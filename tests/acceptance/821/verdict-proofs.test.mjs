// AC2: a change to lean-toolchain or scripts/verdict-proofs.mjs runs the verdict proofs lane in the local preflight.
import assert from 'node:assert/strict';
import test from 'node:test';
import { commit, repo, runReal, stateOf, write } from './helpers.mjs';

const LANE = 'verdict proofs';

test('AC2: a Lean toolchain bump in lean-toolchain runs the verdict proofs lane', (t) => {
  const cwd = repo(t);
  write(cwd, { 'lean-toolchain': 'leanprover/lean4:v4.36.0\n' });
  commit(cwd, 'bump Lean');
  const r = runReal(cwd, [LANE]);
  assert.equal(stateOf(r, LANE), 'RUN', `a lean-toolchain change must run ${LANE}:\n${r.out}`);
  assert.equal(r.status, 0, r.out);
});

test('AC2: a change to scripts/verdict-proofs.mjs runs the verdict proofs lane', (t) => {
  const cwd = repo(t);
  write(cwd, { 'scripts/verdict-proofs.mjs': '// fixture stand-in, edited; never run\n' });
  const r = runReal(cwd, [LANE]);
  assert.equal(stateOf(r, LANE), 'RUN', `a scripts/verdict-proofs.mjs change must run ${LANE}:\n${r.out}`);
  assert.equal(r.status, 0, r.out);
});

test('AC2: the engine and the model still run the verdict proofs lane, and docs/notes.md skips it', (t) => {
  for (const file of ['packages/verdicts/src/x.ts', 'packages/verdicts/model/X.lean']) {
    const cwd = repo(t);
    write(cwd, { [file]: '// edited\n' });
    const r = runReal(cwd, [LANE]);
    assert.equal(stateOf(r, LANE), 'RUN', `a ${file} change must still run ${LANE}:\n${r.out}`);
  }
  const notes = repo(t);
  write(notes, { 'docs/notes.md': 'Notes, edited.\n' });
  const r = runReal(notes, [LANE]);
  assert.equal(stateOf(r, LANE), 'SKIP', `a docs/notes.md change must skip ${LANE}:\n${r.out}`);
});
