import assert from 'node:assert/strict';
import test from 'node:test';
import { DEALT_WITHIN_MS, POOL, STAYS_MS, TURNS, lentOf, sandbox, settledAt, spread, story, thirteenTurns, until } from './helpers.mjs';

test(`#3698.105149b0 with 13 turns on a pool of 17 held by jobs that take no token and none waiting, once the pool is dealt no turn's lent is more than one above another's`, { timeout: 8 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const { readings, thirteenth, all } = await thirteenTurns(box, t);
  const over = thirteenth + DEALT_WITHIN_MS + STAYS_MS;
  await until(() => Date.now() > over, DEALT_WITHIN_MS + STAYS_MS + 5_000);
  const seen = readings.filter((reading) => reading.at >= thirteenth && reading.at <= over);
  const shown = () => `the turns' lent from the thirteenth turn's grant:\n${story(seen, thirteenth)}\n${all()}`;

  const other = seen.find((reading) => reading.turns.length !== TURNS || reading.waiting.length);
  assert.ok(!other, `the world wasn't the criterion's: ${other?.turns.length} turns and ${other?.waiting.length} turn requests waiting at +${((other?.at - thirteenth) / 1000).toFixed(2)} s\n${shown()}`);
  const settled = settledAt(seen, POOL);
  assert.ok(settled && settled.at - thirteenth <= DEALT_WITHIN_MS, `the pool was never dealt whole (Σ(1 + lent) ${seen.at(-1)?.dealt} of ${POOL}), so no turn's lent was read once it was\n${shown()}`);
  const dealt = seen.filter((reading) => reading.at >= settled.at);
  const uneven = dealt.find((reading) => spread(reading) > 1);
  assert.ok(!uneven, `once the pool was dealt, one turn was lent ${spread(uneven ?? dealt[0])} more than another: lent [${lentOf(uneven ?? dealt[0])}] at +${(((uneven ?? dealt[0]).at - thirteenth) / 1000).toFixed(2)} s\n${shown()}`);
});
