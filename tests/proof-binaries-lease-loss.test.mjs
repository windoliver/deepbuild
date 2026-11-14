// Keep the original owner alive: death of the actual deep lease process must still cancel its detached build.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { ROOT, sandbox, write } from './acceptance/1123/helpers.mjs';

test('SIGKILL of the real lease while the owner lives ends its Cargo group and releases captured output', async t => {
  const box=sandbox(t),dir=join(box.dir,'run'),ready=join(box.dir,'ready'),done=join(box.dir,'done');mkdirSync(dir);
  assert.ok(existsSync(join(ROOT,'packages/cli/dist/main.js')),'BLOCKED: build CLI');
  symlinkSync(join(ROOT,'packages'),join(box.repo,'packages'));
  write(box.dir,'build.mjs',`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,worker:worker.pid}));setInterval(()=>{},1000);`);
  const helper=join(ROOT,'scripts/proof-bin-build.mjs'),lease=join(box.repo,'scripts/lease');
  write(box.dir,'owner.mjs',`import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';const start=spawnSync('ps',['-o','lstart=','-p',String(process.pid)],{env:{...process.env,TZ:'UTC',LC_ALL:'C'},encoding:'utf8'}).stdout.trim();const result=spawnSync(${JSON.stringify(lease)},[process.execPath,${JSON.stringify(helper)},${JSON.stringify(dir)},String(process.pid),start,process.execPath,${JSON.stringify(join(box.dir,'build.mjs'))}],{encoding:'utf8',detached:true});writeFileSync(${JSON.stringify(done)},JSON.stringify({status:result.status,signal:result.signal}));setInterval(()=>{},1000);`);
  const child=spawn(process.execPath,[join(box.dir,'owner.mjs')],{env:box.env,cwd:box.repo,detached:true,stdio:'ignore'});let built,leasePid;
  const alive=pid=>{const r=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'});return r.status===0&&!r.stdout.trim().startsWith('Z');};
  t.after(()=>{for(const pid of [child.pid,leasePid,built?.pid,built?.worker])if(pid)try{process.kill(pid,'SIGKILL')}catch{}});
  const end=Date.now()+15000;while(!existsSync(ready)&&Date.now()<end)await sleep(25);assert.ok(existsSync(ready),'builder started');built=JSON.parse(readFileSync(ready,'utf8'));
  const rows=spawnSync('ps',['-A','-o','pid=,ppid=,command='],{encoding:'utf8'}).stdout.split('\n').map(r=>r.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
  leasePid=Number(rows.find(([,pid,parent,command])=>Number(parent)===child.pid&&command.includes('lease'))?.[1]);assert.ok(leasePid,'owned real lease process identified');
  process.kill(leasePid,'SIGKILL');
  const deadline=Date.now()+6000;while((!existsSync(done)||alive(built.pid)||alive(built.worker))&&Date.now()<deadline)await sleep(50);
  assert.equal(alive(child.pid),true,'original owner stayed alive throughout');
  assert.ok(existsSync(done),'captured pipes close when the lease dies');
  assert.equal(alive(built.pid)||alive(built.worker),false,'no detached builder outlives the killed lease');
});
