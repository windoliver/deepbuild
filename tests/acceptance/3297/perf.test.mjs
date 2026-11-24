// #3297 AC5 (#3297.17071219): perf's merge-base run starts no job whose kept result of its own tree is whole, and its workload
// line reads INCONCLUSIVE, never PASS, when the two sides read different counts of kept results.
//
// One scene with the checkout's own perf.mjs, three commits, five runs of scripts/preflight. The first commit is the merge
// base: the preflight run on it keeps its results, by its own tree. The second changes a document, so each run on it is
// compared with the first, whose test files are the same; the third changes one test file too:
// 1. `base`: on the merge base.
// 2. `like`: on the change, with every result of the merge base's tree kept.
// 3. `counts`: again, with the merge base's kept line of one alone file taken away. Every other file's stays.
// 4. `none`: again, with none of the merge base's results kept.
// 5. `own tests`: on the third commit, with every result of the merge base's tree kept again. perf compares the checks without
//    the change's own test files with the merge base's (its line says so), in a copy of their own whose tree no run has kept
//    results of.
// Each side's files run in perf's kept copies, under the scene's cache folder, which tells them from the checkout's.
//
// The base's copy isn't a clean checkout of the merge base. As in this repository its target/ is a link, which .gitignore's
// `target/` doesn't cover, and the merge base tracks a file an ignore pattern covers. Its own tree is the merge base's all the
// same: the one a preflight on the merge base kept its results by.
//
// The merge base of this issue is the planted program that runs the base side whole, and that passes unlike sides.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import test, { before } from 'node:test';
import { aloneFile, nodeFile, parallelFile, scene, toEnd } from './helpers.mjs';

const AC5 = '#3297.17071219';
const FILES = { [parallelFile('p')]: 'p', [aloneFile(0, 'a')]: 'a', [aloneFile(1, 'a')]: 'b', [nodeFile('n')]: 'n' };
const COUNT = Object.keys(FILES).length;
const A = aloneFile(0, 'a');
const COPIES = ['base', 'without-tests'];

let box, baseTree, changeTree, ownTree;
const runs = {};

before(async () => {
  box = scene({ files: FILES, perf: true });
  const copy = (side) => (cwd) => cwd.startsWith(join(box.home, '.cache')) && cwd.includes(`/${side}/copy`);
  const step = async (name) => {
    const count = () => Object.fromEntries(COPIES.map((side) => [side, box.names().map((probe) => box.spans(probe, copy(side)).length)]));
    const from = count();
    const run = await toEnd(box);
    const to = count();
    runs[name] = {
      ...run,
      // What perf's copies started, and the unit records the run left: its own tree's and the sides'.
      sides: Object.fromEntries(COPIES.map((side) => [side, box.names().filter((probe, at) => to[side][at] > from[side][at])])),
      compared: (side) => run.out.split('\n').some((line) => line.startsWith(`perf: ${side} copy `)),
      records: box.records().map(({ tree, state, kept }) => ({ tree, state, kept })),
      baseKept: box.kept(baseTree),
    };
  };
  const commit = (message) => {
    box.git('commit', '-qam', message);
    return box.hash();
  };
  baseTree = box.hash();
  await step('base');
  box.put('notes.txt', 'a document, so this tree is another and its test files are the same\n');
  box.git('add', 'notes.txt');
  changeTree = commit('a document');
  await step('like');
  const whole = box.kept(baseTree);
  if (whole.length) box.keep(whole.filter((line) => !line.files.includes(A)), baseTree);
  await step('counts');
  rmSync(box.keptFile(baseTree), { force: true });
  await step('none');
  if (whole.length) box.keep(whole, baseTree);
  box.add(aloneFile(1, 'a'), '// another line\n');
  ownTree = commit('a test file');
  await step('own tests');
}, { timeout: 180 * 60_000 });

/** The perf lane's lines on the workload: the JSON line of the task `preflight`, and its verdicts. */
function workload(run) {
  const lines = run.out.slice(run.out.lastIndexOf('\nRUN perf')).split('\n');
  const json = lines.flatMap((line) => { try { return line.startsWith('{') ? [JSON.parse(line)] : []; } catch { return []; } }).find(({ task }) => task === 'preflight');
  return { json, inconclusive: json?.status === 'INCONCLUSIVE' || lines.some((line) => /^INCONCLUSIVE perf: /.test(line)), passed: json?.status === 'PASS' || lines.some((line) => /^PASS perf\b/.test(line)) };
}
const keptOf = (run, tree) => run.records.find((record) => record.tree === tree)?.kept;
const files = (run) => run.started.filter((name) => box.names().includes(name)).sort();
/** perf compared the sides, and its line on the workload reads INCONCLUSIVE: no line of it, nor its exit, is a pass. */
function unlike(name, why) {
  const run = runs[name], { json, inconclusive, passed } = workload(run);
  assert.ok(!passed, `perf passed unlike sides: ${why}, and its workload line reads ${json?.status}\n${run.shown}`);
  assert.ok(inconclusive, `perf's workload line doesn't read INCONCLUSIVE, where ${why}: ${JSON.stringify(json)}\n${run.shown}`);
  assert.notEqual(run.code, 0, `the preflight exited 0 over unlike sides: ${why}\n${run.shown}`);
}

test(`${AC5} on the merge base itself, whose tree is both sides', perf's merge-base run starts none of the jobs the run just kept`, () => {
  const run = runs.base;
  assert.deepEqual(files(run), box.names().sort(), `the run on the merge base was to start every file\n${run.shown}`);
  assert.ok(run.compared('base'), `perf never ran the merge base\n${run.shown}`);
  assert.deepEqual(run.sides.base, [], `the base side started jobs whose kept results of its own tree are whole: the merge-base run ran these again\n${run.shown}`);
});

test(`${AC5} perf's merge-base run, on a tree whose results are all kept, starts none of its jobs, and the like sides compare`, () => {
  const run = runs.like;
  assert.ok(runs.base.baseKept.length, `the run on the merge base kept nothing\n${runs.base.shown}`);
  assert.ok(run.compared('base'), `perf never compared the change with the merge base\n${run.shown}`);
  assert.deepEqual(run.sides.base, [], `the base side started jobs whose kept results of its own tree are whole: the merge-base run ran these again\n${run.shown}`);
  assert.deepEqual(keptOf(run, changeTree), { read: COUNT, of: COUNT }, `the test files the change's side says it read from kept results\n${run.shown}`);
  // The merge base's side says the same, in the record its checks wrote.
  assert.ok(run.records.some(({ tree, kept }) => tree !== changeTree && kept?.read === COUNT && kept?.of === COUNT), `no record of the base side says it read ${COUNT} of ${COUNT}: ${JSON.stringify(run.records)}\n${run.shown}`);
  const { json, passed } = workload(run);
  assert.equal(json?.status, 'PASS', `the workload line of like sides\n${run.shown}`);
  assert.ok(passed && run.code === 0, `like sides don't pass: the preflight exited ${run.code ?? run.signal}\n${run.shown}`);
});

test(`${AC5} perf's merge-base run starts the one job with no kept result of its own tree, and no other`, () => {
  const run = runs.counts;
  assert.ok(run.compared('base'), `perf never compared the change with the merge base\n${run.shown}`);
  assert.deepEqual(run.sides.base, ['a'], `the base side was to run ${A} alone, whose kept line of its own tree was taken away\n${run.shown}`);
});

for (const [name, read, why] of [
  ['counts', COUNT - 1, `the merge base's tree keeps ${COUNT - 1} of its ${COUNT} files' results, for the base side to read, and the change's side reads all ${COUNT}`],
  ['none', 0, `the merge base's tree keeps no result, so the base side reads none, and the change's side reads all ${COUNT}`],
]) {
  test(`${AC5} the workload line reads INCONCLUSIVE, never PASS, when ${why}`, () => {
    const run = runs[name];
    assert.ok(run.compared('base'), `perf never compared the change with the merge base\n${run.shown}`);
    assert.deepEqual(files(run), [], `the change's side was to read every result\n${run.shown}`);
    assert.ok(run.sides.base.includes('a'), `the base side was to run ${A}, with no kept result of its own tree; it ran ${run.sides.base.join(', ') || 'nothing'}\n${run.shown}`);
    if (name === 'none') assert.deepEqual([...run.sides.base].sort(), box.names().sort(), `the base side, with no kept result, was to run every file\n${run.shown}`);
    unlike(name, why);
    assert.deepEqual(keptOf(run, changeTree), { read: COUNT, of: COUNT }, `the test files the change's side says it read from kept results\n${run.shown}`);
    assert.ok(run.records.some(({ tree, kept }) => tree !== changeTree && kept?.read === read && kept?.of === COUNT), `no record of the base side says it read ${read} of ${COUNT}: ${JSON.stringify(run.records)}\n${run.shown}`);
  });
}

test(`${AC5} the checks without the change's own tests, run whole, never pass against a base side that read its results`, () => {
  const run = runs['own tests'];
  assert.ok(run.compared('base') && run.compared('without-tests'), `perf never compared the checks without the change's own tests with the merge base's\n${run.shown}`);
  assert.deepEqual(run.sides.base, [], `the base side started jobs whose kept results of its own tree are whole: the merge-base run ran these again\n${run.shown}`);
  assert.deepEqual(keptOf(run, ownTree), { read: COUNT, of: COUNT }, `the test files the change's side says it read from kept results\n${run.shown}`);
  // A side that started none of its files either would be like it.
  if (run.sides['without-tests'].length) unlike('own tests', `the checks without the change's own tests ran ${run.sides['without-tests'].join(', ')}, and the base side read every result`);
});
