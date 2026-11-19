// Debt mirror only. This module must never write transactions or trip_entries.
export type PayableLeg={space_id:string;space_name:string;member_id:string;bill_id:string;direction:'payable'|'receivable';recipient_id:string;recipient_name:string;title:string;date:string;category:string;currency:string;remaining:number;paid:number;cancelled_out:number;share:number;source_revision:number;status:string};
export type PayableSpace={id:string;name:string;identity:string;member_id?:string;currency?:string;pay:number;receive:number};
export type StoredSpace={space_id:string;enabled:number};
export type PayableSnapshot={schema_version:2;version:string;spaces:PayableSpace[];rows:PayableLeg[]};
export const connection='tripshare';
export function payableKey(r:Pick<PayableLeg,'space_id'|'bill_id'|'member_id'|'direction'>){return JSON.stringify([connection,r.space_id,r.bill_id,r.member_id,r.direction])}
export function projectPayables(snapshot:PayableSnapshot, enabled:string[],receivables=false){
 if(snapshot.schema_version!==2||typeof snapshot.version!=='string'||!Array.isArray(snapshot.rows)||snapshot.rows.length>5000||!Array.isArray(snapshot.spaces))throw Error('Invalid TripShare snapshot');
 const spaces=new Map(snapshot.spaces.map(s=>[s.id,s]));if(spaces.size!==snapshot.spaces.length)throw Error('Duplicate source space');
 if(enabled.some(id=>!spaces.has(id)||spaces.get(id)?.identity!=='confirmed'))throw Error('Incomplete total. Confirm your member in every enabled space.');
 const selected=new Set(enabled),keys=new Set<string>(),parents=new Map<string,PayableLeg&{key:string}>(),legs:(PayableLeg&{key:string;leg_key:string})[]=[];
 for(const r of snapshot.rows){
  if(!selected.has(r.space_id)||r.direction==='receivable'&&!receivables)continue;
  const s=spaces.get(r.space_id);if(!s||s.member_id!==r.member_id||s.currency!==r.currency||!['payable','receivable'].includes(r.direction))throw Error('Source identity mismatch');
  for(const field of ['space_id','member_id','bill_id','recipient_id','title','date','currency','category'] as const)if(typeof r[field]!=='string'||r[field].length>250||!r[field])throw Error('Invalid source field');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!['MYR','SGD','USD','CNY','EUR','GBP','JPY','THB','IDR','HKD','TWD','AUD','KRW'].includes(r.currency))throw Error('Invalid source date or currency');
  if(![r.remaining,r.paid,r.cancelled_out,r.share,r.source_revision].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1e11)||r.remaining+r.paid+r.cancelled_out!==r.share)throw Error('Source amounts do not reconcile');
  const key=payableKey(r),legKey=JSON.stringify([key,r.recipient_id]);if(keys.has(legKey))throw Error('Duplicate source leg');keys.add(legKey);
  let p=parents.get(key);if(!p){p={...r,key,remaining:0,paid:0,cancelled_out:0,share:0};parents.set(key,p)}
  for(const f of ['remaining','paid','cancelled_out','share'] as const){p[f]+=r[f];if(!Number.isSafeInteger(p[f]))throw Error('Total overflow')}
  legs.push({...r,key,leg_key:legKey});
 }
 for(const id of enabled){const s=spaces.get(id)!,rows=[...parents.values()].filter(p=>p.space_id===id);for(const direction of receivables?['payable','receivable']:['payable']){const actual=rows.filter(r=>r.direction===direction).reduce((n,r)=>n+r.remaining,0);if(actual!==(direction==='payable'?s.pay:s.receive))throw Error('TripShare and Pocket Ledger totals do not match. Nothing was imported.')}}
 return {parents:[...parents.values()].map(p=>({...p,status:p.remaining===0?'Paid':p.paid>0?'Partly paid':'Unpaid'})),legs,spaces:enabled.map(id=>spaces.get(id)!)};
}
export async function sourceSnapshot(config:{POCKET_SYNC_TOKEN?:string}):Promise<PayableSnapshot>{
 if(!config.POCKET_SYNC_TOKEN)throw Error('TripShare connection is not configured.');
 const response=await fetch('https://trip-share-eagle.yeehanglau486.chatgpt.site/api/integrations/v2/me/payables',{headers:{Authorization:'Bearer '+config.POCKET_SYNC_TOKEN},signal:AbortSignal.timeout(10000),cache:'no-store'});
 if(!response.ok)throw Error('TripShare is unavailable ('+response.status+'). Retry sync.');
 const text=await response.text();if(text.length>2000000)throw Error('Source snapshot is too large. Nothing was imported.');return JSON.parse(text);
}
export async function applyPayables(db:D1Database,owner:string,snapshot:PayableSnapshot,enabled:string[],receive:boolean,lease:string){
 const model=projectPayables(snapshot,enabled,receive),run=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM trip_sync_settings WHERE owner=? AND lease=?)';
 const parents=JSON.stringify(model.parents),legs=JSON.stringify(model.legs);
 if(parents.length+legs.length>1900000)throw Error('Snapshot is too large. Nothing was imported.');
 const results=await db.batch([
  db.prepare(`INSERT INTO trip_payables(owner,connection,key,space_id,bill_id,member_id,direction,title,date,category,currency,remaining,paid,cancelled_out,share,status,source_revision,seen_run,deleted) SELECT ?,?,json_extract(value,'$.key'),json_extract(value,'$.space_id'),json_extract(value,'$.bill_id'),json_extract(value,'$.member_id'),json_extract(value,'$.direction'),json_extract(value,'$.title'),json_extract(value,'$.date'),json_extract(value,'$.category'),json_extract(value,'$.currency'),json_extract(value,'$.remaining'),json_extract(value,'$.paid'),json_extract(value,'$.cancelled_out'),json_extract(value,'$.share'),json_extract(value,'$.status'),json_extract(value,'$.source_revision'),?,0 FROM json_each(?) WHERE ${gate} AND (json_extract(value,'$.remaining')>0 OR EXISTS(SELECT 1 FROM trip_payables p WHERE p.owner=? AND p.key=json_extract(value,'$.key'))) ON CONFLICT(owner,connection,key) DO UPDATE SET title=excluded.title,date=excluded.date,category=excluded.category,currency=excluded.currency,remaining=excluded.remaining,paid=excluded.paid,cancelled_out=excluded.cancelled_out,share=excluded.share,status=excluded.status,source_revision=excluded.source_revision,seen_run=excluded.seen_run,deleted=0`).bind(owner,connection,run,parents,owner,lease,owner),
  db.prepare(`DELETE FROM trip_payable_legs WHERE owner=? AND ${gate}`).bind(owner,owner,lease),
  db.prepare(`INSERT INTO trip_payable_legs(owner,connection,key,leg_key,recipient_id,recipient_name,remaining,paid,cancelled_out) SELECT ?,?,json_extract(value,'$.key'),json_extract(value,'$.leg_key'),json_extract(value,'$.recipient_id'),json_extract(value,'$.recipient_name'),json_extract(value,'$.remaining'),json_extract(value,'$.paid'),json_extract(value,'$.cancelled_out') FROM json_each(?) WHERE ${gate} AND EXISTS(SELECT 1 FROM trip_payables p WHERE p.owner=? AND p.key=json_extract(value,'$.key') AND p.seen_run=?)`).bind(owner,connection,legs,owner,lease,owner,run),
  db.prepare(`UPDATE trip_payables SET deleted=1 WHERE owner=? AND seen_run<>? AND ${gate}`).bind(owner,run,owner,lease),
  db.prepare(`DELETE FROM trip_sync_spaces WHERE owner=? AND ${gate}`).bind(owner,owner,lease),
  db.prepare(`INSERT INTO trip_sync_spaces(owner,connection,space_id,name,member_id,currency,enabled) SELECT ?,?,json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.member_id'),json_extract(value,'$.currency'),json_extract(value,'$.enabled') FROM json_each(?) WHERE ${gate}`).bind(owner,connection,JSON.stringify(snapshot.spaces.map(s=>({...s,member_id:s.member_id||'',currency:s.currency||'',enabled:enabled.includes(s.id)?1:0}))),owner,lease),
  db.prepare("UPDATE trip_sync_settings SET activated=1,also_receive=?,version=?,last_completed=?,status='synced',error='',lease='',lock_until=0 WHERE owner=? AND lease=?").bind(receive?1:0,snapshot.version,new Date().toISOString(),owner,lease),
 ]);
 if(!results.at(-1)?.meta.changes)throw Error('Sync was superseded. Retry.');
 return model;
}
export async function syncPayables(db:D1Database,config:{POCKET_SYNC_TOKEN?:string},owner:string,options?:{enabled:string[];receive:boolean;confirmVersion:string}){
 const lease=crypto.randomUUID(),now=Date.now();
 const locked=await db.prepare("UPDATE trip_sync_settings SET lease=?,lock_until=?,status='syncing' WHERE owner=? AND lock_until<?").bind(lease,now+45000,owner,now).run();if(!locked.meta.changes)throw Error('Sync is already running. Retry shortly.');
 try{
  const state=await db.prepare('SELECT * FROM trip_sync_settings WHERE owner=?').bind(owner).first<{activated:number;also_receive:number}>();if(!state)throw Error('Review and confirm the first import.');if(!state.activated&&!options)throw Error('Review and confirm the first import.');
  const snapshot=await sourceSnapshot(config);
  if(options&&snapshot.version!==options.confirmVersion)throw Error('TripShare changed since the preview. Review it again.');
  const saved=(await db.prepare('SELECT space_id,enabled FROM trip_sync_spaces WHERE owner=?').bind(owner).all<StoredSpace>()).results;
  const selected=options?.enabled||snapshot.spaces.filter(s=>!saved.some(p=>p.space_id===s.id)||saved.some(p=>p.space_id===s.id&&p.enabled)).map(s=>s.id);
  const receive=options?.receive??!!state.also_receive;return await applyPayables(db,owner,snapshot,selected,receive,lease);
 }catch(error){await db.prepare("UPDATE trip_sync_settings SET status='error',error=?,lease='',lock_until=0 WHERE owner=? AND lease=?").bind(error instanceof Error?error.message:'Sync failed',owner,lease).run();throw error}
}
