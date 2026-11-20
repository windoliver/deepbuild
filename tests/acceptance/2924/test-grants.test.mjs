// #2924 AC1-AC3: a test grant past the first is decided by the readings in DEEP_THROTTLE_READINGS's file, on a table of
// the test's own (docs/parallel-proof.md section 6, "Tables of a test's own"), and the file is read again while a
// request waits.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GiB, dump, readings, request, running, sandbox, started, waits } from './helpers.mjs';

// On a loaded machine a node process can take seconds to start, so "at once" is within 15 s and "waits" is not
// started 8 s after the request: a base that grants at once starts the command well inside 8 s.
const AT_ONCE = 15_000;
const WAIT = 8_000;

/** One test grant held under `file`'s readings, then a second request under the same file. */
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
  const { box, holder, second } = await heldThenSecond(t, { memory: 1024 * GiB, load: 8, cores: 8 });
  await waits(box, second, WAIT, [holder], 'while the readings show load 8 on 8 cores');
});

test('#2924.AC2 with one settling test grant held, a second request waits while the readings show memory 1 byte below 48 GiB', { timeout: 60_000 }, async (t) => {
  const { box, holder, second } = await heldThenSecond(t, { memory: 48 * GiB - 1, load: 1, cores: 64 });
  await waits(box, second, WAIT, [holder], 'while the readings show memory below 48 GiB and the held grant is under 5 min old');
});

test('#2924.AC2 with one test grant held, a second request is granted at once under load below the cores and exactly 48 GiB', { timeout: 60_000 }, async (t) => {
  const { box, holder, second } = await heldThenSecond(t, { memory: 48 * GiB, load: 1, cores: 64 });
  await started(box, second, AT_ONCE, [holder]);
  assert.equal(await second.done, 0, dump(box, holder, second));
  assert.ok(running(holder), `the holder ended\n${dump(box, holder, second)}`);
});

test('#2924.AC3 a request waiting on load is granted without a restart once its readings file is rewritten to allow it', { timeout: 60_000 }, async (t) => {
  const { box, holder, second, rewrite } = await heldThenSecond(t, { memory: 1024 * GiB, load: 100, cores: 8 });
  await waits(box, second, WAIT, [holder], 'while the readings show load 100 on 8 cores');
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
