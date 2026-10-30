// AC1: a change that adds or edits an AGENTS.md or CLAUDE.md below the root runs the config eval lane in the
// local preflight; a change to docs/notes.md still skips it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { commit, repo, runReal, stateOf, write } from './helpers.mjs';

const LANE = 'config eval';

test('#821.c3c2e437 AC1: a committed new crates/deep-app/AGENTS.md runs the config eval lane', (t) => {
  const cwd = repo(t);
  write(cwd, { 'crates/deep-app/AGENTS.md': '# deep-app rules\n' });
  commit(cwd, 'add nested instructions');
  const r = runReal(cwd, [LANE]);
  assert.equal(stateOf(r, LANE), 'RUN', `a change adding crates/deep-app/AGENTS.md must run ${LANE}:\n${r.out}`);
  assert.equal(r.status, 0, r.out);
});

test('#821.c3c2e437 AC1: an uncommitted new crates/deep-app/AGENTS.md runs the config eval lane', (t) => {
  const cwd = repo(t);
  write(cwd, { 'crates/deep-app/AGENTS.md': '# deep-app rules\n' });
  const r = runReal(cwd, [LANE]);
  assert.equal(stateOf(r, LANE), 'RUN', `an untracked crates/deep-app/AGENTS.md must run ${LANE}:\n${r.out}`);
  assert.equal(r.status, 0, r.out);
});

test('#821.c3c2e437 AC1: an edit to a nested packages/cli/CLAUDE.md runs the config eval lane', (t) => {
  const cwd = repo(t);
  write(cwd, { 'packages/cli/CLAUDE.md': '# CLI rules\n\nA new rule.\n' });
  const r = runReal(cwd, [LANE]);
  assert.equal(stateOf(r, LANE), 'RUN', `an edit to packages/cli/CLAUDE.md must run ${LANE}:\n${r.out}`);
  assert.equal(r.status, 0, r.out);
});

test('#821.c3c2e437 AC1: a change to docs/notes.md alone still skips the config eval lane, and the root AGENTS.md still runs it', (t) => {
  const notes = repo(t);
  write(notes, { 'docs/notes.md': 'Notes, edited.\n' });
  commit(notes);
  const skipped = runReal(notes, [LANE]);
  assert.equal(stateOf(skipped, LANE), 'SKIP', `a docs/notes.md change must skip ${LANE}:\n${skipped.out}`);
  assert.equal(skipped.status, 0, skipped.out);

  const rootRules = repo(t);
  write(rootRules, { 'AGENTS.md': '# Root rules\n\nA new rule.\n' });
  const ran = runReal(rootRules, [LANE]);
  assert.equal(stateOf(ran, LANE), 'RUN', `a root AGENTS.md change must still run ${LANE}:\n${ran.out}`);
});
