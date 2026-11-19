import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
after(()=>vite.close());
const {spendingSummary,tripConsumption}=await vite.ssrLoadModule('/lib/spending-summary.ts');
const {paymentDue,dueSummary}=await vite.ssrLoadModule('/lib/commitments.ts');
const {dates}=await vite.ssrLoadModule('/lib/ledger-domain.ts');
test('sources and all displayed categories reconcile, including refunds and the remainder',()=>{
 const trip=tripConsumption([{record_type:'expense',group_id:'g',consumed:5170,paid:10340,category:'Food',date:'2026-10-28',currency:'MYR'},{record_type:'payment',amount:90000,consumed:0},{record_type:'expense',deleted:1,consumed:90000}]);
 assert.equal(trip.length,1);assert.equal(trip[0].amount,5170);
 const rows=[...trip,...Array.from({length:8},(_,i)=>({amount:100+i,category:'category'+i,kind:'expense',rule_id:i<3?'r':null})),{kind:'refund',amount:70,category:'category1'},{kind:'income',amount:99999}];
 const x=spendingSummary(rows);
 assert.equal(x.total,5928);assert.equal(Object.values(x.sources).reduce((a,b)=>a+b,0),x.total);
 assert.equal(x.categories.reduce((n,c)=>n+c.value,0),x.total);assert.equal(x.categories.length,5);assert.ok(x.categories.some(c=>c.category==='其他'));
});
test('salary, bonus and irregular receipts never reduce spending or change its category and source totals',()=>{
 const spending=[{kind:'expense',amount:10000,category:'餐饮'},{kind:'refund',amount:500,category:'餐饮'}],before=spendingSummary(spending);
 const income=['工资','奖金','兼职','卖东西','其他'].map(category=>({kind:'income',category,amount:400000}));
 assert.deepEqual(spendingSummary([...spending,...income]),before);assert.equal(before.total,9500);
});
test('pending due amounts remain distinct from zero and never inflate a known total',()=>{
 const occurrences=[{id:'old',rule_id:'r',due:'2026-09-22',status:'recorded',amount:1234,title:'电话',kind:'expense',currency:'MYR'},{id:'pending',rule_id:'r',due:'2026-10-22',status:'pending',amount:0,title:'电话',kind:'expense',currency:'MYR'}];
 const mark={id:'rule:r:2026-09-22',kind:'confirmation',data:JSON.stringify({paid_date:'2026-09-23',amount:1234})};
 const due=paymentDue([mark],[],occurrences,[],'2026-10-30','2026-11-29',dates);
 assert.equal(due.length,1);assert.equal(due[0].amountPending,true);assert.equal(due[0].previousAmount,1234);
 assert.deepEqual(dueSummary(due),{total:0,pending:1,count:1});
});
