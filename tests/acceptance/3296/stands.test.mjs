// #3296 AC3 (#3296.a6124068): a kept FAIL or INVALID stands at its key: the next run doesn't start the file, and the lane
// doesn't pass after a later PASS.
//
// One scene, four runs of scripts/preflight on one tree. In the first a test of every kind of job fails once, and one
// reads INVALID; each would pass if it were run again. The second run must run only what the first left open. The parallel
// block is the one job it starts whole, so the failing file there may get a real later PASS. Then the later PASS is planted
// on the kept lines, as a program that ran the file again would have kept it: after every FAIL (the third run), and with
// every other row PASS, first one FAIL and then one INVALID alone.
//
// The merge base is the planted program that runs a failed file again, and it passes then. The program that lets the last
// result win is told by the third run and the two after it.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { aloneFile, dump, nameOf, nodeFile, parallelFile, scene, timedFile, toEnd } from './helpers.mjs';

const AC3 = '#3296.a6124068';
const FILES = {
  [parallelFile('p')]: 'p', [parallelFile('q')]: 'q',
  [aloneFile(0, 'a')]: 'fails', [aloneFile(0, 'b')]: 'open beside it', [aloneFile(1, 'a')]: 'fails too', [aloneFile(2, 'a')]: 'invalid', [aloneFile(3, 'a')]: 'whole',
  [timedFile()]: 't', [nodeFile('n')]: 'n',
};
// What each reads in the first run.
const FIRST = { p: 'fail', fails: 'fail', 'fails too': 'fail', invalid: 'INVALID', t: 'fail', n: 'fail', cargo: 'fail', q: 'INCONCLUSIVE', 'open beside it': 'INCONCLUSIVE' };
const STANDS = { p: 'FAIL', fails: 'FAIL', 'fails too': 'FAIL', invalid: 'INVALID', t: 'FAIL', n: 'FAIL', 'cargo test': 'FAIL' };
const fileOf = (name) => Object.keys(FILES).find((file) => FILES[file] === name) ?? name;

let box;
const runs = {};
let planted = false;

before(async () => {
  box = scene({ files: FILES });
  const step = async (name) => {
    const earlier = box.counts(), run = await toEnd(box), counts = box.counts();
    runs[name] = { ...run, started: box.names().filter((probe) => counts[probe] !== earlier[probe]), counts, record: box.record(), kept: box.kept(), shown: dump(box, run) };
  };
  for (const [name, what] of Object.entries(FIRST)) box.flag(name, what);
  await step('first');
  for (const [name, what] of Object.entries(FIRST)) box.unflag(name, what);
  await step('second');
  const kept = box.kept();
  planted = kept.length > 0;
  if (!planted) return;
  const passing = (line) => ({ ...line, tests: line.tests.map(({ id }) => ({ id, state: 'PASS' })) });
  const ofName = (name) => (line) => line.tests.some(({ id }) => nameOf(box, id) === name);
  // Every line again, as a later PASS.
  box.keep([...kept, ...kept.map(passing)]);
  await step('later PASS');
  // Every row PASS but one test's FAIL, and a PASS of that after it; then the same with the one INVALID.
  for (const name of ['fails too', 'invalid']) {
    box.keep([...kept.map((line) => (ofName(name)(line) ? line : passing(line))), ...kept.filter(ofName(name)).map(passing)]);
    await step(`only ${name}`);
  }
}, { timeout: 60 * 60_000 });

/** The states a run's record holds of a probe's test `two`, or of cargo test's. */
const read = (run, name) => (run.record?.tests ?? []).filter(({ id }) => nameOf(box, id) === name && /two$/.test(id)).map(({ state }) => state);

test(`${AC3} the next run doesn't start a file whose kept row reads FAIL or INVALID, whichever job ran it, and starts the open file beside it`, () => {
  const { first, second } = runs;
  for (const name of box.names()) assert.equal(first.counts[name], 1, `${fileOf(name)} was started ${first.counts[name]} times by the first run\n${first.shown}`);
  // p is the parallel block's, which runs whole since q must.
  const standing = Object.keys(STANDS).filter((name) => name !== 'p' && second.started.includes(name));
  assert.deepEqual(standing, [], `files with a kept FAIL or INVALID were run again: ${standing.map(fileOf).join(', ')}\n${second.shown}`);
  assert.ok(second.started.includes('q') && second.started.includes('open beside it'), `${fileOf('q')} and ${fileOf('open beside it')}, with an INCONCLUSIVE kept row, weren't both run again: ${second.started.map(fileOf).join(', ')}\n${second.shown}`);
  assert.ok(!second.started.includes('whole'), `${fileOf('whole')}, whose kept rows all ran, was run again\n${second.shown}`);
});

test(`${AC3} the lane doesn't pass on the run after, each failed test reads as it did, and the rows are each there once`, () => {
  for (const run of [runs.first, runs.second]) {
    assert.equal(run.record?.state, 'FAIL', `the lane reads ${run.record?.state}\n${run.shown}`);
    assert.notEqual(run.code, 0, `the preflight exited 0\n${run.shown}`);
    for (const [name, state] of Object.entries(STANDS)) assert.deepEqual(read(run, name), [state], `the record's row of ${fileOf(name)}\n${run.shown}`);
  }
  assert.deepEqual(runs.second.record.tests.map(({ id }) => id).sort(), box.ids(), `the second run's record doesn't hold every test's row once\n${runs.second.shown}`);
  assert.ok(!runs.second.started.includes('fails'), `${fileOf('fails')} was run again\n${runs.second.shown}`);
});

test(`${AC3} with a PASS kept after it, a FAIL stands: nothing is started, the row reads FAIL and the lane doesn't pass`, () => {
  assert.ok(planted, `the runs kept no line, so there is none to plant a later PASS after\n${runs.second.shown}`);
  const run = runs['later PASS'];
  assert.deepEqual(run.started, [], `a run on kept results that all ran started ${run.started.map(fileOf).join(', ')}\n${run.shown}`);
  assert.equal(run.record?.state, 'FAIL', `with a PASS kept after each FAIL, the lane reads ${run.record?.state}\n${run.shown}`);
  for (const [name, state] of Object.entries(STANDS)) assert.deepEqual(read(run, name), [state], `with a PASS kept after it, the record's row of ${fileOf(name)}\n${run.shown}`);
  const only = runs['only fails too'];
  assert.deepEqual(only.started, [], `a run on kept results that all ran started ${only.started.map(fileOf).join(', ')}\n${only.shown}`);
  assert.equal(only.record?.state, 'FAIL', `over one FAIL with a PASS kept after it, the lane reads ${only.record?.state}\n${only.shown}`);
  assert.deepEqual(read(only, 'fails too'), ['FAIL'], `with a PASS kept after it, the record's row of ${fileOf('fails too')}\n${only.shown}`);
  assert.notEqual(only.code, 0, `the preflight exited 0\n${only.shown}`);
});

test(`${AC3} with a PASS kept after it, an INVALID stands: nothing is started, the row reads INVALID and the lane doesn't pass`, () => {
  assert.ok(planted, `the runs kept no line, so there is none to plant a later PASS after\n${runs.second.shown}`);
  const only = runs['only invalid'];
  assert.deepEqual(only.started, [], `a run on kept results that all ran started ${only.started.map(fileOf).join(', ')}\n${only.shown}`);
  assert.equal(only.record?.state, 'INVALID', `over one INVALID with a PASS kept after it, the lane reads ${only.record?.state}\n${only.shown}`);
  assert.deepEqual(read(only, 'invalid'), ['INVALID'], `with a PASS kept after it, the record's row of ${fileOf('invalid')}\n${only.shown}`);
  assert.notEqual(only.code, 0, `the preflight exited 0\n${only.shown}`);
});
