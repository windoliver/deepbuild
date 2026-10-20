// #56: timeout tests on a virtual clock pass 20 of 20 runs. With `--clock virtual`, the hub's time
// starts at 0 and moves only when the test sends `tick`, so the 2-second hold timeout and its
// place among retries are checked to the millisecond without waiting 2 s. One test checks the same
// 2 s on the real clock.
// Run: node --test --test-concurrency=1 tests/acceptance/56/timeouts.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATTEMPTS, assertNoLeases, HOLD_MS, holdCheck, request, setup, sleep, VARIANTS, VIRTUAL_RUNS, waitFor, waitGone, within,
} from './helpers.mjs';

const ID = '#56.57268f7d';
const QUIET_MS = 200; // how long a hold must stay unanswered before the clock reaches its deadline

async function tick(socket, ms, expectNow) {
  const reply = await request(socket, { op: 'tick', ms });
  assert.equal(reply.now, expectNow, `tick ${ms} moves the virtual clock to ${expectNow}: ${JSON.stringify(reply)}`);
}

async function quiet(holds, what) {
  await sleep(QUIET_MS);
  for (const { handle, key } of holds) assert.equal(handle.replied, undefined, `${key} must not be answered ${what}: ${JSON.stringify(handle.replied)}`);
}

// One run of the virtual-clock timeout tests, on a fresh hub.
async function virtualRun(t, variant) {
  const { hub, fx, ports } = await setup(t, variant, { virtual: true });
  const socket = hub.socket;
  try {
    // Retries don't wait on any clock: a flaky check passes on its last retry, and one that never
    // passes stops after three retries, both with the virtual clock still at 0.
    const flaky = holdCheck(socket, fx.check('flaky', ['fail', 'fail', 'fail', 'pass']));
    const broken = holdCheck(socket, fx.check('broken', ['fail']));
    for (const { handle } of [flaky, broken]) assert.equal((await within(handle.ack, 3000, 'an acknowledgement')).hold_until_ms, HOLD_MS, 'a hold made at virtual 0 is due at 2000');
    const passed = await within(flaky.handle.reply, 10_000, 'the flaky hold');
    const failed = await within(broken.handle.reply, 10_000, 'the broken hold');
    assert.deepEqual({ outcome: passed.outcome, attempts: passed.attempts }, { outcome: 'pass', attempts: ATTEMPTS }, JSON.stringify(passed));
    assert.deepEqual({ outcome: failed.outcome, attempts: failed.attempts }, { outcome: 'fail', attempts: ATTEMPTS }, JSON.stringify(failed));
    assert.deepEqual([fx.starts(flaky.key), fx.starts(broken.key)], [ATTEMPTS, ATTEMPTS], 'each check ran once and was retried three times, no more');

    // The 2 s covers the whole hold, retries included, and a timed-out attempt isn't retried.
    const hung = holdCheck(socket, fx.check('hung', ['hang'], 1));
    const late = holdCheck(socket, fx.check('late', ['fail', 'hang']));
    const once = holdCheck(socket, fx.check('once', ['hang', 'pass']));
    const waiting = [hung, late, once];
    for (const { handle } of waiting) assert.equal((await within(handle.ack, 3000, 'an acknowledgement')).hold_until_ms, HOLD_MS, 'the clock has not moved, so these are due at 2000 too');
    await waitFor(() => fx.bound(hung.key, 1) && fx.bound(late.key, 2) && fx.bound(once.key, 1), 10_000, 'the hanging attempts to start');
    await tick(socket, HOLD_MS - 1, HOLD_MS - 1);
    await quiet(waiting, 'at 1999 ms');
    await tick(socket, 1, HOLD_MS);
    for (const { handle, key } of waiting) {
      const reply = await within(handle.reply, 1000, `${key} to time out once the virtual clock reaches 2000`);
      assert.equal(reply.outcome, 'timeout', `${key}: ${JSON.stringify(reply)}`);
      assert.ok(handle.replyAt - handle.sentAt < HOLD_MS - 300, `${key} timed out on the virtual clock, not after 2 s of wall time (${Math.round(handle.replyAt - handle.sentAt)} ms)`);
    }
    assert.deepEqual([hung.handle.replied.attempts, late.handle.replied.attempts, once.handle.replied.attempts], [1, 2, 1], 'attempts at the timeout');
    await sleep(QUIET_MS);
    assert.equal(fx.starts(once.key), 1, 'a timed-out attempt is not retried');

    // A hold made later is due 2 s after it arrived, and not a millisecond sooner.
    const next = holdCheck(socket, fx.check('next', ['hang']));
    assert.equal((await within(next.handle.ack, 3000, 'an acknowledgement')).hold_until_ms, 2 * HOLD_MS, 'a hold made at virtual 2000 is due at 4000');
    await waitFor(() => fx.bound(next.key, 1), 10_000, 'its attempt to start');
    await tick(socket, 1000, 3000);
    await quiet([next], 'at 3000 ms');
    await tick(socket, 999, 3999);
    await quiet([next], 'at 3999 ms');
    await tick(socket, 1, 4000);
    assert.equal((await within(next.handle.reply, 1000, 'the later hold to time out at 4000')).outcome, 'timeout');

    // Whatever grace the hub gives a stop runs on the same clock; past it nothing is left.
    await tick(socket, 60_000, 64_000);
    assert.deepEqual(await waitGone(fx.run, 3000), [], 'no process outlives its timed-out hold');
    await assertNoLeases(socket, ports);
  } finally {
    try { process.kill(hub.pid, 'SIGKILL'); } catch {}
  }
}

for (const variant of VARIANTS) {
  test(`${ID} [${variant}] the timeout tests on a virtual clock pass 20 of 20 runs`, { timeout: 600_000 }, async (t) => {
    const failures = [];
    let passed = 0;
    for (let run = 1; run <= VIRTUAL_RUNS; run++) {
      try {
        await virtualRun(t, variant);
        passed++;
      } catch (error) {
        failures.push(`run ${run}: ${error.message}`);
      }
    }
    assert.equal(passed, VIRTUAL_RUNS, `${passed} of ${VIRTUAL_RUNS} runs passed:\n${failures.join('\n')}`);
  });

  test(`${ID} [${variant}] on the real clock a hold times out 2 s after it arrives, whatever its check is still doing`, { timeout: 60_000 }, async (t) => {
    const { hub, fx, ports } = await setup(t, variant);
    const hung = holdCheck(hub.socket, fx.check('hung', ['hang'], 1));
    const slow = holdCheck(hub.socket, fx.check('slow', ['pass:3500']));
    for (const { handle } of [hung, slow]) {
      const due = (await within(handle.ack, 3000, 'an acknowledgement')).hold_until_ms - handle.sentEpoch;
      assert.ok(due >= HOLD_MS - 100 && due <= HOLD_MS + 250, `hold_until_ms is 2 s after the request: ${due} ms`);
    }
    for (const { handle, key } of [hung, slow]) {
      const reply = await within(handle.reply, HOLD_MS + 2000, `${key} to time out`);
      const tookMs = handle.replyAt - handle.sentAt;
      assert.equal(reply.outcome, 'timeout', `${key}: ${JSON.stringify(reply)}`);
      assert.ok(tookMs >= HOLD_MS - 50 && tookMs <= HOLD_MS + 700, `${key} timed out ${Math.round(tookMs)} ms after its request`);
    }
    assert.deepEqual(await waitGone(fx.run, 2000), [], 'no process outlives its timed-out hold');
    await assertNoLeases(hub.socket, ports);
  });
}
