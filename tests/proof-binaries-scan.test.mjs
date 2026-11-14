// Process enumeration is an external boundary; failed enumeration must never certify cleanup as successful.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { ROOT, sandbox, write } from './acceptance/1123/helpers.mjs';

test('a failed process scan cannot turn a build with a live descendant into a successful result', async t => {
  const box=sandbox(t), shim=join(box.dir,'tools'), ready=join(box.dir,'ready'),done=join(box.dir,'done'), dir=join(box.dir,'run');mkdirSync(shim);mkdirSync(dir);
  const realPs=spawnSync('sh',['-c','command -v ps'],{encoding:'utf8'}).stdout.trim();
  write(shim,'ps',`#!/bin/sh\ncase "$*" in *pgid*) echo 'scan unavailable' >&2; exit 1;; esac\nexec '${realPs}' "$@"\n`);chmodSync(join(shim,'ps'),0o755);
  write(box.dir,'worker.mjs',`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`);
  write(box.dir,'build.mjs',`import {spawn} from 'node:child_process';const w=spawn(process.execPath,[${JSON.stringify(join(box.dir,'worker.mjs'))}],{stdio:'inherit'});w.unref();setTimeout(()=>process.exit(0),100);`);
  const entry=join(ROOT,'scripts/proof-bin-build.mjs');
  write(box.dir,'owner.mjs',`import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';const start=spawnSync(${JSON.stringify(realPs)},['-o','lstart=','-p',String(process.pid)],{env:{...process.env,TZ:'UTC',LC_ALL:'C'},encoding:'utf8'}).stdout.trim();const r=spawnSync(process.execPath,[${JSON.stringify(entry)},${JSON.stringify(dir)},String(process.pid),start,process.execPath,${JSON.stringify(join(box.dir,'build.mjs'))}],{encoding:'utf8',timeout:10000});writeFileSync(${JSON.stringify(done)},JSON.stringify({status:r.status,out:r.stdout,err:r.stderr}));`);
  const child=spawn(process.execPath,[join(box.dir,'owner.mjs')],{env:{...box.env,PATH:shim+':'+box.env.PATH},stdio:'ignore',detached:true});
  t.after(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{};if(existsSync(ready))try{process.kill(Number(readFileSync(ready,'utf8')),'SIGKILL')}catch{}});
  const end=Date.now()+15000;while(!existsSync(done)&&Date.now()<end)await sleep(25);
  assert.ok(existsSync(done),'supervisor finishes with an explicit result despite failed ps');
  const result=JSON.parse(readFileSync(done,'utf8'));
  assert.notEqual(result.status,0,'a process-table failure cannot certify a successful build cleanup');
  assert.match(result.err,/BLOCKED.*process|process.*scan/i,'missing process evidence is named');
});
