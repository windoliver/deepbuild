// #3567, criterion 1: on a scratch tree whose one selected file never ends, with the bound set to seconds, the run ends
// within the bound and 15 s more, reads INCONCLUSIVE naming the file, and leaves no process it started. A planted run
// that waits for the file fails, naming it. The Scope's lines for the bound add that the run gives back its grants, and
// that the bound counts from the run's start, its waits for a grant included: the second test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, BOUND_MIN, BOUNDED, dump, expectEnded, heldBy, hold, holding, leftBy, noted, pause, readings, sandbox, start, stateLines, stuck, throttleTable, tree, until } from './helpers.mjs';

const STUCK = 'tests/fixture-3567-stuck.test.mjs';
// How long the second test's run waits for its test grant: a third of its bound.
const GRANT_AFTER_MS = 10_000;

/** What the criterion holds of a run whose one selected file never ends. `what` says what the run had before it. */
async function expectStopped(box, run, what) {
  const all = () => dump(box, run);
  expectEnded(box, run, { what });
  const roles = noted(box).map(({ role }) => role);
  assert.ok(roles.includes('stuck') && roles.includes('stuck-child'), `${STUCK} never ran far enough within the bound to note its process and the child it starts, so this run proves nothing about stopping it\n${all()}`);

  const named = stateLines(run.stdout, STUCK);
  assert.ok(named.some((line) => line.startsWith('INCONCLUSIVE')), `no INCONCLUSIVE line names ${STUCK}, the file that didn't finish\n${all()}`);
  assert.deepEqual(named.filter((line) => !line.startsWith('INCONCLUSIVE')), [], `${STUCK} reads otherwise than INCONCLUSIVE\n${all()}`);

  const left = await leftBy(box, run);
  assert.deepEqual(left.noted, [], `${STUCK}'s own processes still run after the run ended: the run left processes it started\n${all()}`);
  assert.deepEqual(left.group, [], `processes of the run's own process group still run after it ended: the run left processes it started\n${all()}`);
  assert.deepEqual(await heldBy(box), { grants: [], requests: [] }, `the throttle's table still holds a grant or a request of the run after it ended: the run didn't give its grants back\n${all()}`);
}

test('#3567.3092e5a6 on a scratch tree whose one selected file never ends, with the bound at 30 s, the run ends within the bound and 15 s more, reads INCONCLUSIVE naming the file, and leaves no process it started', BOUNDED, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, { [STUCK]: stuck(box) });
  const run = await affected(box, fixture, [STUCK], { env: { DEEP_AFFECTED_MIN: String(BOUND_MIN) } });
  await expectStopped(box, run, `waiting for ${STUCK}, which never ends`);
});

test("#3567.3092e5a6 the bound counts from the run's start, its wait for a grant included: a run that waited 10 s for its test grant before its one file, which never ends, could start still ends within the bound and 15 s more of its start", BOUNDED, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, { [STUCK]: stuck(box) });
  // No memory for a second run: while the neighbour holds the first test grant, the readings keep the run out (section 6).
  readings(box, { memory: 0, load: 0, cores: 16 });
  const neighbour = hold(box, fixture, 'test');
  // deadline: the neighbour's grant comes at once on an empty table; 60 s bounds a machine that can't start it.
  assert.ok(await until(() => holding(box) === 1, 60_000), `the neighbour never took the sandbox's first test grant\n${JSON.stringify(throttleTable(box))}`);
  const running = start(box, fixture, [STUCK], { env: { DEEP_AFFECTED_MIN: String(BOUND_MIN) } });
  // deadline: the fixture's schedule, the neighbour's grant ends no sooner than 10 s after the run's start.
  await pause(Math.max(0, running.began + GRANT_AFTER_MS - Date.now()));
  const requests = () => throttleTable(box).requests.filter(({ pid }) => pid !== neighbour);
  // deadline: the run asks within seconds of its start; 15 s more bound a machine too busy for that.
  await until(() => requests().length === 1, 15_000);
  const asked = requests();
  // The neighbour's own process group, which this test started: its grant ends with it.
  try { process.kill(-neighbour, 'SIGKILL'); } catch {}
  const run = await running.done;
  const all = () => dump(box, run);

  assert.equal(asked.length, 1, `${GRANT_AFTER_MS / 1000} s and more after its start the run had ${asked.length} requests in the throttle's table, not the one for its test grant, so it didn't wait for a grant behind the neighbour and this run proves nothing\n${all()}`);
  await expectStopped(box, run, `counting the ${GRANT_AFTER_MS / 1000} s it waited for its test grant before ${STUCK}, which never ends, could start`);
  const began = noted(box).find(({ role }) => role === 'stuck');
  assert.ok(began.at >= running.began + GRANT_AFTER_MS, `${STUCK} started before the neighbour's grant ended, so the run didn't wait for its grant\n${all()}`);
});
