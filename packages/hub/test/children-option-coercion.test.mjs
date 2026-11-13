// #1906 AC4: a successful native call must not stringify argv a second time after the child exits.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
const owner=new URL('../dist/children.js',import.meta.url).href;
const script=`import cp from 'node:child_process';if(process.env.OWNER)await import(process.env.OWNER);let n=0;const arg={toString(){n++;return 'value'}};const out=cp.execFileSync('printf',['%s',arg],{encoding:'utf8'});console.log(JSON.stringify({out,n}));`;
test('successful execFileSync preserves argument coercion count',()=>{
 const run=tracked=>spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,OWNER:tracked?owner:''}});
 const base=run(false),work=run(true);
 assert.equal(base.status,0,base.stderr);assert.equal(work.status,0,work.stderr);
 assert.equal(work.stdout,base.stdout);
});
