import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
let beforeWrite;
const wrap=(q,p=[])=>({bind:(...args)=>wrap(q,args),first:async()=>sql.prepare(q).get(...p)||null,all:async()=>({results:sql.prepare(q).all(...p)}),run:async()=>{if(beforeWrite){const hook=beforeWrite;beforeWrite=null;hook();}const r=sql.prepare(q).run(...p);return {meta:{changes:r.changes}}}});
const DB={prepare:q=>wrap(q)};
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const domain=await import('data:text/javascript;base64,'+Buffer.from(transpile(readFileSync('lib/ledger-domain.ts','utf8'))).toString('base64'));
const pocket=await import('data:text/javascript;base64,'+Buffer.from(transpile(readFileSync('lib/pocket-domain.ts','utf8'))).toString('base64'));
const source=readFileSync('app/api/pocket/route.ts','utf8').replace(/^import .*;\n/gm,'');
let user='owner-a';const api=new Function('env','getChatGPTUser','CURRENCIES','CATEGORIES','minor','today','validDate',transpile(source).replace(/export /g,'')+';return {GET,POST}')( {DB},async()=>user?{userId:user}:null,domain.CURRENCIES,domain.CATEGORIES,domain.minor,()=> '2026-10-07',domain.validDate);
const post=b=>api.POST(new Request('https://ledger.test/api/pocket',{method:'POST',headers:{origin:'https://ledger.test'},body:JSON.stringify(b)}));
const get=async()=>await (await api.GET()).json();
const bill={action:'bill',id:'bill-wallet-001',title:'电话充值',category:'账单',currency:'MYR',amount:'100',mode:'wallet',consumption_date:'2026-10-07',paid_date:'2026-10-07'};
await test('owner isolation, validation and idempotent prepaid usage',async()=>{
 user=null;assert.equal((await post(bill)).status,401);user='owner-a';
 assert.equal((await api.POST(new Request('https://ledger.test/api/pocket',{method:'POST',headers:{origin:'https://evil.test'},body:JSON.stringify(bill)}))).status,403);
 assert.equal((await post(bill)).status,200);assert.equal((await post(bill)).status,200);assert.equal((await get()).bills.length,1);
 assert.equal(pocket.recognised((await get()).bills[0],'2026-10-07'),false);
 const use={...bill,id:'wallet-use-001',mode:'use',parent_id:bill.id,paid_date:'',amount:'40'};
 assert.equal((await post(use)).status,200);assert.equal((await post(use)).status,200);
 let data=await get();assert.equal(pocket.prepaidBalance(data.bills.find(b=>b.id===bill.id),data.bills),6000);
 assert.equal(data.bills.filter(b=>pocket.recognised(b,'2026-10-07')).reduce((s,b)=>s+b.amount,0),4000);
 assert.equal((await post({...use,id:'wallet-use-002',amount:'61'})).status,409);
 assert.equal((await post({action:'remove',entity:'bills',id:bill.id})).status,409);
 user='owner-b';assert.equal((await get()).bills.length,0);assert.equal((await post({...use,id:'wallet-use-003'})).status,400);assert.equal((await post({action:'remove',entity:'bills',id:bill.id})).status,404);user='owner-a';
 assert.equal((await post({action:'remove',entity:'bills',id:use.id})).status,200);data=await get();assert.equal(pocket.prepaidBalance(data.bills.find(b=>b.id===bill.id),data.bills),10000);
 assert.equal((await post({action:'remove',entity:'bills',id:bill.id})).status,200);
});
await test('planned bills, prepaid services and credit settlement preserve consumption',async()=>{
 const card={action:'account',id:'credit-card-001',title:'My card',currency:'MYR',statement_day:25,due_day:15};assert.equal((await post(card)).status,200);
 const due={...bill,id:'postpaid-bill-001',mode:'postpaid',title:'Data plan',account_id:card.id,paid_date:'',amount:'50',due_date:'2026-10-15'};
 assert.equal((await post(due)).status,200);assert.equal((await post({...due,id:'future-invalid-001',consumption_date:'2026-11-01'})).status,400);
 const sum=async()=> (await get()).bills.filter(b=>pocket.recognised(b,'2026-10-07')).reduce((s,b)=>s+b.amount,0);
 const before=await sum();assert.equal((await post({action:'settle',id:due.id,date:'2026-10-07'})).status,200);assert.equal(await sum(),before);assert.equal((await get()).bills.find(b=>b.id===due.id).paid_date,'2026-10-07');
 assert.equal((await post({action:'remove',entity:'accounts',id:card.id})).status,409);
 const plan={...bill,id:'planned-bill-001',mode:'planned',paid_date:'',consumption_date:'2026-11-01'};assert.equal((await post(plan)).status,200);assert.equal(await sum(),before);
 assert.equal((await post({action:'activate',id:plan.id,date:'2026-11-01'})).status,400);assert.equal((await post({action:'activate',id:plan.id,date:'2026-10-07'})).status,200);assert.equal(await sum(),before+10000);
 const service={...bill,id:'prepaid-service-001',mode:'prepaid',consumption_date:'2026-11-01'};assert.equal((await post(service)).status,200);assert.equal(await sum(),before+10000);assert.equal(pocket.recognised((await get()).bills.find(b=>b.id===service.id),'2026-11-01'),true);
});
await test('categories, templates, goals and range budgets stay owner scoped',async()=>{
 assert.equal((await post({action:'category',name:'咖啡'})).status,200);
 assert.equal((await post({action:'template',id:'template-coffee-001',title:'Coffee',currency:'MYR',category:'咖啡',amount:'8.50'})).status,200);
 assert.equal((await post({action:'goal',id:'goal-travel-001',title:'旅行',currency:'MYR',target:'1000',saved:'200'})).status,200);
 assert.equal((await post({action:'range_budget',id:'budget-trip-001',title:'JB weekend',currency:'MYR',category:'all',amount:'200',start:'2026-10-07',end:'2026-10-09'})).status,200);
 assert.equal((await post({action:'range_budget',id:'budget-trip-002',title:'Wrong date',currency:'MYR',category:'all',amount:'200',start:'2026-10-10',end:'2026-10-09'})).status,400);
 user='owner-b';const data=await get();assert.equal(data.templates.length,0);assert.equal(data.goals.length,0);assert.equal(data.categories.length,0);assert.equal(data.range_budgets.length,0);
 user='owner-a';assert.equal((await get()).goals[0].saved,20000);
});
await test('bill IDs replay only identical active content, including prepaid usage',async()=>{
 user='bill-replay-owner';
 assert.equal((await post(bill)).status,200);
 assert.equal((await post({...bill,amount:'100.00'})).status,200);
 assert.equal((await post({...bill,title:'另一次充值'})).status,409);
 const use={...bill,id:'bill-replay-use',mode:'use',parent_id:bill.id,paid_date:''};
 assert.equal((await post(use)).status,200);
 assert.equal((await post(use)).status,200); // The balance is now zero.
 assert.equal((await post({...use,amount:'20'})).status,409);
 assert.equal((await post({action:'remove',entity:'bills',id:use.id})).status,200);
 assert.equal((await post(use)).status,409);
});
for(const action of ['settle','unsettle','activate']){
 await test('bill '+action+' rejects a lost transition and a repeat',async()=>{
  user='bill-transition-owner';
  const body={...bill,id:'bill-transition-'+action,mode:action==='activate'?'planned':'postpaid',paid_date:action==='unsettle'?bill.paid_date:''};
  assert.equal((await post(body)).status,200);
  const request={action,id:body.id,date:bill.paid_date};
  beforeWrite=()=>sql.prepare("UPDATE pocket_bills SET status='cancelled' WHERE owner=? AND id=?").run(user,body.id);
  assert.equal((await post(request)).status,409);
  assert.equal(sql.prepare('SELECT paid_date FROM pocket_bills WHERE owner=? AND id=?').get(user,body.id).paid_date,body.paid_date);
  sql.prepare("UPDATE pocket_bills SET status='active' WHERE owner=? AND id=?").run(user,body.id);
  assert.equal((await post(request)).status,200);
  assert.equal((await post(request)).status,409);
 });
}
await test('a card deleted before INSERT cannot leave an orphaned bill',async()=>{
 user='bill-card-race-owner';
 const card={action:'account',id:'bill-race-card',title:'Card',currency:'MYR',statement_day:25,due_day:15};
 const linked={...bill,id:'bill-card-race',mode:'postpaid',paid_date:'',account_id:card.id};
 assert.equal((await post(card)).status,200);
 beforeWrite=()=>sql.prepare('DELETE FROM pocket_accounts WHERE owner=? AND id=?').run(user,card.id);
 assert.equal((await post(linked)).status,400);
 assert.equal((await get()).bills.length,0);
 assert.equal((await post({...card,currency:'SGD'})).status,200);
 assert.equal((await post(linked)).status,400);
 assert.equal((await get()).bills.length,0);
});
await test('Pocket caps history with a warning and returns unresolved bills and payment state',async()=>{
 user='pocket-cap-owner';
 sql.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<2001)
  INSERT INTO pocket_bills(owner,id,title,mode,category,amount,currency,consumption_date,paid_date,created_at)
  SELECT ?, 'paid-'||n,'Paid','postpaid','账单',100,'MYR','2026-10-01','2026-10-02','2026-10-02' FROM seq`).run(user);
 sql.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<2001)
  INSERT INTO pocket_bills(owner,id,title,mode,category,amount,currency,consumption_date,created_at)
  SELECT ?, 'open-'||n,'Open','postpaid','账单',100,'MYR','2000-01-01','2000-01-01' FROM seq`).run(user);
 sql.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<2001)
  INSERT INTO pocket_categories(owner,name) SELECT ?, 'category-'||n FROM seq`).run(user);
 const insert=sql.prepare("INSERT INTO pocket_commitments(owner,id,kind,title,currency,data) VALUES (?,?,?,'Plan','MYR',?)");
 insert.run(user,'old-mark','confirmation',JSON.stringify({paid_date:'2000-01-02',amount:100}));
 insert.run(user,'open-plan','paylater',JSON.stringify({date:'2000-01-01',rows:[{paid_date:''}]}));
 const response=await api.GET(),data=await response.json();
 assert.equal(response.status,200);assert.equal(data.truncated,true);
 assert.equal(data.categories.length,2000);
 assert.equal(data.bills.filter(b=>!b.paid_date).length,2001);
 assert.equal(data.bills.filter(b=>b.paid_date).length,2000);
 assert.deepEqual(data.commitments.map(c=>c.id),['open-plan','old-mark']);
});
sql.close();
