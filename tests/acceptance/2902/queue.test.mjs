// #2902: a waiter from an old checkout at the head of the test queue no longer caps the machine at its own limit,
// and with no old waiter the queue's order is unchanged. Every throttle.mjs runs as a process against a table of the
// test's own (DEEP_THROTTLE_TABLE, docs/parallel-proof.md section 6, "Tables of a test's own"); the live table is
// never touched. The current code's test limit is read from scripts/throttle.mjs's LIMITS line, never hard-coded.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, finish, pause, running, sandbox, started, startOf, throttle } from '../2744/helpers.mjs';
import { testLimit } from '../2744-redraft-2833/helpers.mjs';
import { OLD_LIMIT, oldCheckout, requestOf, run, table, until } from './helpers.mjs';

const GRANT_MS = 60_000;

test('#2902.5c1e8a3f an old checkout\'s waiter at the head of the test queue, with its own 4 grants held, doesn\'t stop the current code\'s requests: they are granted up to the current limit, and the one after waits', {
  timeout: 300_000,
  skip: process.platform === 'darwin' && 'AC1 is the Linux limits (an old checkout\'s test: 4 under the current test: 6); macOS has test: 2 in both',
}, async (t) => {
  const LIMIT = testLimit('linux');
  assert.ok(LIMIT > OLD_LIMIT, `scripts/throttle.mjs's Linux test limit is ${LIMIT}, not above an old checkout's ${OLD_LIMIT}: AC1 has nothing to show`);
  const box = sandbox(t);
  const old = oldCheckout(box);
  // 4 test grants held.
  const holders = [];
  for (let k = 1; k <= OLD_LIMIT; k++) {
    holders.push(throttle(box, ['test', '--wait', '2'], `holder-${k}`));
    await started(box, holders.at(-1), 'test', GRANT_MS, ...holders);
  }
  // A live waiter from an old checkout: its request in the table, recording no limit, its own code allowing 4.
  const stale = run(box, old, ['test', '--wait', '10'], 'old-waiter');
  const queued = await until(async () => (await requestOf(box, stale.pid)) || !running(stale), GRANT_MS);
  assert.ok(queued && running(stale), `the old checkout's request never appeared in the table\n${dump(box, ...holders, stale)}`);
  const head = (await table(box)).requests.filter((request) => request.class === 'test');
  assert.deepEqual(head.map((request) => request.pid), [stale.pid], `the old checkout's waiter isn't alone at the head of the test queue\n${dump(box, ...holders, stale)}`);
  assert.equal(startOf(box, 'old-waiter'), undefined, `the old checkout's waiter was granted beyond its own limit of ${OLD_LIMIT}\n${dump(box, ...holders, stale)}`);

  // The current code's requests, one after another, are granted until the current limit is held.
  const current = [];
  for (let k = OLD_LIMIT + 1; k <= LIMIT; k++) {
    const next = throttle(box, ['test', '--wait', '3'], `current-${k}`);
    current.push(next);
    await until(async () => startOf(box, next.label) || !running(next), GRANT_MS);
    assert.ok(startOf(box, next.label), `the current code's test request number ${k} (current limit ${LIMIT}) wasn't granted within ${GRANT_MS / 1000} s: it waits behind the old checkout's waiter at the head of the queue\n${dump(box, ...holders, stale, ...current)}`);
    assert.match(String(startOf(box, next.label).throttle), /^test:\S+$/, `current-${k} ran under no test grant\n${dump(box, ...holders, stale, ...current)}`);
    assert.ok(running(stale) && (await requestOf(box, stale.pid)), `the old checkout's waiter left the queue, so it no longer stood at the head\n${dump(box, ...holders, stale, ...current)}`);
  }
  assert.equal(startOf(box, 'old-waiter'), undefined, `the old checkout's waiter was granted beyond its own limit of ${OLD_LIMIT}\n${dump(box, ...holders, stale, ...current)}`);

  // The request after the current limit waits.
  const over = throttle(box, ['test', '--wait', '3'], `current-${LIMIT + 1}`);
  const pending = await until(async () => (await requestOf(box, over.pid)) || startOf(box, over.label) || !running(over), GRANT_MS);
  assert.ok(pending, `request ${LIMIT + 1} never reached the table\n${dump(box, ...holders, stale, ...current, over)}`);
  // A negative needs time: 3 s is about 15 of the throttle's 200 ms polls.
  await pause(3_000);
  assert.equal(startOf(box, over.label), undefined, `request ${LIMIT + 1} was granted beyond the current limit of ${LIMIT}\n${dump(box, ...holders, stale, ...current, over)}`);
  assert.ok(running(over) && (await requestOf(box, over.pid)), `request ${LIMIT + 1} ended instead of waiting\n${dump(box, ...holders, stale, ...current, over)}`);
  const grants = (await table(box)).grants.filter((grant) => grant.class === 'test');
  assert.equal(grants.length, LIMIT, `the table holds ${grants.length} test grants, not the current limit ${LIMIT}\n${dump(box, ...holders, stale, ...current, over)}`);
});

test('#2902.b47d09e2 with no old waiter the order is unchanged: with the test class full a later request waits behind an earlier one, and the earlier one is granted first when a slot frees', { timeout: 300_000 }, async (t) => {
  const LIMIT = testLimit();
  const box = sandbox(t);
  const holders = [];
  for (let k = 1; k <= LIMIT; k++) {
    holders.push(throttle(box, ['test', '--wait', '2'], `holder-${k}`));
    await started(box, holders.at(-1), 'test', GRANT_MS, ...holders);
  }
  const earlier = throttle(box, ['test', '--wait', '3'], 'earlier');
  assert.ok(await until(async () => (await requestOf(box, earlier.pid)) || !running(earlier), GRANT_MS) && running(earlier), `the earlier request never queued\n${dump(box, ...holders, earlier)}`);
  const later = throttle(box, ['test', '--wait', '3'], 'later');
  assert.ok(await until(async () => (await requestOf(box, later.pid)) || !running(later), GRANT_MS) && running(later), `the later request never queued\n${dump(box, ...holders, earlier, later)}`);
  const all = [...holders, earlier, later];
  assert.ok(!startOf(box, 'earlier') && !startOf(box, 'later'), `a request was granted while the class was full\n${dump(box, ...all)}`);

  // One slot frees: the earlier request takes it, and the later one still waits (the class is full again).
  finish(box, 'holder-1');
  await until(async () => startOf(box, 'earlier') || startOf(box, 'later') || !running(earlier) || !running(later), GRANT_MS);
  assert.ok(startOf(box, 'earlier'), `the earlier request wasn't granted when a slot freed\n${dump(box, ...all)}`);
  assert.equal(startOf(box, 'later'), undefined, `the later request was granted before or with the earlier one, with one slot free\n${dump(box, ...all)}`);
  assert.ok(running(later) && (await requestOf(box, later.pid)), `the later request ended instead of waiting\n${dump(box, ...all)}`);

  // The next slot goes to the later request.
  finish(box, 'holder-2');
  await started(box, later, 'test', GRANT_MS, ...all);
});
