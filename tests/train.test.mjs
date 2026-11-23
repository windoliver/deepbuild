// A merge train's per-file results and its reading of a record (#3018; docs/parallel-proof.md, section 6a).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fileResults } from '../scripts/affected.mjs';

const TRAIN = fileURLToPath(new URL('../scripts/train.mjs', import.meta.url));
const selection = { tests: ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs'], crates: ['deep', 'deep-hub'] };
const none = { fresh: [], known: [], unsure: [], passed: [] };
const states = (out) => Object.fromEntries(out.files.map(({ file, state }) => [file, state]));

test('a file of a job stopped part way reads INCONCLUSIVE though a test of it passed', () => {
  const out = fileResults(selection, { ...none, passed: ['tests/a.test.mjs › one', 'tests/b.test.mjs › one'] }, false, new Set(['tests/a.test.mjs']));
  assert.equal(states(out)['tests/a.test.mjs'], 'INCONCLUSIVE');
  assert.equal(states(out)['tests/b.test.mjs'], 'PASS');
  assert.equal(states(out)['tests/c.test.mjs'], 'INCONCLUSIVE', 'a file that reported nothing never passes');
});

test("a crate reads by its own cargo ids, not a crate whose name it starts", () => {
  const out = fileResults(selection, { ...none, fresh: [{ id: 'cargo -p deep-hub --lib › store::reads', state: 'FAIL' }], passed: ['cargo -p deep --lib › parses'] }, false);
  assert.equal(states(out)['cargo test -p deep'], 'PASS');
  assert.equal(states(out)['cargo test -p deep-hub'], 'FAIL');
});

test('a crate cargo never ran reads INCONCLUSIVE, one it ran clean with no test PASS', () => {
  assert.equal(states(fileResults(selection, none, false))['cargo test -p deep'], 'INCONCLUSIVE');
  assert.equal(states(fileResults(selection, none, true))['cargo test -p deep'], 'PASS');
});

test("cargo's failure outside any target fails no crate, is listed apart, and leaves no crate passing", () => {
  const out = fileResults(selection, { ...none, fresh: [{ id: 'cargo test', state: 'FAIL' }], passed: ['cargo -p deep --lib › parses'] }, false);
  assert.deepEqual(out.other, [{ id: 'cargo test', state: 'FAIL' }]);
  assert.equal(states(out)['cargo test -p deep'], 'INCONCLUSIVE');
  assert.equal(states(out)['cargo test -p deep-hub'], 'INCONCLUSIVE');
});

test('a failure that names no selected file is listed apart, with its state', () => {
  const out = fileResults(selection, { ...none, fresh: [{ id: 'npm run build --workspaces', state: 'FAIL' }, { id: 'tests/a.test.mjs › one', state: 'FAIL' }], unsure: [{ id: 'vitest report', state: 'INCONCLUSIVE' }] }, false);
  assert.deepEqual(out.other, [{ id: 'npm run build --workspaces', state: 'FAIL' }, { id: 'vitest report', state: 'INCONCLUSIVE' }]);
  assert.equal(states(out)['tests/a.test.mjs'], 'FAIL');
});

// A record --read reads, from a file of its own. Each case here is refused before origin is read, by its `INCONCLUSIVE
// train:` line; one read against origin would print a line for each PR instead.
function readRecord(record) {
  const dir = mkdtempSync(join(tmpdir(), 'train-test-'));
  try {
    writeFileSync(join(dir, 'record.json'), JSON.stringify(record));
    return spawnSync(process.execPath, [TRAIN, '--read', join(dir, 'record.json')], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('--read of a record that names no PR reads INCONCLUSIVE, never a silent pass', () => {
  const run = readRecord({ main: '0'.repeat(40), prs: [], tree: '1'.repeat(40), state: 'PASS', files: [{ file: 'tests/a.test.mjs', state: 'PASS', prs: [] }] });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout, /^INCONCLUSIVE train: /m);
});

test('--read of a green record that names no file reads INCONCLUSIVE, not PASS', () => {
  const run = readRecord({ main: '0'.repeat(40), prs: [{ number: 1, head: '2'.repeat(40) }], tree: '1'.repeat(40), state: 'PASS', files: [] });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout, /^INCONCLUSIVE train: /m);
  assert.doesNotMatch(run.stdout, /^PASS /m);
});
