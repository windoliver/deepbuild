import assert from 'node:assert/strict';
import test from 'node:test';
import { DEALT_WITHIN_MS, POOL, STAYS_MS, TURNS, sandbox, settledAt, story, thirteenTurns, until } from './helpers.mjs';

test(`#3698.0e17c600 with 13 turns on a pool of 17 held by jobs that take no token and none waiting, Σ(1 + lent) over the turns reaches 17 within 10 s of the thirteenth turn's grant and stays at 17`, { timeout: 8 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const { readings, thirteenth, all } = await thirteenTurns(box, t);
  const over = thirteenth + DEALT_WITHIN_MS + STAYS_MS;
  await until(() => Date.now() > over, DEALT_WITHIN_MS + STAYS_MS + 5_000);
  const seen = readings.filter((reading) => reading.at >= thirteenth && reading.at <= over);
  const shown = () => `Σ(1 + lent) over the turns from the thirteenth turn's grant:\n${story(seen, thirteenth)}\n${all()}`;

  assert.ok(seen.length > 0, `the table was never read after the thirteenth turn's grant\n${all()}`);
  const other = seen.find((reading) => reading.turns.length !== TURNS || reading.waiting.length);
  assert.ok(!other, `the world wasn't the criterion's: ${other?.turns.length} turns and ${other?.waiting.length} turn requests waiting at +${((other?.at - thirteenth) / 1000).toFixed(2)} s\n${shown()}`);
  const settled = settledAt(seen, POOL);
  assert.ok(settled, `Σ(1 + lent) over the ${TURNS} turns ended at ${seen.at(-1).dealt}, not the pool's ${POOL}, ${((over - thirteenth) / 1000).toFixed(0)} s after the thirteenth turn's grant: ${POOL - seen.at(-1).dealt} tokens went to nobody\n${shown()}`);
  const after = settled.at - thirteenth;
  t.diagnostic(`Σ(1 + lent) reached ${POOL} for good ${(after / 1000).toFixed(2)} s after the thirteenth turn's grant`);
  assert.ok(after <= DEALT_WITHIN_MS, `Σ(1 + lent) stayed at ${POOL} only from +${(after / 1000).toFixed(2)} s after the thirteenth turn's grant, not within ${DEALT_WITHIN_MS / 1000} s\n${shown()}`);
});
