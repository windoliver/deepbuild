// Two proofs of one fixed input in the machine's repository, run once for this file and read by each test: the change
// calls for the before lane (on the merge base, the change and a twin touching no Rust), crash and replay, and its
// worktree holds an untracked tagged test. AC1 (no lock change), AC2, AC3 (nothing touches Rust), AC4 and AC5.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after } from 'node:test';
import test from 'node:test';
import { C2, USES, UNTRACKED_TEST, byUse, compiled, git, machineRepo, npmCi, proof, recipes, recordUse, sandbox, sha, show, strings, theBays, useRecords } from './helpers.mjs';

const cleanups = [];
after(() => { for (const cleanup of cleanups) cleanup(); });
let scenario;
const shared = () => (scenario ??= (async () => {
  const box = sandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const fixture = machineRepo(box);
  const first = await proof(box, fixture);
  const second = await proof(box, fixture);
  return { box, fixture, first, second };
})());
const TIMEOUT = { timeout: 1_200_000 };

/** The paths whose bytes differ between what a use's copy held and its recipe, each with why. */
const differences = (expected, files) => Object.keys({ ...expected, ...files }).filter((path) => expected[path] !== files[path]).sort()
  .map((path) => `${path}: ${!(path in files) ? 'missing' : !(path in expected) ? 'not in the recipe' : 'bytes differ'}`);
const empty = (value) => value === undefined || value === null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0);

test('#1118.5a7b1fc3 a second proof of the same tree, with no lock change, runs npm ci 0 times, though every use ran in a bay', TIMEOUT, async () => {
  const { box, fixture, second } = await shared();
  const calls = npmCi(second);
  assert.equal(calls.length, 0, `npm ci ran ${calls.length} times in the second proof of the same tree, with no lock change:\n${calls.map(({ cwd }) => `  in ${cwd}`).join('\n')}\n${show(second)}`);
  byUse(second, fixture.twin);
  theBays(box, second, fixture.twin);
});

test('#1118.dc689388 when replay runs, crash\'s overlay and the before lane\'s base overlays are absent from the bays, and each use\'s recipe is in the record', TIMEOUT, async () => {
  const { box, fixture, first, second } = await shared();
  const expected = recipes(fixture);
  const head = git(fixture.worktree, 'rev-parse', 'HEAD^{tree}').trim();
  const base = git(fixture.worktree, 'rev-parse', `${git(fixture.worktree, 'merge-base', 'HEAD', 'origin/main').trim()}^{tree}`).trim();
  for (const result of [first, second]) {
    const uses = byUse(result, fixture.twin);
    // What replay's verdict engine saw as it loaded, on each side: exactly the merge base and exactly the change, so
    // no file crash laid over the change bay (main's tests/) nor the before lane laid over the base bay (the change's
    // tests/) is left, and no file either deleted is missing.
    for (const use of ['replay-base', 'replay-change'])
      for (const seen of uses[use]) assert.deepEqual(differences(expected[use], seen.files), [], `in ${result.run}, the ${use} use's copy is not exactly its recipe when replay runs`);
    // Every other use held its own recipe exactly as it ran.
    for (const use of USES) for (const seen of uses[use]) assert.deepEqual(differences(expected[use], seen.files), [], `in ${result.run}, the ${use} use's copy is not exactly its recipe`);
    theBays(box, result, fixture.twin);
    // Each use's recipe in the record: a record line per use, binding the tree and what was laid over it.
    const records = useRecords(result);
    for (const use of USES) {
      const own = records.filter((record) => recordUse(record, fixture.twin) === use);
      assert.ok(own.length, `in ${result.run}, no record line names the ${use} use (by its role and use)\n${records.map(({ line }) => line).join('\n')}`);
      const tree = /base$/.test(use) ? base : head;
      for (const record of own) {
        assert.equal(record.tree, tree, `in ${result.run}, the ${use} use's record binds the tree ${record.tree}, not ${tree}: ${record.line}`);
        if (['before-base', 'twin', 'crash'].includes(use)) assert.ok(!empty(record.overlay), `in ${result.run}, the ${use} use's record names no overlay, though its copy has files laid over its tree: ${record.line}`);
        if (/^replay/.test(use)) assert.ok(empty(record.overlay), `in ${result.run}, the ${use} use's record names an overlay (${JSON.stringify(record.overlay)}), though replay runs on its tree alone: ${record.line}`);
      }
    }
  }
});

test('#1118.1f06c2df a second proof of the same tree, with origin/main pinned and a twin, crash overlay and base overlay that touch no Rust, compiles 0 crates in both bays', TIMEOUT, async () => {
  const { box, fixture, first, second } = await shared();
  const uses = byUse(second, fixture.twin);
  for (const use of USES)
    for (const seen of uses[use]) {
      assert.equal(seen.build?.status, 0, `the ${use} use's cargo build failed\n${seen.build?.stderr}`);
      assert.ok(seen.artifacts.length >= 2, `cargo reported ${seen.artifacts.length} artifacts in the ${use} use; the fixture has a lib and a bin`);
      assert.deepEqual(compiled(seen), [], `the second proof of the same tree compiled crates in the ${use} use (cargo's own fresh flags)\n${show(second)}`);
      assert.deepEqual(seen.build.compiling, [], `cargo printed Compiling lines in the ${use} use of the second proof`);
      assert.equal(seen.greet, 'hello', `the ${use} use's binary does not print its tree's word`);
    }
  const bays = theBays(box, second, fixture.twin);
  assert.deepEqual(theBays(box, first, fixture.twin), bays, 'the second proof of the same tree used other bays than the first');
});

test('#1118.4cb77839 an untracked tagged test in the worktree is present in the change bay, runs there, and is named in the record', TIMEOUT, async () => {
  const { box, fixture, first, second } = await shared();
  const bytes = sha(readFileSync(join(fixture.worktree, UNTRACKED_TEST)));
  for (const result of [first, second]) {
    const named = useRecords(result).filter((record) => record.role === 'change' && recordUse(record, fixture.twin) === 'before-change' && strings(record).some((value) => value.includes(UNTRACKED_TEST)));
    assert.ok(named.length, `in ${result.run}, no record of the change's use in the change bay names the untracked tagged test ${UNTRACKED_TEST}\n${show(result)}`);
    const uses = byUse(result, fixture.twin, ['before-change', 'untracked-change']);
    const bays = theBays(box, result, fixture.twin);
    for (const seen of uses['before-change']) assert.equal(seen.files[UNTRACKED_TEST], bytes, `in ${result.run}, the change bay does not hold the untracked test with the worktree's bytes`);
    assert.ok(uses['untracked-change'].every((seen) => seen.cwd === bays.change), `in ${result.run}, the untracked test (${C2}) did not run in the change bay`);
  }
});

test('#1118.e7117f8d proof wall time is a reading: each proof of the same commit prints its own', TIMEOUT, async () => {
  const { first, second } = await shared();
  for (const result of [first, second]) {
    const reading = wallTime(result.stdout);
    assert.ok(reading, `the proof printed no wall-time reading (a line naming its wall time in s or ms)\n${show(result)}`);
    assert.ok(reading.seconds > 0 && reading.seconds <= result.wall + 1, `the wall-time reading ${reading.seconds} s (${JSON.stringify(reading.line)}) is not this run's, which took ${result.wall} s as measured outside`);
  }
});

/** The first stdout line naming the run's wall time, and its value in seconds (ms when the unit or the key says so). */
function wallTime(stdout) {
  for (const line of String(stdout).split('\n')) {
    const at = line.search(/wall/i);
    if (at < 0) continue;
    const rest = line.slice(at);
    const match = rest.match(/^(.*?)(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?)?\b/i);
    if (!match) continue;
    const ms = /ms/i.test(match[3] ?? '') || (!match[3] && /ms/i.test(match[1]));
    return { line, seconds: Number(match[2]) / (ms ? 1000 : 1) };
  }
  return null;
}
