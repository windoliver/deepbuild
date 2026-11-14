// Selection must exclude an actual executable consumer, not just a file mentioning the environment key.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cargoRepo, commit, consumer, dump, git, run, sandbox, write } from './acceptance/1123/helpers.mjs';

function scene(t, excludes) {
  const box = sandbox(t);
  cargoRepo(box);
  write(box.repo, 'crates/deep-hook/src/main.rs', 'fn main(){compile_error!("excluded binary must not build");}');
  write(box.repo, 'tests/selected.test.mjs', "import test from 'node:test';import assert from 'node:assert/strict';test('selected',()=>assert.equal(2+2,4));\n");
  write(box.repo, 'tests/selected.test.ts', "import {test,expect} from 'vitest';test('selected',()=>expect(2+2).toBe(4));\n");
  write(box.repo, 'tests/excluded/bin.test.ts', consumer('vitest', 'actual excluded binary'));
  write(box.repo, 'vitest.config.mjs', "export default {test:{include:['tests/**/*.test.ts']}};\n");
  const lanes = excludes ? [{name:'selected',commands:[[process.execPath,'node_modules/vitest/vitest.mjs','run','--exclude','tests/excluded/**']],fix:'none'}]
    : [{name:'selected',commands:[[process.execPath,'--test','tests/selected.test.mjs']],fix:'none'},{name:'skipped',paths:['unmodified/**'],commands:[[process.execPath,'node_modules/vitest/vitest.mjs','run','tests/excluded/bin.test.ts']],fix:'none'}];
  write(box.repo, 'driver.mjs', `import {runLanes} from './scripts/lanes.mjs';process.exitCode=runLanes(${JSON.stringify(lanes)});`);
  commit(box, 'fixture');git(box,'update-ref','refs/remotes/origin/main','HEAD');write(box.repo,'changed.md','only this changed\n');
  return box;
}
function check(box) {
  const r = run(box, process.execPath, ['driver.mjs']);
  assert.equal(r.status, 0, dump(r));
  assert.match(r.stdout, /PASS selected/);
}
for (const excludes of [false, true]) test(`${excludes ? 'Vitest exclude' : 'path-skipped lane'} ignores an actual binary prerequisite; a planted selector is rejected`, (t) => {
  const box = scene(t, excludes);
  check(box);
  // Mutate only the isolated copied program; the command and exact same assertions stay fixed.
  const path = excludes ? 'scripts/proof-binaries.mjs' : 'scripts/lanes.mjs';
  const source = readFileSync(join(box.repo,path),'utf8');
  const before = excludes ? "...args.slice(at + 2), '--filesOnly'" : 'selected.flatMap((lane) => lane.commands).flatMap';
  const after = excludes ? "...args.slice(at + 2).filter((arg, i, rest) => arg !== '--exclude' && rest[i - 1] !== '--exclude'), '--filesOnly'" : 'lanes.flatMap((lane) => lane.commands).flatMap';
  assert.ok(source.includes(before), 'the copied selector has the planted seam');
  write(box.repo,path,source.replace(before,after));
  assert.throws(()=>check(box),{code:'ERR_ASSERTION'},'the same selected-run check rejects a selector that includes the real binary consumer');
});
