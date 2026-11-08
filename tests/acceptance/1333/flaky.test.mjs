// #1333 AC3: a clean first run, five landings that break nothing, and a test that fails once on main's head and then
// passes (README: The scenes).
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { FLAKY, LANDINGS, LONG, assert, asks, created, dump, events, ghCalls, land, originMain, pulls, sandbox, status, tick, watched } from './helpers.mjs';

test(`#1333.aded8275 a test that fails once and passes on repeats reads INCONCLUSIVE, is filed, and pauses nothing`, LONG, async (t) => {
  const box = await sandbox(t);
  const fx = watched(box);
  const first = await tick(box, fx);
  for (let k = 1; k <= LANDINGS; k++) land(box, fx);
  const head = originMain(fx);
  writeFileSync(box.env.T1333_FLAKY, 'armed');
  const run = await tick(box, fx, { poll: true });
  const after = await status(box, fx);
  const all = dump(box, first, run);
  const runs = events(box).filter(({ test }) => test === 'flaky');
  assert.ok(runs.some(({ ok }) => !ok), `the flaky test never failed on main's head, so nothing was judged\n${all}`);
  const failedAt = runs.findIndex(({ ok }) => !ok);
  assert.ok(runs.slice(failedAt + 1).some(({ ok }) => ok), `the flaky test wasn't run again after it failed\n${all}`);
  // Reads INCONCLUSIVE.
  assert.ok(run.stdout.split('\n').some((line) => line.includes('INCONCLUSIVE') && line.includes(FLAKY)), `no line of the job's run reads INCONCLUSIVE for "${FLAKY}"\n${all}`);
  // Is filed, with its runs.
  const filed = created(box).filter(({ title, body }) => !/^Ask:/.test(title) && `${title}\n${body}`.includes(FLAKY));
  assert.equal(filed.length, 1, `the flaky test wasn't filed once as an issue naming "${FLAKY}": ${JSON.stringify(created(box))}\n${all}`);
  const [one] = filed;
  assert.ok(one.body.includes('INCONCLUSIVE'), `the filed issue doesn't say INCONCLUSIVE:\n${one.body}`);
  assert.ok(/^\W*FAIL\b/m.test(one.body) && /^\W*PASS\b/m.test(one.body), `the filed issue doesn't list its runs, a line each starting FAIL or PASS:\n${one.body}`);
  // Pauses nothing: landings read open throughout and after, nothing was reverted or reopened, and no one was asked.
  const polls = run.polls.filter(({ state }) => state !== 'open');
  assert.deepEqual(polls.map(({ line }) => line), [], `landings didn't read open throughout the run\n${all}`);
  assert.equal(after.state, 'open', `landings aren't open after the run: ${after.line}\n${all}`);
  assert.equal(originMain(fx), head, `the job landed something on main\n${all}`);
  assert.deepEqual(pulls(box), [], `the job opened a pull request for a flaky test\n${all}`);
  assert.deepEqual(ghCalls(box).filter(({ args }) => args[0] === 'issue' && args[1] === 'reopen'), [], `the job reopened an issue for a flaky test\n${all}`);
  assert.deepEqual(asks(box), [], `the job raised an ask for a flaky test\n${all}`);
});
