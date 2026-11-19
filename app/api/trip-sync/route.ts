import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {validDate} from '@/lib/ledger-domain';

export const dynamic='force-dynamic';
type SyncState={mode:string;status:string;last_completed:string;cursor:string;run:string};
const SOURCE='https://trip-share-eagle.yeehanglau486.chatgpt.site/api/integrations/v1/me/entries';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const supported=new Set(['MYR','SGD','USD','CNY','EUR','GBP','JPY','THB','IDR','HKD','TWD','AUD','KRW']);
const sourceDigits=(currency:string)=>['JPY','KRW','IDR'].includes(currency)?0:2;
const ledgerDigits=(currency:string)=>currency==='JPY'||currency==='KRW'?0:2;
function database(){if(!env.DB)throw new Error('Database unavailable');return env.DB;}
async function owner(){const user=await getChatGPTUser();if(!user)return null;return {id:user.userId,email:user.email.toLowerCase()};}
// Trip Share scopes its token to its own account. Keep this import restricted
// to the pocket ledger owner even when the two Sites use different emails.
function authorized(email:string){const expected=env.LEDGER_OWNER_EMAIL;return !!expected&&email.toLowerCase()===expected.trim().toLowerCase();}
function configured(){return !!env.POCKET_SYNC_TOKEN;}
const textField=(x:unknown,max=200)=>typeof x==='string'&&x.length<=max?x:null;
class SourceRecordError extends Error {
 constructor(public fields:string[]){super(`Invalid source record fields: ${fields.join(', ')}`);}
}
function normalise(value:unknown,run:string){
 if(!value||typeof value!=='object')throw Error('Invalid source entry');
 const e=value as Record<string,unknown>,type=e.record_type;
 if(type!=='expense'&&type!=='payment')throw Error('Invalid source type');
 const group=textField(e.group_id,150),id=textField(type==='expense'?e.expense_id:e.payment_id,150),member=textField(e.member_id,150),currency=textField(e.currency,3),date=textField(e.date,10);
 const invalidIdentity=[!group?'group_id':'',!id?(type==='expense'?'expense_id':'payment_id'):'',!member?'member_id':'',!currency||!supported.has(currency)?'currency':'',!date||!validDate(date)?'date':'',typeof e.deleted!=='boolean'?'deleted':''].filter(Boolean);
 if(!group||!id||!member||!currency||!supported.has(currency)||!date||!validDate(date)||typeof e.deleted!=='boolean')throw new SourceRecordError(invalidIdentity);
 // A tombstone identifies the row to remove; it need not repeat display metadata.
 // Only absent/null metadata is optional for deleted records. Active rows stay strict.
 const metadata=(name:string,max:number)=>e.deleted===true&&e[name]==null?'':textField(e[name],max);
 const consumed=type==='expense'?e.consumed_minor:0,paid=type==='expense'?e.paid_minor:0,amount=type==='payment'?e.amount_minor:0;
 if(![consumed,paid,amount].every(n=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=1e11))throw Error('Invalid source amount');
 const scale=10**(ledgerDigits(currency)-sourceDigits(currency));
 const numbers=[consumed,paid,amount].map(n=>Number(n)*scale);
 if(numbers.some(n=>!Number.isSafeInteger(n)))throw Error('Source amount out of range');
 const title=type==='expense'?metadata('title',200):'还款';
 const category=type==='expense'?metadata('category',100):'';
 const groupType=type==='expense'?metadata('group_type',20):'';
 const from=type==='payment'?metadata('from_member_id',150):'';
 const to=type==='payment'?metadata('to_member_id',150):'';
 const invalidMetadata=[title===null?'title':'',category===null?'category':'',groupType===null?'group_type':'',from===null?'from_member_id':'',to===null?'to_member_id':''].filter(Boolean);
 if(title===null||category===null||groupType===null||from===null||to===null)throw new SourceRecordError(invalidMetadata);
 let paylater='';
 if(type==='expense'&&!e.deleted&&e.paylater!=null){
  if(typeof e.paylater!=='object')throw new SourceRecordError(['paylater']);
  const p=e.paylater as Record<string,unknown>;
  if(!p||typeof p.provider!=='string'||typeof p.months!=='number'||typeof p.total!=='number'||!['spaylater','grabpaylater','other'].includes(p.provider)||!Number.isInteger(p.months)||p.months<1||p.months>60||(p.provider==='grabpaylater'&&p.months!==1)||typeof p.first_due!=='string'||!validDate(p.first_due)||p.first_due<date||!Number.isSafeInteger(p.total)||p.total<=0||p.total>1e11||!Number.isSafeInteger(p.total*scale))throw new SourceRecordError(['paylater']);
  paylater=JSON.stringify({provider:p.provider,months:p.months,first_due:p.first_due,total:p.total*scale});
 }
 return {type,group,id,member,currency,date,title,category,groupType,from,to,consumed:numbers[0],paid:numbers[1],amount:numbers[2],deleted:e.deleted?1:0,run,paylater};
}
export async function GET(){const user=await owner();if(!user)return reply({error:'请先登录'},401);if(!authorized(user.email))return reply({ready:false,status:'forbidden',reason:'not_owner'},403);if(!configured())return reply({ready:false,status:'configuration_needed',reason:'missing_token'});const state=await database().prepare('SELECT mode,status,last_completed,cursor FROM trip_sync WHERE owner=?').bind(user.id).first<SyncState>();return reply({ready:true,status:state?.status||'idle',mode:state?.mode||'full',last_completed:state?.last_completed||'',has_cursor:!!state?.cursor});}
export async function POST(request:Request){
 const user=await owner();if(!user)return reply({error:'请先登录'},401);
 if(!authorized(user.email))return reply({error:'仅口袋账本 Owner 可以同步'},403);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'请求来源无效'},403);
 if(!configured())return reply({error:'Trip Share 同步密钥尚未配置'},503);
 const db=database(),now=Date.now();
 await db.prepare('INSERT OR IGNORE INTO trip_sync(owner,run) VALUES (?,?)').bind(user.id,crypto.randomUUID()).run();
 const locked=await db.prepare('UPDATE trip_sync SET lock_until=?,status=? WHERE owner=? AND lock_until<?').bind(now+45000,'syncing',user.id,now).run();
 if(!locked.meta.changes)return reply({error:'同步进行中，请稍后刷新'},409);
 try{
  const initial=await db.prepare('SELECT * FROM trip_sync WHERE owner=?').bind(user.id).first<SyncState>();
  if(!initial)throw Error('Sync state unavailable');
  let state:SyncState=initial;
  for(let page=0;page<5;page++){
   const url=new URL(SOURCE);url.searchParams.set('limit','50');if(state.cursor)url.searchParams.set('cursor',state.cursor);
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
   let upstream:Response;
   try{upstream=await fetch(url,{headers:{Authorization:`Bearer ${env.POCKET_SYNC_TOKEN}`},cache:'no-store',signal:controller.signal});}finally{clearTimeout(timer);}
   if(upstream.status===401)return reply({error:'Trip Share 拒绝了同步密钥（401）。请在两个站点设置相同的 POCKET_SYNC_TOKEN，并分别重新发布。'},503);
   if(upstream.status===409){const body=await upstream.json().catch(()=>({})) as {reset_required?:boolean};if(!body.reset_required)throw Error('Trip Share cursor rejected');await db.prepare("UPDATE trip_sync SET cursor='',run=?,mode='full',status='reset_required' WHERE owner=?").bind(crypto.randomUUID(),user.id).run();return reply({error:'成员范围已变化，请再次同步以重新核对记录',reset_required:true},409);}
   if(upstream.status===429)return reply({error:'Trip Share 请求过于频繁，请稍后再试'},429);
   if(!upstream.ok)throw Error(`Trip Share unavailable (${upstream.status})`);
   const data=await upstream.json() as {schema_version?:number;mode?:string;entries?:unknown[];next_cursor?:unknown;has_more?:boolean};
   if(data.schema_version!==1||!['full','incremental'].includes(data.mode||'')||!Array.isArray(data.entries)||data.entries.length>100||typeof data.has_more!=='boolean'||(data.next_cursor!==null&&typeof data.next_cursor!=='string'))throw Error('Trip Share response invalid');
   const entries=data.entries.map(e=>normalise(e,state.run));
   const next=data.next_cursor||'';
   if(data.has_more&&!next)throw Error('Trip Share pagination cursor missing');
   const statements=entries.map(e=>db.prepare(`INSERT INTO trip_entries(owner,record_type,group_id,record_id,member_id,group_type,date,title,category,currency,consumed,paid,amount,from_member,to_member,deleted,seen_run,paylater) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,record_type,group_id,record_id,member_id) DO UPDATE SET group_type=excluded.group_type,date=excluded.date,title=excluded.title,category=excluded.category,currency=excluded.currency,consumed=excluded.consumed,paid=excluded.paid,amount=excluded.amount,from_member=excluded.from_member,to_member=excluded.to_member,deleted=excluded.deleted,seen_run=excluded.seen_run,paylater=excluded.paylater`).bind(user.id,e.type,e.group,e.id,e.member,e.groupType,e.date,e.title,e.category,e.currency,e.consumed,e.paid,e.amount,e.from,e.to,e.deleted,e.run,e.paylater));
   // Checkpoint only after all rows in this page have been stored. Replays are safe.
   for(let i=0;i<statements.length;i+=60)await db.batch(statements.slice(i,i+60));
   await db.prepare('UPDATE trip_sync SET cursor=?,mode=?,status=? WHERE owner=?').bind(next,data.mode,data.has_more?'more':'synced',user.id).run();
   if(!data.has_more){
    if(state.mode==='full'||data.mode==='full')await db.prepare('DELETE FROM trip_entries WHERE owner=? AND seen_run!=?').bind(user.id,state.run).run();
    await db.prepare('UPDATE trip_sync SET last_completed=?,mode=?,status=? WHERE owner=?').bind(new Date().toISOString(),'incremental','synced',user.id).run();
    return reply({ok:true,complete:true,count:entries.length});
   }
   state={...state,cursor:next,mode:data.mode||state.mode};
  }
  return reply({ok:true,complete:false,message:'仍有记录待同步，请继续同步'});
 }catch(e){console.error('trip-sync',e instanceof Error?e.message:e);await db.prepare("UPDATE trip_sync SET status='error' WHERE owner=?").bind(user.id).run();if(e instanceof SourceRecordError)return reply({error:`Trip Share 记录字段不符合约定：${e.fields.join('、')}。本页未导入，进度保留。`,code:'invalid_source_record',fields:e.fields},503);return reply({error:'暂时无法同步 Trip Share，已保存进度，请重试'},503);}
 finally{await db.prepare('UPDATE trip_sync SET lock_until=0 WHERE owner=?').bind(user.id).run();}
}
