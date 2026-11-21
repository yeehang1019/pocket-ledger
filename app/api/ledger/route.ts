import {transactionVersion} from '@/lib/transaction-version';
import type {Commitment,PlanData} from '@/lib/commitments';
import type {TransactionRow,RuleRow,OccurrenceRow} from '@/lib/ledger-records';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {CURRENCIES,CATEGORIES,INCOME_CATEGORIES,minor,today,validDate,dates} from '@/lib/ledger-domain';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
function db(){if(!env.DB)throw new Error('Database unavailable');return env.DB;}
const editableLedgerTransaction="note<>'周期付款确认' AND id NOT GLOB 'deposit:*'";
const noLinkedPlan="NOT EXISTS (SELECT 1 FROM pocket_commitments p WHERE p.owner=transactions.owner AND p.id=transactions.id AND p.kind='paylater')";
const noInvoiceCoverage=`NOT EXISTS (SELECT 1 FROM pocket_commitments p, json_each(p.data,'$.covers') c
  WHERE p.owner=transactions.owner AND p.kind='paylater' AND p.status='active' AND p.source_key GLOB 'invoice:*'
  AND json_extract(c.value,'$.plan')=transactions.id)`;
const ledgerSnapshot='id=? AND owner=? AND deleted=0 AND title=? AND amount=? AND currency=? AND kind=? AND category=? AND date=? AND note=? AND '+editableLedgerTransaction+' AND '+noInvoiceCoverage;
const unmanagedSnapshot=ledgerSnapshot+' AND '+noLinkedPlan;
const noPaidRows=`NOT EXISTS (SELECT 1 FROM json_each(p.data,'$.rows') r WHERE COALESCE(json_extract(r.value,'$.paid_date'),'')<>'')`;
async function auth(){const user=await getChatGPTUser();return user?.userId;}
async function reconcile(owner:string,now:string,ruleId?:string){
 const database=db(); const rows=await database.prepare("SELECT * FROM rules WHERE owner=? AND status='active'").bind(owner).all<RuleRow>();
 for(const r of rows.results){
 if((ruleId&&r.id!==ruleId)||r.processed_through>=now)continue;
 const due=dates(r.start,r.frequency,now,r.month_days).filter(d=>d>r.processed_through);const statements=[];
 for(const date of due){const id=r.id+':'+date;
 statements.push(database.prepare('INSERT OR IGNORE INTO occurrences (id,owner,rule_id,due,status,title,amount,currency,kind,category) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rules WHERE id=? AND owner=? AND revision=? AND status=\'active\')').bind(id,owner,r.id,date,r.mode==='fixed'?'awaiting':'pending',r.title,r.amount,r.currency,r.kind,r.category,r.id,owner,r.revision));
 }
 // Chunked idempotent batches tolerate interruptions without marking unprocessed dates complete.
 for(let i=0;i<statements.length;i+=80)await database.batch(statements.slice(i,i+80));
 await database.prepare('UPDATE rules SET processed_through=MAX(processed_through,?) WHERE id=? AND owner=? AND revision=? AND status=\'active\'').bind(now,r.id,owner,r.revision).run();
 }
}
const occurrenceHistoryLimit=5000;
async function readOccurrences(database:D1Database,owner:string){
 const result=await database.prepare(`WITH classified AS (
  SELECT o.*, CASE WHEN o.status IN ('pending','unpaid') OR
   (o.status='awaiting' AND o.kind='income') OR
   (o.status IN ('awaiting','recorded') AND o.kind='expense' AND NOT EXISTS (
    SELECT 1 FROM pocket_commitments p WHERE p.owner=o.owner AND p.id='rule:'||o.rule_id||':'||o.due
    AND p.kind='confirmation' AND CASE WHEN p.status='ignored' THEN 1 WHEN json_valid(p.data) THEN
     COALESCE(json_extract(p.data,'$.paid_date'),'')<>'' AND json_extract(p.data,'$.amount')=o.amount
    ELSE 0 END
   )) THEN 1 ELSE 0 END AS unresolved
  FROM occurrences o WHERE o.owner=?
 ), ranked AS (
  SELECT *,ROW_NUMBER() OVER (PARTITION BY unresolved ORDER BY due DESC,id DESC) AS position FROM classified
 ) SELECT * FROM ranked WHERE unresolved=1 OR position<=? ORDER BY due DESC,id DESC`)
 .bind(owner,occurrenceHistoryLimit+1).all<OccurrenceRow&{unresolved:number;position:number}>();
 const occurrences:OccurrenceRow[]=[];
 let truncated=false;
 for(const {unresolved,position,...row} of result.results){
  if(!unresolved&&position>occurrenceHistoryLimit)truncated=true;
  else occurrences.push(row);
 }
 return {occurrences,pending:occurrences.filter(o=>o.status==='pending').reverse(),truncated};
}
export async function GET(){try{const owner=await auth();if(!owner)return response({error:'请先登录验证'},401);
 const database=db(); const [tx,rules,budgets,trip,tripState,groupLabels,terms]=await Promise.all([database.prepare('SELECT * FROM transactions WHERE owner=? AND deleted=0 ORDER BY date DESC,created_at DESC LIMIT 10001').bind(owner).all<TransactionRow>(),database.prepare('SELECT * FROM rules WHERE owner=? ORDER BY created_at DESC').bind(owner).all(),database.prepare('SELECT month,currency,category,amount FROM budgets WHERE owner=? ORDER BY month DESC LIMIT 240').bind(owner).all(),database.prepare('SELECT * FROM trip_entries WHERE owner=? AND deleted=0 ORDER BY date DESC LIMIT 10001').bind(owner).all(),database.prepare('SELECT status,last_completed FROM trip_sync WHERE owner=?').bind(owner).first<{status:string;last_completed:string}>(),database.prepare('SELECT group_id,label FROM trip_group_labels WHERE owner=?').bind(owner).all(),readOccurrences(database,owner)]);
 return response({...terms,transactions:tx.results.slice(0,10000).map(t=>({...t,edit_version:transactionVersion(t)})),truncated:terms.truncated||tx.results.length>10000||trip.results.length>10000,rules:rules.results,budgets:budgets.results,trip_entries:trip.results.slice(0,10000),trip_sync:tripState||null,group_labels:groupLabels.results,today:today()});
 }catch(e){console.error('ledger.read',e);return response({error:'暂时无法读取账本，请稍后重试'},503);}}
export async function POST(req:Request){try{
 const businessDay=today();
 const owner=await auth();if(!owner)return response({error:'请先登录验证'},401);
 const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)return response({error:'请求来源无效'},403);
 if(Number(req.headers.get('content-length')||0)>16000)return response({error:'请求过大'},413);
 const raw=await req.text();if(raw.length>16000)return response({error:'请求过大'},413);const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))return response({error:'请求格式无效'},400);const database=db();
 const idempotencyKey=req.headers.get('Idempotency-Key');
 if(b.action==='transaction'&&idempotencyKey&&idempotencyKey!==b.id)return response({error:'防重复标识与记录不一致，请重新打开表单'},409);
 const categoryAllowed=async(c:unknown)=>typeof c==='string'&&(CATEGORIES.includes(c)||INCOME_CATEGORIES.includes(c)||!!await database.prepare('SELECT 1 FROM pocket_categories WHERE owner=? AND name=?').bind(owner,c).first());
 if(b.action==='group_label'){
  if(typeof b.group_id!=='string'||b.group_id.length>150||!b.group_id||typeof b.label!=='string'||b.label.length>60)return response({error:'组别名称无效'},400);
  const group=await database.prepare("SELECT 1 FROM trip_entries WHERE owner=? AND group_id=? LIMIT 1").bind(owner,b.group_id).first();
  if(!group)return response({error:'组别不存在'},404);
  const label=b.label.trim();
  if(label)await database.prepare('INSERT INTO trip_group_labels(owner,group_id,label) VALUES (?,?,?) ON CONFLICT(owner,group_id) DO UPDATE SET label=excluded.label').bind(owner,b.group_id,label).run();
  else await database.prepare('DELETE FROM trip_group_labels WHERE owner=? AND group_id=?').bind(owner,b.group_id).run();
  return response({ok:true});
 }
 if(b.action==='budget'){
  if(typeof b.month!=='string'||!/^20\d\d-(0[1-9]|1[0-2])$/.test(b.month)||!CURRENCIES.includes(b.currency)||!(b.category==='all'||await categoryAllowed(b.category)))return response({error:'预算月份、币种或分类无效'},400);
  if(b.amount===''){
   await database.prepare('DELETE FROM budgets WHERE owner=? AND month=? AND currency=? AND category=?').bind(owner,b.month,b.currency,b.category).run();return response({ok:true});
  }
  const amount=minor(String(b.amount),b.currency);
  await database.prepare('INSERT INTO budgets (owner,month,currency,category,amount) VALUES (?,?,?,?,?) ON CONFLICT(owner,month,currency,category) DO UPDATE SET amount=excluded.amount').bind(owner,b.month,b.currency,b.category,amount).run();return response({ok:true});
 }
 if(b.action==='sync'){await reconcile(owner,businessDay);return response({ok:true});}
 if(b.action==='delete'){
 const tx=await database.prepare('SELECT * FROM transactions WHERE id=? AND owner=?').bind(String(b.id),owner).first<TransactionRow>();
 if(!tx)return response({error:'记录不存在'},404);
 if(tx.note==='周期付款确认'||tx.id.startsWith('deposit:'))return response({error:'此交易由账单管理'},409);
 const plan=await database.prepare("SELECT * FROM pocket_commitments WHERE owner=? AND id=? AND kind='paylater'").bind(owner,tx.id).first<Commitment>();
 if(plan&&!['keep','cancel'].includes(b.plan_disposition))return response({error:'请选择如何处理还款计划'},400);
 if(tx.deleted){
  const replayGuard=plan?noInvoiceCoverage:noInvoiceCoverage+' AND '+noLinkedPlan;
  if(!await database.prepare('SELECT 1 FROM transactions WHERE id=? AND owner=? AND deleted=1 AND '+editableLedgerTransaction+' AND '+replayGuard).bind(tx.id,owner).first())return response({error:'此交易由账单管理'},409);
  return plan&&b.plan_disposition==='cancel'&&plan.status!=='cancelled'?response({error:'消费已删除，计划仍保留，请到账单页核对'},409):response({ok:true});
 }
 if(plan&&b.plan_revision!==plan.revision)return response({error:'还款计划已变更，请重新载入'},409);
 if(plan&&(JSON.parse(plan.data) as PlanData).rows.some(r=>r.paid_date))return response({error:'已有付款记录，请到账单 → PayLater 核对付款历史'},409);
 if(b.edit_version!==transactionVersion(tx))return response({error:'这笔记录已在其他设备修改，请重新载入后再删除'},409);
 const values=[tx.id,owner,tx.title,tx.amount,tx.currency,tx.kind,tx.category,tx.date,tx.note||''];
 const stmts=[];
 let deleteGuard=unmanagedSnapshot,planValues:unknown[]=[];
 if(plan){
  const linkedPlan="SELECT 1 FROM pocket_commitments p WHERE p.owner=transactions.owner AND p.id=transactions.id AND p.kind='paylater'";
  if(b.plan_disposition==='cancel'){
   const mutation=crypto.randomUUID();
   stmts.push(database.prepare("UPDATE pocket_commitments AS p SET status='cancelled',revision=revision+1,mutation=? WHERE owner=? AND id=? AND kind='paylater' AND revision=? AND "+noPaidRows+" AND EXISTS (SELECT 1 FROM transactions WHERE "+ledgerSnapshot+")").bind(mutation,owner,tx.id,plan.revision,...values));
   deleteGuard=ledgerSnapshot+" AND EXISTS ("+linkedPlan+" AND p.mutation=?)";
   planValues=[mutation];
  }else{
   deleteGuard=ledgerSnapshot+" AND EXISTS ("+linkedPlan+" AND p.revision=? AND "+noPaidRows+")";
   planValues=[plan.revision];
  }
 }
 if(tx.rule_id)stmts.push(database.prepare("UPDATE occurrences SET status='skipped' WHERE rule_id=? AND due=? AND owner=? AND EXISTS (SELECT 1 FROM transactions WHERE "+deleteGuard+")").bind(tx.rule_id,tx.occurrence,owner,...values,...planValues));
 stmts.push(database.prepare('UPDATE transactions SET deleted=1 WHERE '+deleteGuard).bind(...values,...planValues));
 const result=await database.batch(stmts);return result[result.length-1].meta.changes?response({ok:true}):response({error:plan?'记录已变更或计划已归入平台月账单，请重新载入并到账单 → PayLater 核对':'记录已变更或由账单管理，请重新载入后核对'},409);
 }
 if(b.action==='status'){
 if(!['active','paused','ended'].includes(b.status))return response({error:'无效状态'},400);
 await reconcile(owner,businessDay);
 // Resume starts now; dates while paused are deliberately not backfilled.
 const changed=await database.prepare("UPDATE rules SET status=?,processed_through=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND status!='ended'").bind(b.status,businessDay,String(b.id),owner,b.revision??-1).run();if(!changed.meta.changes)return response({error:'规则已在其他设备修改，请重新载入'},409);return response({ok:true});
 }
 if(b.action==='receive'){
  const o=await database.prepare("SELECT * FROM occurrences WHERE id=? AND owner=? AND kind='income' AND status IN ('pending','awaiting')").bind(String(b.id),owner).first<OccurrenceRow>();
  if(!o)return response({error:'本期收入已处理或不存在，请重新载入'},409);
  if(!validDate(b.date)||b.date>businessDay)return response({error:'请填写实际到账日期，不能是未来日期'},400);
  const amount=b.amount!==undefined&&b.amount!==''?minor(String(b.amount),o.currency):o.amount;
  if(!Number.isSafeInteger(amount)||amount<=0)return response({error:'请填写实际到账金额'},400);
  await database.batch([
   database.prepare("INSERT OR IGNORE INTO transactions(id,owner,title,amount,currency,kind,category,date,note,rule_id,occurrence,deleted,created_at) SELECT id,owner,title,?,currency,'income',category,?,'周期收入到账确认',rule_id,due,0,? FROM occurrences WHERE id=? AND owner=? AND kind='income' AND status IN ('pending','awaiting') AND amount=?").bind(amount,b.date,new Date().toISOString(),o.id,owner,o.amount),
   database.prepare("UPDATE occurrences SET status='recorded',amount=? WHERE id=? AND owner=? AND kind='income' AND status IN ('pending','awaiting') AND amount=? AND EXISTS (SELECT 1 FROM transactions WHERE id=? AND owner=? AND deleted=0 AND kind='income' AND amount=? AND date=?)").bind(amount,o.id,owner,o.amount,o.id,owner,amount,b.date)
  ]);
  const booked=await database.prepare("SELECT t.amount,t.date,o.status FROM transactions t JOIN occurrences o ON o.id=t.id AND o.owner=t.owner WHERE t.owner=? AND t.id=? AND t.deleted=0").bind(owner,o.id).first<{amount:number;date:string;status:string}>();
  return booked?.status==='recorded'&&booked.amount===amount&&booked.date===b.date?response({ok:true,record:{id:o.id,date:booked.date,currency:o.currency}}):response({error:'本期已在其他设备处理，请重新载入'},409);
 }
 if(b.action==='skip'||b.action==='confirm'){
 const o=await database.prepare("SELECT * FROM occurrences WHERE id=? AND owner=? AND status='pending'").bind(String(b.id),owner).first<OccurrenceRow>();if(!o)return response({error:'该期账单已处理，请刷新'},409);
 if(o.kind==='income'&&b.action==='confirm')return response({error:'请使用确认到账并填写实际到账日期'},400);
 if(b.action==='skip'){const result=await database.prepare("UPDATE occurrences SET status='skipped' WHERE id=? AND owner=? AND status='pending'").bind(o.id,owner).run();if(!result.meta.changes)return response({error:'本期已在其他设备处理，请重新载入'},409);}
 else{const amount=minor(String(b.amount),o.currency),term=`rule:${o.rule_id}:${o.due}`;const results=await database.batch([
 database.prepare("UPDATE occurrences SET status=?,amount=? WHERE id=? AND owner=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM pocket_commitments WHERE owner=? AND id=? AND status='ignored')").bind(o.kind==='expense'?'awaiting':'recorded',amount,o.id,owner,owner,term)]);
 if(!results[0].meta.changes)return response({error:'本期已忽略或在其他设备处理，请重新载入；恢复后才能填金额'},409);}
 return response({ok:true});
 }
 if(!['transaction','rule','rule_edit','edit'].includes(b.action))return response({error:'无效操作'},400);
 if(typeof b.title!=='string'||!b.title.trim()||b.title.length>100||!CURRENCIES.includes(b.currency)||!['income','expense','refund'].includes(b.kind)||!await categoryAllowed(b.category)||typeof b.date!=='string'||!validDate(b.date))return response({error:'请检查名称、日期、币种和分类'},400);
 const isRule=b.action==='rule'||b.action==='rule_edit';
 if(b.kind==='income'&&!INCOME_CATEGORIES.includes(b.category)||b.kind!=='income'&&b.category!=='其他'&&INCOME_CATEGORIES.includes(b.category))return response({error:'分类与收支类型不符，请重新选择'},400);
 const amount=isRule&&b.mode==='variable'?0:minor(String(b.amount),b.currency);
 const id=String(b.id);if(!/^[\w:-]{8,100}$/.test(id))return response({error:'无效记录标识'},400);
 if(isRule){
 if(!['monthly','weekly','fortnightly','semimonthly','yearly'].includes(b.frequency)||!['fixed','variable'].includes(b.mode)||b.kind==='refund')return response({error:'周期设置无效'},400);
 let monthDays='';
 if(b.frequency==='semimonthly'){
  if(typeof b.month_days!=='string'||!/^\d{1,2},\d{1,2}$/.test(b.month_days))return response({error:'请选择每月两个不同的日期'},400);
  const days=b.month_days.split(',').map(Number).sort((a:number,b:number)=>a-b);
  if(days.some((d:number)=>d<1||d>31)||days[0]===days[1])return response({error:'请选择 1 至 31 日之间两个不同的日期'},400);
  monthDays=days.join(',');
 }
 if(b.action==='rule_edit'){
  const existing=await database.prepare('SELECT * FROM rules WHERE id=? AND owner=?').bind(id,owner).first<RuleRow>();
  if(!existing)return response({error:'周期规则不存在'},404);
  if(existing.status==='ended')return response({error:'已结束的规则不能修改，请创建新规则'},409);
  if(!Number.isSafeInteger(b.revision)||b.revision!==existing.revision)return response({error:'规则已被其他操作修改，请刷新后再编辑'},409);
  // Finish overdue dates under the old terms. New terms apply strictly after today.
  await reconcile(owner,businessDay,id);
  const updated=await database.prepare("UPDATE rules SET title=?,amount=?,currency=?,kind=?,category=?,start=?,frequency=?,month_days=?,mode=?,processed_through=MAX(processed_through,?),revision=revision+1 WHERE id=? AND owner=? AND revision=? AND status!='ended'").bind(b.title.trim(),amount,b.currency,b.kind,b.category,b.date,b.frequency,monthDays,b.mode,businessDay,id,owner,b.revision).run();
  if(!updated.meta.changes)return response({error:'规则已被其他操作修改，请刷新后再编辑'},409);
  return response({ok:true});
 }
 const count=await database.prepare("SELECT COUNT(*) AS n FROM rules WHERE owner=? AND status!='ended'").bind(owner).first<{n:number}>();if(count&&count.n>=100)return response({error:'最多支持 100 条未结束的周期规则'},400);
 await database.prepare('INSERT OR IGNORE INTO rules (id,owner,title,amount,currency,kind,category,start,frequency,month_days,mode,status,processed_through,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,owner,b.title.trim(),amount,b.currency,b.kind,b.category,b.date,b.frequency,monthDays,b.mode,'active','',new Date().toISOString()).run();
 const savedRule=await database.prepare('SELECT * FROM rules WHERE id=? AND owner=?').bind(id,owner).first<RuleRow>();
 if(!savedRule||JSON.stringify([savedRule.title,savedRule.amount,savedRule.currency,savedRule.kind,savedRule.category,savedRule.start,savedRule.frequency,savedRule.month_days,savedRule.mode,savedRule.status])!==JSON.stringify([b.title.trim(),amount,b.currency,b.kind,b.category,b.date,b.frequency,monthDays,b.mode,'active']))return response({error:'这个提交标识已有不同周期规则，请重新载入核对；未覆盖原规则'},409);
 await reconcile(owner,businessDay);
 }else{
 if(b.action!=='edit'&&b.date>businessDay)return response({error:'实际交易不能使用未来日期，请创建周期账单'},400);
 const note=String(b.note||'');if(note.length>500)return response({error:'备注最多 500 字'},400);
 if(b.action==='edit'){
 const existing=await database.prepare('SELECT * FROM transactions WHERE id=? AND owner=? AND deleted=0').bind(id,owner).first<TransactionRow>();
 if(!existing)return response({error:'记录不存在'},404);
 if(b.date>businessDay&&!(existing.rule_id&&existing.kind==='expense'&&b.kind==='expense'&&b.date===existing.date))return response({error:'不能把实际交易改成未来日期'},400);
 if(b.edit_version!==transactionVersion(existing))return response({error:'这笔记录已在其他设备修改',current_version:transactionVersion(existing)},409);
 const guardValues=[id,owner,existing.title,existing.amount,existing.currency,existing.kind,existing.category,existing.date,existing.note||''];
 const results=await database.batch([
 database.prepare("UPDATE occurrences SET title=?,amount=?,currency=?,kind=?,category=? WHERE id=? AND owner=? AND status IN ('recorded','awaiting') AND EXISTS (SELECT 1 FROM transactions WHERE "+unmanagedSnapshot+")").bind(b.title.trim(),amount,b.currency,b.kind,b.category,id,owner,...guardValues),
 database.prepare('UPDATE transactions SET title=?,amount=?,currency=?,kind=?,category=?,date=?,note=? WHERE '+unmanagedSnapshot).bind(b.title.trim(),amount,b.currency,b.kind,b.category,b.date,note,...guardValues)]);
 if(!results[1].meta.changes)return response({error:'记录已变更或由账单管理，请重新载入后核对'},409);
 }else{
  await database.prepare('INSERT OR IGNORE INTO transactions (id,owner,title,amount,currency,kind,category,date,note,deleted,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,owner,b.title.trim(),amount,b.currency,b.kind,b.category,b.date,note,0,new Date().toISOString()).run();
  const saved=await database.prepare('SELECT * FROM transactions WHERE id=? AND owner=?').bind(id,owner).first<TransactionRow>();
  if(!saved||saved.rule_id||transactionVersion(saved)!==transactionVersion({title:b.title.trim(),amount,currency:b.currency,kind:b.kind,category:b.category,date:b.date,note,deleted:0}))return response({error:'这个提交标识已有不同记录，请重新载入后核对；未覆盖原记录'},409);
 }
 }return response({ok:true});
 }catch(e){if(e instanceof SyntaxError)return response({error:'请求格式无效'},400);if(e instanceof Error&&/金额|小数|整数/.test(e.message))return response({error:e.message},400);console.error('ledger.write',e);return response({error:'保存失败，你的输入已保留，请重试'},503);}}
