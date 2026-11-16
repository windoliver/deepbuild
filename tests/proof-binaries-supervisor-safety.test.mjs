// Failed ps and reparented launchers must not be mistaken for proven ownership/cleanup.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { ROOT, sandbox, write } from './acceptance/1123/helpers.mjs';

const wait = async (predicate) => { const end=Date.now()+12000;while(!predicate()&&Date.now()<end)await sleep(25);assert.ok(predicate(),'supervisor returned before deadline'); };
const alive = pid => { const r=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'});return r.status===0&&!r.stdout.trim().startsWith('Z'); };

test('failed process scan returns BLOCKED promptly and kills its recorded worker instead of relying on caller timeout',async t=>{
 const box=sandbox(t),shim=join(box.dir,'tools'),ready=join(box.dir,'ready'),done=join(box.dir,'done'),dir=join(box.dir,'run');mkdirSync(shim);mkdirSync(dir);
 write(shim,'ps',"#!/bin/sh\ncase \"$*\" in *pgid*) echo scan-unavailable >&2;exit 1;; esac\nexec /bin/ps \"$@\"\n");chmodSync(join(shim,'ps'),0o755);
 write(box.dir,'worker.mjs',`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`);
 write(box.dir,'build.mjs',`import {spawn} from 'node:child_process';const w=spawn(process.execPath,[${JSON.stringify(join(box.dir,'worker.mjs'))}],{stdio:'inherit'});w.unref();setTimeout(()=>process.exit(0),200);`);
 write(box.dir,'owner.mjs',`import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';const start=spawnSync('/bin/ps',['-o','lstart=','-p',String(process.pid)],{env:{...process.env,TZ:'UTC',LC_ALL:'C'},encoding:'utf8'}).stdout.trim();const r=spawnSync(process.execPath,[${JSON.stringify(join(ROOT,'scripts/proof-bin-build.mjs'))},${JSON.stringify(dir)},String(process.pid),start,process.execPath,${JSON.stringify(join(box.dir,'build.mjs'))}],{encoding:'utf8',timeout:8000});writeFileSync(${JSON.stringify(done)},JSON.stringify({status:r.status,error:r.error?.code,stderr:r.stderr}));`);
 const child=spawn(process.execPath,[join(box.dir,'owner.mjs')],{env:{...box.env,PATH:shim+':'+box.env.PATH},stdio:'ignore',detached:true});
 t.after(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{};if(existsSync(ready))try{process.kill(Number(readFileSync(ready,'utf8')),'SIGKILL')}catch{}});
 await wait(()=>existsSync(ready));const pid=Number(readFileSync(ready,'utf8'));await wait(()=>existsSync(done));const result=JSON.parse(readFileSync(done,'utf8'));
 assert.equal(result.error,undefined,'the supervisor must close captured pipes before the outer timeout');assert.notEqual(result.status,0);assert.match(result.stderr,/BLOCKED.*process.*scan/i);assert.equal(alive(pid),false,'recorded descendant ended despite unavailable enumeration');
});

test('a supplied owner that is not an ancestor cannot authorize a detached build',async t=>{
 const box=sandbox(t),dir=join(box.dir,'run'),marker=join(box.dir,'ran');mkdirSync(dir);
 const decoy=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>decoy.kill('SIGKILL'));
 const start=spawnSync('/bin/ps',['-o','lstart=','-p',String(decoy.pid)],{env:{...process.env,TZ:'UTC',LC_ALL:'C'},encoding:'utf8'}).stdout.trim();
 const result=spawnSync(process.execPath,[join(ROOT,'scripts/proof-bin-build.mjs'),dir,String(decoy.pid),start,process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'started')`],{env:box.env,encoding:'utf8',timeout:8000});
 assert.notEqual(result.status,0,'live sibling identity is not authorization to launch');assert.equal(existsSync(marker),false,'a lost ancestor chain starts no compiler');
});
