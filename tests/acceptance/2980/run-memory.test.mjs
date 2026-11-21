// #2980 AC2 and AC3: a run's memory by platform. With one test grant held and still settling (under 5 minutes old),
// a second top-level test request on a test's own table, whose DEEP_THROTTLE_READINGS show load below the cores,
// waits one byte below two runs' memory and is granted at once at exactly two runs': 16 GiB on darwin (8 GiB a run),
// 48 GiB on Linux (24 GiB a run, #2924 AC2 unchanged). throttle.mjs runs as a process on a sandbox table
// (../2924/helpers.mjs); the live ~/.deepbuild/throttle/ is never read or written.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GiB, dump, readings, request, running, sandbox, started, waits } from '../2924/helpers.mjs';

// As in #2924's suite: "at once" is the command started within 15 s, "waits" is not started 8 s after the request.
const AT_ONCE = 15_000;
const WAIT = 8_000;

const onlyOn = (platform, name) => (process.platform === platform ? false : `${name} only; this is ${process.platform}`);

/** One test grant held under `file`'s readings (so it is seconds old, still settling), then a second request. */
async function heldThenSecond(t, value) {
  const box = sandbox(t);
  const file = readings(box, 'readings', value);
  const env = { DEEP_THROTTLE_READINGS: file };
  const holder = request(box, 'holder', { env });
  await started(box, holder, AT_ONCE);
  const second = request(box, 'second', { env, exit: true });
  return { box, holder, second };
}

for (const [ac, platform, name, total] of [['AC2', 'darwin', 'darwin', 16], ['AC3', 'linux', 'Linux', 48]]) {
  test(`#2980.${ac} on ${name}, with one settling test grant held, a second request waits while the readings show memory 1 byte below ${total} GiB and load below the cores`, { skip: onlyOn(platform, name), timeout: 60_000 }, async (t) => {
    const { box, holder, second } = await heldThenSecond(t, { memory: total * GiB - 1, load: 1, cores: 64 });
    await waits(box, second, WAIT, [holder], `while the readings show ${total} GiB - 1 byte and the held grant is under 5 min old`);
  });

  test(`#2980.${ac} on ${name}, with one settling test grant held, a second request is granted at once under exactly ${total} GiB and load below the cores`, { skip: onlyOn(platform, name), timeout: 60_000 }, async (t) => {
    const { box, holder, second } = await heldThenSecond(t, { memory: total * GiB, load: 1, cores: 64 });
    await started(box, second, AT_ONCE, [holder]);
    assert.equal(await second.done, 0, dump(box, holder, second));
    assert.ok(running(holder), `the holder ended, so the second may have been granted as the first\n${dump(box, holder, second)}`);
  });
}
