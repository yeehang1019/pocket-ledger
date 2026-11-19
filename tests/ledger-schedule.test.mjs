import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const code=ts.transpileModule(readFileSync('lib/ledger-domain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {dates}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('weekly and fortnightly keep a fixed weekday and cross month boundaries',()=>{
 assert.deepEqual(dates('2026-01-23','weekly','2026-02-07'),['2026-01-23','2026-01-30','2026-02-06']);
 assert.deepEqual(dates('2026-01-02','fortnightly','2026-02-01'),['2026-01-02','2026-01-16','2026-01-30']);
});
test('twice monthly uses two fixed calendar days and excludes dates before the start',()=>{
 assert.deepEqual(dates('2026-01-10','semimonthly','2026-03-05','20,5'),['2026-01-20','2026-02-05','2026-02-20','2026-03-05']);
 assert.deepEqual(dates('2026-02-21','semimonthly','2026-02-25','5,20'),[]);
});
test('short and leap months clamp to month end without duplicate charges',()=>{
 assert.deepEqual(dates('2024-02-01','semimonthly','2024-03-31','30,31'),['2024-02-29','2024-03-30','2024-03-31']);
 assert.deepEqual(dates('2026-01-31','monthly','2026-03-31'),['2026-01-31','2026-02-28','2026-03-31']);
 assert.deepEqual(dates('2024-02-29','yearly','2026-03-01'),['2024-02-29','2025-02-28','2026-02-28']);
});
