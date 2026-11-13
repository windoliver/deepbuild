// #1906 AC4: Node ignores a fourth execFileSync argument, uses null-prototype defaults, and permits construction.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
const owner = new URL('../dist/children.js', import.meta.url).href;
const probe = `
import cp from 'node:child_process';
const tracker=process.env.OWNER?await import(process.env.OWNER):undefined;
const out=[];
const taken=fn=>{const before=tracker?.trackedSyncChildren?.().length??0;const value=fn();const entries=tracker?.trackedSyncChildren?.().slice(before);out.push({value:Buffer.isBuffer(value)?value.toString():value,owned:entries?entries.length===1&&entries.every(x=>x.pid>0):true});};
taken(()=>cp.execFileSync('printf',['fourth'],{},'ignored'));
Object.defineProperty(Object.prototype,'stdio',{value:'pipe',configurable:true});
try{taken(()=>cp.execSync('printf err >&2;printf out'));}finally{delete Object.prototype.stdio;}
Object.defineProperty(Object.prototype,'argv0',{value:5,configurable:true});
try{taken(()=>cp.execFileSync('printf',['plain']));}finally{delete Object.prototype.argv0;}
taken(()=>new cp.execFileSync('printf',['construct']));
taken(()=>new cp.spawnSync('printf',['spawn']).stdout);
const reads=[];const options={get argv0(){reads.push('argv0');return 'custom';},get stdio(){reads.push('stdio');return 'pipe';}};
taken(()=>cp.execFileSync('printf',['getters'],options));
console.log(JSON.stringify({out,reads}));
`;
test('sync edge cases keep the native output, option read order and a process identity per invocation', () => {
  const run=tracked=>spawnSync(process.execPath,['--input-type=module','-e',probe],{encoding:'utf8',env:{...process.env,OWNER:tracked?owner:''}});
  const native=run(false),tracked=run(true);
  assert.equal(native.status,0,native.stderr);
  assert.equal(tracked.status,0,tracked.stderr);
  assert.deepEqual(JSON.parse(tracked.stdout),JSON.parse(native.stdout));
  assert.equal(tracked.stderr,native.stderr);
});
