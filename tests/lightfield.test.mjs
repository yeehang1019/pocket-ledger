import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../app/lightfield.css',import.meta.url),'utf8');
const luminance=hex=>{
 const channels=hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 return channels.reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
};
test('all six lightfield themes keep body, muted and today text above 4.5:1',()=>{
 const themes=[...css.matchAll(/:root[^{}]*\{([^}]*--field-paper:[^}]*)\}/g)];
 assert.equal(themes.length,6);
 for(const [,declarations] of themes){
  const values=Object.fromEntries([...declarations.matchAll(/--field-([\w-]+):(#[a-f\d]{6})/gi)].map(([,key,value])=>[key,value]));
  for(const [foreground,background] of [['ink','paper'],['muted','paper'],['today-ink','today']]){
   const a=luminance(values[foreground]),b=luminance(values[background]);
   assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${foreground} on ${background}: ${declarations}`);
  }
 }
});
test('motion has an OS reduced-motion override and no perpetual animation',()=>{
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/animation:none!important/);
 assert.doesNotMatch(css,/\binfinite\b/);
 assert.match(css,/:root\[data-motion="off"\] \.entry-dialog/);
 assert.match(css,/:root\[data-motion="soft"\]/);
});
