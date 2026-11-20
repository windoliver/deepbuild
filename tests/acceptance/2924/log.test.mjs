// #2924 AC6: the throttle log's `granted` entry for a test grant (`<table folder>/log`, JSON lines) carries
// `readings`, the {memory, load, cores} object the grant was decided on, or null on a test's own table without
// injected readings.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GiB, dump, log, readings, request, sandbox, started, until, waits } from './helpers.mjs';

const grantedTo = (box, run) => log(box).find((entry) => entry.event === 'granted' && entry.class === 'test' && entry.pid === run.pid);

test('#2924.AC6 each test grant\'s granted entry carries the readings it was decided on, the rewritten ones for a request that waited', { timeout: 60_000 }, async (t) => {
  const box = sandbox(t);
  const first = { memory: 0, load: 50, cores: 4 };
  const holder = request(box, 'holder', { env: { DEEP_THROTTLE_READINGS: readings(box, 'holder', first) } });
  await started(box, holder, 15_000);
  const blocking = { memory: 1024 * GiB, load: 9, cores: 8 };
  const allowing = { memory: 1024 * GiB, load: 2.5, cores: 8 };
  const second = request(box, 'second', { exit: true, env: { DEEP_THROTTLE_READINGS: readings(box, 'second', blocking) } });
  await waits(box, second, 8_000, [holder], 'while the readings show load 9 on 8 cores');
  readings(box, 'second', allowing);
  await started(box, second, 15_000, [holder]);
  await until(() => grantedTo(box, second), 2_000);
  assert.deepEqual(grantedTo(box, holder)?.readings, first, `the first grant's entry\n${dump(box, holder, second)}`);
  assert.deepEqual(grantedTo(box, second)?.readings, allowing, `the second grant's entry\n${dump(box, holder, second)}`);
});

test('#2924.AC6 on a test\'s own table without DEEP_THROTTLE_READINGS, a test grant\'s granted entry carries readings null', { timeout: 60_000 }, async (t) => {
  const box = sandbox(t);
  const run = request(box, 'plain', { exit: true });
  await started(box, run, 15_000);
  await run.done;
  const entry = grantedTo(box, run);
  assert.ok(entry, `no granted entry for pid ${run.pid}\n${dump(box, run)}`);
  assert.ok('readings' in entry, `the granted entry has no readings field: ${JSON.stringify(entry)}`);
  assert.equal(entry.readings, null, JSON.stringify(entry));
});
