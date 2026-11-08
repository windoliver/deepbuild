// Criterion 3: a planted change whose text holds a studied name fails the public-text lane without printing the list. A
// twin with a common word passes. Both names are invented; their salted hashes are planted in the fixture's list.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commit, fakeGh, laneName, makeFixture, openIssues, plainHash, plantStudied, runLanes, sandboxEnv, verdicts, writeRepoFile } from './helpers.mjs';

// The studied name the change holds, and a second listed name it doesn't.
const STUDIED = 'Zorblax';
const OTHER = 'Quindleplex';
const note = (word) => [
  '# Panel notes (#1329 fixture)',
  '',
  `The review panel keeps its toolbar on the left, as ${word} does, and folds the history into one row.`,
  '',
].join('\n');

// The public-text lane alone on a change (one commit past origin/main) adding panel-notes-1329.md with `text`.
function publicRun(t, text) {
  const { sandbox, repo } = makeFixture(t);
  const list = plantStudied(repo, [STUDIED, OTHER]);
  commit(repo, 'The base', { base: true });
  writeRepoFile(repo, 'panel-notes-1329.md', text);
  commit(repo, 'Notes on the review panel');
  fakeGh(sandbox, openIssues());
  const run = runLanes(repo, sandboxEnv(sandbox), ['public']);
  return { run, name: laneName(run, 'public'), list };
}

test('#1329.c6aca305 criterion 3: a change whose text holds the studied name Zorblax fails the public-text lane, and its output holds no other listed name, no listed hash and no salt-free hash', (t) => {
  const { run, name, list } = publicRun(t, note(STUDIED));
  // A lane that scans nothing, misses a capitalized name, or hashes without the salt passes here.
  assert.deepEqual(verdicts(run, name), ['FAIL'], `the public-text lane's verdict is FAIL:\n${run.output}`);
  assert.notEqual(run.status, 0, `runLanes returned 0:\n${run.output}`);
  // Without printing the list: a lane that prints the names it checked, or the hashes, fails here.
  assert.ok(!new RegExp(OTHER, 'i').test(run.output), `the output prints ${OTHER}, a listed name the change doesn't hold:\n${run.output}`);
  for (const hash of list.hashes) assert.ok(!run.output.includes(hash), `the output prints the listed hash ${hash}:\n${run.output}`);
  for (const plain of [STUDIED, OTHER].map(plainHash)) assert.ok(!run.output.includes(plain), `the output prints a salt-free hash of a listed name:\n${run.output}`);
});

test('#1329.c6aca305 criterion 3, twin: the same change with the common word "window" in place of Zorblax passes the public-text lane', (t) => {
  const { run, name } = publicRun(t, note('window'));
  // A lane that fails every change, or flags capitalized or unknown words rather than listed names, fails here.
  assert.deepEqual(verdicts(run, name), ['PASS'], `the public-text lane's verdict on the twin is PASS:\n${run.output}`);
  assert.equal(run.status, 0, `runLanes didn't return 0:\n${run.output}`);
});
