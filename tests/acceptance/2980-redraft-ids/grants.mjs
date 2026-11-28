import assert from 'node:assert/strict';
import { dump, readings, request, running, sandbox, started, waits } from '../2924/helpers.mjs';

const AT_ONCE = 30_000;

async function holder(t, value) {
  const box = sandbox(t);
  const env = { DEEP_THROTTLE_READINGS: readings(box, 'readings', value) };
  const begun = Date.now();
  const held = request(box, 'holder', { env });
  await started(box, held, AT_ONCE);
  return { box, env, held, took: Date.now() - begun };
}

export async function secondWaits(t, value, why) {
  const { box, env, held, took } = await holder(t, value);
  const second = request(box, 'second', { env, exit: true });
  await waits(box, second, Math.max(8_000, 2 * took), [held], why);
}

export async function secondGranted(t, value) {
  const { box, env, held } = await holder(t, value);
  const second = request(box, 'second', { env, exit: true });
  await started(box, second, AT_ONCE, [held]);
  assert.equal(await second.done, 0, dump(box, held, second));
  assert.ok(running(held), `the holder ended, so the second may have been granted as the first\n${dump(box, held, second)}`);
}
