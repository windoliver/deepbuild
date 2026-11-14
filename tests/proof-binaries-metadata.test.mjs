import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoRepo, dump, run, sandbox, write } from './acceptance/1123/helpers.mjs';

test('metadata-only scope check does not build an unused helper binary', t => {
  const box=sandbox(t);cargoRepo(box);
  write(box.repo,'crates/deep-hook/src/main.rs','fn main(){compile_error!("scope checks do not execute this binary");}');
  write(box.repo,'tests/helpers.mjs',"import {spawnSync} from 'node:child_process';const supplied=process.env.DEEP_BIN_DIR;if(supplied==='')throw Error('empty');export function metadata(){return JSON.parse(spawnSync('cargo',['metadata','--no-deps','--format-version','1'],{encoding:'utf8'}).stdout)};export function hook(){return spawnSync(supplied+'/deep-hook',[]).status};");
  write(box.repo,'tests/scope.test.mjs',"import test from 'node:test';import assert from 'node:assert/strict';import {metadata} from './helpers.mjs';test('scope',()=>assert.equal(metadata().packages[0].name,'deep-hook'));\n");
  write(box.repo,'driver.mjs',"import {runLanes} from './scripts/lanes.mjs';process.exitCode=runLanes([{name:'scope',commands:[[process.execPath,'--test','tests/scope.test.mjs']],fix:'none'}]);");
  const result=run(box,process.execPath,['driver.mjs']);assert.equal(result.status,0,dump(result));assert.match(result.stdout,/PASS scope/);
});
