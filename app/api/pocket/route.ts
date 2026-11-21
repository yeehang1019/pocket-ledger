import type {PocketBill} from '@/lib/pocket-domain';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {CURRENCIES,CATEGORIES,minor,today,validDate} from '@/lib/ledger-domain';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
function database(){if(!env.DB)throw Error('Database unavailable');return env.DB;}
const tables={commitments:'pocket_commitments',bills:'pocket_bills',accounts:'pocket_accounts',templates:'pocket_templates',goals:'pocket_goals',categories:'pocket_categories',range_budgets:'range_budgets'} as const;
const readLimit=2000;
const requiredRows:Partial<Record<keyof typeof tables,string>>={
 // Confirmation rows also carry payment and ignore state for the ledger's recurring rules.
 commitments:`kind='confirmation' OR (status='active' AND (kind='deposit' OR
  (kind='paylater' AND (source_key GLOB 'invoice:*' OR CASE WHEN json_valid(data) THEN
   COALESCE(json_array_length(data,'$.rows'),0)=0 OR EXISTS (
    SELECT 1 FROM json_each(data,'$.rows') r WHERE CASE WHEN r.type='object'
     THEN COALESCE(json_extract(r.value,'$.paid_date'),'')='' ELSE 1 END
   ) ELSE 1 END))))`,
 bills:"status='active' AND (mode IN ('wallet','use') OR (mode IN ('planned','postpaid') AND paid_date=''))",
 accounts:"EXISTS (SELECT 1 FROM pocket_bills b WHERE b.owner=t.owner AND b.account_id=t.id AND b.status='active')",
};
const historyOrder:Partial<Record<keyof typeof tables,string>>={
 bills:'consumption_date DESC,created_at DESC,id DESC',
 commitments:"CASE WHEN json_valid(data) THEN json_extract(data,'$.date') END DESC,id DESC",
 range_budgets:'end DESC,id DESC',
};
export async function GET(){try{
 const u=await getChatGPTUser();if(!u)return reply({error:'请先登录'},401);
 const db=database();
 const results=await Promise.all(Object.entries(tables).map(async([name,table])=>{
  const key=name as keyof typeof tables,order=historyOrder[key]??(key==='categories'?'name':'id');
  const required=requiredRows[key];
  if(!required){
   const {results:rows}=await db.prepare(`SELECT * FROM ${table} WHERE owner=? ORDER BY ${order} LIMIT ?`).bind(u.userId,readLimit+1).all();
   return {key,rows:rows.slice(0,readLimit),truncated:rows.length>readLimit};
  }
  const {results:ranked}=await db.prepare(`WITH classified AS (
   SELECT t.*,CASE WHEN ${required} THEN 1 ELSE 0 END AS required FROM ${table} t WHERE owner=?
  ), ranked AS (
   SELECT *,ROW_NUMBER() OVER (PARTITION BY required ORDER BY ${order}) AS position FROM classified
  ) SELECT * FROM ranked WHERE required=1 OR position<=? ORDER BY ${order}`)
   .bind(u.userId,readLimit+1).all<Record<string,unknown>&{required:number;position:number}>();
  const rows=[];
  let truncated=false;
  for(const {required,position,...row} of ranked){
   if(!required&&position>readLimit)truncated=true;
   else rows.push(row);
  }
  return {key,rows,truncated};
 }));
 return reply({...Object.fromEntries(results.map(({key,rows})=>[key,rows])),truncated:results.some(r=>r.truncated)});
 }catch(e){console.error('pocket.read',e);return reply({error:'暂时无法读取生活账单'},503);}}
export async function POST(req:Request){try{
 const u=await getChatGPTUser();if(!u)return reply({error:'请先登录'},401);const owner=u.userId,db=database();
 if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'请求来源无效'},403);
 const raw=await req.text();if(raw.length>10000)return reply({error:'请求过大'},413);const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))return reply({error:'请求格式无效'},400);
 if(b.action==='category'){const name=typeof b.name==='string'?b.name.trim():'';if(!name||name.length>24)return reply({error:'分类名称需为 1–24 字'},400);const result=await db.prepare('INSERT INTO pocket_categories(owner,name) VALUES (?,?) ON CONFLICT(owner,name) DO NOTHING').bind(owner,name).run();return result.meta.changes||await db.prepare('SELECT 1 FROM pocket_categories WHERE owner=? AND name=?').bind(owner,name).first()?reply({ok:true}):reply({error:'分类未保存'},409);}
 if(typeof b.id!=='string'||!/^[\w-]{8,100}$/.test(b.id))return reply({error:'无效记录标识'},400);
 if(b.action==='remove'){
  const table=(tables as Record<string,string>)[b.entity];if(!table||b.entity==='categories'||b.entity==='commitments')return reply({error:'无效记录类型'},400);
  if(b.entity==='bills'){
   const item=await db.prepare('SELECT * FROM pocket_bills WHERE owner=? AND id=?').bind(owner,b.id).first<PocketBill>();if(!item)return reply({error:'账单不存在'},404);
   // A recharge with active usage cannot disappear underneath its deductions.
   const result=await db.prepare("UPDATE pocket_bills SET status='cancelled' WHERE owner=? AND id=? AND status='active' AND NOT EXISTS (SELECT 1 FROM pocket_bills c WHERE c.owner=? AND c.parent_id=? AND c.status='active')").bind(owner,b.id,owner,b.id).run();
   if(!result.meta.changes)return reply({error:'账单状态已变化，或这笔充值仍有使用记录'},409);
  }else if(b.entity==='accounts'){
   const result=await db.prepare("DELETE FROM pocket_accounts WHERE owner=? AND id=? AND NOT EXISTS (SELECT 1 FROM pocket_bills WHERE owner=? AND account_id=? AND status='active')").bind(owner,b.id,owner,b.id).run();
   if(!result.meta.changes)return reply({error:'信用卡不存在或仍有关联账单'},409);
  }else{
   const result=await db.prepare(`DELETE FROM ${table} WHERE owner=? AND id=?`).bind(owner,b.id).run();
   if(!result.meta.changes)return reply({error:'记录不存在'},404);
  }
  return reply({ok:true});
 }
 if(b.action==='settle'||b.action==='unsettle'||b.action==='activate'){
  const record=await db.prepare('SELECT * FROM pocket_bills WHERE owner=? AND id=?').bind(owner,b.id).first<PocketBill>();if(!record)return reply({error:'账单不存在'},404);
  const mode=b.action==='activate'?'planned':'postpaid';
  if(record.status!=='active'||record.mode!==mode||Boolean(record.paid_date)!==(b.action==='unsettle'))return reply({error:'账单状态不适用此操作'},409);
  if(b.action!=='unsettle'&&(!validDate(b.date)||b.date>today()))return reply({error:'请填写已经发生的日期'},400);
  const guard=" WHERE owner=? AND id=? AND mode=? AND status='active' AND paid_date=?";
  const statement=b.action==='activate'
   ?db.prepare("UPDATE pocket_bills SET mode='postpaid',consumption_date=?"+guard).bind(b.date,owner,b.id,mode,record.paid_date)
   :db.prepare('UPDATE pocket_bills SET paid_date=?'+guard).bind(b.action==='unsettle'?'':b.date,owner,b.id,mode,record.paid_date);
  return (await statement.run()).meta.changes?reply({ok:true}):reply({error:'账单状态已变化，请刷新后重试'},409);
 }
 const title=typeof b.title==='string'?b.title.trim():'';if(!title||title.length>100||!CURRENCIES.includes(b.currency))return reply({error:'请检查名称与币种'},400);
 if(b.action==='account'){
  if(!Number.isInteger(b.statement_day)||!Number.isInteger(b.due_day)||b.statement_day<1||b.statement_day>31||b.due_day<1||b.due_day>31)return reply({error:'账单日与还款日需为 1–31'},400);
  await db.prepare('INSERT INTO pocket_accounts(owner,id,title,currency,statement_day,due_day) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET title=excluded.title,statement_day=excluded.statement_day,due_day=excluded.due_day').bind(owner,b.id,title,b.currency,b.statement_day,b.due_day).run();return reply({ok:true});
 }
 if(b.action==='goal'){
  const target=minor(String(b.target),b.currency),saved=b.saved===''||String(b.saved)==='0'?0:minor(String(b.saved),b.currency);
  await db.prepare('INSERT INTO pocket_goals(owner,id,title,currency,target,saved) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET title=excluded.title,target=excluded.target,saved=excluded.saved').bind(owner,b.id,title,b.currency,target,saved).run();return reply({ok:true});
 }
 const category=b.category;
 if(typeof category!=='string'||(!(b.action==='range_budget'&&category==='all')&&!CATEGORIES.includes(category)&&!await db.prepare('SELECT 1 FROM pocket_categories WHERE owner=? AND name=?').bind(owner,category).first()))return reply({error:'无效分类'},400);
 const amount=minor(String(b.amount),b.currency);
 if(b.action==='template'){await db.prepare('INSERT INTO pocket_templates(owner,id,title,currency,category,amount) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET title=excluded.title,category=excluded.category,amount=excluded.amount').bind(owner,b.id,title,b.currency,category,amount).run();return reply({ok:true});}
 if(b.action==='range_budget'){
  if(!validDate(b.start)||!validDate(b.end)||b.start>b.end)return reply({error:'请检查预算日期范围'},400);
  await db.prepare('INSERT INTO range_budgets(owner,id,title,start,end,currency,category,amount) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET title=excluded.title,start=excluded.start,end=excluded.end,category=excluded.category,amount=excluded.amount').bind(owner,b.id,title,b.start,b.end,b.currency,category,amount).run();return reply({ok:true});
 }
 if(b.action!=='bill'||!['planned','postpaid','prepaid','wallet','use'].includes(b.mode)||!validDate(b.consumption_date)||((b.mode==='postpaid'||b.mode==='wallet'||b.mode==='use')&&b.consumption_date>today()))return reply({error:'请检查账单类型与消费日期'},400);
 const paid=b.paid_date||'',due=b.due_date||'',account=b.account_id||'',parent=b.parent_id||'';
 if((paid&&(!validDate(paid)||paid>today()))||(due&&!validDate(due))||(['prepaid','wallet'].includes(b.mode)&&!paid)||(['planned','use'].includes(b.mode)&&paid))return reply({error:'请检查付款／到期日期；预付需要实际付款日期'},400);
 if(account&&!['postpaid','planned'].includes(b.mode))return reply({error:'信用卡只用于后付消费或未来计划'},400);
 if(b.mode!=='use'&&parent)return reply({error:'只有预付使用可以关联充值'},400);
 const content=[title,b.mode,category,amount,b.currency,b.consumption_date,due,paid,'active',account,parent];
 const guard=b.mode==='use'
  ?"EXISTS (SELECT 1 FROM pocket_bills p WHERE p.owner=? AND p.id=? AND p.status='active' AND p.mode='wallet' AND p.currency=? AND p.paid_date<=? AND p.amount-COALESCE((SELECT SUM(c.amount) FROM pocket_bills c WHERE c.owner=p.owner AND c.parent_id=p.id AND c.status='active'),0)>=?)"
  :"(?='' OR EXISTS (SELECT 1 FROM pocket_accounts WHERE owner=? AND id=? AND currency=?))";
 const guardValues=b.mode==='use'?[owner,parent,b.currency,b.consumption_date,amount]:[account,owner,account,b.currency];
 const result=await db.prepare(`INSERT INTO pocket_bills(owner,id,title,mode,category,amount,currency,consumption_date,due_date,paid_date,status,account_id,parent_id,created_at)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(owner,id) DO NOTHING`).bind(owner,b.id,...content,new Date().toISOString(),...guardValues).run();
 if(result.meta.changes)return reply({ok:true});
 const saved=await db.prepare('SELECT * FROM pocket_bills WHERE owner=? AND id=?').bind(owner,b.id).first<PocketBill>();
 if(saved){
  const existing=[saved.title,saved.mode,saved.category,saved.amount,saved.currency,saved.consumption_date,saved.due_date,saved.paid_date,saved.status,saved.account_id,saved.parent_id];
  return existing.every((value,i)=>value===content[i])?reply({ok:true}):reply({error:'该标识已有不同账单，请刷新后核对'},409);
 }
 if(b.mode==='use'){
  const wallet=await db.prepare("SELECT * FROM pocket_bills WHERE owner=? AND id=? AND mode='wallet' AND status='active'").bind(owner,parent).first<PocketBill>();
  if(!wallet||wallet.currency!==b.currency)return reply({error:'预付余额不存在或币种不一致'},400);
  if(b.consumption_date<wallet.paid_date)return reply({error:'使用日期不能早于充值日期'},400);
  return reply({error:'预付余额不足，请刷新后重试'},409);
 }
 return account?reply({error:'信用卡不存在或币种不一致'},400):reply({error:'账单未保存，请刷新后重试'},409);
 }catch(e){if(e instanceof SyntaxError)return reply({error:'请求格式无效'},400);if(e instanceof Error&&/金额|小数|整数/.test(e.message))return reply({error:e.message},400);console.error('pocket.write',e);return reply({error:'保存失败，请保留输入并重试'},503);}}
