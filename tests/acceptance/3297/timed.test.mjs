// #3297 AC1 (#3297.758dee21), the preflight's own grants: while a tree's results are being filled it holds no timed grant
// except during a timed file's own run; and AC2 (#3297.dab8afb0): every timed file runs under its own timed grant, alone, as
// a job of its own whose kept line names that one file.
//
// One scene, two runs of scripts/preflight on one tree, with the alone block's folders in two shards. Its timed files are
// those lanes.mjs's `timed` list names, wherever the lane lists them: two of the alone block, two of the parallel block,
// which runs its files beside each other, and one of `node --test`. Each runs for some seconds, so a job beside it shows,
// and beside each kind stand untimed files. The first run starts with nothing kept. Before the second, the kept lines of one
// timed file of each kind are taken away: jobs of their own, so it runs those and no file beside them (#3296: no job whose
// kept rows all ran is started). What ran when is read from the probes, which note the time and the table's grants as they
// start and end, and the grants' times from the throttle's log.
//
// The merge base is the planted program of both: it claims timed for the whole run, and runs its timed files in one job,
// and those of the parallel block and `node --test` beside their neighbours. The programs that differ from it in one of these
// are told by the same readings.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { aloneFile, inside, nodeFile, parallelFile, scene, seconds, timedAloneFile, timedNodeFile, timedParallelFile, toEnd } from './helpers.mjs';

const AC1 = '#3297.758dee21';
const AC2 = '#3297.dab8afb0';
const TIMED = {
  [timedAloneFile(0)]: 'alone-1', [timedAloneFile(1)]: 'alone-2',
  [timedParallelFile(0)]: 'parallel-1', [timedParallelFile(1)]: 'parallel-2',
  [timedNodeFile(0)]: 'node-1',
};
const UNTIMED = { [parallelFile('p')]: 'p', [parallelFile('q')]: 'q', [aloneFile(0, 'a')]: 'a', [aloneFile(1, 'a')]: 'b', [nodeFile('n')]: 'n' };
const FILES = { ...TIMED, ...UNTIMED };
// The tests' names go by what a timed file is, never by its path, which is the lists'.
const WHAT = { 'alone-1': 'a timed file of the alone block', 'alone-2': 'another timed file of the alone block', 'parallel-1': 'a timed file of the parallel block', 'parallel-2': 'another timed file of the parallel block', 'node-1': 'a timed file of `node --test`' };

const AWAY = ['alone-1', 'node-1', 'parallel-1'];

let box, run, again, log;

before(async () => {
  box = scene({ files: FILES, env: { DEEP_SHARDS: '2' } });
  for (const name of Object.values(TIMED)) box.flag(name, 'slow', '4000');
  for (const name of Object.values(UNTIMED)) box.flag(name, 'slow', '1500');
  run = await toEnd(box);
  log = { timed: box.timed(), spans: Object.fromEntries(box.names().map((name) => [name, box.spans(name)])) };
  box.keep(run.kept.filter((line) => !AWAY.some((name) => line.files?.includes(box.fileOf(name)))));
  again = await toEnd(box);
}, { timeout: 120 * 60_000 });

const clock = (ms) => new Date(ms).toISOString().slice(11, 23);
const show = ({ id, from, to }) => `timed grant ${id}, held from ${clock(from)} to ${to === null ? 'the run\'s end' : clock(to)} (${seconds((to ?? run.at) - from)})`;
/** A file's run in the first preflight; a file that ran twice or not at all is its own failure. */
function spanOf(name) {
  const spans = log.spans[name];
  assert.equal(spans.length, 1, `${box.fileOf(name)} was started ${spans.length} times, not once\n${run.shown}`);
  assert.ok(spans[0].to !== null, `${box.fileOf(name)} never ended\n${run.shown}`);
  return spans[0];
}

test(`${AC1} while the tree's results are filled, the preflight holds no timed grant while an untimed job runs`, () => {
  const grants = log.timed;
  assert.ok(grants.length, `the throttle's log names no timed grant\n${run.shown}`);
  for (const name of [...Object.values(UNTIMED), 'cargo test']) {
    const span = spanOf(name);
    const over = grants.filter((grant) => inside([span], grant).length);
    assert.deepEqual(over.map(show), [], `the preflight held a timed grant while ${box.fileOf(name)}, which isn't timed, ran from ${clock(span.from)} to ${clock(span.to)}\n${run.shown}`);
  }
});

test(`${AC1} each timed grant the preflight holds while it fills is for one timed file's run, and the last, with no file under it, is the finish's`, () => {
  const grants = log.timed;
  const runs = Object.values(FILES).map((name) => spanOf(name));
  const last = Math.max(...runs.map(({ to }) => to));
  const filling = grants.filter(({ from }) => from < last);
  for (const grant of filling) {
    const under = inside(runs, grant).map(({ name }) => box.fileOf(name));
    assert.equal(under.length, 1, `${show(grant)}, before the last file ended, was held while ${under.length} files ran: ${under.join(', ') || 'none'}\n${run.shown}`);
  }
  assert.equal(filling.length, Object.keys(TIMED).length, `the preflight took ${filling.length} timed grants while it filled ${Object.keys(TIMED).length} timed files\n${run.shown}`);
  assert.equal(grants.length, filling.length + 1, `the preflight took ${grants.length - filling.length} timed grants after its last file ended: the finish takes one\n${run.shown}`);
});

for (const [file, name] of Object.entries(TIMED)) {
  test(`${AC2} ${WHAT[name]} runs alone, under its own timed grant`, () => {
    const span = spanOf(name);
    const others = [...Object.values(FILES), 'cargo test'].filter((other) => other !== name).map((other) => spanOf(other));
    const named = (spans) => spans.map((other) => box.fileOf(other.name));
    assert.deepEqual(named(inside(others, span)), [], `${file}, timed, ran from ${clock(span.from)} to ${clock(span.to)} beside other files\n${run.shown}`);
    const grants = log.timed.filter((grant) => grant.from <= span.from && (grant.to ?? Infinity) >= span.to);
    assert.equal(grants.length, 1, `${file} ran from ${clock(span.from)} to ${clock(span.to)} under ${grants.length} timed grants of the throttle's log\n${run.shown}`);
    assert.deepEqual(named(inside(others, grants[0])), [], `${file}'s timed grant isn't its own: other files ran under ${show(grants[0])}\n${run.shown}`);
    // The table it found as it started: its own grant, and no job on a turn of the pool.
    assert.ok(span.grants?.some(({ class: cls, id }) => cls === 'timed' && id === grants[0].id), `the table ${file} found as it started doesn't hold its timed grant: ${JSON.stringify(span.grants)}\n${run.shown}`);
    assert.deepEqual(span.grants.filter(({ class: cls }) => cls === 'turn'), [], `${file} started beside jobs on turns of the pool\n${run.shown}`);
  });

  test(`${AC2} ${WHAT[name]} is a job of its own, whose kept line names that one file`, () => {
    const lines = run.kept.filter((line) => line.files?.includes(file));
    assert.equal(lines.length, 1, `${lines.length} kept lines name ${file}\n${run.shown}`);
    assert.deepEqual(lines[0].files, [file], `the kept line of ${file} (job ${lines[0].job}) names other files: ${lines[0].files.filter((other) => other !== file).join(', ')}\n${run.shown}`);
    assert.deepEqual(lines[0].tests.map(({ id, state }) => `${state} ${id}`).sort(), [`PASS ${file} › one`, `PASS ${file} › two`], `its rows\n${run.shown}`);
  });
}

test(`${AC2} a timed file with no kept result is run by the next run as its own job, with no other file of its block`, () => {
  assert.deepEqual(again.started.filter((name) => box.names().includes(name)).sort(), AWAY, `the kept lines of ${AWAY.map((name) => box.fileOf(name)).join(', ')} alone were taken away\n${again.shown}`);
  const lines = again.kept.filter((line) => line.files?.some((file) => AWAY.includes(TIMED[file])));
  assert.deepEqual(lines.map((line) => line.files.map((file) => TIMED[file] ?? file).join(', ')).sort(), AWAY, `their kept lines\n${again.shown}`);
  const grants = again.timed.filter((grant) => AWAY.some((name) => inside(again.spans(name), grant).length));
  assert.equal(grants.length, AWAY.length, `the three timed files ran under ${grants.length} timed grants\n${again.shown}`);
  assert.equal(again.code, 0, `the preflight exited ${again.code ?? again.signal}\n${again.shown}`);
});

test(`${AC2} the jobs beside the timed files hold none of them, and the run whose timed files stood alone passes whole`, () => {
  const mixed = run.kept.filter(({ files }) => files?.some((file) => file in TIMED) && files.some((file) => !(file in TIMED)));
  assert.deepEqual(mixed.map(({ job, files }) => `${job}: ${files.join(', ')}`), [], `kept jobs hold timed files beside untimed ones\n${run.shown}`);
  assert.equal(run.code, 0, `the preflight exited ${run.code ?? run.signal}\n${run.shown}`);
  assert.deepEqual(run.record?.tests.map(({ id }) => id).sort(), box.ids(), `the record doesn't hold every test's row once\n${run.shown}`);
  assert.equal(run.record.state, 'PASS', `the unit lane's record reads ${run.record.state}\n${run.shown}`);
});
