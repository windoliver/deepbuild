// Unused exports of a test helper are not build prerequisites, even beside a real binary consumer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoRepo, dump, run, sandbox, write } from './acceptance/1123/helpers.mjs';

for (const usesBinary of [false,true]) test(`named helper imports ${usesBinary ? 'build only their used binary' : 'do not build unused binary exports'}`, t => {
  const box=sandbox(t);cargoRepo(box);
  write(box.repo,'Cargo.toml','[workspace]\nmembers=["crates/deep-hook","crates/app"]\nresolver="2"\n');
  write(box.repo,'crates/app/Cargo.toml','[package]\nname="deep-app"\nversion="0.0.0"\nedition="2021"\n');
  write(box.repo,'crates/app/src/main.rs','fn main(){compile_error!("unused binary");}');
  assert.equal(run(box,'cargo',['generate-lockfile','--offline']).status,0);
  write(box.repo,'tests/helpers.mjs',`import {spawnSync} from 'node:child_process';import {join} from 'node:path';const bin=n=>join(process.env.DEEP_BIN_DIR,n);export const value=()=>2;export const hook=()=>spawnSync(bin('deep-hook'),[],{encoding:'utf8'}).stdout.trim();export const unused=()=>spawnSync(bin('deep-app'),[],{encoding:'utf8'});`);
  write(box.repo,'tests/check.test.mjs',`import test from 'node:test';import assert from 'node:assert/strict';import {${usesBinary?'hook':'value'}} from './helpers.mjs';test('uses selected helper',()=>assert.equal(${usesBinary?"hook(),'change-right'":"value(),2"}));`);
  write(box.repo,'driver.mjs',"import {runLanes} from './scripts/lanes.mjs';process.exitCode=runLanes([{name:'helper',commands:[[process.execPath,'--test','tests/check.test.mjs']],fix:'none'}]);");
  const result=run(box,process.execPath,['driver.mjs']);assert.equal(result.status,0,dump(result));assert.match(result.stdout,/PASS helper/);
});
