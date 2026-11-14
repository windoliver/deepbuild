import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, run, sandbox, write } from './helpers.mjs';

const probe = `import assert from 'node:assert/strict';
import { childEnv } from './scripts/proof-runs.mjs';
const extra = { DEEP_BIN_DIR: '/fixture/change/bin' };
assert.equal(childEnv(extra).DEEP_BIN_DIR, extra.DEEP_BIN_DIR, 'per-side DEEP_BIN_DIR survives');
assert.equal(extra.DEEP_BIN_DIR, '/fixture/change/bin', 'extra is not mutated');
`;

test('#1123.cd6b3dd8 childEnv discards a shell binary directory', (t) => {
  const box = sandbox(t);
  const result = run(box, process.execPath, ['--input-type=module', '-e', `
    import { childEnv } from './scripts/proof-runs.mjs';
    console.log(JSON.stringify(childEnv().DEEP_BIN_DIR ?? null));
  `], box.repo, { DEEP_BIN_DIR: '/fixture/shell/bin' });
  assert.equal(result.status, 0, dump(result));
  assert.equal(JSON.parse(result.stdout), null, 'inherited DEEP_BIN_DIR must be discarded before merging extra');
});

test('#1123.cd6b3dd8 childEnv preserves the explicit per-side binary directory', (t) => {
  const box = sandbox(t);
  const result = run(box, process.execPath, ['--input-type=module', '-e', probe], box.repo, { DEEP_BIN_DIR: '/fixture/shell/bin' });
  assert.equal(result.status, 0, dump(result));
});

test('wrong-program proof: deleting DEEP_BIN_DIR after the merge fails the same per-side assertion', (t) => {
  const box = sandbox(t);
  const path = 'scripts/proof-runs.mjs';
  const original = readFileSync(join(box.repo, path), 'utf8');
  assert.ok(original.includes('export function childEnv('), 'childEnv surface exists');
  // Only the disposable copy changes; dependencies and the probe above stay identical.
  write(box.repo, path, original.replace('export function childEnv(', 'function originalChildEnv(') + `
export function childEnv(extra = {}) {
  const environment = { ...originalChildEnv(), ...extra };
  delete environment.DEEP_BIN_DIR;
  return environment;
}
`);
  const result = run(box, process.execPath, ['--input-type=module', '-e', probe], box.repo, { DEEP_BIN_DIR: '/fixture/shell/bin' });
  assert.equal(result.status, 1, dump(result));
  assert.match(result.stderr, /AssertionError \[ERR_ASSERTION\]: per-side DEEP_BIN_DIR survives/, dump(result));
  t.diagnostic('planted delete-after-merge rejected: ' + result.stderr.split('\n').find((line) => line.includes('AssertionError')));
});
