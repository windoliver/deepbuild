// #56: no lease leaks across 1,000 randomized runs. 50 sessions hold hooks on checks that pass,
// fail, flake or hang, under leases from a pool of 10 ports, with random cancels and the extension
// that ignores its abort signal. Every run is one held hook. The seed is printed on failure;
// replay one with DEEP_SPIKE_SEED=<seed>.
// Run: node --test --test-concurrency=1 tests/acceptance/56/leases.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATTEMPTS, assertNoLeases, busyPorts, HOLD_MS, holdCheck, leases, POOL, RANDOMIZED_RUNS, random, request, seedFromEnv, SESSIONS, setup, sleep, VARIANTS, waitFor, waitGone, within,
} from './helpers.mjs';

const ID = '#56.80ab2a58';

// Samples the hub's leases while a workload runs: never more than the pool, never one port twice,
// never a port outside the pool.
function sampler(socket, ports) {
  const problems = [];
  let most = 0, running = true;
  const done = (async () => {
    while (running) {
      try {
        const { held } = await leases(socket);
        most = Math.max(most, held.length);
        const taken = held.map(({ port }) => port);
        if (taken.length > POOL) problems.push(`${taken.length} leases held at once`);
        if (new Set(taken).size !== taken.length) problems.push(`a port leased twice at once: ${JSON.stringify(held)}`);
        for (const port of taken) if (!ports.includes(port)) problems.push(`port ${port} is outside the pool`);
      } catch (error) {
        problems.push(`leases failed: ${error.message}`);
      }
      await sleep(25);
    }
  })();
  return { problems, most: () => most, stop: async () => { running = false; await done; } };
}

for (const variant of VARIANTS) {
  test(`${ID} [${variant}] 50 sessions holding hooks share a pool of 10 ports, never more than 10 leased at once, and every lease comes back`, { timeout: 120_000 }, async (t) => {
    const { hub, fx, ports } = await setup(t, variant);
    const leasesSeen = sampler(hub.socket, ports);
    const holds = Array.from({ length: SESSIONS }, (_, index) => holdCheck(hub.socket, fx.check(`s${index}`, ['pass'], 1)));
    for (const { handle } of holds) {
      const ack = await within(handle.ack, 5000, 'an acknowledgement');
      assert.equal(ack.ack, handle.id, `the acknowledgement names its hold: ${JSON.stringify(ack)}`);
      const due = ack.hold_until_ms - handle.sentEpoch;
      assert.ok(due >= HOLD_MS - 100 && due <= HOLD_MS + 250, `a hold is due 2 s after it arrives: hold_until_ms is ${due} ms after the request`);
    }
    const replies = await Promise.all(holds.map(({ handle }) => within(handle.reply, HOLD_MS + 3000, 'a reply')));
    await leasesSeen.stop();
    assert.deepEqual(replies.map(({ outcome }) => outcome), Array(SESSIONS).fill('pass'), `all 50 holds pass once a port frees up: ${JSON.stringify(replies.filter(({ outcome }) => outcome !== 'pass'))}`);
    assert.deepEqual(leasesSeen.problems, []);
    assert.ok(leasesSeen.most() >= 2, `the holds ran side by side under separate leases (at most ${leasesSeen.most()} seen)`);
    const used = new Set(fx.events().filter(({ event }) => event === 'bound').map(({ port }) => port));
    assert.ok([...used].every((port) => ports.includes(port)), `every check ran on a pool port: ${[...used]}`);
    assert.deepEqual(fx.problems(), [], 'no check ran without its port or on a port another check held');
    await assertNoLeases(hub.socket, ports);
    assert.deepEqual(await waitGone(fx.run, 2000), []);
    assert.deepEqual(await busyPorts(ports), []);
  });

  test(`${ID} [${variant}] 1,000 randomized runs with flaky checks, random cancels and an extension that ignores its abort signal leak no lease`, { timeout: 300_000 }, async (t) => {
    const seed = seedFromEnv();
    const draw = random(seed);
    const { hub, fx, ports } = await setup(t, variant);
    const leasesSeen = sampler(hub.socket, ports);
    // What each script must end as when nothing cancels it and it isn't still queued at 2 s.
    const scripts = [
      { script: ['pass'], outcome: 'pass', attempts: 1, weight: 28 },
      { script: ['pass:150'], outcome: 'pass', attempts: 1, weight: 8 },
      { script: ['fail', 'pass'], outcome: 'pass', attempts: 2, weight: 14 },
      { script: ['fail', 'fail', 'pass'], outcome: 'pass', attempts: 3, weight: 8 },
      { script: ['fail', 'fail', 'fail', 'pass'], outcome: 'pass', attempts: 4, weight: 8 },
      { script: ['fail', 'fail', 'fail', 'fail', 'pass'], outcome: 'fail', attempts: 4, weight: 8 },
      { script: ['fail'], outcome: 'fail', attempts: 4, weight: 10 },
      { script: ['fail:100', 'pass'], outcome: 'pass', attempts: 2, weight: 6 },
      { script: ['hang'], outcome: 'timeout', attempts: 1, weight: 6 },
      { script: ['fail', 'hang'], outcome: 'timeout', attempts: 2, weight: 4 },
    ];
    const bag = scripts.flatMap((entry) => Array(entry.weight).fill(entry));
    const failures = [];
    const counts = {};
    let started = 0;

    const one = async (session) => {
      const plan = draw.pick(bag);
      const check = fx.check(session, plan.script, draw.int(0, 2));
      const cancelAfter = draw.next() < 0.3 ? draw.int(0, 600) : null;
      const { handle, key } = holdCheck(hub.socket, check);
      let cancel = null;
      const cancelling = cancelAfter === null ? null : sleep(cancelAfter).then(() => request(hub.socket, { op: 'cancel', session })).then((reply) => { cancel = reply; }, (error) => { cancel = { error: error.message }; });
      const reply = await within(handle.reply, HOLD_MS + 3000, `${key}'s reply`).catch((error) => ({ missing: error.message }));
      await cancelling;
      const tookMs = Math.round(handle.replyAt - handle.sentAt);
      const fail = (why) => failures.push(`${key} ${JSON.stringify(plan.script)} cancel@${cancelAfter}: ${why}; reply ${JSON.stringify(reply)} after ${tookMs} ms, cancel ${JSON.stringify(cancel)}`);
      counts[reply.outcome ?? 'none'] = (counts[reply.outcome ?? 'none'] ?? 0) + 1;
      if (!reply.outcome) return fail('no reply');
      if (cancel?.error) fail('the cancel failed');
      const cancelled = cancel?.cancelled ?? 0;
      if (reply.outcome === 'cancelled' && cancelled !== 1) fail('cancelled without a cancel that cancelled it');
      if (cancelled === 1 && reply.outcome !== 'cancelled') fail('a cancel that cancelled the hold, but another outcome');
      if (!Number.isSafeInteger(reply.attempts) || reply.attempts < 0 || reply.attempts > ATTEMPTS) fail(`attempts must be 0 to ${ATTEMPTS}`);
      // A stopped attempt may die before the fixture writes its first line, so only a hold that
      // ended on its own has to match the fixture's count exactly.
      if (fx.starts(key) > reply.attempts) fail(`the reply says ${reply.attempts} attempts, the check started ${fx.starts(key)}`);
      if (['pass', 'fail'].includes(reply.outcome) && fx.starts(key) !== reply.attempts) fail(`the reply says ${reply.attempts} attempts, the check started ${fx.starts(key)}`);
      if (reply.outcome === 'cancelled') return;
      if (reply.outcome === 'timeout') {
        if (tookMs < HOLD_MS - 50) fail('timed out before 2 s');
        if (tookMs > HOLD_MS + 1500) fail('replied long after the 2 s timeout');
        return;
      }
      if (reply.outcome !== plan.outcome) return fail(`expected ${plan.outcome} or timeout`);
      if (reply.attempts !== plan.attempts) fail(`expected ${plan.attempts} attempts`);
    };

    const worker = async (index) => {
      while (started < RANDOMIZED_RUNS) {
        started++;
        await one(`s${index}`);
        await sleep(draw.int(0, 150));
      }
    };
    await Promise.all(Array.from({ length: SESSIONS }, (_, index) => worker(index)));
    await leasesSeen.stop();

    await sleep(300);
    const starts = {};
    for (const { event, key } of fx.events()) if (event === 'start') starts[key] = (starts[key] ?? 0) + 1;
    for (const [key, count] of Object.entries(starts)) if (count > ATTEMPTS) failures.push(`${key}: ${count} attempts started, more than one try and three retries`);
    const where = `seed ${seed} (replay with DEEP_SPIKE_SEED=${seed}); outcomes ${JSON.stringify(counts)}`;
    assert.deepEqual(failures.slice(0, 15), [], `${failures.length} of ${RANDOMIZED_RUNS} runs went wrong, ${where}`);
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), RANDOMIZED_RUNS, where);
    for (const outcome of ['pass', 'fail', 'timeout', 'cancelled']) assert.ok(counts[outcome] > 0, `the runs covered ${outcome}: ${where}`);
    assert.deepEqual(leasesSeen.problems.slice(0, 10), [], where);
    assert.deepEqual(fx.problems().slice(0, 10), [], `no check ran without its port or on a port a live attempt held, ${where}`);
    await assertNoLeases(hub.socket, ports).catch((error) => assert.fail(`${error.message}\n${where}`));
    assert.deepEqual(await waitGone(fx.run, 3000), [], `no process outlives its run, ${where}`);
    assert.deepEqual(await busyPorts(ports), [], `every pool port is free, ${where}`);
    await waitFor(() => fx.extension().filter(({ event }) => event === 'aborted').length === RANDOMIZED_RUNS, 3000, `every hold's extension signal to abort (${fx.extension().filter(({ event }) => event === 'called').length} called), ${where}`);
  });
}
