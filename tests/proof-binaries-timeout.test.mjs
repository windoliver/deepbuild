// A synchronous caller's timeout kills the lease, not the detached worker. Both must still end.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { ROOT, sandbox, write } from './acceptance/1123/helpers.mjs';

test('a spawn timeout through real lease returns nonzero and leaves no compiler descendants', async t=>{
  const box=sandbox(t),dir=join(box.dir,'run'),ready=join(box.dir,'ready'),done=join(box.dir,'done');mkdirSync(dir);
  assert.ok(existsSync(join(ROOT,'packages/cli/dist/main.js')),'BLOCKED: real CLI build required');symlinkSync(join(ROOT,'packages'),join(box.repo,'packages'));
  write(box.dir,'work.mjs',`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const w=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,worker:w.pid}));setInterval(()=>{},1000);`);
  write(box.dir,'owner.mjs',`import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';const start=spawnSync('ps',['-o','lstart=','-p',String(process.pid)],{env:{...process.env,TZ:'UTC',LC_ALL:'C'},encoding:'utf8'}).stdout.trim();const r=spawnSync(${JSON.stringify(join(box.repo,'scripts/lease'))},[process.execPath,${JSON.stringify(join(ROOT,'scripts/proof-bin-build.mjs'))},${JSON.stringify(dir)},String(process.pid),start,process.execPath,${JSON.stringify(join(box.dir,'work.mjs'))}],{encoding:'utf8',timeout:3000,killSignal:'SIGKILL',detached:true});writeFileSync(${JSON.stringify(done)},JSON.stringify({status:r.status,error:r.error?.code,signal:r.signal}));setInterval(()=>{},1000);`);
  const child=spawn(process.execPath,[join(box.dir,'owner.mjs')],{cwd:box.repo,env:box.env,stdio:'ignore',detached:true});let built;
  const alive=pid=>{const r=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'});return r.status===0&&!r.stdout.trim().startsWith('Z');};
  t.after(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{};for(const p of [built?.pid,built?.worker])if(p)try{process.kill(p,'SIGKILL')}catch{}});
  const deadline=Date.now()+15000;while(!existsSync(done)&&Date.now()<deadline)await sleep(25);
  assert.ok(existsSync(ready),'real work starts before timeout');built=JSON.parse(readFileSync(ready,'utf8'));
  assert.ok(existsSync(done),'timed-out spawn returns despite inherited output descriptors');
  const result=JSON.parse(readFileSync(done,'utf8'));assert.equal(result.error,'ETIMEDOUT');assert.notEqual(result.status,0);
  const end=Date.now()+5000;while((alive(built.pid)||alive(built.worker))&&Date.now()<end)await sleep(25);
  assert.equal(alive(built.pid)||alive(built.worker),false,'timeout stops the whole owned build group');
});
