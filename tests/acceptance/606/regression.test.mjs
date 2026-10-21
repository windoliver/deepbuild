// Criterion 4 (#606.f6e09fa4): `tests/acceptance/311` passes unchanged. Behavior that must not change, so
// these pass on the base. The base the folder is compared with is the merge base of HEAD and origin/main,
// or DEEP_606_BASE when set. See README.md.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ID = '#606.f6e09fa4';
const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SUITE = 'tests/acceptance/311';

const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
const show = (r) => `exit ${r.status ?? r.signal}\n--- stdout\n${(r.stdout ?? '').slice(-4000)}\n--- stderr\n${(r.stderr ?? '').slice(-2000)}`;

test(`${ID} tests/acceptance/311 is unchanged from the base, committed or not`, () => {
  let base = process.env.DEEP_606_BASE;
  if (!base) {
    const found = run('git', ['merge-base', 'HEAD', 'origin/main']);
    assert.equal(found.status, 0, `no merge base of HEAD and origin/main; set DEEP_606_BASE\n${show(found)}`);
    base = found.stdout.trim();
  }
  // Tracked files against the base, in the working tree; then files added and not yet tracked.
  const changed = run('git', ['diff', '--name-status', base, '--', SUITE]);
  assert.equal(changed.status, 0, show(changed));
  assert.equal(changed.stdout.trim(), '', `${SUITE} differs from ${base}:\n${changed.stdout}`);
  const added = run('git', ['ls-files', '--others', '--exclude-standard', '--', SUITE]);
  assert.equal(added.status, 0, show(added));
  assert.equal(added.stdout.trim(), '', `${SUITE} has files the base doesn't:\n${added.stdout}`);
});

test(`${ID} tests/acceptance/311 passes`, () => {
  // As its README runs it. rust.test.ts builds deep-contracts and a throwaway crate, so allow minutes.
  const result = run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--root', SUITE], { timeout: 20 * 60_000 });
  assert.equal(result.status, 0, `npx vitest run --root ${SUITE} failed:\n${show(result)}`);
  assert.match(result.stdout, /Test Files\s+\d+ passed/, show(result));
  assert.doesNotMatch(result.stdout, /Test Files\s+.*failed/, show(result));
});
