// #3296 AC1 (#3296.87081be7) and AC6 (#3296.72441260): a preflight stopped part way keeps the jobs that ended, the next
// run on that clean tree starts none of them again, and a stop leaves nothing running and no grant held.
//
// One scene, five runs of scripts/preflight on one tree. Three are stopped, by SIGINT, SIGTERM and SIGHUP sent to the
// process scripts/preflight becomes, each while another job is part way: the parallel block, an alone group and
// node --test. The part-way job holds a build it waits for and a child in a process group of its own that ignores every
// signal it can. The fourth run goes to its end, and the fifth has nothing left to run.
//
// The merge base is the planted program of both criteria that forwards no signal and starts every job again: its stopped
// preflight dies by itself, its jobs go on, and its next run starts them all. What it leaves running is stopped here by
// PID and start time after it was read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { constants, cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import test, { before } from 'node:test';
import { aloneFile, dump, nameOf, nodeFile, parallelFile, scene, timedFile, toEnd, until } from './helpers.mjs';

const AC1 = '#3296.87081be7';
const AC6 = '#3296.72441260';
// deadline: how long a run may take to reach the job it is held in, on a machine at many times its cores' load.
const REACH = 900_000;

const FILES = {
  [parallelFile('p')]: 'p', [parallelFile('q')]: 'q',
  [aloneFile(0, 'a')]: 'a', [aloneFile(0, 'b')]: 'b', [aloneFile(1, 'a')]: 'c', [aloneFile(2, 'a')]: 'h', [aloneFile(3, 'a')]: 'd',
  [timedFile()]: 't', [nodeFile('n')]: 'n',
};
// Each stopped run: the probe it is stopped in, and the signal.
const STOPS = [['p', 'SIGINT', 'the parallel block'], ['h', 'SIGTERM', 'an alone group'], ['n', 'SIGHUP', 'node --test']];

let box;
const stops = new Map();
let end, again;

/** One run, stopped by `signal` while probe `held` is part way. */
async function stopped(held, signal) {
  const from = box.counts();
  box.flag(held, 'hold');
  const run = box.preflight();
  const mine = () => box.notes().filter((note) => note.name === held && ['build', 'apart'].includes(note.event));
  const earlier = mine().length;
  const reached = await until(() => mine().length >= earlier + 2 || !run.running(), REACH) && mine().length >= earlier + 2;
  // The jobs that ended before this one started: the lane's jobs run one after another with DEEP_SHARDS=1.
  const counts = box.counts();
  const ended = box.names().filter((name) => name !== held && counts[name] > from[name] && !sameJob(name, held));
  // A job's line is written as the job ends; the base writes none, so this is only a wait for a slow machine.
  // deadline: 10 s for the lines of jobs that have already ended.
  await until(() => ended.every((name) => box.rowsOf(name).length), 10_000);
  run.look();
  const running = run.alive();
  const kept = box.kept();
  const at = Date.now();
  if (run.running()) process.kill(run.child.pid, signal);
  // deadline: four times the design's 30 s, after which the stop has failed whatever the load.
  const exited = await until(() => !run.running(), 120_000);
  const took = Date.now() - at;
  // A process the stop ended a moment ago may not be gone from the listing yet, and the folder watchers a run leaves
  // end themselves once their parent has.
  // deadline: 30 s for those.
  await until(() => run.alive().length === 0, 30_000);
  const left = run.alive();
  const grants = box.grants();
  const ask = spawnSync(process.execPath, [join(box.tree, 'scripts/throttle.mjs'), 'timed', '--wait', '0', '--', process.execPath, '-e', '0'], { cwd: box.dir, env: box.env, encoding: 'utf8' });
  run.stop();
  box.unflag(held, 'hold');
  stops.set(held, {
    signal, reached, ended, running, left, grants, ask, exited, took, counts: box.counts(), kept,
    exit: exited ? await run.exited : null, noted: mine().slice(earlier), shown: dump(box, run),
  });
}
/** Whether two probes' files are in one job: the parallel block's, or one alone folder's. */
function sameJob(one, other) {
  const fileOf = (name) => Object.keys(FILES).find((file) => FILES[file] === name);
  if (one === 'cargo test' || other === 'cargo test') return one === other;
  const job = (file) => (file.endsWith('.mjs') ? 'node' : file === timedFile() ? 'timed' : file.startsWith('tests/acceptance/') ? dirname(file) : 'parallel');
  return job(fileOf(one)) === job(fileOf(other));
}

before(async () => {
  box = scene({ files: FILES });
  for (const [held, signal] of STOPS) await stopped(held, signal);
  end = { before: box.counts(), ...await toEnd(box) };
  Object.assign(end, { counts: box.counts(), record: box.record(), kept: box.kept(), shown: dump(box, end) });
  // A line under this key for a file the tree doesn't list, which the last run is to ignore.
  if (end.kept.length) box.keep([...end.kept, { ...end.kept[0], files: ['tests/gone.test.ts'], tests: [{ id: 'tests/gone.test.ts › one', state: 'FAIL', note: 'a planted failure' }] }]);
  again = { ...await toEnd(box) };
  Object.assign(again, { counts: box.counts(), record: box.record(), shown: dump(box, again) });
}, { timeout: 60 * 60_000 });

/** A process's command line, with the scene's folders left out. */
const line = ({ pid, command }) => `${pid} ${command.replaceAll(box.home, '~').replaceAll(box.dir, '<tmp>').slice(0, 160)}`;

for (const [held, signal, where] of STOPS) {
  test(`${AC6} a preflight sent ${signal} while ${where} is part way leaves no process it started running, exits 128 plus the signal and holds no grant`, (t) => {
    const stop = stops.get(held);
    assert.ok(stop.reached, `the run never reached ${held}, the job it is to be stopped in\n${stop.shown}`);
    const pids = new Map(stop.noted.flatMap(({ event, pid, compiler }) => (event === 'build' ? [[pid, 'the build it waits for'], [compiler, "that build's compiler"]] : [[pid, 'the child in a process group apart']])));
    for (const [pid, what] of pids) assert.ok(stop.running.some((proc) => proc.pid === pid), `${what} (${pid}) wasn't running when the run was stopped, so the stop proves nothing\n${stop.running.map(line).join('\n')}`);
    const named = (proc) => `${line(proc)}${pids.has(proc.pid) ? ` (${pids.get(proc.pid)})` : ''}`;
    assert.deepEqual(stop.left.map(named), [], `the stopped preflight left processes it started running\n${stop.shown}`);
    assert.ok(stop.exited, `the preflight didn't end within 120 s of its ${signal}\n${stop.shown}`);
    assert.deepEqual(stop.exit, { code: 128 + constants.signals[signal], signal: null }, `the preflight didn't exit with 128 plus the signal\n${stop.shown}`);
    assert.deepEqual(stop.grants, [], `a grant is still held after the stop\n${stop.shown}`);
    assert.equal(stop.ask.status, 0, `a timed request isn't granted at once after the stop: ${stop.ask.stdout}`);
    // The design's 30 s is of the machine it runs on: at a load above the cores it is a reading.
    t.diagnostic(`stopped in ${(stop.took / 1000).toFixed(1)} s at a load of ${loadavg()[0].toFixed(0)} on ${cpus().length} cores`);
    // deadline: the design's bound, read only where the machine isn't overloaded.
    if (loadavg()[0] < cpus().length) assert.ok(stop.took <= 30_000, `the stop took ${stop.took} ms`);
  });
}

test(`${AC1} a run on the same clean tree starts no job that ended before the stop, and starts the one that was part way`, () => {
  // The jobs that had ended at a stop, and what the next run did with them.
  const steps = [['h', stops.get('n').counts, 'the run stopped by SIGTERM'], ['n', end.counts, 'the run stopped by SIGHUP']];
  for (const [held, later, what] of steps) {
    const stop = stops.get(held);
    assert.ok(stop.reached && stop.ended.length >= 2, `${what} was stopped after ${JSON.stringify(stop.ended)} ended, too few to read\n${stop.shown}`);
    const started = stop.ended.filter((name) => later[name] !== stop.counts[name]);
    assert.deepEqual(started, [], `jobs that ended before ${what} were started again by the next run: ${started.join(', ')}\n${end.shown}`);
    assert.equal(later[held], stop.counts[held] + 1, `${held}, part way when its run was stopped, was started ${later[held] - stop.counts[held]} times by the next run\n${end.shown}`);
  }
});

test(`${AC1} a stopped run keeps one whole line for each job that ended, as the job ended, and none for the one it stopped`, () => {
  for (const [held] of STOPS) {
    const stop = stops.get(held);
    const rows = (name) => stop.kept.flatMap((kept) => (kept.tests ?? []).filter(({ id }) => nameOf(box, id) === name));
    for (const name of stop.ended) assert.deepEqual(rows(name).map(({ state }) => state), ['PASS', 'PASS'], `${name} ended before the stop by ${stop.signal}, and its kept rows then weren't its two tests', once each\n${stop.shown}`);
    assert.deepEqual(rows(held), [], `${held} was part way at the stop by ${stop.signal}, and a kept line holds rows of it\n${stop.shown}`);
  }
  // A line is a job's: its label, its files (none for cargo test) and its tests, each with its state.
  for (const kept of end.kept) {
    for (const field of ['key', 'job', 'files', 'tests']) assert.ok(field in kept, `a kept line holds no ${field}: ${JSON.stringify(kept)}`);
    assert.ok(typeof kept.job === 'string' && kept.job, `a kept line names no job: ${JSON.stringify(kept)}`);
    const names = [...new Set(kept.tests.map(({ id }) => nameOf(box, id)))];
    assert.deepEqual(kept.files.map((file) => FILES[file]).sort(), names.filter((name) => name !== 'cargo test').sort(), `a kept line's files aren't the files of its tests: ${JSON.stringify(kept)}`);
    for (const row of kept.tests) assert.equal(row.state, 'PASS', JSON.stringify(kept));
  }
  assert.equal(statSync(box.keptFile()).mode & 0o777, 0o600, 'the kept lines are not their owner\'s alone');
  assert.equal(statSync(dirname(box.keptFile())).mode & 0o777, 0o700, 'their folder is not its owner\'s alone');
});

test(`${AC1} once the last job has run, the lane's record holds every test's row once and passes, and a run with nothing left to run starts nothing`, () => {
  const whole = (record) => {
    const ids = (record?.tests ?? []).map(({ id }) => id).sort();
    const missing = box.ids().filter((id) => !ids.includes(id)), twice = ids.filter((id, k) => ids.indexOf(id) !== k), other = ids.filter((id) => !box.ids().includes(id));
    assert.deepEqual({ missing, twice, other }, { missing: [], twice: [], other: [] }, 'the lane\'s record doesn\'t hold every test\'s row once');
    assert.deepEqual(record.tests.filter(({ state }) => state !== 'PASS'), []);
  };
  // The judge itself, on a record a program that loses a kept row would leave, and on one that counts a row twice.
  const rows = box.ids().map((id) => ({ id, state: 'PASS' }));
  assert.throws(() => whole({ tests: rows.slice(1) }), (error) => error.message.includes('every test') && error.actual.missing[0] === rows[0].id);
  assert.throws(() => whole({ tests: [...rows, rows[0]] }), (error) => error.actual.twice[0] === rows[0].id);

  const fresh = Object.fromEntries(box.names().filter((name) => again.counts[name] !== end.counts[name]).map((name) => [name, again.counts[name] - end.counts[name]]));
  assert.deepEqual(fresh, {}, `a run on a tree whose every job is kept started jobs again: ${Object.keys(fresh).join(', ')}\n${again.shown}`);
  for (const [run, what] of [[end, 'the run that ran the last job'], [again, 'the run with nothing left to run']]) {
    assert.ok(run.record, `${what} left no record of the unit lane\n${run.shown}`);
    whole(run.record);
    assert.equal(run.record.state, 'PASS', `${what}: the lane reads ${run.record.state}\n${run.shown}`);
    assert.equal(run.code, 0, `${what} exited ${run.code}\n${run.shown}`);
  }
});
