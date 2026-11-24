// #3296 AC2 (#3296.4125e574): a job that was cut, killed, refused a grant or ended with an unhandled error counts for
// nothing on the next run, though each left rows that read PASS behind it; and neither does a kept line that doesn't
// parse.
//
// One scene, three runs of scripts/preflight on one tree. In the first, eight jobs end badly, each after a test of theirs
// passed: in the alone block, a runner killed outright, a report torn in a line, one whose end never landed (as on a full
// disk), an error no test caught and a job refused its grant; and the parallel block's unhandled error, cargo test killed
// and node --test killed, which the unit lane runs itself. One alone group and the timed block end whole. In the second run
// nothing is wrong but two refusals, the alone group's again and node --test's, and in the third nothing is. Between the
// first and the second, one good group's kept line is cut in half, with no end of line, as a run killed in a write would
// leave it.
//
// The merge base is a planted program that keeps nothing: it starts the jobs that ended whole again. The programs that
// count a bad job are told by its count: it is started once, not twice.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import test, { before } from 'node:test';
import { aloneFile, busyTable, dump, nodeFile, parallelFile, refusals, refuse, scene, timedFile, toEnd } from './helpers.mjs';

const AC2 = '#3296.4125e574';
const REFUSED = aloneFile(4, 'a');
const FILES = {
  [parallelFile('p')]: 'p', [parallelFile('q')]: 'q',
  [aloneFile(0, 'a')]: 'killed', [aloneFile(0, 'b')]: 'beside the killed', [aloneFile(1, 'a')]: 'torn', [aloneFile(2, 'a')]: 'unended', [aloneFile(3, 'a')]: 'unhandled',
  [REFUSED]: 'refused', [aloneFile(5, 'a')]: 'whole', [aloneFile(6, 'a')]: 'halved', [timedFile()]: 't', [nodeFile('n')]: 'n',
};
const fileOf = (name) => Object.keys(FILES).find((file) => FILES[file] === name) ?? name;
const BAD = { p: 'unhandled', killed: 'kill', torn: 'tear', unended: 'full', unhandled: 'unhandled', n: 'kill', cargo: 'kill' };

let box;
const runs = [];
let halved;

before(async () => {
  box = scene({ files: FILES });
  for (const [name, what] of Object.entries(BAD)) box.flag(name, what);
  refuse(box, REFUSED);
  await busyTable(box);
  const step = async () => {
    const earlier = refusals(box), run = await toEnd(box);
    runs.push({ ...run, counts: box.counts(), record: box.record(), refusals: refusals(box) - earlier, shown: dump(box, run) });
  };
  await step();
  // The good group's line, half of it, at the end of the file and without its end of line.
  try {
    const lines = readFileSync(box.keptFile(), 'utf8').split('\n').filter(Boolean);
    const at = lines.findIndex((line) => line.includes(aloneFile(6, 'a')));
    halved = at >= 0;
    const [line] = halved ? lines.splice(at, 1) : [''];
    writeFileSync(box.keptFile(), lines.map((other) => `${other}\n`).join(''), { mode: 0o600 });
    appendFileSync(box.keptFile(), line.slice(0, line.length / 2));
  } catch {
    halved = false;
  }
  for (const [name, what] of Object.entries(BAD)) box.unflag(name, what);
  // node --test's command names its files by their pattern, or one by one.
  refuse(box, REFUSED, 'tests/!(*.live)', nodeFile('n'));
  await step();
  refuse(box);
  await step();
}, { timeout: 60 * 60_000 });

/** That the first run ended whole, and kept, the jobs that did, so what it left out was the bad jobs' doing. */
function control() {
  const [first, second] = runs;
  for (const name of ['whole', 't']) {
    assert.equal(first.counts[name], 1, `${fileOf(name)} was started ${first.counts[name]} times by the first run\n${first.shown}`);
    assert.equal(second.counts[name], 1, `${fileOf(name)}, whose job ended whole in the first run, was started again by the second\n${second.shown}`);
  }
}
/** That the job's files were started again by the next run that could, the second: what the first left counted for nothing. */
function again(what, names, next = runs[1], from = runs[0]) {
  for (const name of names) {
    assert.ok(runs[0].counts[name] <= 1, `${fileOf(name)} was started ${runs[0].counts[name]} times by the first run\n${runs[0].shown}`);
    assert.equal(next.counts[name] - from.counts[name], 1, `the next run started ${fileOf(name)} ${next.counts[name] - from.counts[name]} times: ${what}, and it counted\n${next.shown}`);
  }
}

test(`${AC2} a job whose runner was killed counts for nothing on the next run, in the alone block, in cargo test and in node --test`, () => {
  const [first] = runs;
  assert.equal(first.counts.killed, 1, `the killed job never started\n${first.shown}`);
  control();
  again('its runner was killed', ['killed', 'beside the killed', 'cargo test']);
  // The second run refused node --test its grant, so the third is the next that could start it.
  assert.equal(first.counts.n, 1, `${fileOf('n')} never started\n${first.shown}`);
  again('its runner was killed, and it was then refused its grant', ['n'], runs[2]);
});

test(`${AC2} a job whose report was cut, in a line or of its end, counts for nothing on the next run`, () => {
  control();
  again('its report was torn', ['torn']);
  again("its report's end never landed", ['unended']);
});

test(`${AC2} a job that ended with an unhandled error counts for nothing on the next run, in the alone block and in the parallel block`, () => {
  control();
  again('it ended with an unhandled error', ['unhandled', 'p', 'q']);
});

test(`${AC2} a job that was refused its grant counts for nothing on the next runs`, () => {
  const [first, second, third] = runs;
  control();
  assert.equal(first.refusals, 1, `the throttle refused ${first.refusals} jobs of the first run, not the one\n${first.shown}`);
  for (const run of [first, second]) assert.equal(run.counts.refused, 0, `${REFUSED} was started, so nothing refused it\n${run.shown}`);
  assert.equal(second.counts.n, first.counts.n, `${fileOf('n')} was started, so nothing refused it\n${second.shown}`);
  again('it was refused its grant', ['refused', 'n'], third, second);
  assert.equal(second.refusals, 2, `the throttle refused ${second.refusals} jobs of the second run, not the two\n${second.shown}`);
});

test(`${AC2} a kept line that doesn't parse is no result, and the line kept after it is whole`, () => {
  const [first, second, third] = runs;
  assert.ok(halved, `the first run kept no line for the good group\n${first.shown}`);
  assert.equal(second.counts.halved, 2, `the second run started ${second.counts.halved - 1} times the job whose line doesn't parse\n${second.shown}`);
  control();
  // Every job the second run ended whole, the first of which kept its line after the half one.
  const lost = box.names().filter((name) => !['refused', 'n'].includes(name) && third.counts[name] !== second.counts[name]);
  assert.deepEqual(lost, [], `jobs that ended whole in the second run were started again by the third, their kept rows lost: ${lost.map(fileOf).join(', ')}\n${third.shown}`);
});

test(`${AC2} the third run passes on the rows of the jobs that ended whole, each test once, and none of a bad job's`, () => {
  const [, second, third] = runs;
  const fresh = box.names().filter((name) => third.counts[name] !== second.counts[name]);
  assert.deepEqual(fresh, ['refused', 'n'], `the third run started ${fresh.map(fileOf).join(', ')}, where only the refused jobs were unrun\n${third.shown}`);
  assert.deepEqual((third.record?.tests ?? []).map(({ id, state }) => `${state} ${id}`).sort(), box.ids().map((id) => `PASS ${id}`).sort(), `the third run's record isn't every test's row, once and PASS\n${third.shown}`);
  assert.equal(third.record.state, 'PASS', `the third run's lane reads ${third.record.state}\n${third.shown}`);
  assert.equal(third.code, 0, `the third run exited ${third.code}\n${third.shown}`);
});
