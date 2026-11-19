import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const folder='dist/client/_next/static/css';
const css=readdirSync(folder).filter(f=>f.endsWith('.css')).map(f=>readFileSync(`${folder}/${f}`,'utf8')).join('\n');
assert.ok(/(?<!-webkit-)backdrop-filter:blur\(40px\)\s*saturate\((190%|1\.9)\)/.test(css),'Production CSS must retain standard glass-sheet blur');
assert.ok(/(?<!-webkit-)backdrop-filter:blur\(22px\)\s*saturate\((190%|1\.9)\)/.test(css),'Production CSS must retain standard floating chrome blur');
assert.match(css,/spending-sources button\{[^}]*flex-direction:row!important/,'Source rows must not inherit the legacy column layout');
console.log('Visual build checks passed: 40px sheet glass, 22px floating chrome and horizontal source rows.');
