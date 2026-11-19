// Reproducible local/CI gate. This never deploys or touches production records.
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=readdirSync(new URL('../tests/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
const gates=[
 ['Lint',['node_modules/eslint/bin/eslint.js','.']],
 ['Types',['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']],
 ['Accounting and UI regression tests',['--test',...tests]],
 ['Production build',['scripts/run-framework.mjs','build']],
 ['Production CSS regression',['scripts/check-visual-build.mjs']],
];
for(const [name,args] of gates){
 console.log(`Release gate: ${name}`);
 const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
 if(result.error||result.status!==0){
  console.error(`Release blocked at ${name}`,result.error?.message||result.signal||result.status);
  process.exit(result.status||1);
 }
}
console.log('Automated gates passed. Browser, real-data and permissions acceptance are still required before deployment.');
