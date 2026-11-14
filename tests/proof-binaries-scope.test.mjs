import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cargoRepo, commit, dump, git, run, sandbox, write } from './acceptance/1123/helpers.mjs';

test('a JS-only test importing tooling does not build binaries merely mentioned in that tooling', (t) => {
  const box = sandbox(t);
  cargoRepo(box);
  write(box.repo, 'crates/deep-hook/src/main.rs', 'fn main() { compile_error!("unselected Rust build"); }');
  write(box.repo, 'scripts/fixture-tool.mjs', "export const value = 2; // cargo target/debug/deep-hook, a separate caller\n");
  write(box.repo, 'tests/js.test.mjs', "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../scripts/fixture-tool.mjs'; test('js value', () => assert.equal(value, 2));");
  write(box.repo, 'driver.mjs', "import {runLanes} from './scripts/lanes.mjs'; process.exitCode=runLanes([{name:'js',commands:[[process.execPath,'--test','tests/js.test.mjs']],fix:'none'}]);");
  commit(box, 'fixture'); git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const result = run(box, process.execPath, ['driver.mjs']);
  assert.equal(result.status, 0, dump(result));
  assert.match(result.stdout, /PASS js/);
});
