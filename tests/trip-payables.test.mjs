import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync}from'node:sqlite';import{readFileSync,readdirSync}from'node:fs';
import {applyPayables,projectPayables}from'../lib/trip-payables.ts';
import * as payables from '../lib/trip-payables.ts';
import ts from 'typescript';
function fixture(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));const db={prepare(q){let args=[];return{bind(...v){args=v;return this},async first(){return sql.prepare(q).get(...args)},async all(){return{results:sql.prepare(q).all(...args)}},async run(){return{meta:sql.prepare(q).run(...args)}}}},async batch(ss){sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};sql.exec("INSERT INTO trip_sync_settings(owner,lease)VALUES('me','test')");return{sql,db}}
function snapshot(remaining=10000,paid=0){return {schema_version:2,version:'v1',spaces:[{id:'qa',name:'QA Test',member_id:'self',identity:'confirmed',currency:'MYR',pay:remaining,receive:0}],rows:[{space_id:'qa',space_name:'QA Test',member_id:'self',bill_id:'bill',direction:'payable',recipient_id:'friend',recipient_name:'Friend',title:'QA bill',date:'2026-11-04',category:'Food',currency:'MYR',remaining,paid,cancelled_out:0,share:remaining+paid,source_revision:1,status:remaining?paid?'Partly paid':'Unpaid':'Paid'}]}}
test('Mirror replay is idempotent, follows partial/full/Undo/delete/restore, and never modifies consumption',async()=>{const {sql,db}=fixture();sql.exec("INSERT INTO transactions(id,owner,title,amount,currency,kind,category,date,note,created_at)VALUES('original','me','Consumption',10000,'MYR','expense','Food','2026-11-04','','now')");const original=JSON.stringify(sql.prepare('SELECT * FROM transactions').all());async function sync(s){sql.exec("UPDATE trip_sync_settings SET lease='test'");await applyPayables(db,'me',s,['qa'],false,'test')};for(let i=0;i<3;i++)await sync(snapshot());assert.equal(sql.prepare('SELECT COUNT(*) n FROM trip_payables').get().n,1);await sync(snapshot(8000,2000));assert.equal(sql.prepare('SELECT status FROM trip_payables').get().status,'Partly paid');await sync(snapshot(0,10000));assert.equal(sql.prepare('SELECT status FROM trip_payables').get().status,'Paid');await sync(snapshot());assert.equal(sql.prepare('SELECT status FROM trip_payables').get().status,'Unpaid');const removed=snapshot(0,0);removed.rows=[];await sync(removed);assert.equal(sql.prepare('SELECT deleted FROM trip_payables').get().deleted,1);await sync(snapshot());assert.equal(sql.prepare('SELECT deleted FROM trip_payables').get().deleted,0);assert.equal(JSON.stringify(sql.prepare('SELECT * FROM transactions').all()),original);sql.close()});
test('First import excludes paid history; identities, duplicate legs and reconciliation errors fail closed',async()=>{const {sql,db}=fixture();await applyPayables(db,'me',snapshot(0,10000),['qa'],false,'test');assert.equal(sql.prepare('SELECT COUNT(*) n FROM trip_payables').get().n,0);const bad=snapshot();bad.spaces[0].pay++;assert.throws(()=>projectPayables(bad,['qa']),/match/);bad.spaces[0].identity='unconfirmed';assert.throws(()=>projectPayables(bad,['qa']),/Incomplete/);const duplicate=snapshot();duplicate.rows.push({...duplicate.rows[0]});assert.throws(()=>projectPayables(duplicate,['qa']),/Duplicate/);const wrong=snapshot();wrong.rows[0].member_id='other';assert.throws(()=>projectPayables(wrong,['qa']),/identity/);assert.equal(sql.prepare('SELECT COUNT(*) n FROM transactions').get().n,0);sql.close()});
test('Stale lease cannot write another account or advance its checkpoint',async()=>{const {sql,db}=fixture();await assert.rejects(applyPayables(db,'other',snapshot(),['qa'],false,'test'),/superseded/);assert.equal(sql.prepare('SELECT COUNT(*) n FROM trip_payables').get().n,0);sql.close()});
test('Currencies remain separate and source IDR/JPY minor units are not mis-scaled',async()=>{const {payableMoney}=await import('../lib/trip-payable-format.ts');assert.equal(payableMoney(100,'IDR'),'IDR 100');assert.equal(payableMoney(100,'JPY'),'JPY 100');assert.equal(payableMoney(100,'MYR'),'RM 1.00');const a=snapshot(),b=snapshot(500,0);b.spaces[0]={...b.spaces[0],id:'sg',currency:'SGD'};b.rows[0]={...b.rows[0],space_id:'sg',currency:'SGD'};const rows=projectPayables({...a,spaces:[...a.spaces,...b.spaces],rows:[...a.rows,...b.rows]},['qa','sg']).parents;assert.equal(rows.find(r=>r.currency==='MYR').remaining,10000);assert.equal(rows.find(r=>r.currency==='SGD').remaining,500)});

const route=ts.transpileModule(readFileSync('app/api/trip-payables/route.ts','utf8').replace(/^import .*;\n/gm,''),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/export /g,'');
function routeFixture(t){
 const {sql,db}=fixture(),originalFetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=originalFetch;sql.close();});
 const dependencies={...payables,env:{DB:db,LEDGER_OWNER_EMAIL:'owner@example.test',POCKET_SYNC_TOKEN:'test'},getChatGPTUser:async()=>({userId:'me',email:'owner@example.test'})};
 const api=new Function(...Object.keys(dependencies),route+';return {POST};')(...Object.values(dependencies));
 return {sql,post:body=>api.POST(new Request('https://ledger.test/api/trip-payables',{method:'POST',headers:{origin:'https://ledger.test'},body:JSON.stringify(body)}))};
}
function snapshotWith(...ids){
 const result=snapshot();
 result.spaces=ids.map(id=>({...result.spaces[0],id}));
 result.rows=ids.map(id=>({...result.rows[0],space_id:id}));
 return result;
}
test('Payables require confirmation for new spaces and preserve disabled spaces through disappearance',async t=>{
 const {sql,post}=routeFixture(t);
 let source=snapshotWith('qa','disabled');
 globalThis.fetch=async()=>Response.json(source);
 const selected=()=>sql.prepare('SELECT space_id FROM trip_payables WHERE deleted=0 ORDER BY space_id').all().map(r=>r.space_id);
 const confirm=enabled=>post({action:'confirm',version:source.version,enabled});
 assert.deepEqual((await (await post({action:'preview'})).json()).enabled,['qa','disabled']);
 assert.equal((await confirm(['qa'])).status,200);
 source=snapshotWith('qa');
 assert.equal((await post({action:'sync'})).status,200);
 source=snapshotWith('qa','disabled','new');
 const preview=await (await post({action:'preview'})).json();
 assert.equal((await post({action:'sync'})).status,200);
 assert.deepEqual(selected(),['qa']);
 assert.deepEqual(preview.enabled,['qa']);
 assert.equal((await confirm(['qa','new'])).status,200);
 assert.deepEqual(selected(),['new','qa']);
 assert.equal(sql.prepare("SELECT enabled FROM trip_sync_spaces WHERE space_id='disabled'").get().enabled,0);
});
test('Pausing Payables revokes an in-flight import lease and prevents reactivation',async t=>{
 const {sql,post}=routeFixture(t),entered=Promise.withResolvers(),upstream=Promise.withResolvers();
 globalThis.fetch=async()=>Response.json(snapshot());
 assert.equal((await post({action:'confirm',version:'v1',enabled:['qa']})).status,200);
 globalThis.fetch=async()=>{entered.resolve();return upstream.promise;};
 const stale=post({action:'sync'});await entered.promise;
 const paused=await post({action:'pause'});
 upstream.resolve(Response.json({...snapshot(8000,2000),version:'v2'}));
 const staleResult=await stale;
 assert.equal(paused.status,200);
 assert.equal(staleResult.status,409);
 assert.deepEqual({...sql.prepare('SELECT activated,status,lease,lock_until,version FROM trip_sync_settings').get()},{activated:0,status:'paused',lease:'',lock_until:0,version:'v1'});
 assert.equal(sql.prepare('SELECT remaining FROM trip_payables').get().remaining,10000);
 assert.equal((await post({action:'sync'})).status,409);
 assert.equal(sql.prepare('SELECT status FROM trip_sync_settings').get().status,'paused');
});
