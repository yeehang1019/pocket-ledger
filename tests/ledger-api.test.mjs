import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
let databaseWrites=0;let beforeBatch=null,failAfter=0;
const wrap=(query,params=[])=>({bind:(...p)=>wrap(query,p),first:async()=>sql.prepare(query).get(...params)||null,all:async()=>({results:sql.prepare(query).all(...params)}),run:async()=>{databaseWrites++;if(failAfter&&--failAfter===0)throw Error('simulated write failure');const result=sql.prepare(query).run(...params);return {...result,meta:{changes:Number(result.changes)}}}});
const DB={prepare:query=>wrap(query),batch:async list=>{if(beforeBatch){const hook=beforeBatch;beforeBatch=null;await hook();}sql.exec('BEGIN');try{const out=[];for(const q of list)out.push(await q.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
let identity='test-owner-a';
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const domain=await import('data:text/javascript;base64,'+Buffer.from(transpile(readFileSync('lib/ledger-domain.ts','utf8'))).toString('base64'));
const source=readFileSync('app/api/ledger/route.ts','utf8').replace(/^import .*;\n/gm,'');
const js=transpile(source).replace(/export /g,'');
const transactionVersion=(t)=>JSON.stringify([t.title,t.amount,t.currency,t.kind,t.category,t.date,t.note||'',t.deleted||0]);
const factory=new Function('transactionVersion','env','getChatGPTUser','CURRENCIES','CATEGORIES','INCOME_CATEGORIES','minor','today','validDate','dates',js+';return {GET,POST};');
let clock=domain.today();
const api=factory(transactionVersion,{DB},async()=>identity?{userId:identity}:null,domain.CURRENCIES,domain.CATEGORIES,domain.INCOME_CATEGORIES,domain.minor,()=>clock,domain.validDate,domain.dates);
const post=b=>api.POST(new Request('https://ledger.test/api/ledger',{method:'POST',headers:{origin:'https://ledger.test','content-type':'application/json'},body:JSON.stringify(b)}));
const get=async()=>{const r=await api.GET();return {status:r.status,...await r.json()}};
const base={action:'transaction',id:'test-manual-0001',title:'测试午餐',amount:'12.29',currency:'MYR',kind:'expense',category:'餐饮',date:domain.today()};
await test('API authorization, isolation, idempotency, recurring and reversal',async()=>{
 identity=null;assert.equal((await post(base)).status,401);assert.equal((await get()).status,401);identity='test-owner-a';
 assert.equal((await api.POST(new Request('https://ledger.test/api/ledger',{method:'POST',headers:{origin:'https://other.test'},body:JSON.stringify(base)}))).status,403);
 assert.equal((await post({...base,amount:'1.234'})).status,400);
 assert.equal((await post(base)).status,200);assert.equal((await post(base)).status,200);let data=await get();assert.equal(data.transactions.length,1);assert.equal(data.transactions[0].amount,1229);
 identity='test-owner-b';assert.equal((await get()).transactions.length,0);assert.equal((await post({action:'delete',id:base.id})).status,404);identity='test-owner-a';
 const rule={...base,kind:'income',category:'工资',action:'rule',id:'test-rule-0001',title:'测试房租',date:domain.today(),frequency:'monthly',mode:'fixed'};
 assert.equal((await post(rule)).status,200);await post({action:'sync'});await post({action:'sync'});assert.equal((await get()).transactions.length,1);
 const dueIncome=(await get()).occurrences.find(o=>o.rule_id===rule.id);assert.equal((await post({action:'receive',id:dueIncome.id,date:clock})).status,200);assert.equal((await get()).transactions.length,2);
 const recurring=(await get()).transactions.find(x=>x.rule_id);await post({action:'delete',id:recurring.id,edit_version:recurring.edit_version});await post({action:'sync'});assert.equal((await get()).transactions.length,1);
 await post({...rule,id:'test-variable-001',mode:'variable',amount:''});data=await get();assert.equal(data.pending.length,1);const id=data.pending[0].id;
 await post({action:'receive',id,amount:'87.21',date:clock});assert.equal((await post({action:'receive',id,amount:'87.21',date:clock})).status,409);assert.equal((await get()).pending.length,0);assert.equal((await get()).transactions.length,2);
 const confirmed=(await get()).transactions.find(x=>x.id===id);assert.equal(confirmed.amount,8721);
 await post({action:'status',id:rule.id,revision:(await get()).rules.find(x=>x.id===rule.id).revision,status:'paused'});assert.equal((await get()).rules.find(x=>x.id===rule.id).status,'paused');
 await post({action:'status',id:rule.id,revision:(await get()).rules.find(x=>x.id===rule.id).revision,status:'ended'});await post({action:'status',id:rule.id,revision:(await get()).rules.find(x=>x.id===rule.id).revision,status:'active'});assert.equal((await get()).rules.find(x=>x.id===rule.id).status,'ended');
});
await test('group labels are restricted to imported groups and owner',async()=>{
 identity='test-owner-a';
 assert.equal((await post({action:'group_label',group_id:'unknown',label:'KL'})).status,404);
 sql.prepare("INSERT INTO trip_entries(owner,group_id,record_id,member_id,record_type,group_type,date,currency) VALUES (?,?,?,?,?,?,?,?)").run(identity,'group-kl','expense-1','member-1','expense','daily',domain.today(),'MYR');
 assert.equal((await post({action:'group_label',group_id:'group-kl',label:'KL House'})).status,200);
 assert.equal((await get()).group_labels[0].label,'KL House');
 identity='test-owner-b';assert.equal((await get()).group_labels.length,0);
 assert.equal((await post({action:'group_label',group_id:'group-kl',label:'JB'})).status,404);
 identity='test-owner-a';
 assert.equal((await post({action:'group_label',group_id:'group-kl',label:''})).status,200);
 assert.equal((await get()).group_labels.length,0);
});
await test('same-day recurring refresh performs no redundant database writes',async()=>{
 identity='test-owner-a';databaseWrites=0;assert.equal((await post({action:'sync'})).status,200);assert.equal(databaseWrites,0);
});


await test('rule edits preserve history, apply new cadence to future dates, and reject stale or foreign edits',async()=>{
 identity='rule-editor';clock='2026-01-01';
 const rule={...base,kind:'income',category:'工资',action:'rule',id:'edit-rule-001',date:clock,amount:'10.00',frequency:'monthly',mode:'fixed'};
 assert.equal((await post(rule)).status,200);
 await post({action:'receive',id:(await get()).occurrences[0].id,date:clock});
 const original=sql.prepare('SELECT * FROM transactions WHERE rule_id=?').get(rule.id);
 const edit={...rule,action:'rule_edit',revision:0,title:'修正后的名称',amount:'20.00',frequency:'fortnightly'};
 identity='other-editor';assert.equal((await post(edit)).status,404);identity='rule-editor';
 assert.equal((await post(edit)).status,200);assert.equal((await post(edit)).status,409);
 assert.deepEqual(sql.prepare('SELECT * FROM transactions WHERE id=?').get(original.id),original);
 clock='2026-01-15';await post({action:'sync'});await post({action:'sync'});
 assert.equal((await post({action:'receive',id:(await get()).occurrences.find(o=>o.due===clock).id,date:clock})).status,200);
 const rows=sql.prepare('SELECT * FROM transactions WHERE rule_id=? ORDER BY date').all(rule.id);
 assert.deepEqual(rows.map(r=>[r.date,r.amount]),[['2026-01-01',1000],['2026-01-15',2000]]);
 assert.equal(rows[1].title,'修正后的名称');
 // A correction to an already recorded occurrence survives later reconciliation.
 assert.equal((await post({...base,action:'edit',edit_version:transactionVersion(original),id:original.id,title:'历史纠错',amount:'9.00',date:'2026-01-01'})).status,200);
 await post({action:'sync'});assert.equal(sql.prepare('SELECT amount FROM transactions WHERE id=?').get(original.id).amount,900);
 await post({action:'status',id:rule.id,revision:(await get()).rules.find(x=>x.id===rule.id).revision,status:'paused'});
 let stored=sql.prepare('SELECT * FROM rules WHERE id=?').get(rule.id);
 assert.equal((await post({...edit,revision:stored.revision,amount:'30.00'})).status,200);
 assert.equal(sql.prepare('SELECT status FROM rules WHERE id=?').get(rule.id).status,'paused');
 await post({action:'status',id:rule.id,revision:(await get()).rules.find(x=>x.id===rule.id).revision,status:'ended'});
 stored=sql.prepare('SELECT * FROM rules WHERE id=?').get(rule.id);
 assert.equal((await post({...edit,revision:stored.revision})).status,409);
});
await test('twice-monthly validates two days, clamps month ends, and never duplicates a colliding date',async()=>{
 identity='twice-monthly-owner';clock='2026-01-01';
 const rule={...base,kind:'income',category:'工资',action:'rule',id:'twice-monthly-001',date:clock,amount:'15.01',frequency:'semimonthly',month_days:'28,31',mode:'fixed'};
 for(const days of ['5,5','0,15','1,32','1.5,15','1,2,3','',null])assert.equal((await post({...rule,month_days:days})).status,400);
 assert.equal((await post(rule)).status,200);clock='2026-04-30';await post({action:'sync'});await post({action:'sync'});
 assert.equal((await get()).transactions.length,0);
 const rows=sql.prepare('SELECT due AS date,amount FROM occurrences WHERE rule_id=? ORDER BY due').all(rule.id);
 assert.deepEqual(rows.map(r=>r.date),['2026-01-28','2026-01-31','2026-02-28','2026-03-28','2026-03-31','2026-04-28','2026-04-30']);
 assert.equal(rows.reduce((sum,r)=>sum+r.amount,0),7*1501);
});
await test('editing variable rules keeps pending snapshots and only generates new fixed terms in the future',async()=>{
 identity='variable-rule-editor';clock='2026-01-01';
 const rule={...base,kind:'income',category:'工资',action:'rule',id:'variable-edit-001',date:clock,title:'旧浮动',frequency:'monthly',mode:'variable',amount:''};
 await post(rule);const pending=(await get()).pending[0];clock='2026-01-02';
 assert.equal((await post({...rule,action:'rule_edit',revision:0,title:'新固定',mode:'fixed',amount:'22.00',frequency:'weekly'})).status,200);
 assert.deepEqual((await get()).pending[0],pending);clock='2026-01-08';await post({action:'sync'});
 assert.equal((await get()).transactions.length,0);assert.equal((await get()).occurrences.find(o=>o.due===clock).amount,2200);
 assert.equal((await post({action:'receive',id:pending.id,amount:'7.00',date:clock})).status,200);
 const old=sql.prepare('SELECT * FROM transactions WHERE id=?').get(pending.id);assert.equal(old.title,'旧浮动');assert.equal(old.amount,700);
});
await test('a stale reconciliation cannot insert old terms or advance a revised rule watermark',async()=>{
 identity='race-owner';clock='2026-01-01';
 const rule={...base,kind:'income',category:'工资',action:'rule',id:'race-rule-001',date:clock,frequency:'weekly',mode:'fixed'};
 await post(rule);clock='2026-01-08';
 beforeBatch=()=>{sql.prepare("UPDATE rules SET title='new',revision=revision+1,processed_through='2026-01-07' WHERE id=?").run(rule.id)};
 await post({action:'sync'});
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM occurrences WHERE rule_id=?').get(rule.id).n,1);
 assert.equal(sql.prepare('SELECT processed_through FROM rules WHERE id=?').get(rule.id).processed_through,'2026-01-07');
 await post({action:'sync'});assert.equal(sql.prepare("SELECT title FROM occurrences WHERE rule_id=? AND due='2026-01-08'").get(rule.id).title,'new');
});
await test('stale transaction versions return 409 and do not overwrite the first device',async()=>{
 identity='concurrent-devices';clock=domain.today();
 await post({...base,id:'concurrent-tx-001',date:clock});
 const original=(await get()).transactions[0];
 const edit={...base,action:'edit',id:original.id,date:clock,edit_version:original.edit_version};
 assert.equal((await post({...edit,title:'device A'})).status,200);
 assert.equal((await post({...edit,title:'device B'})).status,409);
 assert.equal((await get()).transactions[0].title,'device A');
 const fresh=(await get()).transactions[0];
 beforeBatch=()=>sql.prepare("UPDATE transactions SET title='raced' WHERE id=?").run(original.id);
 assert.equal((await post({...edit,edit_version:fresh.edit_version,title:'late'})).status,409);
 assert.equal((await get()).transactions[0].title,'raced');
});
await test('variable income confirmation uses actual receipt date and records amount in both snapshots',async()=>{
 identity='variable-confirm-date';clock='2026-01-01';
 await post({...base,kind:'income',category:'工资',id:'variable-date-001',date:clock,action:'rule',mode:'variable',frequency:'monthly',amount:''});
 const pending=(await get()).pending[0];clock='2026-02-12';
 assert.equal((await post({action:'receive',id:pending.id,amount:'21.30',date:clock})).status,200);
 const data=await get();assert.equal(data.transactions[0].date,clock);assert.equal(data.transactions[0].amount,2130);
 assert.equal(data.occurrences.find(o=>o.id===pending.id).amount,2130);
});
await test('the same idempotency key cannot create a second transaction',async()=>{
 identity='idempotency-key-owner';clock=domain.today();
 const id='idempotency-key-001';
 const request=(recordId)=>api.POST(new Request('https://ledger.test/api/ledger',{method:'POST',headers:{origin:'https://ledger.test','content-type':'application/json','Idempotency-Key':id},body:JSON.stringify({...base,id:recordId,date:clock})}));
 assert.equal((await request(id)).status,200);assert.equal((await request(id)).status,200);
 assert.equal((await request('different-id-001')).status,409);assert.equal((await get()).transactions.length,1);
});
await test('ignored variable terms reject stale confirmation, including ignore arriving during submit',async()=>{
 identity='ignored-confirm-owner';clock='2026-10-23';
 assert.equal((await post({action:'rule',id:'ignored-variable-rule',title:'电话费',amount:'0',currency:'MYR',kind:'expense',category:'账单',date:'2026-10-22',start:'2026-10-22',frequency:'monthly',mode:'variable'})).status,200);
 const data=await get(),occ=data.pending[0];assert.ok(occ);
 const mark=()=>sql.prepare("INSERT INTO pocket_commitments(owner,id,kind,title,currency,data,status) VALUES (?,?,'confirmation','电话费','MYR',?,'ignored')").run(identity,`rule:${occ.rule_id}:${occ.due}`,JSON.stringify({rule_id:occ.rule_id,due:occ.due,paid_date:'',amount:0}));
 beforeBatch=mark;
 assert.equal((await post({action:'confirm',id:occ.id,amount:'20'})).status,409);
 assert.equal((await get()).transactions.length,0);assert.equal((await get()).pending[0].amount,0);
 assert.equal((await post({action:'confirm',id:occ.id,amount:'20'})).status,409);
 sql.prepare("UPDATE pocket_commitments SET status='active' WHERE owner=?").run(identity);
 assert.equal((await post({action:'confirm',id:occ.id,amount:'20'})).status,200);
 assert.equal((await get()).transactions.length,0);assert.equal((await get()).occurrences.find(o=>o.id===occ.id).status,'awaiting');
});
await test('expense schedules and amount confirmation never book consumption before payment',async()=>{
 identity='payment-gated-owner';clock='2026-11-01';
 const rule={...base,action:'rule',id:'gated-fixed-001',date:clock,mode:'fixed',frequency:'monthly'};
 assert.equal((await post(rule)).status,200);clock='2026-12-02';await post({action:'sync'});await post({action:'sync'});
 let data=await get();assert.equal(data.transactions.length,0);assert.equal(data.occurrences.length,2);assert.ok(data.occurrences.every(o=>o.status==='awaiting'));
 await post({...rule,id:'gated-variable-001',mode:'variable',amount:''});data=await get();const pending=data.pending[0];
 assert.equal((await post({action:'confirm',id:pending.id,amount:'25.50'})).status,200);
 data=await get();assert.equal(data.transactions.length,0);assert.equal(data.occurrences.find(o=>o.id===pending.id).amount,2550);assert.equal(data.occurrences.find(o=>o.id===pending.id).status,'awaiting');
});
await test('manual income categories stay separate from spending and duplicate submissions',async()=>{
 identity='income-categories-owner';clock='2026-11-12';
 for(const [i,category]of domain.INCOME_CATEGORIES.entries()){
  const body={...base,id:'income-category-'+i,kind:'income',category,amount:'100',date:clock};
  assert.equal((await post(body)).status,200);assert.equal((await post(body)).status,200);
  if(category!=='其他')assert.equal((await post({...body,id:'invalid-expense-'+i,kind:'expense'})).status,400);
 }
 assert.equal((await post({...base,id:'bad-income-category',kind:'income',date:clock})).status,400);
 const rows=(await get()).transactions;assert.equal(rows.length,5);assert.equal(rows.reduce((n,t)=>n+t.amount,0),50000);assert.ok(rows.every(t=>t.kind==='income'));
});
await test('salary remains unbooked until receipt; late receipt crosses month, rejects replay and wrong owner, and rolls back partial failure',async()=>{
 identity='salary-receipt-owner';clock='2026-10-31';
 const rule={...base,id:'salary-receipt-001',action:'rule',title:'工资',kind:'income',category:'工资',amount:'4000',date:clock,frequency:'monthly',mode:'fixed'};
 assert.equal((await post(rule)).status,200);clock='2026-11-12';await post({action:'sync'});
 let data=await get();assert.equal(data.transactions.length,0);const due=data.occurrences[0];assert.equal(due.status,'awaiting');
 const body={action:'receive',id:due.id,date:'2026-11-01',amount:'3999.99'};
 identity='foreign-income-owner';assert.equal((await post(body)).status,409);identity='salary-receipt-owner';
 assert.equal((await post({...body,date:'2026-11-13'})).status,400);
 failAfter=2;assert.equal((await post(body)).status,503);data=await get();assert.equal(data.transactions.length,0);assert.equal(data.occurrences[0].status,'awaiting');
 assert.equal((await post(body)).status,200);assert.equal((await post(body)).status,409);
 data=await get();assert.equal(data.transactions.length,1);assert.equal(data.transactions[0].date,'2026-11-01');assert.equal(data.transactions[0].occurrence,'2026-10-31');assert.equal(data.transactions[0].amount,399999);
 await post({action:'sync'});assert.equal((await get()).transactions.length,1);
});
await test('two devices confirming different receipt amounts cannot silently overwrite the first confirmation',async()=>{
 identity='receipt-race-owner';clock='2026-11-12';
 await post({...base,id:'receipt-race-rule',action:'rule',kind:'income',category:'工资',date:clock,amount:'4000',frequency:'monthly',mode:'fixed'});
 const o=(await get()).occurrences[0],body={action:'receive',id:o.id,date:clock,amount:'4000'};
 beforeBatch=async()=>assert.equal((await post({...body,amount:'3900'})).status,200);
 assert.equal((await post(body)).status,409);
 const rows=(await get()).transactions;assert.equal(rows.length,1);assert.equal(rows[0].amount,390000);
});
await test('legacy auto-booked income is preserved rather than re-requested or double-booked',async()=>{
 identity='legacy-income-owner';clock='2026-11-12';
 await post({...base,id:'legacy-income-rule',action:'rule',kind:'income',category:'工资',date:clock,amount:'1000',frequency:'monthly',mode:'fixed'});
 const o=(await get()).occurrences[0];
 sql.prepare("UPDATE occurrences SET status='recorded' WHERE id=?").run(o.id);
 sql.prepare("INSERT INTO transactions(id,owner,title,amount,currency,kind,category,date,note,rule_id,occurrence,created_at) VALUES (?,?,'旧工资',100000,'MYR','income','工资',?,'周期自动入账',?,?,'legacy')").run(o.id,identity,clock,o.rule_id,o.due);
 const snapshot=JSON.stringify((await get()).transactions);
 await post({action:'sync'});assert.equal((await post({action:'receive',id:o.id,date:clock})).status,409);
 assert.equal(JSON.stringify((await get()).transactions),snapshot);
});
await test('idempotent replay requires identical content and never reports a changed or deleted submission as saved',async()=>{
 identity='replay-content-owner';clock=domain.today();
 const body={...base,id:'replay-content-001',date:clock};assert.equal((await post(body)).status,200);
 assert.equal((await post({...body,amount:'50'})).status,409);
 let saved=(await get()).transactions[0];assert.equal(saved.amount,1229);
 assert.equal((await post({action:'delete',id:saved.id,edit_version:saved.edit_version})).status,200);
 assert.equal((await post(body)).status,409);assert.equal((await get()).transactions.length,0);
});
await test('delete and undo reject stale versions, including a modification between read and commit',async()=>{
 identity='delete-conflict-owner';clock=domain.today();
 await post({...base,id:'delete-conflict-001',date:clock});const original=(await get()).transactions[0];
 assert.equal((await post({action:'delete',id:original.id})).status,409);
 await post({...base,id:original.id,action:'edit',edit_version:original.edit_version,amount:'20',date:clock});
 assert.equal((await post({action:'delete',id:original.id,edit_version:original.edit_version})).status,409);
 const current=(await get()).transactions[0];
 beforeBatch=()=>sql.prepare("UPDATE transactions SET amount=2500 WHERE owner=? AND id=?").run(identity,current.id);
 assert.equal((await post({action:'delete',id:current.id,edit_version:current.edit_version})).status,409);
 const latest=(await get()).transactions[0];assert.equal(latest.amount,2500);
 assert.equal((await post({action:'delete',id:latest.id,edit_version:latest.edit_version})).status,200);
 assert.equal((await get()).transactions.length,0);
});
await test('null, array and primitive payloads fail validation rather than masquerading as server outages',async()=>{
 for(const body of [null,[],1,'invalid'])assert.equal((await post(body)).status,400);
});
await test('prepaid recurring expense can be corrected without changing its original future due date',async()=>{
 identity='future-expense-editor';clock='2026-11-11';
 sql.prepare("INSERT INTO transactions(id,owner,title,amount,currency,kind,category,date,note,rule_id,occurrence,created_at) VALUES ('future-edit-001',?,'房租',60000,'MYR','expense','居住','2026-11-20','周期付款确认','future-rule','2026-11-20','now')").run(identity);
 const original=(await get()).transactions[0],edit={...base,id:original.id,action:'edit',title:'房租备注修正',category:'居住',amount:'600',date:'2026-11-20',edit_version:original.edit_version};
 assert.equal((await post({...edit,date:'2026-11-21'})).status,400);
 assert.equal((await post(edit)).status,200);
 const saved=(await get()).transactions[0];assert.equal(saved.date,'2026-11-20');assert.equal(saved.title,edit.title);assert.equal(saved.amount,60000);
});
await test('concurrent variable amount confirmations never claim to save the losing amount',async()=>{
 identity='variable-amount-race';clock='2026-10-23';
 await post({...base,action:'rule',id:'amount-race-rule',title:'电话费',category:'账单',date:'2026-10-22',frequency:'monthly',mode:'variable',amount:''});
 const occurrence=(await get()).pending[0];
 const body={action:'confirm',id:occurrence.id,amount:'20'};
 beforeBatch=async()=>assert.equal((await post({...body,amount:'35'})).status,200);
 assert.equal((await post(body)).status,409);
 const snapshot=await get();assert.equal(snapshot.occurrences.find(o=>o.id===occurrence.id).amount,3500);assert.equal(snapshot.transactions.length,0);
});
await test('recurring rule replay verifies full content and never claims another owners ID was saved',async()=>{
 identity='rule-replay-owner';clock='2026-10-23';const rule={...base,action:'rule',id:'replay-rule-001',date:'2026-11-01',frequency:'monthly',mode:'fixed'};
 assert.equal((await post(rule)).status,200);assert.equal((await post(rule)).status,200);
 for(const change of [{amount:'50'},{title:'changed'},{category:'其他'},{frequency:'weekly'}])assert.equal((await post({...rule,...change})).status,409);
 assert.equal((await get()).rules[0].amount,1229);
 identity='rule-other-owner';assert.equal((await post(rule)).status,409);assert.equal((await get()).rules.length,0);
});
await test('PayLater deletion requires a choice and preserves or cancels only the linked plan',async()=>{
 identity='delete-plan-owner';clock='2026-10-23';
 for(const [choice,id] of [['keep','keep-plan-record'],['cancel','cancel-plan-record']]){
  assert.equal((await post({...base,id,date:clock})).status,200);
  const data={rows:[{paid_date:'',amount:1229}]};
  sql.prepare("INSERT INTO pocket_commitments(owner,id,kind,title,currency,data,status,revision) VALUES (?,?,'paylater','plan','MYR',?,'active',0)").run(identity,id,JSON.stringify(data));
  const row=(await get()).transactions.find(t=>t.id===id);
  const body={action:'delete',id,edit_version:row.edit_version,plan_revision:0};
  assert.equal((await post(body)).status,400);
  assert.equal((await post({...body,plan_disposition:choice})).status,200);
  assert.equal((await get()).transactions.some(t=>t.id===id),false);
  assert.equal(sql.prepare('SELECT status FROM pocket_commitments WHERE owner=? AND id=?').get(identity,id).status,choice==='keep'?'active':'cancelled');
 }
});
sql.close();
