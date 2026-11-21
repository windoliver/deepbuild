// #2674, the criteria a window's own code meets: one real scene, a fixture repository whose main a first window marks and
// a second measures over two commits, every process reading a load at this machine's cores (scene.mjs). Each test reads
// what that window left in the sandbox, then what the repo holds of the three windows on a reference Mac under
// benchmarks/windows/ (evidence.mjs). The scene runs once, on the first test's turn.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { forShare, holdings, inARow, loadsOf, passesAtLoad, share, sidesHeld, sidesOf, statesOf, windowRecordOf, windowsWhole } from './evidence.mjs';
import { commitRecords, dump, LOAD, logLines, play, REACHED, sandbox, SLOW, TASKS, UNREACHED, windowRecords } from './scene.mjs';

const box = sandbox({ after });
let played;
const scene = () => (played ??= play(box));
/** Fails, listing each problem under `what`, unless there are none. */
const none = (problems, what) => assert.ok(!problems.length, `${what}:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);

/** The measuring window's record of each commit: one each, and none of a commit it didn't measure. */
function recordsOf(s) {
  const found = commitRecords(box);
  assert.deepEqual(found.map(({ commit }) => commit).sort(), [...s.commits].sort(), `the window over the ${s.commits.length} commits merged since the window before didn't end with one record for each\n${dump(box, s.run)}`);
  return s.commits.map((commit) => found.find((record) => record.commit === commit));
}

test('#2674.5cde9b0e every window ends with one record per commit merged since the one before and a window-open and window-close in the throttle log, every task reads a verdict or not reached, and no task measured at a load at the cores reads PASS; the repo holds three such windows in a row on one reference Mac', SLOW, async () => {
  const s = await scene();
  const records = recordsOf(s);
  const log = logLines(box), opens = log.filter(({ event }) => event === 'window-open'), closes = log.filter(({ event }) => event === 'window-close');
  assert.ok(opens.length === s.windows && closes.length === s.windows && opens.every((open) => closes.some((close) => close.id === open.id)),
    `the throttle log doesn't hold a window-open and a window-close for each of the scene's ${s.windows} windows\n${dump(box, s.run)}`);
  for (const record of records) {
    none(statesOf(record, TASKS.map(({ id }) => id)), `a task of the record of ${record.commit} reads no verdict and isn't not reached: ${JSON.stringify(record)}`);
    for (const id of REACHED) assert.ok(['FAIL', 'INCONCLUSIVE', 'PASS'].includes(record.tests.find((row) => row.id === id)?.state), `the window didn't measure ${id}, which runs on every commit, on ${record.commit}\n${dump(box, s.run)}`);
    const problems = passesAtLoad(record, LOAD);
    none(problems, `the window recorded PASS for a task measured at a load of ${LOAD}, every process's, on ${LOAD} cores`);
  }
  const problems = inARow(holdings());
  none(problems, `the repo doesn't hold three scheduled windows in a row on one reference Mac`);
});

test('#2674.39a35288 a commit\'s record holds the load at each run\'s start and end, and a window in which every limit read INCONCLUSIVE by load is left open naming the load; in the repo\'s windows at least 90% of the tasks that carry a limit or a target read PASS or FAIL', SLOW, async () => {
  const s = await scene();
  const records = recordsOf(s);
  for (const record of records) {
    const problems = loadsOf(record, ['limited'], LOAD);
    none(problems, `the record of ${record.commit} doesn't hold the load at each run's start and end of limited, which carries a limit`);
  }
  const fixture = share([{ name: 'the fixture\'s window', cores: LOAD, records: records.map((value) => ({ value, tasks: TASKS })) }]);
  assert.ok(fixture.open.length === 1 && fixture.open[0].includes(`loads up to ${LOAD} on`), `a window in which every limit read INCONCLUSIVE at a load of ${LOAD} on ${LOAD} cores isn't left open naming the load: ${JSON.stringify(fixture)}\n${dump(box, s.run)}`);
  const problems = share(forShare(holdings())).problems;
  none(problems, `the repo's windows don't read 90% of the tasks that carry a limit or a target PASS or FAIL`);
});

test('#2674.04047d99 each commit\'s record holds, for each task and each side, its p50, its p95, its peak bytes and its instructions retired per round, in the sandbox and in the repo\'s windows', SLOW, async () => {
  const s = await scene();
  for (const record of recordsOf(s)) {
    for (const id of REACHED) {
      const problems = sidesOf(record, id, { counted: true });
      none(problems, `the record of ${record.commit} doesn't hold ${id}'s numbers for each side`);
    }
  }
  const problems = sidesHeld(holdings());
  none(problems, `a committed record doesn't hold each side's numbers`);
});

test('#2674.d1a3f7be each window\'s record gives its start, its end, the commits it measured, and the tasks it ran and did not reach; a window in the repo ends within two hours or names the task that took longest', SLOW, async () => {
  const s = await scene();
  const own = windowRecords(box).filter(({ commits }) => commits.length);
  assert.equal(own.length, 1, `the window over ${s.commits.join(', ')} left ${own.length} records of its own (start, end, commits), not one\n${dump(box, s.run)}`);
  const problems = windowRecordOf(own[0], { commits: s.commits, ran: new Set(REACHED), notReached: new Set(UNREACHED) });
  none(problems, `the window's record isn't whole: ${JSON.stringify(own[0])}`);
  const [start, end] = [Date.parse(own[0].start), Date.parse(own[0].end)];
  assert.ok(start >= s.run.launched - 1000 && end <= s.run.ended + 1000, `the window's record gives ${own[0].start} to ${own[0].end}, outside the run it records, ${new Date(s.run.launched).toISOString()} to ${new Date(s.run.ended).toISOString()}`);
  const held = windowsWhole(holdings());
  none(held, `a committed window's record isn't whole`);
});
