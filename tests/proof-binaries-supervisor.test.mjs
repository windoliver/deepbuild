// Supervisor regressions: wrapper SIGKILL (as bay reclamation) and a build leader that exits first.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { ROOT, sandbox, write } from './acceptance/1123/helpers.mjs';

const alive = pid => { const r=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'});return r.status===0&&!r.stdout.trim().startsWith('Z'); };
for (const exitsFirst of [false,true]) test(exitsFirst ? 'successful build leader cannot leave a writer behind' : 'killing the recorded supervisor wrapper cannot strand Cargo', async t => {
  const box=sandbox(t), dir=join(box.dir,'run'),ready=join(box.dir,'ready'),done=join(box.dir,'done');mkdirSync(dir);
  write(box.dir,'worker.mjs',`import {mkdirSync,writeFileSync} from 'node:fs';setInterval(()=>{mkdirSync(${JSON.stringify(dir)},{recursive:true});writeFileSync(${JSON.stringify(join(dir,'late'))},'writing');},20);`);
  write(box.dir,'build.mjs',`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const w=spawn(process.execPath,[${JSON.stringify(join(box.dir,'worker.mjs'))}],{stdio:'inherit'});writeFileSync(${JSON.stringify(ready)},JSON.stringify({leader:process.pid,worker:w.pid}));${exitsFirst ? 'w.unref();process.exit(0);' : 'setInterval(()=>{},1000);'}`);
  const entry=join(ROOT,'scripts/proof-bin-build.mjs');
  write(box.dir,'owner.mjs',`import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';const start=spawnSync('ps',['-o','lstart=','-p',String(process.pid)],{env:{...process.env,TZ:'UTC',LC_ALL:'C'},encoding:'utf8'}).stdout.trim();const r=spawnSync(process.execPath,[${JSON.stringify(entry)},${JSON.stringify(dir)},String(process.pid),start,process.execPath,${JSON.stringify(join(box.dir,'build.mjs'))}],{stdio:'ignore'});writeFileSync(${JSON.stringify(done)},JSON.stringify({status:r.status,signal:r.signal}));`);
  const child=spawn(process.execPath,[join(box.dir,'owner.mjs')],{env:box.env,stdio:'ignore',detached:true});let pids;
  t.after(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{};for(const p of [pids?.leader,pids?.worker])if(p)try{process.kill(p,'SIGKILL')}catch{}});
  const wait=async p=>{const end=Date.now()+15000;while(!p()&&Date.now()<end)await sleep(25);assert.ok(p(),'supervisor fixture progressed');};
  await wait(()=>existsSync(ready));pids=JSON.parse(readFileSync(ready,'utf8'));
  if(!exitsFirst){const rows=spawnSync('ps',['-A','-o','pid=,ppid='],{encoding:'utf8'}).stdout.split('\n').map(r=>r.trim().split(/\s+/).map(Number));const wrapper=rows.find(([,parent])=>parent===child.pid)?.[0];assert.ok(wrapper,'own blocking wrapper exists');process.kill(wrapper,'SIGKILL');}
  await wait(()=>existsSync(done));await wait(()=>!alive(pids.worker)&&!alive(pids.leader));
  if(exitsFirst)assert.equal(JSON.parse(readFileSync(done,'utf8')).status,0,'leader result survives descendant cleanup');
  else assert.equal(existsSync(dir),false,'cancelled build removes only its run root after workers stop');
});
