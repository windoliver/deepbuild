import assert from 'node:assert/strict';
import test from 'node:test';
import { GiB, dump, readings, request, running, sandbox, started, waits } from '../2924/helpers.mjs';

const AT_ONCE = 15_000;
const WAIT = 8_000;
const TWO_RUNS = process.platform === 'darwin' ? 16 : 48;

async function heldThenSecond(t, value) {
  const box = sandbox(t);
  const file = readings(box, 'readings', value);
  const env = { DEEP_THROTTLE_READINGS: file };
  const holder = request(box, 'holder', { env });
  await started(box, holder, AT_ONCE);
  const second = request(box, 'second', { env, exit: true });
  return { box, holder, second, rewrite: (next) => readings(box, 'readings', next) };
}

test('#2924.AC1 with no test grant held, a test request is granted at once under a load above the cores and 0 bytes of memory', { timeout: 60_000 }, async (t) => {
  const box = sandbox(t);
  const file = readings(box, 'readings', { memory: 0, load: 50, cores: 4 });
  const first = request(box, 'first', { exit: true, env: { DEEP_THROTTLE_READINGS: file } });
  await started(box, first, AT_ONCE);
  assert.equal(await first.done, 0, dump(box, first));
});

test('#2924.AC2 with one test grant held, a second request waits while the readings show load equal to the cores', { timeout: 60_000 }, async (t) => {
  const { box, holder, second } = await heldThenSecond(t, { memory: 1024 * GiB, load: 1, cores: 1 });
  await waits(box, second, WAIT, [holder], 'while the readings show load 1 on 1 core');
});

test(`#2924.AC2 with one settling test grant held, a second request waits while the readings show memory 1 byte below ${TWO_RUNS} GiB`, { timeout: 60_000 }, async (t) => {
  const { box, holder, second } = await heldThenSecond(t, { memory: TWO_RUNS * GiB - 1, load: 1, cores: 64 });
  await waits(box, second, WAIT, [holder], `while the readings show memory below ${TWO_RUNS} GiB and the held grant is under 5 min old`);
});

test(`#2924.AC2 with one test grant held, a second request is granted at once under load below the cores and exactly ${TWO_RUNS} GiB`, { timeout: 60_000 }, async (t) => {
  const { box, holder, second } = await heldThenSecond(t, { memory: TWO_RUNS * GiB, load: 1, cores: 64 });
  await started(box, second, AT_ONCE, [holder]);
  assert.equal(await second.done, 0, dump(box, holder, second));
  assert.ok(running(holder), `the holder ended\n${dump(box, holder, second)}`);
});

test('#2924.AC3 a request waiting on load is granted without a restart once its readings file is rewritten to allow it', { timeout: 60_000 }, async (t) => {
  const { box, holder, second, rewrite } = await heldThenSecond(t, { memory: 1024 * GiB, load: 100, cores: 1 });
  await waits(box, second, WAIT, [holder], 'while the readings show load 100 on 1 core');
  rewrite({ memory: 1024 * GiB, load: 1, cores: 8 });
  await started(box, second, AT_ONCE, [holder]);
  assert.equal(await second.done, 0, dump(box, holder, second));
  assert.ok(running(holder), `the holder ended, so the second may have been granted as the first\n${dump(box, holder, second)}`);
});

test('#2924.AC3 a request waiting on memory is granted without a restart once its readings file is rewritten to allow it', { timeout: 60_000 }, async (t) => {
  const { box, holder, second, rewrite } = await heldThenSecond(t, { memory: 10 * GiB, load: 1, cores: 64 });
  await waits(box, second, WAIT, [holder], 'while the readings show 10 GiB of memory');
  rewrite({ memory: 64 * GiB, load: 1, cores: 64 });
  await started(box, second, AT_ONCE, [holder]);
  assert.equal(await second.done, 0, dump(box, holder, second));
  assert.ok(running(holder), `the holder ended, so the second may have been granted as the first\n${dump(box, holder, second)}`);
});
