import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
after(()=>vite.close());
const {paymentDue,dueSummary,dueDescription}=await vite.ssrLoadModule('/lib/commitments.ts');
const {dates}=await vite.ssrLoadModule('/lib/ledger-domain.ts');
const {appearanceScript}=await vite.ssrLoadModule('/lib/appearance.ts');
const {lastExpenseCategory,entryDateMax}=await vite.ssrLoadModule('/lib/entry-defaults.ts');
test('date picker accepts an existing prepaid recurring due date without allowing new future expenses',()=>{
 assert.equal(entryDateMax({date:'2026-11-20',rule_id:'rent'},'2026-11-11'),'2026-11-20');
 assert.equal(entryDateMax({date:'2026-11-20'},'2026-11-11'),'2026-11-11');
 assert.equal(entryDateMax({date:'2026-11-01',rule_id:'rent'},'2026-11-11'),'2026-11-11');
});
test('A1 all five next-month variable terms use the same schedule without adding consumption or known amounts',()=>{
 const rules=Array.from({length:5},(_,i)=>({id:'v'+i,title:'variable'+i,status:'active',kind:'expense',mode:'variable',start:'2026-10-22',frequency:'monthly',amount:0,currency:'MYR'}));
 const pending=rules.map(r=>({...r,rule_id:r.id,due:'2026-10-22',status:'pending'}));
 const fixed={id:'f',title:'rent',status:'active',kind:'expense',mode:'fixed',start:'2026-10-10',frequency:'monthly',amount:60000,currency:'MYR'};
 const before=JSON.stringify([rules,pending]);
 const due=paymentDue([],[],pending,[...rules,fixed],'2026-11-02','2026-12-02',dates);
 assert.equal(due.filter(d=>d.amountPending&&d.expected&&d.due==='2026-11-22').length,5);
 assert.deepEqual(dueSummary(due),{total:60000,pending:10,count:11});
 assert.equal(dueDescription(due,'2026-11-02'),'11 笔待付（其中 10 笔金额待填） · 5 笔逾期');
 assert.equal(JSON.stringify([rules,pending]),before);
 const withGenerated=paymentDue([],[],[...pending,{...pending[0],due:'2026-11-22'}],rules,'2026-11-02','2026-12-02',dates);
 assert.equal(withGenerated.filter(d=>d.id==='rule:v0:2026-11-22').length,1);
});
test('A1 future variable terms respect weekly, fortnightly, twice-monthly and inactive rules',()=>{
 for(const frequency of ['weekly','fortnightly','semimonthly']){
  const rule={id:'v',title:'variable',status:'active',kind:'expense',mode:'variable',start:'2026-10-22',frequency,month_days:'5,20',currency:'MYR'};
  const due=paymentDue([],[],[],[rule,{...rule,id:'paused',status:'paused'}],'2026-11-02','2026-12-02',dates);
  assert.deepEqual(due.map(x=>x.due),dates(rule.start,frequency,'2026-12-02',rule.month_days).filter(x=>x>'2026-11-02'));
  assert.ok(due.every(x=>x.amount===0&&x.amountPending));
 }
});
test('C1 head bootstrap resolves system-dark before React and respects saved preferences without writing them',()=>{
 for(const [saved,dark,theme,mode] of [[{},true,'cream','dark'],[{},false,'cream','light'],[{'ledger-theme':'cream'},true,'cream','dark'],[{'ledger-theme':'racing','ledger-color-mode':'light'},false,'game','dark'],[{'ledger-world-choice':'glass'},true,'cream','dark'],[{'ledger-world-choice':'neon'},false,'game','dark']]){
  const root={dataset:{},style:{}};vm.runInNewContext(appearanceScript,{document:{documentElement:root},localStorage:{getItem:k=>saved[k]||null},matchMedia:()=>({matches:dark})});
  assert.equal(root.dataset.theme,theme);assert.equal(root.dataset.mode,mode);assert.equal(root.style.colorScheme,mode);
 }
 const root={dataset:{},style:{}};vm.runInNewContext(appearanceScript,{document:{documentElement:root},localStorage:{getItem:()=>{throw Error('blocked')}},matchMedia:()=>({matches:true})});assert.equal(root.dataset.mode,'dark');
 const layout=readFileSync('app/layout.tsx','utf8');assert.ok(layout.indexOf('__html:appearanceScript')<layout.indexOf('<body>'));
});
test('D1 latest valid manual expense category comes from server records, not a recurring or income entry',()=>{
 const rows=[{id:'a',date:'2026-10-29',created_at:'b',kind:'expense',category:'餐饮'},{id:'b',date:'2026-10-30',kind:'expense',category:'工资'},{id:'c',date:'2026-11-01',kind:'expense',category:'交通',rule_id:'r'},{id:'d',date:'2026-11-02',kind:'income',category:'工资'}];
 assert.equal(lastExpenseCategory(rows,['餐饮','交通','其他']),'餐饮');assert.equal(lastExpenseCategory([],['其他']),'其他');
});
