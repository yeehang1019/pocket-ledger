import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const source=ts.transpileModule(readFileSync('lib/ledger-reader.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {readLedgerSnapshot,LedgerUnauthorized}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ledger={transactions:[{id:'existing',amount:400}],trip_entries:[{record_id:'daily-existing'}]},pocket={bills:[],commitments:[]};
for(const failure of ['503','network','timeout'])test(`recurring ${failure} still reads saved personal and group bills`,async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push([url,options.method||'GET']);if(options.method==='POST'){if(failure==='network')throw Error('network');if(failure==='timeout')throw new DOMException('timeout','TimeoutError');return Response.json({error:'unavailable'},{status:503});}return Response.json(url==='/api/ledger'?ledger:pocket)};
 const result=await readLedgerSnapshot(true,fetcher);assert.deepEqual(result.ledger,ledger);assert.deepEqual(result.pocket,pocket);assert.match(result.warning,/尚未补齐/);assert.deepEqual(calls,[['/api/ledger','POST'],['/api/ledger','GET'],['/api/pocket','GET']]);
});
test('unauthorized synchronization stops without reading any personal records',async()=>{
 let calls=0;await assert.rejects(()=>readLedgerSnapshot(true,async()=>{calls++;return Response.json({}, {status:401})}),LedgerUnauthorized);assert.equal(calls,1);
});
test('failed saved-record read stays an error rather than claiming an empty ledger',async()=>{
 await assert.rejects(()=>readLedgerSnapshot(false,async()=>Response.json({error:'暂时无法读取账本'},{status:503})),/暂时无法读取账本/);
});
test('successful sync removes warning, normal refresh does not post',async()=>{
 let writes=0;const fetcher=async(url,options)=>{if(options.method==='POST'){writes++;return Response.json({ok:true})}return Response.json(url==='/api/ledger'?ledger:pocket)};
 assert.equal((await readLedgerSnapshot(true,fetcher)).warning,'');assert.equal((await readLedgerSnapshot(false,fetcher)).warning,'');assert.equal(writes,1);
});

test('missing or failed payment-state data never becomes an all-unpaid snapshot',async()=>{
 for(const extra of [Response.json({bills:[]}),Response.json({}, {status:503})]){
 await assert.rejects(()=>readLedgerSnapshot(false,async url=>url==='/api/ledger'?Response.json(ledger):extra),/付款状态/);
 }
});
