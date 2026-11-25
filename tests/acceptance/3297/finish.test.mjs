// #3297 AC3 (#3297.0a3b3b31): a finishing run starts no file that has a kept result, takes one timed grant and prints
// `Checks elapsed: N s (budget: <B s)` and the `Kept:` line, and with a file unrun the preflight doesn't finish; and AC4
// (#3297.3773818a): `Checks elapsed` is the finishing run's, and the machine time of kept results is in the `Kept:` line alone.
//
// One scene, five runs of scripts/preflight on one tree:
// 1. `cut`: one alone file's runner is killed, so the file has no result, and everything else fills.
// 2. `filled`: that file runs, for 20 s, and the same command finishes.
// 3. `planted`: nothing is left to fill. Before it, each kept line's `ms` and `run` is planted, far over the budget, with a
//    line of another host's beside them.
// 4. `open`: that file's kept row reads INCONCLUSIVE, and does again when it is run.
// 5. `stands`: its kept row reads FAIL, which stands (#3296), so there is nothing to fill.
//
// A finish is told by what it alone does: the other lane of the checks, which a fill doesn't run, the warm-up builds, which
// take 3 s here, perf after them, its one timed grant and its two lines.
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { aloneFile, inside, LIMIT, nodeFile, parallelFile, printed, scene, seconds, timedAloneFile, toEnd } from './helpers.mjs';

const AC3 = '#3297.0a3b3b31';
const AC4 = '#3297.3773818a';
const FILES = { [parallelFile('p')]: 'p', [aloneFile(0, 'a')]: 'a', [aloneFile(1, 'a')]: 'b', [timedAloneFile(0)]: 't', [nodeFile('n')]: 'n' };
const COUNT = Object.keys(FILES).length;
const SLOW = 20_000, WARM = 3;
const B = aloneFile(1, 'a');
const only = (names) => [...names].sort();
/** The test files a run started, and cargo test. */
const files = (run) => only(run.started.filter((name) => box.names().includes(name)));

let box, planted;
const runs = {};

before(async () => {
  box = scene({ files: FILES });
  box.warmFor(WARM);
  box.flag('b', 'kill');
  runs.cut = await toEnd(box);
  box.unflag('b', 'kill');
  box.flag('b', 'slow', String(SLOW));
  runs.filled = await toEnd(box);
  box.unflag('b', 'slow');
  // A time and a run of the test's own on each line, each a whole number of seconds and far over the budget in all.
  planted = runs.filled.kept.map((line, at) => ({ ...line, ms: 1000 * (100_000 + at), run: `planted-${at % 3}` }));
  if (planted.length) box.keep([...planted, { ...planted[0], key: { ...planted[0].key, host: 'another-host' }, ms: 5_000_000_000, run: 'another' }]);
  runs.planted = await toEnd(box);
  // The kept rows of b alone, as another run would have kept them.
  const read = (state) => planted.map((line) => (line.files?.includes(B) ? { ...line, tests: line.tests.map((row) => (row.id.endsWith('› two') ? { ...row, state, note: `${state}: planted` } : row)) } : line));
  box.keep(read('INCONCLUSIVE'));
  box.flag('b', 'INCONCLUSIVE');
  runs.open = await toEnd(box);
  box.unflag('b', 'INCONCLUSIVE');
  box.keep(read('FAIL'));
  runs.stands = await toEnd(box);
}, { timeout: 180 * 60_000 });

/** The files that ran while a run held a timed grant, and its timed grants that cover no file's run: the finish's. */
const under = (grant) => box.names().filter((name) => inside(box.spans(name), grant).length).map(box.fileOf);
const finishes = (run) => run.timed.filter((grant) => !under(grant).length);
/** The run finished: the other lane once, one timed grant with no file under it, both lines in their order. */
function finished(name, { passed = true } = {}) {
  const run = runs[name], { checks, kept } = printed(run.out);
  assert.equal(finishes(run).length, 1, `a finishing run takes one timed grant, under which no file runs: ${run.timed.length} were taken, ${finishes(run).length} of them with no file under it (under the others ran ${run.timed.flatMap(under).join(', ') || 'none'})\n${run.shown}`);
  assert.ok(checks, `it prints no line "Checks elapsed: N s (budget: <B s)"\n${run.shown}`);
  assert.equal(checks.budget, LIMIT / 1000, `its budget\n${run.shown}`);
  assert.ok(kept, `it prints no line "Kept: <jobs> jobs, <seconds> s of machine time, from <runs> runs"\n${run.shown}`);
  assert.ok(kept.at > checks.at, `the Kept: line isn't after Checks elapsed\n${run.shown}`);
  assert.equal(run.times('other'), 1, `the finish runs the checks' other lane once, not ${run.times('other')} times\n${run.shown}`);
  if (passed) {
    assert.equal(run.code, 0, `it exited ${run.code ?? run.signal}\n${run.shown}`);
    assert.match(run.out, /^PASS unit\b/m, `the unit lane doesn't read PASS\n${run.shown}`);
    assert.equal(run.record?.state, 'PASS', `the unit lane's record\n${run.shown}`);
    assert.deepEqual(run.record.tests.map(({ id }) => id).sort(), box.ids(), `the record doesn't hold every test's row once\n${run.shown}`);
    assert.equal(run.times('perf'), 1, `perf runs once after the checks\n${run.shown}`);
  }
  return { run, checks, kept, grant: finishes(run)[0] };
}
/** The run didn't finish: exit 3, the line naming the file, and nothing a finish does. */
function unfinished(name, why) {
  const run = runs[name];
  assert.doesNotMatch(run.out, /^PASS unit\b/m, `the unit lane reads PASS with ${why}\n${run.shown}`);
  assert.notEqual(run.record?.state, 'PASS', `the unit lane's record reads PASS with ${why}\n${run.shown}`);
  const early = ['other', 'perf'].filter((what) => run.times(what)).map((what) => (what === 'other' ? 'the checks\' other lane' : what));
  assert.deepEqual(early, [], `it finished early, with ${why}: it ran these of the finish\n${run.shown}`);
  assert.deepEqual(finishes(run), [], `it finished early, with ${why}: it took the finish's timed grant\n${run.shown}`);
  assert.equal(printed(run.out).checks, null, `it finished early, with ${why}: it printed Checks elapsed\n${run.shown}`);
  assert.equal(run.code, 3, `it exited ${run.code ?? run.signal}, not 3, with ${why}\n${run.shown}`);
  const line = run.out.split('\n').find((text) => text.startsWith('INCONCLUSIVE preflight: '));
  assert.ok(line, `it prints no line "INCONCLUSIVE preflight: <n> of <m> test files have no result on this tree: …" with ${why}\n${run.shown}`);
  // With a file unrun the line counts it; whether it counts an open one as well is not said.
  assert.match(line, new RegExp(`^INCONCLUSIVE preflight: ${name === 'cut' ? 1 : '\\d+'} of ${COUNT} test files have no result on this tree: `), `its line, with ${why}`);
  assert.ok(line.includes(B), `the line names no ${B}: ${line}`);
  return run;
}

test(`${AC3} with a file unrun the preflight doesn't finish: it exits 3, INCONCLUSIVE, naming the file, with no PASS for the unit lane`, () => {
  assert.deepEqual(files(runs.cut), only(box.names()), `the run was to start every file\n${runs.cut.shown}`);
  const run = unfinished('cut', `${B} unrun, its runner killed`);
  // The fill's own timed grant, for its one timed file, and no other.
  assert.equal(run.timed.length, 1, `it took ${run.timed.length} timed grants while it filled one timed file\n${run.shown}`);
});

test(`${AC3} with a file open the preflight doesn't finish: it runs that file, and exits 3, INCONCLUSIVE, naming it`, () => {
  assert.deepEqual(files(runs.open), ['b'], `the run was to start ${B} alone\n${runs.open.shown}`);
  unfinished('open', `${B} open, its kept row INCONCLUSIVE`);
});

test(`${AC3} once every file has a kept result the same command finishes: one timed grant, no file started again, and both lines`, () => {
  const { run, grant } = finished('filled');
  assert.deepEqual(files(run), ['b'], `it was to start ${B}, the file unrun, and no file that had a kept result\n${run.shown}`);
  assert.equal(run.times('b'), 1, `${B} was started ${run.times('b')} times\n${run.shown}`);
  assert.ok(grant.from >= run.spans('b')[0].to, `the finish took its timed grant before ${B} ended\n${run.shown}`);
  assert.equal(run.timed.length, 1, `it took ${run.timed.length} timed grants with no timed file to run\n${run.shown}`);
});

test(`${AC3} a run with nothing to fill finishes at once: one timed grant, no file started, and both lines`, () => {
  const { run } = finished('planted');
  assert.deepEqual(files(run), [], `it started files that have kept results\n${run.shown}`);
  assert.equal(run.timed.length, 1, `it took ${run.timed.length} timed grants with no file to run\n${run.shown}`);
});

test(`${AC3} a file whose kept FAIL stands has its result: the preflight starts nothing, finishes and fails`, () => {
  const { run } = finished('stands', { passed: false });
  assert.deepEqual(files(run), [], `it started files that have kept results\n${run.shown}`);
  assert.match(run.out, /^FAIL unit\b/m, `the unit lane doesn't read FAIL\n${run.shown}`);
  assert.doesNotMatch(run.out, /^INCONCLUSIVE preflight: /m, `a file whose FAIL stands isn't one with no result\n${run.shown}`);
  assert.equal(run.code, 1, `it exited ${run.code ?? run.signal}\n${run.shown}`);
  assert.equal(run.times('perf'), 0, `perf ran over checks that didn't pass\n${run.shown}`);
});

test(`${AC3} the unit record of a finishing run says how many test files it read from kept results, of how many`, () => {
  for (const name of ['filled', 'planted']) assert.deepEqual(runs[name].record?.kept, { read: COUNT, of: COUNT }, `the record of the run "${name}" says ${JSON.stringify(runs[name].record?.kept)}\n${runs[name].shown}`);
});

test(`${AC4} a kept line says which preflight ran its job and how long the job took`, () => {
  const { kept, shown } = runs.filled;
  assert.ok(kept.length, `no line was kept\n${shown}`);
  for (const line of kept) {
    assert.ok(typeof line.run === 'string' && line.run, `the kept line of ${line.job} (${line.files.join(', ') || 'no file'}) names no run: ${JSON.stringify(line.run)}`);
    assert.ok(Number.isFinite(line.ms) && line.ms > 0, `the kept line of ${line.job} (${line.files.join(', ') || 'no file'}) says no time: ${JSON.stringify(line.ms)}`);
  }
  const mine = kept.filter((line) => line.files.includes(B));
  assert.equal(mine.length, 1, `${mine.length} kept lines name ${B}, which ran whole once\n${shown}`);
  const others = new Set(kept.filter((line) => line !== mine[0]).map((line) => line.run));
  assert.equal(others.size, 1, `the jobs one preflight ran name ${others.size} runs: ${[...others].join(', ')}\n${shown}`);
  assert.ok(!others.has(mine[0].run), `${B}'s job, which the second preflight ran, names the first's run\n${shown}`);
  // Its job held the file's 20 s and ran inside its preflight.
  assert.ok(mine[0].ms >= SLOW, `the job of ${B}, which took over ${seconds(SLOW)}, says ${seconds(mine[0].ms)}\n${shown}`);
  assert.ok(mine[0].ms <= runs.filled.at - runs.filled.began, `the job of ${B} says ${seconds(mine[0].ms)}, longer than its preflight took\n${shown}`);
});

test(`${AC4} the Kept: line says how many jobs are kept, their machine time in all and how many runs they came from`, () => {
  for (const name of ['filled', 'planted']) assert.ok(printed(runs[name].out).kept, `the run "${name}" prints no line "Kept: <jobs> jobs, <seconds> s of machine time, from <runs> runs": the kept jobs' machine time is left out\n${runs[name].shown}`);
  const filled = finished('filled'), lines = filled.run.kept;
  const sum = (of) => of.reduce((total, { ms }) => total + ms, 0) / 1000;
  assert.equal(filled.kept.jobs, lines.length, `the jobs of its Kept: line, over ${lines.length} kept jobs\n${filled.run.shown}`);
  assert.equal(filled.kept.runs, 2, `the runs of its Kept: line, over the kept jobs of two preflights\n${filled.run.shown}`);
  // The line may round its seconds.
  assert.ok(Math.abs(filled.kept.seconds - sum(lines)) <= 1, `its Kept: line says ${filled.kept.seconds} s of machine time over kept jobs of ${sum(lines)} s\n${filled.run.shown}`);
  const again = finished('planted');
  assert.equal(again.kept.jobs, planted.length, `the jobs of its Kept: line: those kept under this run's own key\n${again.run.shown}`);
  assert.equal(again.kept.runs, 3, `the runs of its Kept: line, over kept jobs that name three\n${again.run.shown}`);
  assert.equal(again.kept.seconds, sum(planted), `the machine time of its Kept: line, over kept jobs of ${sum(planted)} s\n${again.run.shown}`);
  const elsewhere = again.run.out.split('\n').filter((line, at) => at !== again.kept.at && new RegExp(`\\b${sum(planted)}\\b`).test(line));
  assert.deepEqual(elsewhere, [], `the machine time of the kept results is on other lines than Kept:\n${again.run.shown}`);
});

test(`${AC4} Checks elapsed is the finishing run's: its warm-up builds and checks, and no kept job's time`, () => {
  for (const name of ['filled', 'planted']) {
    const timed = runs[name].timed.at(-1), elapsed = printed(runs[name].out).checks?.elapsed;
    assert.ok(timed, `the run "${name}" took no timed grant to time its checks under\n${runs[name].shown}`);
    assert.deepEqual(under(timed), [], `in the run "${name}" Checks elapsed, ${elapsed} s, isn't the finish's alone: these files ran under the grant it is timed on, held for ${seconds(timed.to - timed.from)}\n${runs[name].shown}`);
    const { run, checks, grant } = finished(name);
    // Timed on the finish's own grant, from its warm-up builds on.
    assert.ok(checks.elapsed * 1000 <= grant.to - grant.from + 50, `in the run "${name}" Checks elapsed is ${checks.elapsed} s, longer than the finish held its grant, ${seconds(grant.to - grant.from)}: it holds more than the finishing run\n${run.shown}`);
    assert.ok(checks.elapsed >= WARM, `in the run "${name}" Checks elapsed is ${checks.elapsed} s, less than the warm-up builds' ${WARM} s\n${run.shown}`);
    assert.doesNotMatch(run.out, /^FAIL preflight budget/m, `in the run "${name}" the kept jobs' time counts against the budget of ${LIMIT / 1000} s\n${run.shown}`);
  }
});
