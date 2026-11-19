import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const code=ts.transpileModule(readFileSync('lib/ledger-view.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {groupLedgerPage}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('large ledger bounds rendered rows without losing daily consumption and refunds',()=>{
 const rows=Array.from({length:10000},(_,i)=>({id:i,date:'2026-10-07',kind:i===9998?'refund':i===9999?'income':'expense',amount:100}));
 const page=groupLedgerPage(rows,60);assert.equal(page.length,1);assert.equal(page[0].rows.length,60);assert.equal(page[0].count,10000);assert.equal(page[0].spent,999700);assert.equal(page[0].income,100);
 assert.equal(groupLedgerPage(rows,120)[0].rows.length,120);
});
test('paging retains complete summaries on a day split across the page boundary',()=>{
 const rows=[{id:1,date:'2026-10-07',kind:'expense',amount:400},{id:2,date:'2026-10-06',kind:'expense',amount:300},{id:3,date:'2026-10-06',kind:'refund',amount:100},{id:4,date:'2026-10-05',kind:'income',amount:1000}];
 const page=groupLedgerPage(rows,2);assert.deepEqual(page.map(d=>d.day),['2026-10-07','2026-10-06']);assert.equal(page[1].rows.length,1);assert.equal(page[1].count,2);assert.equal(page[1].spent,200);
 assert.deepEqual(groupLedgerPage(rows,4).flatMap(d=>d.rows).map(r=>r.id),[1,2,3,4]);assert.deepEqual(groupLedgerPage([],60),[]);
});
