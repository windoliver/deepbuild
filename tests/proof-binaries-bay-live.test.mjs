// A real published supervisor record is consumed before a reclaimed bay is rewritten.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ROOT } from './acceptance/1123/helpers.mjs';
import { machineRepo, sandbox, until, write } from './acceptance/1117/helpers.mjs';

test('reclaim waits for the actual binary supervisor and its group before replacing the bay', {timeout:60000}, async t=>{
 const box=sandbox(t),repo=machineRepo(box),bay=join(box.bays,'1/change'),ready=join(box.dir,'ready'),cleaned=join(box.dir,'stopped');
 rmSync(join(repo.worktree,'package-lock.json'));
 write(bay,{'source-before':'before','target/keep':'kept'});
 write(box.dir,{'build.mjs':`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`});
 const entry=join(ROOT,'scripts/proof-bin-build.mjs');
 const code=`import {spawnSync} from 'node:child_process';const start=spawnSync('ps',['-o','lstart=','-p',String(process.pid)],{env:{...process.env,TZ:'UTC',LC_ALL:'C'},encoding:'utf8'}).stdout.trim();spawnSync(process.execPath,[${JSON.stringify(entry)},${JSON.stringify(join(box.dir,'bin'))},String(process.pid),start,process.execPath,${JSON.stringify(join(box.dir,'build.mjs'))}],{cwd:${JSON.stringify(bay)},stdio:'inherit'});`;
 const owner=spawn(process.execPath,['--input-type=module','-e',code],{cwd:repo.worktree,env:box.env,stdio:'ignore',detached:true});box.children.push(owner);
 assert.ok(await until(()=>existsSync(ready),10000),'real compiler surrogate started');
 const builder=Number(readFileSync(ready,'utf8')),records=join(bay,'target/.deep-proof-builds');
 const file=join(records,readdirSync(records).find(f=>f.endsWith('.json')));const record=JSON.parse(readFileSync(file,'utf8'));
 assert.equal(record.owner.pid,owner.pid);assert.ok(record.group.pid&&record.supervisor.pid,'complete group record before compilation');
 // Freeze the guardian so the new claimant cannot rely on its ordinary polling having already cleaned up.
 process.kill(record.supervisor.pid,'SIGSTOP');owner.kill('SIGKILL');assert.ok(await until(()=>owner.signalCode!==null,2000));
 const claimCode=`const {claimPair}=await import(${JSON.stringify(pathToFileURL(repo.bays).href)});const p=claimPair(process.cwd(),()=>{});if(p.blocked||p.refused){console.log(p.blocked||p.refused);process.exit(2)}try{p.use('change','reclaim');console.log('READY')}finally{p.close(null,false)}`;
 const claimant=spawn(process.execPath,['--input-type=module','-e',claimCode],{cwd:repo.worktree,env:box.env,stdio:['ignore','pipe','pipe'],detached:true});box.children.push(claimant);let output='';claimant.stdout.on('data',b=>output+=b);claimant.stderr.on('data',b=>output+=b);const done=new Promise(resolve=>claimant.once('close',resolve));
 t.after(()=>{for(const pid of [record.supervisor.pid,record.group.pid,builder])try{process.kill(pid,'SIGKILL')}catch{}});
 await new Promise(resolve=>setTimeout(resolve,400));assert.ok(existsSync(join(bay,'source-before')),'bay is not rewritten before stalled cleanup');
 process.kill(record.supervisor.pid,'SIGCONT');assert.equal(await done,0,output);assert.match(output,/READY/);
 assert.equal(existsSync(join(bay,'source-before')),false,'bay really replaced');
 const living=pid=>{const r=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'});return r.status===0&&!r.stdout.trim().startsWith('Z')};
 assert.equal(living(builder),false,'old compiler ended before reuse completed');
});
