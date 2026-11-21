import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const domain=await import('data:text/javascript;base64,'+Buffer.from(transpile(readFileSync('lib/ledger-domain.ts','utf8'))).toString('base64'));
globalThis.__commitmentDomain=domain;
const finance=await import('data:text/javascript;base64,'+Buffer.from(transpile(readFileSync('lib/commitments.ts','utf8')).replace(/^import .*;\n/gm,'const {validDate}=globalThis.__commitmentDomain;\n')).toString('base64'));
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
let hook=null,beforeWrite=null,user='owner-a',failWrites=false,failAfter=0;
const wrap=(q,p=[])=>({bind:(...args)=>wrap(q,args),first:async()=>sql.prepare(q).get(...p)||null,all:async()=>({results:sql.prepare(q).all(...p)}),run:async()=>{if(failWrites||failAfter&&--failAfter===0)throw Error('simulated database outage');if(beforeWrite){const h=beforeWrite;beforeWrite=null;h();}const r=sql.prepare(q).run(...p);return {meta:{changes:r.changes}}}});
const DB={prepare:q=>wrap(q),batch:async statements=>{if(hook){const h=hook;hook=null;h();}sql.exec('BEGIN');try{for(const s of statements)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e}}};
const source=transpile(readFileSync('app/api/commitments/route.ts','utf8').replace(/^import .*;\n/gm,'')).replace(/export /g,'');
const {transactionVersion}=await import('data:text/javascript;base64,'+Buffer.from(transpile(readFileSync('lib/transaction-version.ts','utf8'))).toString('base64'));
const deps={env:{DB},getChatGPTUser:async()=>user?{userId:user}:null,...domain,...finance,transactionVersion,today:()=> '2026-10-23'};
const api=new Function(...Object.keys(deps),source+';return {POST};')(...Object.values(deps));
const post=(b,origin='https://ledger.test')=>api.POST(new Request('https://ledger.test/api/commitments',{method:'POST',headers:{origin},body:JSON.stringify(b)}));
const stored=id=>sql.prepare('SELECT * FROM pocket_commitments WHERE owner=? AND id=?').get(user,id);
const plan=id=>JSON.parse(stored(id).data);
const base={action:'purchase',id:'finance-test-001',title:'手机',amount:'300',total:'309',currency:'MYR',kind:'expense',category:'购物',date:'2026-10-10',payment_method:'spaylater',months:3,first_due:'2026-10-31',revision:-1};
await test('purchase and schedule save atomically, cents sum exactly, and repayments never create expenses',async()=>{
 user=null;assert.equal((await post(base)).status,401);user='owner-a';assert.equal((await post(base,'https://other.test')).status,403);
 assert.equal((await post({...base,owner:'forged-owner'})).status,200);
 const d=plan(base.id);assert.deepEqual(d.rows.map(r=>[r.due,r.amount]),[['2026-10-31',10300],['2026-11-30',10300],['2026-12-31',10300]]);
 assert.equal(sql.prepare('SELECT amount FROM transactions WHERE id=? AND owner=?').get(base.id,user).amount,30900);
 assert.equal((await post(base)).status,200);assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE id=?').get(base.id).n,1);
 assert.equal((await post({action:'pay',id:base.id,revision:0,row_id:d.rows[0].id,date:'2026-10-23'})).status,200);
 assert.equal(plan(base.id).rows[0].paid_date,'2026-10-23');assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=?').get(user).n,1);
 user='other-owner';assert.equal((await post({action:'pay',id:base.id,revision:1,row_id:d.rows[1].id,date:'2026-10-23'})).status,404);user='owner-a';
 const paid=plan(base.id);assert.equal((await post({action:'plan',id:base.id,revision:1,rows:paid.rows.map((r,i)=>i===0?{...r,amount:1}:r)})).status,400);
});
await test('deposit refunds are not income; deduction and rent consume only once with conflict protection',async()=>{
 const id='deposit-test-001';assert.equal((await post({action:'deposit',id,title:'租房押金',amount:'3000',currency:'MYR',date:'2026-10-01'})).status,200);
 const count=sql.prepare('SELECT COUNT(*) n FROM transactions').get().n;
 const refund={action:'movement',id,revision:0,movement_id:'refund-test-001',kind:'refund',amount:'2800',date:'2026-10-20'};
 assert.equal((await post(refund)).status,200);assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions').get().n,count);assert.equal(finance.depositHeld(plan(id)),20000);
 const deduction={action:'movement',id,revision:1,movement_id:'deduct-test-001',kind:'deduct',amount:'200',date:'2026-10-21'};
 assert.equal((await post(deduction)).status,200);await post(deduction);assert.equal(finance.depositHeld(plan(id)),0);
 assert.equal(sql.prepare('SELECT SUM(amount) total FROM transactions WHERE id LIKE ?').get('deposit:'+id+':%').total,20000);
 assert.equal((await post({action:'movement_void',id,revision:2,movement_id:'deduct-test-001'})).status,200);assert.equal(finance.depositHeld(plan(id)),20000);
 assert.equal(sql.prepare('SELECT deleted FROM transactions WHERE id=?').get('deposit:'+id+':deduct-test-001').deleted,1);
 assert.equal((await post({action:'deposit_edit',id,revision:3,title:'更正押金',amount:'3100',currency:'MYR',date:'2026-10-01'})).status,200);assert.equal(finance.depositHeld(plan(id)),30000);
 const race='deposit-race-001';await post({action:'deposit',id:race,title:'押金',amount:'100',currency:'MYR',date:'2026-10-01'});
 hook=()=>sql.prepare('UPDATE pocket_commitments SET revision=revision+1 WHERE id=?').run(race);
 assert.equal((await post({...deduction,id:race,revision:0,amount:'10',movement_id:'deduct-race-001'})).status,409);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE id LIKE ?').get('deposit:'+race+':%').n,0);
});
await test('platform monthly invoice covers underlying instalments once without adding consumption',async()=>{
 user='invoice-owner';const p={...base,id:'invoice-item-001',total:'300',months:1};await post(p);
 const before=sql.prepare('SELECT SUM(amount) n FROM transactions WHERE owner=?').get(user).n;
 const invoice={action:'invoice',id:'invoice-test-001',provider:'spaylater',amount:'305',currency:'MYR',due:'2026-10-31',title:'10月平台账单'};
 assert.equal((await post(invoice)).status,200);
 const list=sql.prepare('SELECT * FROM pocket_commitments WHERE owner=?').all(user);
 const due=finance.paymentDue(list,[],[],[],'2026-10-23','2026-11-22',domain.dates);assert.equal(due.length,1);assert.equal(due[0].amount,30500);
 assert.equal(sql.prepare('SELECT SUM(amount) n FROM transactions WHERE owner=?').get(user).n,before);
 assert.equal((await post({...invoice,id:'invoice-test-002'})).status,409);
 assert.equal((await post({action:'pay',id:p.id,row_id:plan(p.id).rows[0].id,revision:0,date:'2026-10-23'})).status,409);
 assert.equal((await post({action:'pay',id:invoice.id,row_id:plan(invoice.id).rows[0].id,revision:0,date:'2026-10-23'})).status,200);
 assert.equal(finance.paymentDue(sql.prepare('SELECT * FROM pocket_commitments WHERE owner=?').all(user),[],[],[],'2026-10-23','2026-11-22',domain.dates).length,0);
});
await test('source updates preserve paid snapshots and require explicit reconciliation',()=>{
 const row={record_type:'expense',group_id:'group-a',record_id:'entry-a',member_id:'member-a',deleted:0,title:'替朋友购买',currency:'MYR',date:'2026-10-01',paylater:JSON.stringify({provider:'spaylater',months:3,first_due:'2026-11-01',total:30900})};
 const virtual=finance.tripPlan(row);assert.equal(virtual.id,'trip:group-a:entry-a:member-a');
 const saved={...virtual,revision:0};const changed={...row,paylater:JSON.stringify({provider:'spaylater',months:6,first_due:'2026-11-01',total:30900})};
 assert.equal(finance.allCommitments([saved],[changed])[0].review,true);assert.equal(finance.allCommitments([saved],[{...row,deleted:1}])[0].review,true);
 assert.equal(finance.allCommitments([saved],[row]).length,1);
});
await test('recurring prepayment creates one expense dated on the due date',async()=>{
 user='rule-confirm-owner';sql.prepare("INSERT INTO rules(id,owner,title,amount,currency,kind,category,start,frequency,mode,status,processed_through,created_at) VALUES ('recurring-test-001',?,'房租',150000,'MYR','expense','居住','2026-10-25','monthly','fixed','active','','now')").run(user);
 const id='rule:recurring-test-001:2026-10-25';assert.equal((await post({action:'rulepay',id,rule_id:'recurring-test-001',due:'2026-10-25',date:'2026-10-23',revision:-1})).status,200);
 const saved=sql.prepare('SELECT * FROM pocket_commitments WHERE owner=?').all(user),rules=sql.prepare('SELECT * FROM rules WHERE owner=?').all(user);
 assert.equal(finance.paymentDue(saved,[],[],rules,'2026-10-23','2026-11-22',domain.dates).length,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=?').get(user).n,1);assert.equal(sql.prepare('SELECT date FROM transactions WHERE owner=?').get(user).date,'2026-10-25');
});
await test('ignore one recurring term is reversible, isolated, revision guarded and never changes consumption',async()=>{
 user='ignore-owner';
 const insertRule=sql.prepare("INSERT INTO rules(id,owner,title,amount,currency,kind,category,start,frequency,mode,status,processed_through,created_at) VALUES (?,?,?,?,'MYR','expense','账单',?,'monthly',?,'active','','now')");
 insertRule.run('ignore-fixed-001',user,'房租',60000,'2026-10-10','fixed');
 insertRule.run('ignore-variable-001',user,'电话费',0,'2026-10-22','variable');
 sql.prepare("INSERT INTO occurrences(id,owner,rule_id,due,status,title,amount,currency,kind,category) VALUES (?,?,?,'2026-10-10','recorded','房租',60000,'MYR','expense','居住')").run('ignore-occ-fixed',user,'ignore-fixed-001');
 sql.prepare("INSERT INTO occurrences(id,owner,rule_id,due,status,title,amount,currency,kind,category) VALUES (?,?,?,'2026-10-22','pending','电话费',0,'MYR','expense','账单')").run('ignore-occ-variable',user,'ignore-variable-001');
 sql.prepare("INSERT INTO transactions(id,owner,title,amount,currency,kind,category,date,created_at) VALUES ('ignore-tx-fixed',?,'房租',60000,'MYR','expense','居住','2026-10-10','now')").run(user);
 const snapshot=()=>JSON.stringify(['transactions','occurrences','rules'].map(table=>sql.prepare(`SELECT * FROM ${table} WHERE owner=? ORDER BY id`).all(user)));
 const before=snapshot(),due=()=>finance.paymentDue(sql.prepare('SELECT * FROM pocket_commitments WHERE owner=?').all(user),[],sql.prepare('SELECT * FROM occurrences WHERE owner=?').all(user),sql.prepare('SELECT * FROM rules WHERE owner=?').all(user),'2026-10-23','2026-11-22',domain.dates);
 const fixed={action:'ruleignore',id:'rule:ignore-fixed-001:2026-10-10',rule_id:'ignore-fixed-001',due:'2026-10-10',revision:-1};
 user=null;assert.equal((await post(fixed)).status,401);user='ignore-owner';assert.equal((await post(fixed,'https://evil.test')).status,403);
 user='other-owner';assert.equal((await post({...fixed,owner:'ignore-owner'})).status,404);user='ignore-owner';
 assert.equal((await post(fixed)).status,200);assert.equal(stored(fixed.id).status,'ignored');assert.equal(plan(fixed.id).paid_date,'');assert.equal(snapshot(),before);
 assert.ok(!due().some(d=>d.id===fixed.id));assert.ok(due().some(d=>d.due==='2026-11-10'));
 assert.equal((await post(fixed)).status,409);
 assert.equal((await post({...fixed,action:'rulepay',revision:0,date:'2026-10-23'})).status,409);
 const variable={action:'ruleignore',id:'rule:ignore-variable-001:2026-10-22',rule_id:'ignore-variable-001',due:'2026-10-22',revision:-1};
 assert.equal((await post(variable)).status,200);assert.ok(!due().some(d=>d.id===variable.id));assert.ok(due().some(d=>d.amountPending&&d.due==='2026-11-22'));assert.equal(snapshot(),before);
 const known=finance.dueSummary(due()).total;assert.equal(known,60000);
 assert.equal((await post({...fixed,action:'ruleunignore',revision:0})).status,200);assert.ok(due().some(d=>d.id===fixed.id));assert.equal(finance.dueSummary(due()).total,120000);assert.equal(snapshot(),before);
 assert.equal((await post({...variable,action:'ruleunignore',revision:0})).status,200);assert.ok(due().some(d=>d.id===variable.id&&d.amountPending));assert.equal(snapshot(),before);
 const beforeFailure=JSON.stringify(stored(variable.id));failWrites=true;
 assert.equal((await post({...variable,revision:1})).status,503);failWrites=false;
 assert.equal(JSON.stringify(stored(variable.id)),beforeFailure);assert.ok(due().some(d=>d.id===variable.id));
 // Ignore a forecast term; occurrence generation later must not make it reappear.
 const future={action:'ruleignore',id:'rule:ignore-variable-001:2026-11-22',rule_id:'ignore-variable-001',due:'2026-11-22',revision:-1};
 assert.equal((await post(future)).status,200);
 const occ=sql.prepare('SELECT * FROM occurrences WHERE owner=?').all(user);occ.push({...occ.find(o=>o.status==='pending'),id:'future-occ',due:'2026-11-22'});
 const items=finance.paymentDue(sql.prepare('SELECT * FROM pocket_commitments WHERE owner=?').all(user),[],occ,sql.prepare('SELECT * FROM rules WHERE owner=?').all(user),'2026-11-23','2026-12-23',domain.dates);
 assert.ok(!items.some(d=>d.id===future.id));
});
await test('payment-gated expense is due-dated, idempotent, reversible, isolated and atomic on failure',async()=>{
 user='gated-owner';
 sql.prepare("INSERT INTO rules(id,owner,title,amount,currency,kind,category,start,frequency,mode,status,processed_through,created_at) VALUES ('gated-rule-001',?,'jiayong',25000,'MYR','expense','其他','2026-10-20','monthly','fixed','active','','now')").run(user);
 sql.prepare("INSERT INTO occurrences(id,owner,rule_id,due,status,title,amount,currency,kind,category) VALUES ('gated-rule-001:2026-10-20',?,'gated-rule-001','2026-10-20','awaiting','jiayong',25000,'MYR','expense','其他')").run(user);
 const body={action:'rulepay',id:'rule:gated-rule-001:2026-10-20',rule_id:'gated-rule-001',due:'2026-10-20',date:'2026-10-23',revision:-1};
 failWrites=true;assert.equal((await post(body)).status,503);failWrites=false;assert.equal(stored(body.id),undefined);assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=?').get(user).n,0);
 assert.equal((await post(body)).status,200);assert.equal((await post(body)).status,409);
 let tx=sql.prepare('SELECT * FROM transactions WHERE owner=?').get(user);assert.equal(tx.date,body.due);assert.equal(tx.amount,25000);assert.equal(plan(body.id).paid_date,body.date);
 assert.equal((await post({...body,action:'ruleunpay',revision:0})).status,200);assert.equal(sql.prepare('SELECT deleted FROM transactions WHERE id=?').get(tx.id).deleted,1);
 assert.equal((await post({...body,revision:1})).status,200);assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=? AND deleted=0').get(user).n,1);
 hook=()=>sql.prepare('UPDATE pocket_commitments SET revision=revision+1 WHERE owner=? AND id=?').run(user,body.id);
 assert.equal((await post({...body,action:'ruleunpay',revision:2})).status,409);assert.equal(sql.prepare('SELECT deleted FROM transactions WHERE id=?').get(tx.id).deleted,0);
 user='foreign-owner';assert.equal((await post({...body,revision:-1})).status,400);assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=?').get(user).n,0);
 user='gated-owner';
 // Existing legacy expense is reused; undoing its payment must not rewrite history.
 sql.prepare("UPDATE transactions SET note='周期自动入账' WHERE id=?").run(tx.id);
 sql.prepare("UPDATE pocket_commitments SET data=json_set(data,'$.managed_transaction',json('false')) WHERE owner=? AND id=?").run(user,body.id);
 const snapshot=sql.prepare('SELECT * FROM transactions WHERE id=?').get(tx.id),revision=stored(body.id).revision;
 assert.equal((await post({...body,action:'ruleunpay',revision})).status,200);assert.deepEqual(sql.prepare('SELECT * FROM transactions WHERE id=?').get(tx.id),snapshot);
 assert.equal((await post({...body,revision:revision+1})).status,200);assert.deepEqual(sql.prepare('SELECT * FROM transactions WHERE id=?').get(tx.id),snapshot);
});
await test('variable prepayment persists amount and original due date; partial database failure rolls back acknowledgement',async()=>{
 user='variable-early-owner';
 sql.prepare("INSERT INTO rules(id,owner,title,amount,currency,kind,category,start,frequency,mode,status,processed_through,created_at) VALUES ('variable-early-001',?,'电话费',0,'MYR','expense','账单','2026-10-25','monthly','variable','active','','now')").run(user);
 const body={action:'rulepay',id:'rule:variable-early-001:2026-10-25',rule_id:'variable-early-001',due:'2026-10-25',date:'2026-10-23',amount:'35.21',revision:-1};
 failAfter=2;assert.equal((await post(body)).status,503);assert.equal(stored(body.id),undefined);assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=?').get(user).n,0);
 assert.equal((await post(body)).status,200);
 assert.equal(sql.prepare('SELECT date FROM transactions WHERE owner=?').get(user).date,'2026-10-25');assert.equal(sql.prepare('SELECT amount FROM transactions WHERE owner=?').get(user).amount,3521);
 assert.equal(sql.prepare('SELECT amount FROM occurrences WHERE owner=?').get(user).amount,3521);
 assert.equal(finance.paymentDue([stored(body.id)],[],sql.prepare('SELECT * FROM occurrences WHERE owner=?').all(user),sql.prepare('SELECT * FROM rules WHERE owner=?').all(user),'2026-10-23','2026-10-31',domain.dates).length,0);
});
await test('PayLater replay verifies the whole expense and plan, without requiring the post-save revision',async()=>{
 user='purchase-replay-owner';const body={...base,id:'replay-purchase-001',note:'原始备注'};
 assert.equal((await post(body)).status,200);const original=stored(body.id);
 assert.equal((await post(body)).status,200);
 for(const change of [{category:'餐饮'},{note:'另一个备注'},{title:'另一笔'},{total:'310'},{currency:'SGD'},{months:6}])assert.equal((await post({...body,...change})).status,409);
 assert.deepEqual(stored(body.id),original);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=?').get(user).n,1);
 sql.prepare('UPDATE transactions SET deleted=1 WHERE owner=? AND id=?').run(user,body.id);
 assert.equal((await post(body)).status,404);
});
await test('PayLater edit and ordinary conversion protect both transaction content and plan revision',async()=>{
 user='purchase-edit-owner';const body={...base,id:'edit-purchase-001'};await post(body);
 const tx=()=>sql.prepare('SELECT * FROM transactions WHERE owner=? AND id=?').get(user,body.id);
 const edit={...body,edit:true,revision:0,title:'修改名称',edit_version:transactionVersion(tx())};
 assert.equal((await post({...edit,edit_version:'stale'})).status,409);
 hook=()=>sql.prepare("UPDATE transactions SET note='other device' WHERE owner=? AND id=?").run(user,body.id);
 assert.equal((await post(edit)).status,409);assert.equal(stored(body.id).revision,0);assert.equal(tx().title,body.title);
 assert.equal((await post({...edit,edit_version:transactionVersion(tx())})).status,200);assert.equal(stored(body.id).revision,1);assert.equal(tx().title,edit.title);
 const conversion={...base,id:'convert-purchase-001',edit:true,revision:-1};
 sql.prepare("INSERT INTO transactions(id,owner,title,amount,currency,kind,category,date,note,created_at) VALUES (?,?,'普通消费',30000,'MYR','expense','购物','2026-10-10','','now')").run(conversion.id,user);
 const original=sql.prepare('SELECT * FROM transactions WHERE owner=? AND id=?').get(user,conversion.id);
 hook=()=>sql.prepare("UPDATE transactions SET amount=40000 WHERE owner=? AND id=?").run(user,conversion.id);
 assert.equal((await post({...conversion,edit_version:transactionVersion(original)})).status,409);assert.equal(stored(conversion.id),undefined);
 assert.equal(sql.prepare('SELECT amount FROM transactions WHERE owner=? AND id=?').get(user,conversion.id).amount,40000);
});
await test('a concurrent ordinary insert cannot produce an unrelated PayLater plan or false success',async()=>{
 user='purchase-insert-race';const body={...base,id:'insert-race-purchase'};
 hook=()=>sql.prepare("INSERT INTO transactions(id,owner,title,amount,currency,kind,category,date,note,created_at) VALUES (?,?,'another record',100,'MYR','expense','其他','2026-10-10','','now')").run(body.id,user);
 assert.equal((await post(body)).status,409);assert.equal(stored(body.id),undefined);
 assert.equal(sql.prepare('SELECT amount FROM transactions WHERE owner=? AND id=?').get(user,body.id).amount,100);
});
await test('PayLater cannot use income-only categories, or report malformed JSON as an outage',async()=>{
 user='purchase-validation-owner';for(const category of ['工资','奖金','兼职','卖东西'])assert.equal((await post({...base,id:'category-validation-001',category})).status,400);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=?').get(user).n,0);
 assert.equal((await api.POST(new Request('https://ledger.test/api/commitments',{method:'POST',headers:{origin:'https://ledger.test'},body:'{'}))).status,400);
});
await test('deposit identifiers never silently accept a different title or movement content',async()=>{
 user='deposit-replay-owner';const deposit={action:'deposit',id:'deposit-replay-001',title:'房租押金',amount:'100',currency:'MYR',date:'2026-10-01'};
 assert.equal((await post(deposit)).status,200);assert.equal((await post(deposit)).status,200);
 assert.equal((await post({...deposit,title:'另一个押金'})).status,409);
 const movement={action:'movement',id:deposit.id,revision:0,movement_id:'movement-replay-001',kind:'deduct',amount:'10',date:'2026-10-20',note:'原备注'};
 assert.equal((await post(movement)).status,200);
 assert.equal((await post({...movement,revision:1})).status,200);
 for(const change of [{amount:'11'},{kind:'rent'},{date:'2026-10-21'},{note:'另一个备注'}])assert.equal((await post({...movement,revision:1,...change})).status,409);
 assert.equal(finance.depositHeld(plan(deposit.id)),9000);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions WHERE owner=?').get(user).n,1);
 assert.equal((await post({action:'movement_void',id:deposit.id,revision:1,movement_id:movement.movement_id})).status,200);
 assert.equal((await post({...movement,revision:2})).status,409);
});
await test('variable bills save just the amount, or explicitly book one expense at the original due date',async()=>{
 user='same-sheet-owner';
 const put=sql.prepare("INSERT INTO rules(id,owner,title,amount,currency,kind,category,start,frequency,mode,status,processed_through,created_at) VALUES (?,?,'电话费',0,'MYR','expense','账单','2026-10-20','monthly','variable','active','','now')");
 const occurrence=sql.prepare("INSERT INTO occurrences(id,owner,rule_id,due,status,title,amount,currency,kind,category) VALUES (?,?,?,'2026-10-20','pending','电话费',0,'MYR','expense','账单')");
 for(const [index,only] of [true,false].entries()){
  const rule_id='variable-sheet-'+index,due='2026-10-20',id='rule:'+rule_id+':'+due,occ=rule_id+':'+due;
  put.run(rule_id,user);occurrence.run(occ,user,rule_id);
  const body={id,rule_id,due,amount:'52.40',date:'2026-10-23',revision:-1};
  if(only){assert.equal((await post({...body,action:'ruleamount'})).status,200);assert.equal(plan(id).paid_date,'');assert.equal(sql.prepare('SELECT * FROM transactions WHERE id=?').get(occ),undefined);body.revision=0;}
  const paid=await post({...body,action:'rulepay'});assert.equal(paid.status,200);
  assert.deepEqual((await paid.json()).record,{id:occ,date:due,currency:'MYR'});
  assert.equal(sql.prepare('SELECT amount FROM occurrences WHERE id=?').get(occ).amount,5240);
  assert.equal(sql.prepare('SELECT amount FROM transactions WHERE id=?').get(occ).amount,5240);
  assert.equal(plan(id).paid_date,body.date);
  assert.equal((await post({...body,action:'rulepay'})).status,409);
 }
});
const monthly={action:'invoice',provider:'spaylater',amount:'309',currency:'MYR',due:'2026-10-31'};
const insertInvoice=sql.prepare("INSERT INTO pocket_commitments(owner,id,kind,title,currency,source_key,data,status) VALUES (?,?,'paylater','Invoice',?,?,?,?)");
await test('active invoice uniqueness survives concurrent create and blocks same-month restore',async()=>{
 user='invoice-unique-race';
 const invoice={...monthly,id:'invoice-unique-first'};
 const competing='invoice-unique-other';
 const data={provider:monthly.provider,date:'2026-10-23',total:30900,months:1,first_due:monthly.due,rows:finance.planRows(competing,30900,1,monthly.due),covers:[]};
 beforeWrite=()=>insertInvoice.run(user,competing,'MYR','invoice:spaylater:2026-10',JSON.stringify(data),'active');
 assert.equal((await post(invoice)).status,409);
 assert.equal(stored(invoice.id),undefined);
 assert.equal((await post({id:competing,action:'cancel',revision:0})).status,200);
 assert.equal((await post(invoice)).status,200);
 assert.equal((await post({id:competing,action:'restore',revision:1})).status,409);
 assert.equal(stored(competing).status,'cancelled');
 assert.equal((await post({...invoice,id:'invoice-unique-sgd',currency:'SGD'})).status,200);
});
await test('invoice restore rejects coverage that another active invoice acquired',async()=>{
 user='invoice-overlap-owner';
 const purchase={...base,id:'invoice-overlap-item',months:1};
 const invoice={...monthly,id:'invoice-overlap-first'};
 assert.equal((await post(purchase)).status,200);
 assert.equal((await post(invoice)).status,200);
 assert.equal((await post({id:invoice.id,action:'cancel',revision:0})).status,200);
 const data=plan(invoice.id),competitor='invoice-overlap-other';
 // Simulate a historical invoice with an overlapping link under a different key.
 const due='2026-11-30';
 beforeWrite=()=>insertInvoice.run(user,competitor,'MYR','invoice:spaylater:2026-11',JSON.stringify({...data,first_due:due,rows:finance.planRows(competitor,data.total,1,due)}),'active');
 assert.equal((await post({id:invoice.id,action:'restore',revision:1})).status,409);
 assert.equal(stored(invoice.id).status,'cancelled');
 assert.equal(stored(competitor).status,'active');
});
await test('monthly invoice edits allow one row in the original month only',async()=>{
 user='invoice-edit-month-owner';
 const invoice={...monthly,id:'invoice-edit-month'};
 assert.equal((await post(invoice)).status,200);
 const [row]=plan(invoice.id).rows,edit={id:invoice.id,action:'plan',revision:0};
 assert.equal((await post({...edit,rows:[{...row,due:'2026-11-01'}]})).status,409);
 assert.equal((await post({...edit,rows:finance.planRows(invoice.id,row.amount,2,'2026-10-01')})).status,409);
 assert.equal((await post({...edit,rows:[{...row,due:'2026-10-30'}]})).status,200);
 assert.equal(plan(invoice.id).first_due,'2026-10-30');
});
await test('cancelled plans cannot accept payment',async()=>{
 user='cancelled-payment-owner';
 const purchase={...base,id:'cancelled-payment-item',months:1};
 assert.equal((await post(purchase)).status,200);
 assert.equal((await post({id:purchase.id,action:'cancel',revision:0})).status,200);
 const [row]=plan(purchase.id).rows;
 assert.equal((await post({id:purchase.id,action:'pay',revision:1,row_id:row.id,date:'2026-10-23'})).status,409);
 assert.equal(plan(purchase.id).rows[0].paid_date,'');
});
await test('purchase edits lose against an invoice created before the write',async()=>{
 user='covered-purchase-race';
 const purchase={...base,id:'covered-purchase-item',months:1};
 assert.equal((await post(purchase)).status,200);
 const original=stored(purchase.id),data=plan(purchase.id);
 const tx=()=>sql.prepare('SELECT * FROM transactions WHERE id=?').get(purchase.id);
 const originalTx=tx(),invoice='covered-purchase-invoice';
 const invoiceData={...data,covers:[{plan:purchase.id,row:data.rows[0].id,amount:data.total}]};
 hook=()=>insertInvoice.run(user,invoice,'MYR','invoice:spaylater:2026-10',JSON.stringify(invoiceData),'active');
 const edit={...purchase,edit:true,revision:0,edit_version:transactionVersion(originalTx),title:'changed'};
 assert.equal((await post(edit)).status,409);
 assert.equal((await post(edit)).status,409);
 assert.equal((await post({id:purchase.id,action:'cancel',revision:0})).status,409);
 assert.equal((await post({id:purchase.id,action:'unpay',row_id:data.rows[0].id,revision:0})).status,409);
 assert.deepEqual(stored(purchase.id),original);
 assert.deepEqual(tx(),originalTx);
});
await test('direct plan edits recheck invoice coverage at write time',async()=>{
 user='covered-plan-race';
 const purchase={...base,id:'covered-plan-item',months:1};
 assert.equal((await post(purchase)).status,200);
 const original=stored(purchase.id),data=plan(purchase.id),[row]=data.rows;
 beforeWrite=()=>insertInvoice.run(user,'covered-plan-invoice','MYR','invoice:spaylater:2026-10',JSON.stringify({...data,covers:[{plan:purchase.id,row:row.id,amount:row.amount}]}),'active');
 assert.equal((await post({action:'plan',id:purchase.id,revision:0,rows:[{...row,due:'2026-10-30'}]})).status,409);
 assert.deepEqual(stored(purchase.id),original);
});
await test('invoice coverage matches the plan and row together',async()=>{
 user='covered-row-id-owner';
 const first={...base,id:'covered-row-first',months:1},second={...first,id:'covered-row-second',payment_method:'other'};
 assert.equal((await post(first)).status,200);
 assert.equal((await post(second)).status,200);
 const [row]=plan(first.id).rows;
 assert.equal((await post({action:'plan',id:second.id,revision:0,rows:[row]})).status,200);
 const invoice={...monthly,id:'covered-row-invoice'};
 assert.equal((await post(invoice)).status,200);
 const list=sql.prepare('SELECT * FROM pocket_commitments WHERE owner=?').all(user);
 const due=finance.paymentDue(list,[],[],[],'2026-10-23','2026-10-31',domain.dates);
 assert.deepEqual(new Set(due.map(d=>d.parent.id)),new Set([invoice.id,second.id]));
});
await test('an invoice cannot capture an instalment changed before the invoice INSERT',async()=>{
 user='invoice-source-race';
 const purchase={...base,id:'invoice-source-item',months:1};
 assert.equal((await post(purchase)).status,200);
 const data=plan(purchase.id);data.rows[0].due='2026-11-01';data.first_due=data.rows[0].due;
 beforeWrite=()=>sql.prepare('UPDATE pocket_commitments SET data=?,revision=revision+1 WHERE owner=? AND id=?').run(JSON.stringify(data),user,purchase.id);
 const invoice={...monthly,id:'invoice-source-race'};
 assert.equal((await post(invoice)).status,409);
 assert.equal(stored(invoice.id),undefined);
});
for(const action of ['purchase','movement']){
 await test(action+' rolls back when the linked transaction ID collides',async()=>{
  user='linked-collision-'+action;
  const id='linked-collision-'+action,movement_id='collision-movement';
  if(action==='movement')assert.equal((await post({action:'deposit',id,amount:'100',currency:'MYR',date:'2026-10-01'})).status,200);
  const before=stored(id),txid=action==='purchase'?id:'deposit:'+id+':'+movement_id;
  sql.prepare("INSERT INTO transactions(id,owner,title,amount,currency,kind,category,date,created_at) VALUES (?,'another-owner','Other',100,'MYR','expense','其他','2026-10-10','now')").run(txid);
  const body=action==='purchase'?{...base,id}:{action,id,movement_id,revision:0,kind:'rent',amount:'10',date:'2026-10-20'};
  assert.equal((await post(body)).status,409);
  assert.deepEqual(stored(id),before);
  assert.equal(sql.prepare('SELECT owner FROM transactions WHERE id=?').get(txid).owner,'another-owner');
 });
}
await test('a linked write that affects zero rows aborts the commitment batch',async()=>{
 user='linked-zero-owner';
 const purchase={...base,id:'linked-zero-purchase'};
 sql.exec("CREATE TEMP TRIGGER skip_linked_insert BEFORE INSERT ON transactions WHEN NEW.id='linked-zero-purchase' BEGIN SELECT RAISE(IGNORE); END");
 try{
  assert.equal((await post(purchase)).status,503);
  assert.equal(stored(purchase.id),undefined);
  assert.equal(sql.prepare('SELECT 1 FROM transactions WHERE id=?').get(purchase.id),undefined);
 }finally{sql.exec('DROP TRIGGER skip_linked_insert');}
});
const samplePlanDue='2026-10-31';
const validPlan={id:'valid-plan',kind:'paylater',title:'Valid',currency:'MYR',source_key:'',source_signature:'',revision:0,status:'active',data:JSON.stringify({provider:'spaylater',total:100,date:samplePlanDue,months:1,first_due:samplePlanDue,rows:finance.planRows('valid-plan',100,1,samplePlanDue)})};
const corruptPlan={...validPlan,id:'corrupt-plan',data:'{"rows":null}'};
await test('Invalid stored PayLater plans are skipped and flagged by allCommitments',()=>{
 const storedTrip={record_type:'expense',group_id:'group',record_id:'bad-jpy',member_id:'member',deleted:0,title:'Invalid TripShare',currency:'JPY',date:'2026-10-01',paylater:JSON.stringify({provider:'spaylater',months:2,first_due:samplePlanDue,total:1})};
 const flagged=[];
 const plans=finance.allCommitments([validPlan,corruptPlan],[storedTrip],id=>flagged.push(id));
 assert.deepEqual(plans.map(p=>p.id),['valid-plan']);
 assert.deepEqual(flagged,['trip:group:bad-jpy:member','corrupt-plan']);
});
await test('paymentDue skips and flags an invalid stored plan while returning valid dues',()=>{
 const flagged=[];
 const items=finance.paymentDue([validPlan,corruptPlan],[],[],[],samplePlanDue,samplePlanDue,domain.dates,id=>flagged.push(id));
 assert.deepEqual(items.map(d=>d.id),['valid-plan:1']);
 assert.deepEqual(flagged,['corrupt-plan']);
});
sql.close();delete globalThis.__commitmentDomain;
