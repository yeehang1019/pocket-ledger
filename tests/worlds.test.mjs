import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const source=readFileSync('lib/appearance.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiled={exports:{}};vm.runInNewContext(code,{exports:compiled.exports,module:compiled});
const script=compiled.exports.appearanceScript;
test('world choice migrates legacy themes without overwriting explicit choices',()=>{
 for(const [saved,dark,world,mode] of [[{'ledger-theme':'game'},false,'neon','dark'],[{'ledger-theme':'racing'},false,'neon','dark'],[{'ledger-theme':'cream'},false,'glass','light'],[{'ledger-theme':'unknown-old'},true,'glass','dark'],[{'ledger-theme':'game','ledger-world-choice':'glass'},true,'glass','dark'],[{'ledger-world-choice':'auto'},false,'glass','light'],[{'ledger-world-choice':'auto'},true,'glass','dark']]){
  const root={dataset:{},style:{}};vm.runInNewContext(script,{document:{documentElement:root},localStorage:{getItem:k=>saved[k]||null},matchMedia:q=>({matches:q.includes('color-scheme')&&dark}),navigator:{hardwareConcurrency:8}});
  assert.equal(root.dataset.world,world);assert.equal(root.dataset.mode,mode);
 }
});
test('OS reduced motion always disables effects and low core devices simplify them',()=>{
 for(const [cores,reduced,motion] of [[8,true,'off'],[4,false,'soft'],[8,false,'full']]){
  const root={dataset:{},style:{}};vm.runInNewContext(script,{document:{documentElement:root},localStorage:{getItem:()=>null},matchMedia:q=>({matches:q.includes('reduced-motion')&&reduced}),navigator:{hardwareConcurrency:cores}});assert.equal(root.dataset.motion,motion);
 }
});
test('all worlds use readable solid text and number pairs, independent of ambient effects',()=>{
 const css=readFileSync('app/worlds.css','utf8'),configs=[...css.matchAll(/:root\[data-world=(?:glass|neon)\]\[data-mode(?:=dark)?\]\{([^}]*--app-bg:[^}]+)\}/g)];
 assert.equal(configs.length,3);
 const luminance=hex=>hex.match(/\w\w/g).map(h=>parseInt(h,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
 for(const [,body] of configs){const vars=Object.fromEntries([...body.matchAll(/(--[\w-]+):#([a-f\d]{6})(?:;|\})/g)].map(([,k,v])=>[k,v]));for(const [fg,bg,min] of [['--app-text','--app-surface',7],['--app-muted','--app-surface',4.5],['--app-on-primary','--app-primary',4.5]]){const [a,b]=[luminance(vars[fg]),luminance(vars[bg])];assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=min,`${fg} on ${bg}`);}}
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(css,/data-motion=off/);assert.match(css,/data-motion-paused=true/);
});
