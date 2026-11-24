// #3221 AC4: a run whose process is killed gives its tokens back within 2 s, and the other runs' jobs take them. A
// planted pool that waits for the dead run's jobs to return them stalls and fails, naming the run (twins.json:
// waits-for-jobs). The run's process is the one that holds its grant, the throttle.mjs it was admitted by; its jobs
// hold their tokens until a stop file that never comes, so only the run's death can give the tokens back.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GiB, dump, ended, grantOf, log, ofRun, passedThrough, pause, readings, run, sandbox, starts, until } from './helpers.mjs';

const POOL = 2;
// The criterion's bound, from the kill to each token's release in the table's log.
const BACK_MS = 2_000;

test('#3221.300249e2 a run whose process is killed gives its 2 tokens back within 2 s, and the other run\'s 2 waiting jobs take them', { timeout: 10 * 60_000 }, async (t) => {
  const box = sandbox(t);
  readings(box, { memory: 1024 * GiB, load: 0, cores: POOL + 1 });
  const doomed = run(box, 'doomed', { jobs: Array(POOL).fill({ mode: ['hold'] }) });
  let other = null;
  const all = () => dump(box, doomed, other);
  assert.ok(await until(() => starts(box, 'doomed').length === POOL, 180_000), `the doomed run's ${POOL} jobs never all started\n${all()}`);
  other = run(box, 'other', { jobs: Array(POOL).fill({ mode: ['exit'] }) });
  assert.ok(await until(() => grantOf(box, 'other') && passedThrough(box, grantOf(box, 'other')).length === POOL, 180_000), `the other run was never admitted, or its ${POOL} jobs never asked through its grant\n${all()}`);
  // deadline: a job that a pool lets through starts within 5 s of asking on this machine; these must not.
  await pause(5_000);
  assert.equal(starts(box, 'other').length, 0, `the other run's jobs started while the doomed run's jobs held the pool's ${POOL} tokens, so no token waits to be given back\n${all()}`);

  const doomedGrant = grantOf(box, 'doomed');
  const killed = Date.now();
  process.kill(doomed.pid, 'SIGKILL');
  const back = () => log(box).filter((e) => e.event === 'released' && e.class === 'turn' && ofRun(e, doomedGrant));
  // deadline: 30 s bounds the wait for the releases; the criterion's 2 s is asserted on their times below.
  await until(() => back().length >= POOL && starts(box, 'other').length === POOL, 30_000);
  const released = back().map((e) => `${e.at} (${Date.parse(e.at) - killed} ms after the kill)`);
  t.diagnostic(`the killed run's tokens went back at: ${released.join(', ') || 'none in 30 s'}`);
  // deadline: the criterion's 2 s from the kill to each token's release.
  const late = back().filter((e) => Date.parse(e.at) > killed + BACK_MS);
  assert.ok(back().length >= POOL && !late.length, `the killed run "doomed" (grant ${doomedGrant}) gave back ${back().length - late.length} of its ${POOL} tokens within ${BACK_MS / 1000} s of its kill at ${new Date(killed).toISOString()}; releases: ${released.join(', ') || 'none in 30 s'}\n${all()}`);
  assert.equal(starts(box, 'other').length, POOL, `the other run's ${POOL} jobs didn't take the freed tokens: ${starts(box, 'other').length} started\n${all()}`);
  const otherGrant = grantOf(box, 'other');
  const turns = log(box).filter((e) => e.event === 'turn' && ofRun(e, otherGrant));
  assert.equal(turns.length, POOL, `the log names ${turns.length} turns of the other run (grant ${otherGrant}), not ${POOL}\n${all()}`);
  assert.equal(await ended(other, 120_000, all), 0, `the other run didn't end with 0\n${all()}`);
});
