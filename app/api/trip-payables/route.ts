import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {sourceSnapshot,projectPayables,syncPayables,type StoredSpace} from '@/lib/trip-payables';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function user(){const u=await getChatGPTUser();const allowed=env.LEDGER_OWNER_EMAIL;return u&&allowed&&u.email.toLowerCase()===allowed.trim().toLowerCase()?u:null}
export async function GET(){
 const u=await user();if(!u)return reply({error:'Only the connected account can view TripShare sync.'},403);
 const db=env.DB!;const state=await db.prepare('SELECT activated,also_receive,version,last_completed,status,error FROM trip_sync_settings WHERE owner=?').bind(u.userId).first();
 const rows=await db.prepare('SELECT p.*,s.name AS space_name FROM trip_payables p LEFT JOIN trip_sync_spaces s ON s.owner=p.owner AND s.space_id=p.space_id WHERE p.owner=? AND p.deleted=0 ORDER BY p.date DESC,p.key').bind(u.userId).all();
 const legs=await db.prepare('SELECT * FROM trip_payable_legs WHERE owner=?').bind(u.userId).all();
 return reply({state:state||{activated:0,status:'review_required'},rows:rows.results,legs:legs.results});
}
export async function POST(request:Request){
 const u=await user();if(!u)return reply({error:'Only the connected account can manage TripShare sync.'},403);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'Invalid origin'},403);
 try{
  const raw=await request.text();if(raw.length>20000)return reply({error:'Request too large'},413);const body=JSON.parse(raw),db=env.DB!;
  await db.prepare('INSERT OR IGNORE INTO trip_sync_settings(owner) VALUES(?)').bind(u.userId).run();
  if(body.action==='pause'){const paused=await db.prepare("UPDATE trip_sync_settings SET activated=0,status='paused' WHERE owner=? AND lock_until<?").bind(u.userId,Date.now()).run();if(!paused.meta.changes)throw Error('Sync is running. Retry pause shortly.');return reply({ok:true});}
  if(body.action==='preview'){
   const snapshot=await sourceSnapshot(env);
   const saved=(await db.prepare('SELECT space_id,enabled FROM trip_sync_spaces WHERE owner=?').bind(u.userId).all<StoredSpace>()).results;
   const preferences=await db.prepare('SELECT also_receive FROM trip_sync_settings WHERE owner=?').bind(u.userId).first<{also_receive:number}>();
   const receive=body.receive===undefined?!!preferences?.also_receive:body.receive===true;
   const enabled=body.enabled===undefined?snapshot.spaces.filter(s=>!saved.some(p=>p.space_id===s.id)||saved.some(p=>p.space_id===s.id&&p.enabled)).map(s=>s.id):body.enabled;
   if(!Array.isArray(enabled)||enabled.length>500||enabled.some(x=>typeof x!=='string')||new Set(enabled).size!==enabled.length)throw Error('Choose valid spaces.');
   const incomplete=snapshot.spaces.filter(s=>enabled.includes(s.id)&&s.identity!=='confirmed');
   const known=new Set(snapshot.spaces.map(s=>s.id));if(enabled.some(x=>!known.has(x)))throw Error('Unknown space.');
   const model=projectPayables(snapshot,enabled.filter(x=>!incomplete.some(s=>s.id===x)),receive);
   return reply({version:snapshot.version,spaces:snapshot.spaces,enabled,incomplete,rows:model.parents.filter(p=>p.remaining>0).map(p=>({...p,recipients:model.legs.filter(l=>l.key===p.key).map(l=>l.recipient_name)})),receive});
  }
  if(body.action==='confirm'){
   if(typeof body.version!=='string'||!Array.isArray(body.enabled)||body.enabled.some((x:unknown)=>typeof x!=='string')||new Set(body.enabled).size!==body.enabled.length)throw Error('Review the import first.');
   await syncPayables(db,env,u.userId,{enabled:body.enabled,receive:body.receive===true,confirmVersion:body.version});
  }else if(body.action==='sync')await syncPayables(db,env,u.userId);
  else throw Error('Unknown sync action');
  return reply({ok:true});
 }catch(error){return reply({error:error instanceof Error?error.message:'Sync failed. Retry.'},409)}
}
