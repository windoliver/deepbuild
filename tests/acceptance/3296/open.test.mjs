// #3296 AC5 (#3296.7136c045), a file with an open row: one with an INCONCLUSIVE row, or a skip no list names, makes the
// lane INCONCLUSIVE, never PASS, and is run by the next run; but a row a `skips` entry of known-failures.json covers
// doesn't make its file run again (the issue's "What runs"). A file with no kept result and one with a BLOCKED row are
// unrun.test.mjs's.
//
// One scene, four runs of scripts/preflight on one tree. What is open is an INCONCLUSIVE row in the parallel block and in
// an alone group whose other file passed, a skip no list names, and a row that read PASS and then INCONCLUSIVE. Two probes
// stay settled beside them: a listed skip, and the INCONCLUSIVE file's neighbour in its own folder, since an alone group
// runs only its files that must, where the parallel block runs whole. In one run the only open row is a kept one, of a file
// whose job is refused its grant.
//
// The merge base is a planted program that starts every file again; the programs that read an open row PASS are told by the
// lane's state.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { aloneFile, busyTable, dump, nodeFile, parallelFile, refuse, scene, toEnd } from './helpers.mjs';

const AC5 = '#3296.7136c045';
const FILES = {
  [parallelFile('p')]: 'p', [parallelFile('q')]: 'q',
  [aloneFile(0, 'a')]: 'unsure', [aloneFile(0, 'b')]: 'its neighbour', [aloneFile(1, 'a')]: 'skipped', [aloneFile(2, 'a')]: 'listed skip', [nodeFile('n')]: 'n',
};
const fileOf = (name) => Object.keys(FILES).find((file) => FILES[file] === name);

let box;
const runs = {};

before(async () => {
  box = scene({
    files: FILES, commands: ['parallel', 'alone', 'node'],
    skips: [{ id: `${fileOf('listed skip')} › two`, note: 'a listed skip', reason: 'the fixture lists it' }],
  });
  await busyTable(box);
  box.flag('listed skip', 'listed');
  const step = async (name) => {
    const earlier = box.counts(), run = await toEnd(box), counts = box.counts();
    runs[name] = { ...run, started: box.names().filter((probe) => counts[probe] !== earlier[probe]), counts, record: box.record(), kept: box.kept(), shown: dump(box, run) };
  };
  // 1. INCONCLUSIVE rows, and nothing worse.
  box.flag('p', 'INCONCLUSIVE');
  box.flag('unsure', 'INCONCLUSIVE');
  box.flag('skipped', 'skip');
  await step('unsure');
  // 2. p passes now, and q beside it, which passed, doesn't: its last row is the one that counts. The skip runs, and the
  // INCONCLUSIVE group is refused its grant.
  box.unflag('p', 'INCONCLUSIVE');
  box.flag('q', 'INCONCLUSIVE');
  box.unflag('unsure', 'INCONCLUSIVE');
  box.unflag('skipped', 'skip');
  refuse(box, fileOf('unsure'));
  await step('last row');
  // 3. The parallel block passes whole, and the group is refused again: what is left open is its kept row.
  box.unflag('q', 'INCONCLUSIVE');
  await step('kept unsure');
  // 4. Everything is settled.
  refuse(box);
  await step('settled');
}, { timeout: 60 * 60_000 });

/** The lane reads INCONCLUSIVE, in its line, its record and its exit. */
function inconclusive(name, why) {
  const run = runs[name];
  assert.notEqual(run.record?.state, 'PASS', `the lane reads PASS over ${why}\n${run.shown}`);
  assert.equal(run.record?.state, 'INCONCLUSIVE', `the lane reads ${run.record?.state} over ${why}\n${run.shown}`);
  assert.match(run.out, /^INCONCLUSIVE unit\b/m, `the lane's line doesn't read INCONCLUSIVE over ${why}\n${run.shown}`);
  assert.doesNotMatch(run.out, /^PASS unit\b/m, `the lane's line reads PASS over ${why}\n${run.shown}`);
  assert.notEqual(run.code, 0, `the preflight exited 0 over ${why}\n${run.shown}`);
}
const started = (name, expected, why) => assert.deepEqual([...runs[name].started].sort(), [...expected].sort(), `${why}\n${runs[name].shown}`);

test(`${AC5} a file with an INCONCLUSIVE row makes the lane INCONCLUSIVE, and the next run runs it and starts none of the files that ran`, () => {
  inconclusive('unsure', `an INCONCLUSIVE row in ${fileOf('p')} and ${fileOf('unsure')} and an unlisted skip in ${fileOf('skipped')}`);
  // The parallel block runs whole since p must; the alone group's other file doesn't, and unsure is refused its grant.
  started('last row', ['p', 'q', 'skipped'], `${fileOf('p')} and ${fileOf('skipped')} were to run again, with the parallel block whole, and nothing else could start`);
  inconclusive('last row', `${fileOf('q')}, whose last row is INCONCLUSIVE after a PASS`);
  started('kept unsure', ['p', 'q'], `${fileOf('q')}, whose last kept row is INCONCLUSIVE after a PASS, was to run again, with the parallel block whole, and nothing else could start`);
  started('settled', ['unsure'], `${fileOf('unsure')}, with an INCONCLUSIVE kept row, was to run, and no other file`);
  assert.equal(runs.settled.record?.state, 'PASS', `with nothing open the lane reads ${runs.settled.record?.state}\n${runs.settled.shown}`);
  assert.equal(runs.settled.code, 0, `with nothing open the preflight exited ${runs.settled.code}\n${runs.settled.shown}`);
});

test(`${AC5} a kept INCONCLUSIVE row of a file whose job is refused its grant makes the lane INCONCLUSIVE`, () => {
  // Nothing else is open in that run: the other files' rows all ran, or are listed.
  assert.ok(!runs['kept unsure'].started.includes('skipped'), `${fileOf('skipped')}, whose rows all ran in the run before, was started again\n${runs['kept unsure'].shown}`);
  inconclusive('kept unsure', `${fileOf('unsure')}, whose kept row is INCONCLUSIVE and whose job was refused its grant`);
});

test(`${AC5} a file whose skip known-failures.json lists is settled: its row is kept as it read and it isn't run again`, () => {
  const { counts, record } = runs.settled;
  assert.equal(counts['listed skip'], 1, `${fileOf('listed skip')}, whose one open row a skips entry covers, was started ${counts['listed skip']} times in four runs\n${runs.settled.shown}`);
  // As its row reads before any list is applied: INCONCLUSIVE, and never run.
  const row = runs.settled.kept.flatMap(({ tests }) => tests).find(({ id }) => id === `${fileOf('listed skip')} › two`);
  assert.deepEqual({ state: row?.state, skipped: row?.skipped, note: row?.note }, { state: 'INCONCLUSIVE', skipped: true, note: 'a listed skip' }, `the kept row of the listed skip\n${runs.settled.shown}`);
  const read = record.tests.filter(({ id }) => id === `${fileOf('listed skip')} › two`);
  assert.deepEqual(read.map(({ state, skipped }) => ({ state, skipped })), [{ state: 'LISTED', skipped: true }], `the record's row of the listed skip\n${runs.settled.shown}`);
  assert.deepEqual(record.tests.map(({ id }) => id).sort(), box.ids(), `the record of the run in which only ${fileOf('unsure')} ran doesn't hold every test's row once\n${runs.settled.shown}`);
});
