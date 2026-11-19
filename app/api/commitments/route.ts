import type {TransactionRow,RuleRow,OccurrenceRow,TripEntryRow} from '@/lib/ledger-records';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {CURRENCIES,CATEGORIES,INCOME_CATEGORIES,minor,today,validDate,dates} from '@/lib/ledger-domain';
import {transactionVersion} from '@/lib/transaction-version';
import {paymentMethods,planRows,validateRows,tripPlan,depositHeld,allCommitments,type Commitment,type PlanData,type DepositData,type Instalment} from '@/lib/commitments';
export const dynamic='force-dynamic';
class Conflict extends Error {}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return reply({error:'请先登录'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'请求来源无效'},403);
 const raw=await req.text();if(raw.length>32000)return reply({error:'请求过大'},413);
 const b=JSON.parse(raw),owner=user.userId,db=env.DB;if(!db)return reply({error:'数据库暂不可用'},503);if(!b||typeof b.id!=='string'||!/^[-\w:]{8,240}$/.test(b.id))return reply({error:'记录标识无效'},400);
 const saved=await db.prepare('SELECT * FROM pocket_commitments WHERE owner=? AND id=?').bind(owner,b.id).first<Commitment>();
 const source=b.id.startsWith('trip:')?await db.prepare("SELECT * FROM trip_entries WHERE owner=? AND 'trip:'||group_id||':'||record_id||':'||member_id=? AND record_type='expense'").bind(owner,b.id).first<TripEntryRow>():null;
 const imported=source?tripPlan(source):null,current=saved||imported;
 const revision=saved?.revision??-1,mutation=crypto.randomUUID();
 const write=(p:Commitment)=>saved?db.prepare('UPDATE pocket_commitments SET title=?,currency=?,source_key=?,source_signature=?,data=?,status=?,revision=revision+1,mutation=? WHERE owner=? AND id=? AND revision=?').bind(p.title,p.currency,p.source_key,p.source_signature,p.data,p.status,mutation,owner,b.id,revision):db.prepare('INSERT OR IGNORE INTO pocket_commitments(owner,id,kind,title,currency,source_key,source_signature,data,revision,status,mutation) VALUES (?,?,?,?,?,?,?,?,0,?,?)').bind(owner,b.id,p.kind,p.title,p.currency,p.source_key,p.source_signature,p.data,p.status,mutation);
 const guarded=(sql:string,params:unknown[])=>db.prepare(sql+" WHERE EXISTS (SELECT 1 FROM pocket_commitments WHERE owner=? AND id=? AND mutation=?)").bind(...params,owner,b.id,mutation);
 const checkRevision=()=>{if(b.revision!==revision)throw new Conflict('记录已更新，请刷新后重试')};
 if(b.action==='ruleignore'||b.action==='ruleunignore'){
  if(saved&&saved.kind!=='confirmation')return reply({error:'记录类型冲突'},409);
  if(!validDate(b.due)||typeof b.rule_id!=='string'||b.id!==`rule:${b.rule_id}:${b.due}`)return reply({error:'账单标识无效'},400);
  checkRevision();
  const rule=await db.prepare('SELECT * FROM rules WHERE owner=? AND id=?').bind(owner,b.rule_id).first<RuleRow>();
  const occ=await db.prepare('SELECT * FROM occurrences WHERE owner=? AND rule_id=? AND due=?').bind(owner,b.rule_id,b.due).first<OccurrenceRow>();
  if(!rule||(occ?.kind??rule.kind)!=='expense'||!occ&&(rule.status!=='active'||!dates(rule.start,rule.frequency,b.due,rule.month_days).includes(b.due)))return reply({error:'本期账单不存在'},404);
  if(b.action==='ruleunignore'&&saved?.status!=='ignored')return reply({error:'该期并未忽略，请刷新'},409);
  if(b.action==='ruleignore'&&(saved?.status==='ignored'||occ&& !['pending','awaiting','recorded'].includes(occ.status)||saved&&JSON.parse(saved.data).paid_date&&JSON.parse(saved.data).amount===(occ?.amount??rule.amount)))return reply({error:'本期已处理，请刷新'},409);
  const data=saved?JSON.parse(saved.data):{due:b.due,rule_id:rule.id,paid_date:'',amount:occ?.amount??rule.amount};
  // Only a per-term disposition. Never touch transactions, occurrences or the recurring rule.
  await write({id:b.id,kind:'confirmation',title:occ?.title??rule.title,currency:occ?.currency??rule.currency,source_key:b.rule_id,source_signature:'',data:JSON.stringify({...data,ignored_at:b.action==='ruleignore'?new Date().toISOString():''}),revision,status:b.action==='ruleignore'?'ignored':'active'}).run();
 }else if(['rulepay','ruleunpay','ruleamount'].includes(b.action)){
  if(saved?.status==='ignored')return reply({error:'本期已忽略，请先恢复再确认付款'},409);
  if(saved&&saved.kind!=='confirmation')return reply({error:'记录类型冲突'},409);
  if(!validDate(b.due)||typeof b.rule_id!=='string'||b.id!==`rule:${b.rule_id}:${b.due}`)return reply({error:'账单标识无效'},400);
  const rule=await db.prepare('SELECT * FROM rules WHERE owner=? AND id=?').bind(owner,b.rule_id).first<RuleRow>();
  const occ=await db.prepare('SELECT * FROM occurrences WHERE owner=? AND rule_id=? AND due=?').bind(owner,b.rule_id,b.due).first<OccurrenceRow>();
  if(occ&&!['recorded','awaiting','pending'].includes(occ.status))return reply({error:'请先填写本期金额；已跳过的账单不可确认付款'},409);
  if(!rule||(occ?.kind??rule.kind)!=='expense'||!occ&&(rule.status!=='active'||!dates(rule.start,rule.frequency,b.due,rule.month_days).includes(b.due)))return reply({error:'请先填写本期金额或核对周期规则'},400);
  checkRevision();
  const fill=b.action==='ruleamount'||occ?.status==='pending';
  if(b.action==='ruleamount'&&(occ?occ.status!=='pending':rule.mode!=='variable'))return reply({error:'本期已填写或不可填写，请刷新'},409);
  if(b.action==='rulepay'&&saved&&JSON.parse(saved.data).paid_date&&(occ?.amount??rule.amount)===JSON.parse(saved.data).amount)return reply({error:'本期已确认付款，请到账单历史查看'},409);
  if(b.action==='ruleunpay'&&(!saved||!JSON.parse(saved.data).paid_date))return reply({error:'本期尚未付款'},409);
  if(b.action==='rulepay'&&(!validDate(b.date)||b.date>today()))return reply({error:'请填写实际付款日期'},400);
  const tx=await db.prepare('SELECT * FROM transactions WHERE owner=? AND rule_id=? AND occurrence=?').bind(owner,rule.id,b.due).first<TransactionRow>();
  const oldData=saved?JSON.parse(saved.data):{},amount=fill?minor(String(b.amount),occ?.currency??rule.currency):occ?.amount??(oldData.amount>0?oldData.amount:rule.mode==='fixed'?rule.amount:minor(String(b.amount),rule.currency));
  if(tx&&(tx.deleted&&!oldData.managed_transaction||tx.amount!==amount||tx.currency!==(occ?.currency??rule.currency)))return reply({error:'本期已有不同或已删除的支出，请先核对原记录'},409);
  const managed=oldData.managed_transaction||!tx,txid=tx?.id??occ?.id??`${rule.id}:${b.due}`;
  const data={...oldData,due:b.due,rule_id:rule.id,paid_date:b.action==='rulepay'?b.date:'',amount,managed_transaction:managed};
  const title=occ?.title??rule.title,currency=occ?.currency??rule.currency;
  if(b.action==='rulepay'&&occ?.status==='awaiting'&&b.amount&&minor(String(b.amount),currency)!==occ.amount)return reply({error:'本期金额已变化，请刷新后核对'},409);
  const guard=(occ?'EXISTS (SELECT 1 FROM occurrences WHERE owner=? AND id=? AND status=? AND amount=?)':'NOT EXISTS (SELECT 1 FROM occurrences WHERE owner=? AND rule_id=? AND due=?)')+' AND EXISTS (SELECT 1 FROM rules WHERE owner=? AND id=? AND revision=?)';
  const txCondition=tx?'EXISTS (SELECT 1 FROM transactions WHERE owner=? AND id=? AND deleted=? AND title=? AND amount=? AND currency=? AND kind=? AND category=? AND date=? AND note=?)':'NOT EXISTS (SELECT 1 FROM transactions WHERE owner=? AND rule_id=? AND occurrence=?)';
  const values=[...(occ?[owner,occ.id,occ.status,occ.amount]:[owner,rule.id,b.due]),owner,rule.id,rule.revision,...(tx?[owner,tx.id,tx.deleted,tx.title,tx.amount,tx.currency,tx.kind,tx.category,tx.date,tx.note||'']:[owner,rule.id,b.due])];
  const statements=[saved?db.prepare("UPDATE pocket_commitments SET title=?,currency=?,data=?,revision=revision+1,mutation=? WHERE owner=? AND id=? AND revision=? AND "+guard+' AND '+txCondition).bind(title,currency,JSON.stringify(data),mutation,owner,b.id,revision,...values):db.prepare("INSERT OR IGNORE INTO pocket_commitments(owner,id,kind,title,currency,source_key,source_signature,data,revision,status,mutation) SELECT ?,?,'confirmation',?,?,?,'',?,0,'active',? WHERE "+guard+' AND '+txCondition).bind(owner,b.id,title,currency,b.rule_id,JSON.stringify(data),mutation,...values)];
  if(b.action==='rulepay'||b.action==='ruleamount'){
   // Atomic acknowledgement + one canonical expense. The expense date is always the due date.
   if(!occ)statements.push(guarded('INSERT OR IGNORE INTO occurrences(id,owner,rule_id,due,status,title,amount,currency,kind,category) SELECT ?,?,?,?,?,?,?,?,?,?',[txid,owner,rule.id,b.due,'awaiting',rule.title,amount,rule.currency,'expense',rule.category]));
   if(fill&&occ)statements.push(db.prepare("UPDATE occurrences SET amount=?,status='awaiting' WHERE owner=? AND id=? AND EXISTS (SELECT 1 FROM pocket_commitments WHERE owner=? AND id=? AND mutation=?)").bind(amount,owner,occ.id,owner,b.id,mutation));
   if(b.action==='rulepay'&&!tx)statements.push(guarded('INSERT INTO transactions(id,owner,title,amount,currency,kind,category,date,note,rule_id,occurrence,deleted,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,0,?',[txid,owner,occ?.title??rule.title,amount,occ?.currency??rule.currency,'expense',occ?.category??rule.category,b.due,'周期付款确认',rule.id,b.due,new Date().toISOString()]));
   if(b.action==='rulepay'&&managed)statements.push(db.prepare("UPDATE transactions SET deleted=0 WHERE owner=? AND id=? AND note='周期付款确认' AND EXISTS (SELECT 1 FROM pocket_commitments WHERE owner=? AND id=? AND mutation=?)").bind(owner,txid,owner,b.id,mutation));
  }else if(managed){
   // Undo only the expense created by this workflow; never remove a legacy/manual expense.
   if(tx&&(tx.note!=='周期付款确认'||tx.date!==b.due))return reply({error:'支出已修改，请先核对原记录后再撤销'},409);
   statements.push(db.prepare("UPDATE transactions SET deleted=1 WHERE owner=? AND id=? AND note='周期付款确认' AND EXISTS (SELECT 1 FROM pocket_commitments WHERE owner=? AND id=? AND mutation=?)").bind(owner,txid,owner,b.id,mutation));
  }
  await db.batch(statements);
  const after=await db.prepare('SELECT mutation FROM pocket_commitments WHERE owner=? AND id=?').bind(owner,b.id).first<{mutation:string}>();
  if(after?.mutation!==mutation)return reply({error:'本期已在其他设备修改，请重新载入'},409);
  return reply(b.action==='rulepay'?{ok:true,record:{id:txid,date:tx?.date??b.due,currency}}:{ok:true});
 }else if(b.action==='invoice'){
  if(!/^[\w-]{8,100}$/.test(b.id))return reply({error:'月账单标识无效'},400);
  if(saved)return reply({error:'月账单已存在，请编辑原计划'},409);
  if(!CURRENCIES.includes(b.currency)||!Object.hasOwn(paymentMethods,b.provider)||b.provider==='ordinary'||!validDate(b.due))return reply({error:'请检查平台、币种和到期日期'},400);
  const total=minor(String(b.amount),b.currency),month=b.due.slice(0,7),sourceKey=`invoice:${b.provider}:${month}`;
  const stored=(await db.prepare('SELECT * FROM pocket_commitments WHERE owner=?').bind(owner).all<Commitment>()).results;
  const trips=(await db.prepare("SELECT * FROM trip_entries WHERE owner=? AND paylater<>''").bind(owner).all<TripEntryRow>()).results;
  const plans=allCommitments(stored,trips).filter(p=>p.kind==='paylater'&&p.currency===b.currency&&p.status==='active');
  if(plans.some(p=>p.source_key===sourceKey))return reply({error:'这个平台和月份已有月账单，请编辑原账单'},409);
  const already=new Set(plans.flatMap(p=>(JSON.parse(p.data) as PlanData).covers||[]).map(c=>c.row));
  const covers=plans.filter(p=>!p.source_key.startsWith('invoice:')).flatMap(p=>{const d=JSON.parse(p.data) as PlanData;if(d.provider!==b.provider)return [];return d.rows.filter(r=>!r.paid_date&&r.due.startsWith(month)).map(r=>{if(p.review||already.has(r.id))throw Error('有关联计划需先核对，或已经归入其他月账单');return {plan:p.id,row:r.id,amount:r.amount};})});
  if(total<covers.reduce((n,c)=>n+c.amount,0))return reply({error:'月账单小于已关联分期合计，请先核对各笔金额'},400);
  const title=typeof b.title==='string'&&b.title.trim()?b.title.trim():paymentMethods[b.provider]+' 月账单';if(title.length>100)return reply({error:'名称过长'},400);
  const data:PlanData={provider:b.provider,total,date:today(),months:1,first_due:b.due,rows:planRows(b.id,total,1,b.due),covers};
  await write({id:b.id,kind:'paylater',title,currency:b.currency,source_key:sourceKey,source_signature:'',data:JSON.stringify(data),revision,status:'active'}).run();
 }else if(b.action==='purchase'){
  if(saved&&saved.kind!=='paylater'||!b.id.match(/^[\w-]{8,100}$/)||b.id.startsWith('trip:'))return reply({error:'记录类型不适用'},400);
  const oldTx=await db.prepare('SELECT * FROM transactions WHERE owner=? AND id=?').bind(owner,b.id).first<TransactionRow>();
  if(oldTx?.rule_id)return reply({error:'周期账单的 PayLater 应付请在平台月账单中登记，不要再记一次消费'},409);
  if(oldTx&&!b.edit&&!saved)return reply({error:'交易已存在，请编辑原记录'},409);
  if(b.edit&&!oldTx||oldTx?.deleted)return reply({error:'交易不存在'},404);
  const title=typeof b.title==='string'&&b.title.trim()?b.title.trim():b.category;
  if(typeof title!=='string'||!title.trim()||title.length>100||!CURRENCIES.includes(b.currency)||b.kind!=='expense'||!validDate(b.date)||b.date>today()||typeof b.category!=='string'||b.category!=='其他'&&INCOME_CATEGORIES.includes(b.category)||!CATEGORIES.includes(b.category)&&!await db.prepare('SELECT 1 FROM pocket_categories WHERE owner=? AND name=?').bind(owner,b.category).first())return reply({error:'请检查消费日期、分类和币种'},400);
  const total=minor(String(b.total||b.amount),b.currency),months=Number(b.months),provider=b.payment_method;
  if(!Object.hasOwn(paymentMethods,provider)||provider==='ordinary'||provider==='grabpaylater'&&months!==1)return reply({error:'请选择有效的 PayLater 平台和期数'},400);
  const rows=planRows(b.id,total,months,b.first_due),old=saved?JSON.parse(saved.data) as PlanData:null;
  if(b.first_due<b.date)return reply({error:'首期还款不能早于消费日期'},400);
  const p:Commitment={id:b.id,kind:'paylater',title,currency:b.currency,source_key:'manual:'+b.id,source_signature:'',data:JSON.stringify({provider,total,date:b.date,months,first_due:b.first_due,rows}),revision,status:'active'};
  const note=String(b.note||'');if(note.length>500)return reply({error:'备注最多 500 字'},400);
  if(saved&&!b.edit)return saved.status==='active'&&saved.source_key===p.source_key&&saved.data===p.data&&saved.title===p.title&&saved.currency===p.currency&&oldTx&&!oldTx.deleted&&transactionVersion(oldTx)===transactionVersion({title,amount:total,currency:b.currency,kind:'expense',category:b.category,date:b.date,note,deleted:0})?reply({ok:true}):reply({error:'该标识已有不同记录，请刷新；未覆盖原记录'},409);
  if(saved)checkRevision();
  if(old?.rows.some(r=>r.paid_date))return reply({error:'已开始还款，请在账单中调整未付各期；不能重建交易'},409);
  if(b.edit&&(!oldTx||b.edit_version!==transactionVersion(oldTx)))return reply({error:'这笔记录已在其他设备修改，请重新载入后重试'},409);
  // Guard the plan write with the transaction snapshot as well as its own revision.
  // This also protects ordinary -> PayLater conversion from a concurrent edit/delete.
  const txGuard='SELECT 1 FROM transactions WHERE owner=? AND id=? AND deleted=0 AND title=? AND amount=? AND currency=? AND kind=? AND category=? AND date=? AND note=?';
  const txValues=oldTx?[owner,b.id,oldTx.title,oldTx.amount,oldTx.currency,oldTx.kind,oldTx.category,oldTx.date,oldTx.note||'']:[];
  const writePlan=b.edit?(saved?db.prepare('UPDATE pocket_commitments SET title=?,currency=?,source_key=?,source_signature=?,data=?,status=?,revision=revision+1,mutation=? WHERE owner=? AND id=? AND revision=? AND EXISTS ('+txGuard+')').bind(p.title,p.currency,p.source_key,p.source_signature,p.data,p.status,mutation,owner,b.id,revision,...txValues):db.prepare('INSERT OR IGNORE INTO pocket_commitments(owner,id,kind,title,currency,source_key,source_signature,data,revision,status,mutation) SELECT ?,?,?,?,?,?,?,?,0,?,? WHERE EXISTS ('+txGuard+')').bind(owner,b.id,p.kind,p.title,p.currency,p.source_key,p.source_signature,p.data,p.status,mutation,...txValues)):db.prepare('INSERT OR IGNORE INTO pocket_commitments(owner,id,kind,title,currency,source_key,source_signature,data,revision,status,mutation) SELECT ?,?,?,?,?,?,?,?,0,?,? WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE owner=? AND id=?)').bind(owner,b.id,p.kind,p.title,p.currency,p.source_key,p.source_signature,p.data,p.status,mutation,owner,b.id);
  const updateTx=b.edit?db.prepare("UPDATE transactions SET title=?,amount=?,currency=?,kind='expense',category=?,date=?,note=? WHERE id=? AND owner=? AND EXISTS (SELECT 1 FROM pocket_commitments WHERE owner=? AND id=? AND mutation=?)").bind(title,total,b.currency,b.category,b.date,note,b.id,owner,owner,b.id,mutation):guarded('INSERT OR IGNORE INTO transactions(id,owner,title,amount,currency,kind,category,date,note,deleted,created_at) SELECT ?,?,?,?,?,?,?,?,?,0,?',[b.id,owner,title,total,b.currency,'expense',b.category,b.date,note,new Date().toISOString()]);
  await db.batch([writePlan,updateTx]);
 }else if(b.action==='deposit'||b.action==='deposit_edit'){
  if(!/^[\w-]{8,100}$/.test(b.id))return reply({error:'押金标识无效'},400);
  if(saved&&b.action==='deposit_edit'){
   checkRevision();if(saved.kind!=='deposit'||!CURRENCIES.includes(b.currency)||!validDate(b.date)||b.date>today())return reply({error:'押金资料无效'},400);
   const d=JSON.parse(saved.data) as DepositData,amount=minor(String(b.amount),b.currency),title=String(b.title||'租房押金').trim();
   if(!title||title.length>100||d.movements.length&&b.currency!==saved.currency||d.movements.some(m=>!m.voided&&m.date<b.date)||amount<d.movements.filter(m=>!m.voided).reduce((n,m)=>n+m.amount,0))return reply({error:'请检查押金金额、交付日期和币种，不能小于已处理金额'},400);
   await write({...saved,title,currency:b.currency,data:JSON.stringify({...d,amount,date:b.date})}).run();
   const after=await db.prepare('SELECT mutation FROM pocket_commitments WHERE owner=? AND id=?').bind(owner,b.id).first<{mutation:string}>();return after?.mutation===mutation?reply({ok:true}):reply({error:'记录已更新，请刷新'},409);
  }
  const title=typeof b.title==='string'&&b.title.trim()?b.title.trim():'租房押金';
  if(saved){const d=JSON.parse(saved.data);return saved.kind==='deposit'&&saved.status==='active'&&saved.title===title&&d.amount===minor(String(b.amount),saved.currency)&&d.date===b.date&&saved.currency===b.currency?reply({ok:true}):reply({error:'押金已存在且内容不同，请重新载入核对'},409);}
  if(title.length>100||!CURRENCIES.includes(b.currency)||!validDate(b.date)||b.date>today())return reply({error:'请检查押金名称、币种和交付日期'},400);
  const data:DepositData={amount:minor(String(b.amount),b.currency),date:b.date,movements:[]};
  await write({id:b.id,kind:'deposit',title,currency:b.currency,source_key:'',source_signature:'',data:JSON.stringify(data),revision:-1,status:'active'}).run();
 }else{
  if(!current)return reply({error:'记录不存在'},404);checkRevision();
  if(current.kind==='paylater'){
   if(b.id.startsWith('trip:')&&(!imported||imported.source_signature!==current.source_signature||imported.currency!==current.currency||JSON.parse(imported.data).date!==JSON.parse(current.data).date)&&!['plan','cancel','unpay'].includes(b.action))return reply({error:'Trip Share 原记录已变化，请先核对还款计划'},409);
   const data=JSON.parse(current.data) as PlanData;
   const other=(await db.prepare("SELECT * FROM pocket_commitments WHERE owner=? AND kind='paylater' AND status='active'").bind(owner).all<Commitment>()).results;
   if(other.some(p=>p.id!==current.id&&(JSON.parse(p.data) as PlanData).covers?.some(c=>c.plan===current.id))&&!['cancel','unpay'].includes(b.action))return reply({error:'此计划已归入平台月账单，请在月账单确认付款；修改前须先取消该月账单'},409);
   if(current.source_key.startsWith('invoice:')&&!['cancel','unpay'].includes(b.action)){
    const entries=(await db.prepare("SELECT * FROM trip_entries WHERE owner=? AND paylater<>''").bind(owner).all<TripEntryRow>()).results;
    if(allCommitments(other,entries).find(p=>p.id===current.id)?.review)return reply({error:'月账单关联的消费已变化，请先核对或取消月账单'},409);
   }
   if(b.action==='cancel'||b.action==='restore'){if(b.action==='cancel'&&data.rows.some(r=>r.paid_date))return reply({error:'请先撤销已付款确认，再取消计划'},409);await write({...current,status:b.action==='cancel'?'cancelled':'active'}).run();
   }else if(b.action==='plan'){
    if(imported&&imported.currency!==current.currency)return reply({error:'源币种已改变，请先取消原计划并核对新的平台账单'},409);
    if(b.id.startsWith('trip:')&&!imported)return reply({error:'源消费已删除或付款方式已改变。原还款记录保留，请先核对平台账单'},409);
    const total=imported?(JSON.parse(imported.data) as PlanData).total:data.total;
    validateRows(b.rows,total);
    for(const row of b.rows)if(row.paid_date&&row.paid_date>today())return reply({error:'实际付款日期不能是未来'},400);
    for(const paid of data.rows.filter(r=>r.paid_date)){const wanted=b.rows.find((r:Instalment)=>r.id===paid.id);if(!wanted||JSON.stringify(wanted)!==JSON.stringify(paid))return reply({error:'已付款的期数不可改写；请先撤销付款确认'},409);}
    if(b.rows.some((r:Instalment)=>r.paid_date&&!data.rows.some(old=>old.id===r.id&&old.paid_date===r.paid_date)))return reply({error:'请通过已付款按钮确认付款'},400);
    data.rows=b.rows;data.total=total;if(imported){const fresh=JSON.parse(imported.data) as PlanData;data.date=fresh.date;data.provider=fresh.provider;}data.months=b.rows.length;data.first_due=b.rows[0].due;
    await write({...current,title:imported?.title||current.title,source_signature:imported?.source_signature||current.source_signature,data:JSON.stringify(data)}).run();
   }else if(b.action==='pay'||b.action==='unpay'){
    const row=data.rows.find(r=>r.id===b.row_id);if(!row)return reply({error:'还款期数不存在'},404);
    if(b.action==='pay'&&(!validDate(b.date)||b.date>today()||!current.source_key.startsWith('invoice:')&&b.date<data.date))return reply({error:'请填写已发生的付款日期'},400);
    row.paid_date=b.action==='pay'?b.date:'';await write({...current,data:JSON.stringify(data)}).run();
   }else return reply({error:'操作无效'},400);
  }else if(b.action==='movement_void'){
   if(current.kind!=='deposit')return reply({error:'记录类型无效'},400);
   const data=JSON.parse(current.data) as DepositData,move=data.movements.find(m=>m.id===b.movement_id);if(!move)return reply({error:'处理记录不存在'},404);if(move.voided)return reply({ok:true});
   move.voided=true;
   const txid=`deposit:${b.id}:${move.id}`;
   const remove=db.prepare('UPDATE transactions SET deleted=1 WHERE owner=? AND id=? AND EXISTS (SELECT 1 FROM pocket_commitments WHERE owner=? AND id=? AND mutation=?)').bind(owner,txid,owner,b.id,mutation);
   await db.batch([write({...current,data:JSON.stringify(data)}),remove]);
  }else if(b.action==='movement'){
   if(current.kind!=='deposit')return reply({error:'记录类型无效'},400);
   const data=JSON.parse(current.data) as DepositData;
   if(typeof b.movement_id!=='string'||!/^[\w-]{8,100}$/.test(b.movement_id)||!['refund','deduct','rent'].includes(b.kind)||!validDate(b.date)||b.date>today()||b.date<data.date)return reply({error:'请检查押金操作、金额和日期'},400);
   const previous=data.movements.find(m=>m.id===b.movement_id);
   if(previous)return !previous.voided&&previous.kind===b.kind&&previous.date===b.date&&previous.amount===minor(String(b.amount),current.currency)&&previous.note===String(b.note||'')?reply({ok:true}):reply({error:'这个提交标识已有不同或已撤销的押金操作，请重新载入核对'},409);
   const amount=minor(String(b.amount),current.currency);if(amount>depositHeld(data))return reply({error:'不能超过尚未退回的押金'},409);
   const note=String(b.note||'');if(note.length>500)return reply({error:'备注最多 500 字'},400);
   data.movements.push({id:b.movement_id,kind:b.kind,amount,date:b.date,note});const statements=[write({...current,data:JSON.stringify(data)})];
   if(b.kind!=='refund')statements.push(guarded('INSERT OR IGNORE INTO transactions(id,owner,title,amount,currency,kind,category,date,note,deleted,created_at) SELECT ?,?,?,?,?,?,?,?,?,0,?',[`deposit:${b.id}:${b.movement_id}`,owner,current.title+(b.kind==='rent'?' · 抵租':' · 扣款'),amount,current.currency,'expense',b.kind==='rent'?'居住':'其他',b.date,note,new Date().toISOString()]));
   await db.batch(statements);
  }else return reply({error:'操作无效'},400);
 }
 const after=await db.prepare('SELECT mutation FROM pocket_commitments WHERE owner=? AND id=?').bind(owner,b.id).first<{mutation:string}>();
 return after?.mutation===mutation?reply({ok:true}):reply({error:'记录已更新，请刷新后重试'},409);
 }catch(error){
  if(error instanceof SyntaxError)return reply({error:'请求格式无效'},400);
  const message=error instanceof Error?error.message:'';console.error('commitment.write',error instanceof Error?error.name:'unknown');
  if(error instanceof Conflict)return reply({error:message},409);
  return /[\u3400-\u9fff]/.test(message)&&!/(SQL|SELECT|INSERT|UPDATE|DELETE|D1_)/.test(message)?reply({error:message},400):reply({error:'保存暂时失败，请保留输入并重试'},503);
 }}
