// #1115: a change to the `skips` key of known-failures.json needs a signed approval tag. Its other half, that the rest
// of the file needs none since `affected.mjs --record` rewrote it on main, went with #1872's rule, which #2818 brings:
// every key is guarded. Reached by running this checkout's real
// `node scripts/proof.mjs guard` in scratch repositories, with really signed and really unsigned tags made with a
// throwaway SSH key; the approvers file is named by DEEP_APPROVERS (README: The guard).
import assert from 'node:assert/strict';
import test from 'node:test';
import { baseline, dump, entry, guardRepo, KNOWN, LONG, sandbox, write } from './helpers.mjs';

const listed = entry('tests/fixture-1115/gated.test.ts › the gated test', 'opt-in: a person sets DEEP_1115_FIXTURE=1');
const another = entry('tests/fixture-1115/other.test.ts › the other test', 'opt-in: a person sets DEEP_1115_OTHER=1');
const refusedLines = (run) => run.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:') && line.includes(KNOWN));
const expectRefused = (run, what) => {
  const all = dump(run);
  assert.ok(refusedLines(run).length, `${what} passed the guard\n${all}`);
  assert.notEqual(run.status, 0, all);
};
const expectPassed = (run, what) => {
  const all = dump(run);
  assert.deepEqual(refusedLines(run), [], `${what} failed the guard\n${all}`);
  assert.equal(run.status, 0, all);
  assert.match(run.stdout, /^PASS guard:/m, `the guard printed no PASS\n${all}`);
};

const EDITS = [
  ['an added entry', { skips: [listed] }, baseline({ skips: [listed, another] })],
  ['a removed entry', { skips: [listed, another] }, baseline({ skips: [listed] })],
  ['an entry\'s note changed', { skips: [listed] }, baseline({ skips: [{ ...listed, note: 'opt-in: anything' }] })],
  ['the key added to a file without it', {}, baseline({ skips: [listed] })],
  ['the key removed', { skips: [listed] }, baseline({})],
  ['the file deleted', { skips: [listed] }, null],
];

test('#1115.82b1c824 a change to the skips key with no approval tag fails the guard: an entry added, removed or changed, the key added or removed, the file deleted', LONG, async (t) => {
  for (const [what, before, after] of EDITS) {
    await t.test(what, async (t) => {
      const box = sandbox(t);
      const scene = guardRepo(box, { [KNOWN]: baseline(before) });
      scene.commit({ [KNOWN]: after });
      expectRefused(await scene.guard(), `${what}, with no tag,`);
    });
  }
});

test('#1115.82b1c824 a change to the skips key with an unsigned approval tag fails the guard', LONG, async (t) => {
  const box = sandbox(t);
  const scene = guardRepo(box, { [KNOWN]: baseline({ skips: [listed] }) });
  const commit = scene.commit({ [KNOWN]: baseline({ skips: [listed, another] }) });
  scene.approve(commit, [KNOWN], null);
  expectRefused(await scene.guard(), 'an edit of skips under an unsigned tag');
});

test('#1115.82b1c824 a change to the skips key with a tag signed by a key the approvers file does not list fails the guard', LONG, async (t) => {
  const box = sandbox(t);
  const scene = guardRepo(box, { [KNOWN]: baseline({ skips: [listed] }) });
  const commit = scene.commit({ [KNOWN]: baseline({ skips: [listed, another] }) });
  scene.approve(commit, [KNOWN], 'stranger');
  expectRefused(await scene.guard(), 'an edit of skips under a stranger\'s tag');
});

test('#1115.82b1c824 a change to the skips key under a signed approval tag naming the file passes the guard, by that approved proposal', LONG, async (t) => {
  const box = sandbox(t);
  const scene = guardRepo(box, { [KNOWN]: baseline({ skips: [listed] }) });
  const commit = scene.commit({ [KNOWN]: baseline({ skips: [listed, another] }) });
  scene.approve(commit, [KNOWN]);
  const run = await scene.guard();
  expectPassed(run, 'an edit of skips under a signed tag');
  assert.match(run.stdout, /^PASS guard: .*scripts\/known-failures\.json.*by approved proposal/m, `the guard did not judge the edit by its approval\n${dump(run)}`);
});

test('#1115.82b1c824 a signed approval does not stretch to a commit that also carries a file it does not name', LONG, async (t) => {
  const box = sandbox(t);
  const scene = guardRepo(box, { [KNOWN]: baseline({ skips: [listed] }), 'src/value.mjs': 'export const value = 1;\n' });
  const commit = scene.commit({ [KNOWN]: baseline({ skips: [listed, another] }), 'src/value.mjs': 'export const value = 2;\n' });
  scene.approve(commit, [KNOWN]);
  expectRefused(await scene.guard(), 'an approved skips edit carrying another file');
});

test('#1115.82b1c824 an uncommitted change to the skips key fails the guard', LONG, async (t) => {
  const box = sandbox(t);
  const scene = guardRepo(box, { [KNOWN]: baseline({ skips: [listed] }) });
  write(scene.cwd, { [KNOWN]: baseline({ skips: [listed, another] }) });
  expectRefused(await scene.guard(), 'an uncommitted edit of skips');
});
