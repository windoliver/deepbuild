import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cargoRepo, commit, consumer, dump, git, observations, run, sandbox, write } from './acceptance/1123/helpers.mjs';

function drive(box, files) {
  write(box.repo, 'driver.mjs', `import {runLanes} from './scripts/lanes.mjs';process.exitCode=runLanes([{name:'selected',fix:'none',commands:[[process.execPath,'--test',...${JSON.stringify(files)}]]}]);`);
  return run(box, process.execPath, ['driver.mjs']);
}

test('binary demand stays with its consumer instead of names in unrelated selected tests', (t) => {
  const box = sandbox(t);
  cargoRepo(box);
  write(box.repo, 'Cargo.toml', '[workspace]\nmembers=["crates/deep-hook","crates/unrelated"]\nresolver="2"\n');
  write(box.repo, 'crates/unrelated/Cargo.toml', '[package]\nname="deep-app"\nversion="0.0.0"\nedition="2021"\n');
  write(box.repo, 'crates/unrelated/src/main.rs', 'fn main(){compile_error!("unrelated app must not build");}');
  assert.equal(run(box, 'cargo', ['generate-lockfile', '--offline']).status, 0);
  write(box.repo, 'tests/binary.test.mjs', consumer('node', 'own hook'));
  write(box.repo, 'tests/logic.test.mjs', "import test from 'node:test';import assert from 'node:assert/strict';test('text value',()=>assert.equal('deep-app'.split('-')[1],'app'));\n");
  const result = drive(box, ['tests/binary.test.mjs', 'tests/logic.test.mjs']);
  assert.equal(result.status, 0, dump(result));
  assert.equal(observations(box)[0]?.word, 'change-right');
});

test('a binary consumer without a Cargo workspace is blocked before it executes', (t) => {
  const box = sandbox(t);
  write(box.repo, 'tests/binary.test.mjs', consumer('node', 'missing workspace'));
  const result = drive(box, ['tests/binary.test.mjs']);
  assert.notEqual(result.status, 0, dump(result));
  assert.match(result.stdout, /BLOCKED selected:/);
  assert.deepEqual(observations(box), [], 'an absent binary cannot count as a wrong program assertion');
});
