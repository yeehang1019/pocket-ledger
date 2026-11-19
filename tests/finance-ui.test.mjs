import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {after} from 'node:test';
import {pathToFileURL} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
const vite=await createServer({configFile:false,plugins:[react()],resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
after(()=>vite.close());
const {default:Ledger,LedgerRow}=await vite.ssrLoadModule('/app/ledger.tsx');
const {default:FinanceHub}=await vite.ssrLoadModule('/app/finance-hub.tsx');
const {default:SpendingSources}=await vite.ssrLoadModule('/app/spending-sources.tsx');
const {default:QuickEntry}=await vite.ssrLoadModule('/app/quick-entry.tsx');
const {default:TripPayables}=await vite.ssrLoadModule('/app/trip-payables.tsx');
const {payableSyncView}=await vite.ssrLoadModule('/lib/trip-payable-status.ts');
const {today}=await vite.ssrLoadModule('/lib/ledger-domain.ts');
const {default:IncomeDue}=await vite.ssrLoadModule('/app/income-due.tsx');
test('income entry exposes top-level type switch and only income categories without expense templates',()=>{
 const html=renderToStaticMarkup(React.createElement(QuickEntry,{templates:[{id:'food',title:'餐饮模板',category:'餐饮',amount:100,currency:'MYR'}],form:{kind:'income',category:'工资',currency:'MYR',amount:'',date:today(),payment_method:'ordinary'},setForm:()=>{},categories:['餐饮','工资','其他'],busy:false,error:'',conflict:false,onReload:()=>{},onOverwrite:()=>{},onSave:async()=>{}}));
 assert.ok(html.includes('aria-label="记账类型"'));for(const c of ['工资','奖金','兼职','卖东西','其他'])assert.ok(html.includes('<span>'+c+'</span>'));
 assert.ok(!html.includes('餐饮模板'));assert.ok(!html.includes('付款方式'));
});
test('income receivables show only unconfirmed income in selected currency, never paid history or expenses',()=>{
 const base={id:'salary',kind:'income',status:'awaiting',currency:'MYR',title:'待收工资',due:today(),amount:400000};
 const html=renderToStaticMarkup(React.createElement(IncomeDue,{occurrences:[base,{...base,id:'old',title:'旧工资',status:'recorded'},{...base,id:'expense',title:'房租',kind:'expense'},{...base,id:'usd',title:'美元工资',currency:'USD'}],currency:'MYR',save:async()=>false}));
 assert.ok(html.includes('收入待收 · 1 笔'));assert.ok(html.includes('RM 4,000.00'));assert.ok(html.includes('确认到账：待收工资'));
 assert.ok(!html.includes('旧工资'));assert.ok(!html.includes('房租'));assert.ok(!html.includes('美元工资'));
 assert.equal(renderToStaticMarkup(React.createElement(IncomeDue,{occurrences:[base],currency:'MYR',save:async()=>false,readError:true})),'');
});
test('overview renders every current-month payable including known amounts after the fifth row',()=>{
 const month=today().slice(0,7);
 const occurrences=Array.from({length:10},(_,i)=>({id:'all-'+i,rule_id:'all-rule-'+i,due:month+'-'+String(i+1).padStart(2,'0'),status:[4,7].includes(i)?'pending':'recorded',title:'完整应付'+i,amount:[4,7].includes(i)?0:1000,currency:'MYR',kind:'expense'}));
 for(const compact of [true,false]){
  const html=renderToStaticMarkup(React.createElement(FinanceHub,{compact,data:{commitments:[],bills:[]},trip:[],rules:[],occurrences,currency:'MYR',save:async()=>false,savePocket:async()=>false}));
  assert.equal((html.match(/class="due-row /g)||[]).length,10);
  assert.ok(html.includes('10 笔待付（其中 2 笔金额待填）'));assert.ok(html.includes('RM 80.00'));
  for(let i=0;i<10;i++){assert.ok(html.includes('完整应付'+i));if(i)assert.ok(html.indexOf('完整应付'+(i-1))<html.indexOf('完整应付'+i));}
 }
});
test('monthly due rows stay globally chronological even when later amounts are unknown',()=>{
 const month=today().slice(0,7),occurrences=[{id:'later',rule_id:'late-rule',due:month+'-28',status:'pending',title:'月末待填',amount:0,currency:'MYR',kind:'expense'},{id:'early',rule_id:'early-rule',due:month+'-01',status:'recorded',title:'月初应付',amount:1000,currency:'MYR',kind:'expense'}];
 for(const compact of [false,true]){
  const html=renderToStaticMarkup(React.createElement(FinanceHub,{compact,data:{commitments:[],bills:[]},trip:[],rules:[],occurrences,currency:'MYR',save:async()=>false,savePocket:async()=>false}));
  assert.ok(html.indexOf('月初应付')<html.indexOf('月末待填'));
 }
});
test('Trip summary starts in unknown/loading state rather than showing zero debt',()=>{
 const html=renderToStaticMarkup(React.createElement(TripPayables));
 assert.ok(html.includes('正在读取待付款'));assert.ok(!html.includes('暂无待付款'));assert.ok(!html.includes('RM 0.00'));
});
const syncedPayables={activated:1,status:'synced',last_completed:'2026-11-18T01:00:00Z'};
test('a never-synced, paused, or unavailable balance does not imply no debt',()=>{
 for(const [state,flags] of [
  [{activated:0,status:'review_required'},{}],
  [{activated:0,status:'paused'},{}],
  [undefined,{readFailed:true}],
  [{...syncedPayables,last_completed:'invalid'},{}],
 ]){const v=payableSyncView(state,flags);assert.equal(v.mode,'unknown');assert.equal(v.emptyLabel,null);assert.equal(v.lastSuccess,null);}
});
test('only a successful enabled sync can report a current empty balance',()=>{
 const v=payableSyncView(syncedPayables);assert.equal(v.mode,'fresh');assert.equal(v.emptyLabel,'暂无待付款');assert.equal(v.lastSuccess,syncedPayables.last_completed);
});
test('paused, failed, or refreshing payable sync labels retained data as a snapshot',()=>{
 for(const [state,flags] of [
  [{...syncedPayables,status:'paused',activated:0},{}],
  [{...syncedPayables,status:'error'},{}],
  [syncedPayables,{readFailed:true}],
  [syncedPayables,{syncFailed:true}],
  [syncedPayables,{syncing:true}],
 ]){const v=payableSyncView(state,flags);assert.equal(v.mode,'snapshot');assert.equal(v.emptyLabel,'上次同步暂无待付款');assert.equal(v.lastSuccess,syncedPayables.last_completed);}
});
test('ignored recurring terms disappear from both due views, retain restore entry and do not look paid',()=>{
 const occurrence={id:'term-ignored',rule_id:'rule-ignored',title:'旧电话费',currency:'MYR',kind:'expense',due:'2000-01-02',status:'pending',amount:0};
 const mark={id:'rule:rule-ignored:2000-01-02',kind:'confirmation',title:'旧电话费',currency:'MYR',source_key:'rule-ignored',source_signature:'',status:'ignored',revision:0,data:JSON.stringify({rule_id:'rule-ignored',due:occurrence.due,paid_date:'',amount:0})};
 for(const compact of [true,false]){
  const html=renderToStaticMarkup(React.createElement(FinanceHub,{compact,data:{commitments:[mark],bills:[]},trip:[],rules:[],occurrences:[occurrence],currency:'MYR',save:async()=>false,savePocket:async()=>false}));
  assert.ok(!html.includes('aria-label="填金额：旧电话费"'));assert.ok(html.includes('已忽略'));
  if(!compact){assert.ok(html.includes('恢复本期'));assert.ok(!html.includes('已付 2000'));}
 }
});
test('v19 source rows preserve exact signed amounts while the proportion strip never draws negative widths',()=>{
 for(const sources of [{manual:123566,fixed:78337,tripshare:156832},{manual:-100,fixed:200,tripshare:300}]){
  const html=renderToStaticMarkup(React.createElement(SpendingSources,{sources,currency:'MYR',onSelect:()=>{}}));
  assert.equal((html.match(/<button/g)||[]).length,3);
  assert.equal((html.match(/source-segment/g)||[]).length,3);
  assert.ok(!html.includes('flex-grow:-'));
  for(const value of Object.values(sources)){assert.ok(html.includes(new Intl.NumberFormat('en-MY',{minimumFractionDigits:2}).format(Math.abs(value)/100)));if(value<0)assert.ok(html.includes('−RM '));}
 }
});
test('v19 entry categories remain named buttons with decorative vector icons',()=>{
 const html=renderToStaticMarkup(React.createElement(QuickEntry,{templates:[],form:{kind:'expense',category:'餐饮',currency:'MYR',amount:'',date:'2026-10-20',payment_method:'ordinary'},setForm:()=>{},categories:['餐饮','其他'],busy:false,error:'',conflict:false,onReload:()=>{},onOverwrite:()=>{},onSave:async()=>{}}));
 for(const category of ['餐饮','其他'])assert.ok(html.includes(`<span>${category}</span>`));
 assert.ok(html.includes('<svg'));assert.ok(html.includes('aria-hidden="true"'));
});
test('main navigation has four destinations even before authenticated data loads',()=>{
 const html=renderToStaticMarkup(React.createElement(Ledger));assert.equal((html.match(/role="tab"/g)||[]).length,4);
 for(const label of ['总览','账本','账单','设置'])assert.ok(html.includes(label));
});
test('unknown payment state renders an error, not an unpaid total',()=>{
 const html=renderToStaticMarkup(React.createElement(FinanceHub,{readError:'付款状态读取失败',data:{commitments:[],bills:[]},trip:[],rules:[],occurrences:[],currency:'MYR',save:async()=>true,savePocket:async()=>true}));
 assert.ok(html.includes('付款状态未知'));assert.ok(!html.includes('RM 0.00'));assert.ok(!html.includes('确认付款'));
});
test('overview and full payment views use the same pending count and known total',()=>{
 const day=today().slice(0,7)+'-01';
 const occurrences=Array.from({length:5},(_,i)=>({id:'p'+i,rule_id:'r'+i,due:day,status:'pending',title:'待填'+i,amount:0,currency:'MYR',kind:'expense'}));
 occurrences.push({id:'known',rule_id:'known-rule',due:day,status:'recorded',title:'固定',amount:156574,currency:'MYR',kind:'expense'});
 const props={data:{commitments:[],bills:[]},trip:[],rules:[],occurrences,currency:'MYR',save:async()=>true,savePocket:async()=>true};
 for(const compact of [true,false]){const html=renderToStaticMarkup(React.createElement(FinanceHub,{...props,compact}));assert.ok(html.includes('RM 1,565.74'));assert.ok(html.includes(`6 笔待付（其中 5 笔金额待填） · ${day<today()?6:0} 笔逾期`));assert.ok(!html.includes('另有'));for(let i=0;i<5;i++)assert.ok(html.includes('待填'+i));}
});
test('ledger rows distinguish refunds from income and keep imported entries read-only',()=>{
 const props={categories:['餐饮'],groupName:()=> 'Daily',open:()=>{},setRemove:()=>{},applyTemplate:()=>{},savePocket:async()=>true,setTab:()=>{},busy:false};
 const base={id:'row',title:'午餐',amount:1200,currency:'MYR',category:'餐饮',date:'2026-10-20',note:'原备注',kind:'refund'};
 const refund=renderToStaticMarkup(React.createElement(LedgerRow,{...props,t:base}));
 assert.ok(refund.includes('退款'));assert.ok(refund.includes('抵减支出'));assert.ok(refund.includes('原备注'));assert.ok(refund.includes('2026-10-20'));
 const shared=renderToStaticMarkup(React.createElement(LedgerRow,{...props,t:{...base,kind:'expense',source:'group',paid:2000}}));
 assert.ok(shared.includes('付款与消费差额'));assert.ok(shared.includes('8.00'));assert.ok(shared.includes('不代表当前欠款'));
 assert.ok(!shared.includes('>编辑</button>'));assert.ok(!shared.includes('>删除</button>'));
});
test('full payment cards expose an exact due date and uniquely named confirmation',()=>{
 const day='2000-01-02';
 const plan={id:'overdue-plan',kind:'paylater',title:'测试账单',currency:'MYR',source_key:'manual:overdue-plan',source_signature:'',revision:0,status:'active',data:JSON.stringify({provider:'spaylater',total:100,date:day,months:1,first_due:day,rows:[{id:'first',due:day,amount:100,paid_date:''}]})};
 const html=renderToStaticMarkup(React.createElement(FinanceHub,{data:{commitments:[plan],bills:[]},trip:[],rules:[],occurrences:[],currency:'MYR',save:async()=>true,savePocket:async()=>true}));
 assert.match(html,/datetime="2000-01-02"/i);
 assert.ok(html.includes('aria-label="确认付款：测试账单"'));
 assert.ok(html.includes('逾期'));
 assert.ok(html.includes('due-date-tile'));
});
test('current-month summary renders platform obligation rather than a second personal expense',()=>{
 const day=today(),row={id:'source-plan',kind:'paylater',title:'替朋友购买',currency:'MYR',source_key:'manual:source-plan',source_signature:'',revision:0,status:'active',data:JSON.stringify({provider:'spaylater',total:30900,date:day,months:3,first_due:day,rows:[{id:'one',due:day,amount:10300,paid_date:''}]})};
 const html=renderToStaticMarkup(React.createElement(FinanceHub,{compact:true,data:{commitments:[row],bills:[]},trip:[],rules:[],occurrences:[],currency:'MYR',save:async()=>true,savePocket:async()=>true}));
 assert.match(html,/\d+ 月待付/);assert.ok(html.includes('替朋友购买'));assert.ok(html.includes('103.00'));assert.ok(html.includes('确认付款'));assert.ok(!html.includes('309.00'));
});
test('old unpaid records are folded separately and never enter the main current-month total in either view',()=>{
 const occurrences=[{id:'old',rule_id:'old-rule',due:'2000-01-02',status:'recorded',title:'往期房租',amount:60000,currency:'MYR',kind:'expense'},{id:'current',rule_id:'current-rule',due:today(),status:'recorded',title:'本期房租',amount:50000,currency:'MYR',kind:'expense'}];
 const props={data:{commitments:[],bills:[]},trip:[],rules:[],occurrences,currency:'MYR',save:async()=>false,savePocket:async()=>false};
 for(const compact of [true,false]){
  const html=renderToStaticMarkup(React.createElement(FinanceHub,{...props,compact}));
  const [main,older]=html.split('<details class="secondary-area prior-due">');
  assert.ok(main.includes('RM 500.00'));assert.ok(main.includes('本期房租'));assert.ok(!main.includes('往期房租'));assert.ok(!main.includes('RM 600.00'));
  assert.ok(older.includes('往期未处理'));assert.ok(older.includes('往期房租'));assert.ok(older.includes('RM 600.00'));assert.ok(older.includes('不计入本月合计'));
 }
});
