// A stopped runner must stop the Cargo group it started before removing its final-artifact staging tree.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import { cargoRepo, consumer, sandbox, write } from './acceptance/1123/helpers.mjs';

for (const signal of ['SIGTERM', 'SIGKILL']) test(`a ${signal} during Cargo ends owned builders and removes late staging writes`, async (t) => {
  const box = sandbox(t);
  cargoRepo(box);
  const realCargo = spawnSync('sh',['-c','command -v cargo'],{env:box.env,encoding:'utf8'}).stdout.trim();
  assert.ok(realCargo);
  const ready = join(box.dir,'ready'), shim = join(box.dir,'tools'), decoy = join(box.dir,'unrelated');
  mkdirSync(shim);mkdirSync(decoy);
  write(box.repo,'tests/binary.test.mjs',consumer('node','build never finishes'));
  write(box.repo,'driver.mjs',"import {runLanes} from './scripts/lanes.mjs';runLanes([{name:'build',fix:'none',commands:[[process.execPath,'--test','tests/binary.test.mjs']]}]);\n");
  // Cargo is a tool boundary. Forward to real Cargo, but keep its process wrapper alive writing staging files,
  // as a build-script/compiler descendant can do after its caller is killed.
  write(shim,'cargo',`#!${process.execPath}
import {spawnSync,spawn} from 'node:child_process';import {mkdirSync,writeFileSync} from 'node:fs';import {dirname,join} from 'node:path';
const args=process.argv.slice(2), real=${JSON.stringify(realCargo)};
if(args[0]!=='build'){const r=spawnSync(real,args,{stdio:'inherit'});process.exit(r.status??1);}
const target=args[args.indexOf('--target-dir')+1], bin=dirname(target);
const c=spawn(real,args,{stdio:'inherit'});writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,cargo:c.pid,bin}));
setInterval(()=>{mkdirSync(target,{recursive:true});writeFileSync(join(target,'late'),'still writing');},30);
`);
  chmodSync(join(shim,'cargo'),0o755);
  const child=spawn(process.execPath,['driver.mjs'],{cwd:box.repo,env:{...box.env,PATH:shim+':'+box.env.PATH},stdio:'ignore',detached:true});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  let own;
  t.after(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{};for(const pid of [own?.pid,own?.cargo])if(pid)try{process.kill(pid,'SIGKILL')}catch{}});
  const deadline=Date.now()+20000;while(!existsSync(ready)&&Date.now()<deadline)await sleep(25);
  assert.ok(existsSync(ready),'real Cargo wrapper starts before the parent is killed');
  own=JSON.parse(readFileSync(ready,'utf8'));child.kill(signal);await exited;
  const alive=()=>{try{process.kill(own.pid,0);return true}catch{return false}};
  const end=Date.now()+6000;while((alive()||existsSync(own.bin))&&Date.now()<end)await sleep(25);
  assert.equal(alive(),false,'owned builder must not survive its run');
  assert.equal(existsSync(own.bin),false,'late writes must not recreate the run-private directory');
  assert.equal(existsSync(decoy),true,'cleanup leaves unrelated directories alone');
});
