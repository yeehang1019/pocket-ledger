import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
const wrap=(q,p=[])=>({bind:(...args)=>wrap(q,args),first:async()=>sql.prepare(q).get(...p)||null,all:async()=>({results:sql.prepare(q).all(...p)}),run:async()=>{const r=sql.prepare(q).run(...p);return {meta:{changes:r.changes}}}});
const DB={prepare:q=>wrap(q),batch:async stmts=>{sql.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const domain=await import('data:text/javascript;base64,'+Buffer.from(transpile(readFileSync('lib/ledger-domain.ts','utf8'))).toString('base64'));
const financeSource=transpile(readFileSync('lib/commitments.ts','utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
const tripPlanRows=new Function('validDate',financeSource+';return typeof tripPlanRows==="function"?tripPlanRows:undefined;')(domain.validDate);
const source=readFileSync('app/api/trip-sync/route.ts','utf8').replace(/^import .*;\n/gm,'');
const originalFetch=globalThis.fetch;
let pages=[];globalThis.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer private-test-token');const page=pages.shift();if(!page)throw Error('Unexpected page');return typeof page==='function'?page(url,options):Response.json(page.body,{status:page.status||200})};
let user={userId:'ledger-a',email:'yeehang32@gmail.com'};
const env={DB,LEDGER_OWNER_EMAIL:'yeehang32@gmail.com',POCKET_SYNC_TOKEN:'private-test-token',POCKET_SYNC_EMAIL:'a@example.test'};
const factory=new Function('env','getChatGPTUser','validDate','tripPlanRows','setTimeout',transpile(source).replace(/export /g,'')+';return {GET,POST};');
let responseTimeout;
const api=factory(env,async()=>user,domain.validDate,tripPlanRows,(callback,timeout)=>setTimeout(callback,responseTimeout??timeout));
const sync=()=>api.POST(new Request('https://ledger.test/api/trip-sync',{method:'POST',headers:{origin:'https://ledger.test'}}));
const expense=(consumed,deleted=false)=>({record_type:'expense',group_id:'daily-1',group_type:'daily',expense_id:'expense-1',member_id:'member-a',date:'2026-09-24',title:'Lunch',category:'Food',currency:'MYR',consumed_minor:consumed,paid_minor:12000,deleted});
const payment={record_type:'payment',group_id:'daily-1',payment_id:'payment-1',member_id:'member-a',date:'2026-09-25',currency:'MYR',amount_minor:2000,from_member_id:'member-b',to_member_id:'member-a',deleted:false};
await test('full pages, idempotent incremental changes and scope reset',async()=>{
 pages=[{body:{schema_version:1,mode:'full',entries:[expense(4000)],next_cursor:'page-2',has_more:true}},{body:{schema_version:1,mode:'full',entries:[payment],next_cursor:'incremental-cursor',has_more:false}}];
 assert.equal((await sync()).status,200);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM trip_entries').get().n,2);
 pages=[{body:{schema_version:1,mode:'incremental',entries:[expense(5000)],next_cursor:'next-cursor',has_more:false}}];
 assert.equal((await sync()).status,200);
 assert.equal(sql.prepare("SELECT consumed FROM trip_entries WHERE record_type='expense'").get().consumed,5000);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM trip_entries').get().n,2);
 pages=[{status:409,body:{reset_required:true}}];assert.equal((await sync()).status,409);
 pages=[{body:{schema_version:1,mode:'full',entries:[expense(0,true)],next_cursor:'after-reset',has_more:false}}];assert.equal((await sync()).status,200);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM trip_entries').get().n,1);
 assert.equal(sql.prepare("SELECT deleted FROM trip_entries WHERE record_type='expense'").get().deleted,1);
 // Deleted records may omit display metadata, but not their stable identity/date.
 const tombstone={...expense(0,true),paid_minor:0,title:null,category:null,group_type:null};
 pages=[{body:{schema_version:1,mode:'incremental',entries:[tombstone,{...payment,amount_minor:0,deleted:true,from_member_id:null,to_member_id:null}],next_cursor:'deleted-metadata',has_more:false}}];
 assert.equal((await sync()).status,200);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM trip_entries WHERE deleted=1").get().n,2);
 const before=sql.prepare('SELECT cursor FROM trip_sync').get().cursor;
 const validNew={...expense(3000),expense_id:'new-expense'};
 pages=[{body:{schema_version:1,mode:'incremental',entries:[validNew,{...expense(4000),title:null}],next_cursor:'must-not-advance',has_more:false}}];
 const rejected=await sync();assert.equal(rejected.status,503);
 assert.deepEqual((await rejected.json()).fields,['title']);
 assert.equal(sql.prepare('SELECT cursor FROM trip_sync').get().cursor,before);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM trip_entries WHERE record_id='new-expense'").get().n,0);
 pages=[{body:{schema_version:1,mode:'incremental',entries:[{...tombstone,date:null}],next_cursor:'must-not-advance',has_more:false}}];
 const invalidDate=await sync();assert.equal(invalidDate.status,503);assert.deepEqual((await invalidDate.json()).fields,['date']);
 assert.equal(sql.prepare('SELECT cursor FROM trip_sync').get().cursor,before);
 pages=[{body:{schema_version:1,mode:'incremental',entries:[validNew,expense(4000)],next_cursor:'recovered',has_more:false}}];
 assert.equal((await sync()).status,200);
 assert.equal(sql.prepare("SELECT consumed FROM trip_entries WHERE record_id='expense-1'").get().consumed,4000);
 assert.equal(sql.prepare("SELECT deleted FROM trip_entries WHERE record_id='expense-1'").get().deleted,0);
 assert.equal(sql.prepare('SELECT cursor FROM trip_sync').get().cursor,'recovered');
 user={userId:'ledger-b',email:'b@example.test'};assert.equal((await sync()).status,403);
 user=null;assert.equal((await sync()).status,401);
});
await test('PayLater metadata is owner-scoped, validated before a page writes, and removed when payment method changes',async()=>{
 user={userId:'ledger-a',email:'yeehang32@gmail.com'};
 const entry={...expense(0),expense_id:'financed-expense',paid_minor:30900,paylater:{provider:'spaylater',months:3,first_due:'2026-10-31',total:30900}};
 pages=[{body:{schema_version:1,mode:'incremental',entries:[entry],next_cursor:'finance-cursor',has_more:false}}];assert.equal((await sync()).status,200);
 assert.equal(JSON.parse(sql.prepare("SELECT paylater FROM trip_entries WHERE record_id='financed-expense'").get().paylater).total,30900);
 pages=[{body:{schema_version:1,mode:'incremental',entries:[{...entry,paylater:{...entry.paylater,months:0}}],next_cursor:'invalid-finance',has_more:false}}];assert.equal((await sync()).status,503);assert.equal(sql.prepare('SELECT cursor FROM trip_sync').get().cursor,'finance-cursor');
 pages=[{body:{schema_version:1,mode:'incremental',entries:[{...entry,paylater:null}],next_cursor:'ordinary-cursor',has_more:false}}];assert.equal((await sync()).status,200);assert.equal(sql.prepare("SELECT paylater FROM trip_entries WHERE record_id='financed-expense'").get().paylater,'');
});
await test('TripShare fallback tombstones (unresolvable payment/expense) remove the stored rows and replay safely',async()=>{
 user={userId:'ledger-a',email:'yeehang32@gmail.com'};
 const live={...payment,payment_id:'ghost-payment'},liveExpense={...expense(4000),expense_id:'ghost-expense'};
 pages=[{body:{schema_version:1,mode:'incremental',entries:[live,liveExpense],next_cursor:'live',has_more:false}}];assert.equal((await sync()).status,200);
 const count=()=>sql.prepare("SELECT COUNT(*) AS n FROM trip_entries WHERE record_id IN ('ghost-payment','ghost-expense')").get().n;assert.equal(count(),2);
 // Exact shapes emitted by TripShare v1 when the record is gone or no longer involves this member.
 const payTomb={record_type:'payment',group_id:'daily-1',group_type:'daily',payment_id:'ghost-payment',member_id:'member-a',from_member_id:null,to_member_id:null,amount_minor:0,currency:'MYR',date:'2026-11-20',deleted:true,expense_ids:[],change_seq:9,updated_at:'2026-11-20T08:00:00.000Z'};
 const expTomb={record_type:'expense',group_id:'daily-1',group_type:'daily',expense_id:'ghost-expense',member_id:'member-a',key:['daily-1','ghost-expense','member-a'],date:'2026-11-20',title:null,category:null,currency:'MYR',consumed_minor:0,paid_minor:0,deleted:true,change_seq:10,updated_at:'2026-11-20T08:00:00.000Z'};
 for(const cursor of ['tomb-1','tomb-2']){pages=[{body:{schema_version:1,mode:'incremental',entries:[payTomb,expTomb],next_cursor:cursor,has_more:false}}];assert.equal((await sync()).status,200);}
 assert.equal(count(),2);assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM trip_entries WHERE record_id IN ('ghost-payment','ghost-expense') AND deleted=1").get().n,2);
 assert.equal(sql.prepare('SELECT cursor FROM trip_sync').get().cursor,'tomb-2');
});
const responsePage=(entries,next_cursor,has_more=false,mode='incremental')=>({schema_version:1,mode,entries,next_cursor,has_more});
const useOwner=id=>{user={...user,userId:id};};
const checkpoint=()=>sql.prepare('SELECT * FROM trip_sync WHERE owner=?').get(user.userId);
const published=()=>sql.prepare('SELECT record_id FROM trip_entries WHERE owner=? ORDER BY record_id').all(user.userId).map(r=>r.record_id);

await test('Expired TripShare run cannot write rows, checkpoint, or release its replacement lease',async()=>{
 useOwner('lease-test');
 pages=[{body:responsePage([], 'initial')}];assert.equal((await sync()).status,200);
 const oldBody=Promise.withResolvers(),freshBody=Promise.withResolvers();
 const oldReading=Promise.withResolvers(),freshReading=Promise.withResolvers();
 pages=[
  ()=>({ok:true,status:200,json:()=>{oldReading.resolve();return oldBody.promise;}}),
  ()=>({ok:true,status:200,json:()=>{freshReading.resolve();return freshBody.promise;}}),
 ];
 const old=sync();await oldReading.promise;
 sql.prepare('UPDATE trip_sync SET lock_until=0 WHERE owner=?').run(user.userId);
 const fresh=sync();await freshReading.promise;
 const replacement=checkpoint();
 oldBody.resolve(responsePage([expense(1)],'stale'));
 const oldResult=await old;
 const afterOld=checkpoint(),oldRows=published();
 freshBody.resolve(responsePage([{...expense(2),expense_id:'fresh'}],'fresh'));
 assert.equal((await fresh).status,200);
 assert.equal(oldResult.status,503);
 assert.equal(afterOld.lock_until,replacement.lock_until);
 assert.equal(afterOld.lease,replacement.lease);
 assert.equal(afterOld.status,'syncing');assert.equal(afterOld.cursor,'initial');assert.deepEqual(oldRows,[]);
 assert.deepEqual(published(),['fresh']);
});

await test('TripShare response timeout covers a body stalled after headers',async()=>{
 useOwner('timeout-test');
 responseTimeout=15;
 let signal,releaseBody;
 try{
  pages=[(_url,options)=>{
   signal=options.signal;
   const body=new Promise(resolve=>{releaseBody=setTimeout(()=>resolve(responsePage([expense(1)],'too-late')),80);});
   return {ok:true,status:200,json:()=>body};
  }];
  assert.equal((await sync()).status,503);
  assert.equal(signal.aborted,true);
  assert.equal(checkpoint().cursor,'');assert.deepEqual(published(),[]);
 }finally{responseTimeout=undefined;clearTimeout(releaseBody);}
});

await test('Full resync keeps published rows and full mode across mixed pages and requests',async()=>{
 useOwner('full-resume-test');
 pages=[{body:responsePage([expense(1)],'before')}];assert.equal((await sync()).status,200);
 pages=[{status:409,body:{reset_required:true}}];assert.equal((await sync()).status,409);
 const first={...expense(2),expense_id:'first-new'};
 pages=[{body:responsePage([first],'page-1',true,'full')},...[2,3,4,5].map(i=>({body:responsePage([], 'page-'+i,true)}))];
 assert.equal((await (await sync()).json()).complete,false);
 assert.deepEqual(published(),['expense-1']);
 assert.equal(checkpoint().mode,'full');assert.equal(checkpoint().cursor,'page-5');
 pages=[url=>{assert.equal(url.searchParams.get('cursor'),'page-5');return Response.json(responsePage([payment],null));}];
 assert.equal((await sync()).status,200);
 assert.deepEqual(published(),['first-new','payment-1']);assert.equal(checkpoint().status,'synced');assert.equal(checkpoint().cursor,'');
});

await test('Full resync cleanup failure rolls back publish and terminal checkpoint for retry',async()=>{
 useOwner('full-cleanup-test');
 pages=[{body:responsePage([expense(1)],'before')}];assert.equal((await sync()).status,200);
 sql.prepare("UPDATE trip_sync SET last_completed='prior' WHERE owner=?").run(user.userId);
 pages=[{status:409,body:{reset_required:true}}];assert.equal((await sync()).status,409);
 const final=responsePage([payment],'after',false,'full');
 sql.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON trip_entries WHEN OLD.owner='full-cleanup-test' BEGIN SELECT RAISE(ABORT,'cleanup unavailable'); END");
 try{
  pages=[{body:final}];assert.equal((await sync()).status,503);
  assert.equal(checkpoint().cursor,'');assert.equal(checkpoint().last_completed,'prior');assert.equal(checkpoint().status,'error');
  assert.deepEqual(published(),['expense-1']);
 }finally{sql.exec('DROP TRIGGER fail_cleanup');}
 pages=[{body:final}];assert.equal((await sync()).status,200);
 assert.equal(checkpoint().cursor,'after');assert.notEqual(checkpoint().last_completed,'prior');
 assert.deepEqual(published(),['payment-1']);
});

await test('TripShare rejects unschedulable PayLater amounts and dates before writing any page rows',async()=>{
 useOwner('bad-plan-test');
 pages=[{body:responsePage([], 'valid')}];assert.equal((await sync()).status,200);
 for(const [currency,total,first_due] of [['JPY',1,'2026-10-31'],['IDR',1000000001,'2026-10-31'],['MYR',100,'2100-12-31']]){
  const invalid={...expense(0),currency,paylater:{provider:'spaylater',months:2,first_due,total}};
  pages=[{body:responsePage([payment,invalid],'invalid')}];
  const result=await sync();assert.equal(result.status,503);
  assert.deepEqual((await result.json()).fields,['paylater']);
  assert.equal(checkpoint().cursor,'valid');assert.deepEqual(published(),[]);
 }
});
globalThis.fetch=originalFetch;sql.close();
