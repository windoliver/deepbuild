// #1115: a change to the `skips` key of known-failures.json needs a signed approval tag, and the rest of the file
// doesn't, since `affected.mjs --record` rewrites it on main. Reached by running this checkout's real
// `node scripts/proof.mjs guard` in scratch repositories, with really signed and really unsigned tags made with a
// throwaway SSH key; the approvers file is named by DEEP_APPROVERS (README: The guard).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { affected, baseline, dump, entry, failIds, guardRepo, idOf, KNOWN, LONG, nodeFile, sandbox, tree, write } from './helpers.mjs';

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

/**
 * main and the change each record a failure, so merging main conflicts in known-failures.json; `resolved` is what the
 * merge commit holds there. The guard skips a file git couldn't merge in its ordinary walk over a commit's files.
 */
function conflicted(box, resolved) {
  const scene = guardRepo(box, { [KNOWN]: baseline({ skips: [listed] }) });
  const onMain = { 'a › one': 'fails on main' }, onChange = { 'b › two': 'fails on main' };
  scene.git('checkout', '-q', 'main');
  scene.commit({ [KNOWN]: baseline({ failures: onMain, skips: [listed] }) });
  scene.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  scene.git('checkout', '-q', 'change');
  scene.commit({ [KNOWN]: baseline({ failures: onChange, skips: [listed] }) });
  assert.throws(() => scene.git('merge', '-q', '--no-edit', 'main'), undefined, 'merging main did not conflict, so this scene shows nothing');
  write(scene.cwd, { [KNOWN]: baseline({ failures: { ...onMain, ...onChange }, ...resolved }) });
  scene.git('add', '-A');
  scene.git('commit', '-qm', 'Merge main\n\nPart of #9115');
  return scene;
}

test('#1115.82b1c824 a merge that resolves a conflict in known-failures.json by editing skips fails the guard; one that keeps skips passes', LONG, async (t) => {
  await t.test('the resolution keeps skips', async (t) => {
    expectPassed(await conflicted(sandbox(t), { skips: [listed] }).guard(), 'a merge keeping skips');
  });
  await t.test('the resolution adds an entry', async (t) => {
    expectRefused(await conflicted(sandbox(t), { skips: [listed, another] }).guard(), 'a merge editing skips in its conflict');
  });
});

// Passes on the base, whose guard reads the file not at all. Its wrong programs are a rule on the whole file, and a rule
// by lines: --record rewrites `skips` as JSON.stringify lays it out, so the bytes move though the key's value doesn't.
test('#1115.82b1c824 an affected.mjs --record rewrite of the other keys passes the guard with no tag', LONG, async (t) => {
  const box = sandbox(t);
  const file = 'tests/fixture-1115/record.test.mjs';
  const fixture = tree(box, { [file]: nodeFile("test('the recorded failure', () => { assert.equal(1, 2); });") }, { skips: [listed] });
  // By hand, `skips` sits on one line, so the rewrite has to touch its lines.
  const known = join(fixture.cwd, KNOWN);
  const { skips, ...rest } = JSON.parse(readFileSync(known, 'utf8'));
  const before = `${JSON.stringify(rest, null, 2).replace(/\n}$/, `,\n  "skips": ${JSON.stringify(skips)}\n}`)}\n`;
  write(fixture.cwd, { [KNOWN]: before });

  const recorded = await affected(box, fixture, ['--record', file]);
  const all = dump(recorded);
  const rewrite = readFileSync(known, 'utf8');
  const id = idOf(file, 'the recorded failure');
  assert.deepEqual(failIds(recorded.stdout), [id], `--record did not see the failure\n${all}`);
  assert.ok(JSON.parse(rewrite).failures[id], `--record did not write the failure into ${KNOWN}\n${all}`);
  assert.deepEqual(JSON.parse(rewrite).skips, skips, `--record changed the skips key's value\n${all}`);

  // The rewrite's real bytes, on the guard's own scene.
  const scene = guardRepo(box, { [KNOWN]: before });
  scene.commit({ [KNOWN]: rewrite });
  expectPassed(await scene.guard(), 'a --record rewrite of the other keys');
});
