import assert from 'node:assert/strict';
import test from 'node:test';
import { DEALT_WITHIN_MS, POOL, STAYS_MS, TURNS, askedJob, release, sandbox, settledAt, startOf, story, tableLog, thirteenTurns, until } from './helpers.mjs';

const TURN_WITHIN_MS = 30_000;

test(`#3698.63fa498a with 13 turns on a pool of 17 held by jobs that take no token, once a fourteenth job asks for a turn no turn's lent rises while it waits, and it gets its turn once the lent tokens come back`, { timeout: 8 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const { readings, thirteenth, all } = await thirteenTurns(box, t, [{ name: 'job-14', go: 'late' }]);
  const since = () => readings.filter((reading) => reading.at >= thirteenth);
  await until(() => {
    const settled = settledAt(since(), POOL);
    return settled && Date.now() - settled.at >= 2_000;
  }, DEALT_WITHIN_MS + STAYS_MS);
  const before = since().at(-1);
  t.diagnostic(`before the fourteenth job asked: ${before?.turns.length} turns, Σ(1 + lent) ${before?.dealt}`);
  assert.ok(before && before.turns.length === TURNS && !before.waiting.length, `the world wasn't the criterion's before the fourteenth job asked: ${before?.turns.length} turns and ${before?.waiting.length} waiting\n${all()}`);

  release(box, 'late');
  const asked = await until(() => askedJob(box, 'job-14'), 30_000);
  assert.ok(asked?.child, `the run never started its fourteenth job\n${all()}`);
  const passed = await until(() => tableLog(box).find((e) => e.event === 'passed' && e.pid === asked.child), 30_000);
  assert.ok(passed, `the fourteenth job never asked through the run's grant (no passed entry by pid ${asked.child})\n${all()}`);
  await until(() => startOf(box, 'job-14'), Date.parse(passed.at) + TURN_WITHIN_MS - Date.now());
  const begun = startOf(box, 'job-14');
  await until(() => readings.at(-1)?.at > Date.now() - 100, 1_000);

  const waitedFrom = readings.findIndex((reading) => reading.at >= Date.parse(passed.at) - 1_000 && reading.waiting.some((request) => request.pid === asked.child));
  const turnAt = readings.findIndex((reading, k) => k >= Math.max(0, waitedFrom) && reading.turns.some((turn) => turn.pid === asked.child));
  const waited = waitedFrom < 0 ? [] : readings.slice(waitedFrom, turnAt < 0 ? undefined : turnAt).filter((reading) => reading.waiting.some((request) => request.pid === asked.child));
  const shown = () => `the turns' lent from the fourteenth job's ask:\n${story(readings.filter((reading) => reading.at >= Date.parse(passed.at) - 1_000), Date.parse(passed.at))}\n${all()}`;
  t.diagnostic(`the fourteenth job's request was read waiting ${waited.length} times`);

  const rises = [];
  for (let k = 1; k < waited.length; k += 1) {
    for (const turn of waited[k].turns) {
      const was = waited[k - 1].turns.find((other) => other.id === turn.id);
      if (was && turn.lent > was.lent) rises.push(`turn ${turn.id} from ${was.lent} to ${turn.lent} at +${((waited[k].at - Date.parse(passed.at)) / 1000).toFixed(2)} s`);
    }
  }
  assert.deepEqual(rises, [], `a turn was lent more while the fourteenth job waited for its turn\n${shown()}`);
  assert.ok(begun, `the fourteenth job didn't get its turn within ${TURN_WITHIN_MS / 1000} s of asking: the lent tokens never came back to the pool\n${shown()}`);
  const holding = turnAt < 0 ? null : readings[turnAt];
  assert.ok(holding, `the fourteenth job's command started, but its turn was never read in the table\n${shown()}`);
  assert.ok(holding.dealt <= POOL, `the fourteenth job got its turn with Σ(1 + lent) ${holding.dealt} over ${holding.turns.length} turns, more than the pool's ${POOL}: the lent tokens hadn't come back\n${shown()}`);
});
