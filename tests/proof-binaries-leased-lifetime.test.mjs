// The real built CLI creates another process group for deep lease; cancellation must reach Cargo there too.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { ROOT, cargoRepo, consumer, sandbox, write } from './acceptance/1123/helpers.mjs';

for (const signal of ['SIGTERM','SIGKILL']) test(`real deep lease cancels all binary builders after ${signal}, with no recreated run root`, async (t) => {
  assert.ok(existsSync(join(ROOT,'packages/cli/dist/main.js')),'BLOCKED: build the real CLI');
  const box=sandbox(t);cargoRepo(box);symlinkSync(join(ROOT,'packages'),join(box.repo,'packages'));
  const shim=join(box.dir,'tools'), ready=join(box.dir,'ready');mkdirSync(shim);
  const real=spawnSync('sh',['-c','command -v cargo'],{env:box.env,encoding:'utf8'}).stdout.trim();
  write(box.repo,'tests/binary.test.mjs',consumer('node','waits for build'));
  write(box.repo,'driver.mjs',"import {runLanes} from './scripts/lanes.mjs';runLanes([{name:'b',commands:[[process.execPath,'--test','tests/binary.test.mjs']],fix:'none'}]);");
  write(shim,'cargo',`#!${process.execPath}
import {spawn,spawnSync} from 'node:child_process';import {writeFileSync,mkdirSync} from 'node:fs';import {dirname,join} from 'node:path';
const args=process.argv.slice(2);if(args[0]!=='build'){const r=spawnSync(${JSON.stringify(real)},args,{stdio:'inherit'});process.exit(r.status??1);}
const target=args[args.indexOf('--target-dir')+1], bin=dirname(target);
const worker=spawn(process.execPath,['-e',${JSON.stringify("const fs=require('node:fs');setInterval(()=>{fs.mkdirSync(process.argv[1],{recursive:true});fs.writeFileSync(process.argv[1]+'/late','writing');},20);")},target],{stdio:'inherit'});
writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,worker:worker.pid,bin}));setInterval(()=>{},1000);
`);chmodSync(join(shim,'cargo'),0o755);
  const child=spawn(process.execPath,['driver.mjs'],{cwd:box.repo,env:{...box.env,PATH:shim+':'+box.env.PATH},stdio:'ignore',detached:true});
  const ended=new Promise(r=>child.once('exit',r));let own;
  t.after(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{};for(const pid of [own?.pid,own?.worker])if(pid)try{process.kill(pid,'SIGKILL')}catch{}});
  const until=async(p,ms)=>{const end=Date.now()+ms;while(!p()&&Date.now()<end)await sleep(30);assert.ok(p(),'condition completed before deadline');};
  await until(()=>existsSync(ready),20000);own=JSON.parse(readFileSync(ready,'utf8'));
  child.kill(signal);await ended;
  const alive=pid=>{const r=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'});return r.status===0&&!r.stdout.trim().startsWith('Z');};
  const end=Date.now()+6000;while((alive(own.pid)||alive(own.worker)||existsSync(dirname(own.bin)))&&Date.now()<end)await sleep(50);
  assert.equal(alive(own.pid)||alive(own.worker),false,'lease wrapper and builder worker both ended');
  assert.equal(existsSync(dirname(own.bin)),false,'run root remains removed after descendants stop writing');
});
