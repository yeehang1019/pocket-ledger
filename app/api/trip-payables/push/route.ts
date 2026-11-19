import {env} from 'cloudflare:workers';
import {syncPayables} from '@/lib/trip-payables';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const token=env.POCKET_SYNC_TOKEN,expected='Bearer '+token,given=request.headers.get('authorization')||'';
 let diff=given.length^expected.length;for(let i=0;i<expected.length;i++)diff|=(given.charCodeAt(i)||0)^expected.charCodeAt(i);
 if(!token||diff)return Response.json({error:'unauthorized'},{status:401});
 // Service access conveys no visitor identity. Only already-confirmed connections can run.
 const targets=await env.DB!.prepare('SELECT owner FROM trip_sync_settings WHERE activated=1').all<{owner:string}>();
 try{for(const target of targets.results)await syncPayables(env.DB!,env,target.owner);return Response.json({ok:true})}
 catch{return Response.json({error:'sync_pending',retryable:true},{status:503})}
}
