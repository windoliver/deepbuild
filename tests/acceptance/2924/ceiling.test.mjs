// #2924 AC4 and AC5's first sentence: the LIMITS ceiling, 6 on Linux and 2 on darwin, caps the test grants held at
// once however much room the readings show; and a test's own table without DEEP_THROTTLE_READINGS grants up to the
// ceiling as before. The ceilings are the issue's expected values, hard-coded on purpose.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CEILING, GiB, dump, finish, readings, request, running, sandbox, started, waits } from './helpers.mjs';

async function fillThenWait(t, withReadings) {
  const box = sandbox(t);
  // Room for far more than the ceiling: 1024 GiB, less 24 GiB for each settling grant, load 0 on 1024 cores.
  const env = withReadings ? { DEEP_THROTTLE_READINGS: readings(box, 'readings', { memory: 1024 * GiB, load: 0, cores: 1024 }) } : {};
  const holders = [];
  for (let k = 1; k <= CEILING; k++) {
    holders.push(request(box, `holder-${k}`, { env }));
    await started(box, holders.at(-1), 15_000, holders);
  }
  assert.ok(holders.every(running), `a holder ended early\n${dump(box, ...holders)}`);
  const next = request(box, 'next', { env, exit: true });
  await waits(box, next, 8_000, holders, `while ${CEILING} test grants were held: the ceiling is not ${CEILING}`);
  // It waits for a slot: once one holder finishes, it runs.
  finish(box, 'holder-1');
  await started(box, next, 15_000, holders);
  assert.equal(await next.done, 0, dump(box, ...holders, next));
  assert.ok(holders.slice(1).every(running), `the other holders were ended\n${dump(box, ...holders, next)}`);
}

test(`#2924.AC4 readings with room for many runs still hold at most ${CEILING} test grants (${process.platform}); the next waits until a slot frees`, { timeout: 120_000 }, (t) => fillThenWait(t, true));

test(`#2924.AC5 a test's own table without DEEP_THROTTLE_READINGS grants up to the ceiling, ${CEILING} (${process.platform}), as before`, { timeout: 120_000 }, (t) => fillThenWait(t, false));
