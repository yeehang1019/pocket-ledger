import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
const {dueStats,dueMonth,splitMonthlyDue}=await vite.ssrLoadModule('/lib/due-presentation.ts');
test('monthly payable boundaries handle short/leap months and year rollover',()=>{
 for(const [now,end] of [['2026-11-05','2026-11-30'],['2026-02-28','2026-02-28'],['2028-02-29','2028-02-29'],['2026-12-31','2026-12-31'],['2027-01-01','2027-01-31']]){
  assert.equal(dueMonth(now).end,end);assert.equal(dueMonth(now).start,now.slice(0,7)+'-01');
 }
});
test('monthly totals include this-month overdue and unknown terms but exclude both prior and next month',()=>{
 const rows=[{id:'old',due:'2026-10-31',amount:60000},{id:'overdue',due:'2026-11-01',amount:1000},{id:'unknown',due:'2026-11-22',amount:0,amountPending:true},{id:'last',due:'2026-11-30',amount:2000},{id:'next',due:'2026-12-01',amount:90000}];
 const before=JSON.stringify(rows),{current,previous}=splitMonthlyDue(rows,'2026-11-05');
 assert.deepEqual(current.map(r=>r.id),['overdue','unknown','last']);assert.deepEqual(previous.map(r=>r.id),['old']);
 const s=dueStats(current,'2026-11-05');assert.equal(s.overdue.total+s.upcoming.total,3000);assert.equal(s.pending,1);assert.equal(JSON.stringify(rows),before);
});
test('desktop summary partitions shared payables without counting unknown/review amounts',()=>{
 const rows=[{id:'old',amount:78337,due:'2026-10-22'},{id:'next',amount:78337,due:'2026-11-22'},{id:'unknown',amount:99999,due:'2026-10-22',amountPending:true},{id:'review',amount:40000,due:'2026-11-22',review:true}];
 const before=JSON.stringify(rows),result=dueStats(rows,'2026-11-04');
 assert.equal(result.overdue.total,78337);assert.equal(result.upcoming.total,78337);
 assert.equal(result.overdue.total+result.upcoming.total,156674);assert.equal(result.pending,1);
 assert.equal(JSON.stringify(rows),before);
});
test.after(()=>vite.close());
