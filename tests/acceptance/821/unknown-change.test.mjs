// AC4: a lane that can't work out the change's paths runs, as today, never skips. A regression guard: it
// passes on the base, and must keep passing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_FILES, commit, git, repo, runReal, scratch, stateOf, write } from './helpers.mjs';

const LANES = ['config eval', 'verdict proofs'];

function bothRun(r, why) {
  for (const lane of LANES) assert.equal(stateOf(r, lane), 'RUN', `${why}, so ${lane} must run:\n${r.out}`);
  assert.equal(r.status, 0, r.out);
}

test('#821.7e0e2d43 AC4: with no origin/main, both path-gated lanes run, even for a docs/notes.md change', (t) => {
  const cwd = repo(t, { origin: false });
  write(cwd, { 'docs/notes.md': 'Notes, edited.\n' });
  commit(cwd);
  bothRun(runReal(cwd, LANES), 'without origin/main the change has no merge base');
});

test('#821.7e0e2d43 AC4: with an origin/main that shares no history with HEAD, both path-gated lanes run', (t) => {
  const cwd = repo(t);
  git(cwd, 'checkout', '-q', '--orphan', 'unrelated');
  git(cwd, 'rm', '-rq', '--cached', '.');
  git(cwd, 'clean', '-fdq');
  write(cwd, { 'docs/other.md': 'Unrelated.\n' });
  git(cwd, 'add', 'docs/other.md');
  git(cwd, 'commit', '-q', '-m', 'unrelated root');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '-f', 'change');
  git(cwd, 'clean', '-fdq');
  write(cwd, { 'docs/notes.md': 'Notes, edited.\n' });
  bothRun(runReal(cwd, LANES), "with no merge base the change can't be worked out");
});

test('#821.7e0e2d43 AC4: in a folder that is not a git repository, both path-gated lanes run', (t) => {
  const cwd = scratch(t);
  write(cwd, BASE_FILES);
  bothRun(runReal(cwd, LANES), "outside a git repository the change can't be worked out");
});
