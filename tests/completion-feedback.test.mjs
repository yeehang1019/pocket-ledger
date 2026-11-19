import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const js=ts.transpileModule(readFileSync('lib/completion-feedback.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {completionRows,motionAllowed}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('completion preview retains only an acknowledged removed row without changing current totals',()=>{
 const paid={id:'paid',due:'2026-10-01',amount:100};
 const current=[{id:'next',due:'2026-10-02',amount:200}];
 const view=completionRows(current,paid);
 assert.deepEqual(view.map(x=>x.id),['paid','next']);assert.equal(current.length,1);assert.equal(current.reduce((n,x)=>n+x.amount,0),200);
 assert.equal(completionRows(current,null),current);
 assert.equal(completionRows(current,current[0]),current);
});
test('completion animation is disabled outside a browser',()=>assert.equal(motionAllowed(),false));
