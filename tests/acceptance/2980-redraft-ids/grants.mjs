// The scene criteria 2 and 3 share: on a test's own table (DEEP_THROTTLE_TABLE in the sandbox, a temporary HOME, run
// under node --test), one test grant is held under DEEP_THROTTLE_READINGS's readings and is still settling (it has
// just started), then a second top-level test request is made under the same readings. The 2924 helpers do the
// rest; the live table is never read or written.
import assert from 'node:assert/strict';
import { dump, readings, request, running, sandbox, started, waits } from '../2924/helpers.mjs';

// "Granted at once": the second's command starts within 30 s. The Mac ran at a 1-minute load of 70-90 on 12 cores
// while these were drafted, where a node process can take seconds to start, so the span is wider than 2924's 15 s.
const AT_ONCE = 30_000;

/** The holder, started under `value`; returns the sandbox, the holder and how long its command took to start. */
async function holder(t, value) {
  const box = sandbox(t);
  const env = { DEEP_THROTTLE_READINGS: readings(box, 'readings', value) };
  const begun = Date.now();
  const held = request(box, 'holder', { env });
  await started(box, held, AT_ONCE);
  return { box, env, held, took: Date.now() - begun };
}

/**
 * The second request waits under `value`: its command hasn't started and its throttle.mjs still runs after 8 s, or
 * twice what the holder's command took to start when that is longer, so a program that grants at once on a loaded
 * machine has had the time it needed to start the command.
 */
export async function secondWaits(t, value, why) {
  const { box, env, held, took } = await holder(t, value);
  const second = request(box, 'second', { env, exit: true });
  await waits(box, second, Math.max(8_000, 2 * took), [held], why);
}

/** The second request is granted at once under `value`, while the holder still runs. */
export async function secondGranted(t, value) {
  const { box, env, held } = await holder(t, value);
  const second = request(box, 'second', { env, exit: true });
  await started(box, second, AT_ONCE, [held]);
  assert.equal(await second.done, 0, dump(box, held, second));
  assert.ok(running(held), `the holder ended, so the second may have been granted as the first\n${dump(box, held, second)}`);
}
