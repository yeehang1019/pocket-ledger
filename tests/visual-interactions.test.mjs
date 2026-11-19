import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const compiled={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync('lib/visual-interactions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:compiled.exports,module:compiled});
const {shouldDismissSheet,dueVisualGroup}=compiled.exports;
test('sheet dismissal threshold is strictly 110px, cancelled or busy gestures cannot dismiss',()=>{
 for(const value of [0,109,110,-1,NaN,Infinity])assert.equal(shouldDismissSheet(value,false),false);
 assert.equal(shouldDismissSheet(111,false),true);assert.equal(shouldDismissSheet(200,true),false);
});
test('visual due groups partition without duplicating or modifying amounts or payment state',()=>{
 const rows=[{id:'a',amount:60000,due:'2026-10-10'},{id:'b',amount:0,due:'2026-10-22',amountPending:true},{id:'c',amount:60000,due:'2026-11-10'},{id:'d',amount:0,due:'2026-11-22',amountPending:true}];
 const before=JSON.stringify(rows),groups=['overdue','fill','soon'].map(key=>rows.filter(r=>dueVisualGroup(r,'2026-11-04')===key));
 assert.deepEqual(groups.map(g=>g.map(r=>r.id)),[['a'],['b','d'],['c']]);
 assert.equal(groups.flat().length,rows.length);assert.equal(groups.flat().reduce((n,r)=>n+r.amount,0),120000);assert.equal(JSON.stringify(rows),before);
});
