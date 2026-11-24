// #3296 AC5 (#3296.7136c045), a file with nothing to go by: one with no kept result makes the lane INCONCLUSIVE, naming how
// many of how many are unrun, never PASS, and one with a BLOCKED row keeps it from passing too; each is run by the next
// run. A file with an INCONCLUSIVE row is open.test.mjs's.
//
// One scene, four runs of scripts/preflight on one tree. A job refused its grant is the planted way a file comes to have no
// result in a run that is otherwise clean, twice; a kept line the test takes away is the planted way it comes to have none
// from before. A BLOCKED row is open beside it for one run.
//
// The merge base is a planted program that starts every file again and names no unrun file; the programs that read such a
// file PASS are told by the lane's state.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { aloneFile, busyTable, dump, nodeFile, parallelFile, refuse, scene, toEnd } from './helpers.mjs';

const AC5 = '#3296.7136c045';
const FILES = { [parallelFile('p')]: 'p', [aloneFile(0, 'a')]: 'missing', [aloneFile(1, 'a')]: 'blocked', [aloneFile(2, 'a')]: 'whole', [nodeFile('n')]: 'n' };
const COUNT = Object.keys(FILES).length;
const fileOf = (name) => Object.keys(FILES).find((file) => FILES[file] === name);

let box;
const runs = {};

before(async () => {
  box = scene({ files: FILES, commands: ['parallel', 'alone', 'node'] });
  await busyTable(box);
  const step = async (name) => {
    const earlier = box.counts(), run = await toEnd(box), counts = box.counts();
    runs[name] = { ...run, started: box.names().filter((probe) => counts[probe] !== earlier[probe]), counts, record: box.record(), shown: dump(box, run) };
  };
  // 1. One file is refused its grant, the other reads BLOCKED.
  refuse(box, fileOf('missing'));
  box.flag('blocked', 'BLOCKED');
  await step('blocked');
  // 2. The BLOCKED one passes, and one file is left with no result.
  box.unflag('blocked', 'BLOCKED');
  await step('missing');
  // 3. It runs.
  refuse(box);
  await step('done');
  // 4. Its line is gone, as if it had never been kept.
  if (box.kept().length) box.keep(box.kept().filter((line) => !line.files.some((file) => FILES[file] === 'whole')));
  await step('taken away');
}, { timeout: 60 * 60_000 });

const started = (name, expected, why) => assert.deepEqual([...runs[name].started].sort(), [...expected].sort(), `${why}\n${runs[name].shown}`);
const nameUnrun = (name) => {
  const run = runs[name];
  const said = `${run.out.slice(run.out.lastIndexOf('RUN unit'))}\n${(run.record?.findings ?? []).map(({ note }) => note).join('\n')}`;
  assert.match(said, new RegExp(`\\b1 of ${COUNT}\\b`), `the lane doesn't name that 1 of its ${COUNT} files, ${fileOf('missing')}, is unrun\n${run.shown}`);
};

test(`${AC5} a file with a BLOCKED row keeps the lane from passing, and the next run runs it`, () => {
  const run = runs.blocked;
  started('blocked', ['p', 'blocked', 'whole', 'n'], `every file but ${fileOf('missing')}, which was refused its grant, was to run`);
  assert.ok(['BLOCKED', 'INCONCLUSIVE'].includes(run.record?.state), `the lane reads ${run.record?.state} over the BLOCKED row of ${fileOf('blocked')} and the unrun ${fileOf('missing')}\n${run.shown}`);
  assert.notEqual(run.code, 0, `the preflight exited 0\n${run.shown}`);
  nameUnrun('blocked');
  started('missing', ['blocked'], `${fileOf('blocked')}, with a BLOCKED kept row, was to run again, and no other file could start`);
});

test(`${AC5} a file with no kept result makes the lane INCONCLUSIVE, named as 1 of ${COUNT} unrun, and the next run runs it`, () => {
  const open = runs.missing, done = runs.done;
  assert.notEqual(open.record?.state, 'PASS', `the lane reads PASS with ${fileOf('missing')} unrun\n${open.shown}`);
  assert.equal(open.record?.state, 'INCONCLUSIVE', `the lane reads ${open.record?.state} with ${fileOf('missing')} unrun\n${open.shown}`);
  assert.match(open.out, /^INCONCLUSIVE unit\b/m, `the lane's line doesn't read INCONCLUSIVE\n${open.shown}`);
  assert.doesNotMatch(open.out, /^PASS unit\b/m, `the lane's line reads PASS\n${open.shown}`);
  assert.notEqual(open.code, 0, `the preflight exited 0 with ${fileOf('missing')} unrun\n${open.shown}`);
  nameUnrun('missing');
  started('done', ['missing'], `${fileOf('missing')}, with no kept result, was to run, and no other file`);
  assert.equal(done.record?.state, 'PASS', `with no file unrun the lane reads ${done.record?.state}\n${done.shown}`);
  assert.equal(done.code, 0, `with no file unrun the preflight exited ${done.code}\n${done.shown}`);
  assert.deepEqual(done.record.tests.map(({ id }) => id).sort(), box.ids(), `the record doesn't hold every test's row once\n${done.shown}`);
});

test(`${AC5} a file whose kept line is taken away has no result and is run by the next run, and no other file is`, () => {
  started('taken away', ['whole'], `${fileOf('whole')}, whose kept line was taken away, was to run, and no other file`);
  assert.equal(runs['taken away'].record?.state, 'PASS', `the lane reads ${runs['taken away'].record?.state}\n${runs['taken away'].shown}`);
});
