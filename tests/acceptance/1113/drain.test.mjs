// #1113: inherited grants and the timed drain, on stub holders run through throttle.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMIT, dump, event, events, hold, sandbox, started, until } from './helpers.mjs';

const SLACK = 100; // ms between one stub's last note and the next one's first, for the throttle's own polling

test('#1113.ca815dac nested build and test requests under a build holder pass through, though both classes are full outside its chain', async (t) => {
  const box = sandbox(t);
  // A holds a build grant; after a second, its descendants ask for build and for test, each waiting at most 3 s.
  const a = hold(box, 'build', 1, { name: 'A', then: [
    { delay: 1_000, class: 'build', wait: 0.05, child: { name: 'A-build' } },
    { class: 'test', wait: 0.05, child: { name: 'A-test' } },
  ] });
  await started(box, 'A');
  // Meanwhile other chains fill the rest of build and all of test for 6 s.
  const others = [...Array.from({ length: LIMIT.build - 1 }, (_, i) => ['build', `build-${i}`]), ...Array.from({ length: LIMIT.test }, (_, i) => ['test', `test-${i}`])];
  for (const [kind, name] of others) hold(box, kind, 1, { name, hold: 6_000 });
  for (const [, name] of others) await started(box, name);
  const result = await a.done;
  const firstEnd = Math.min(...others.map(([, name]) => event(box, name, 'end')?.t ?? Infinity));
  for (const name of ['A-build', 'A-test']) {
    const start = event(box, name, 'start');
    assert.ok(start, `${name} never ran: a nested request under a build holder must pass through\n${dump(box, result)}`);
    assert.ok(start.t < firstEnd, `${name} waited for a grant outside its chain to end\n${dump(box, result)}`);
  }
  assert.deepEqual(events(box).filter((e) => e.name === 'A' && e.event === 'returned').map((e) => e.status), [0, 0], dump(box, result));
});

test('#1113.ca815dac a nested timed request under a build holder still drains: it waits for a holder outside its chain, and no other grant starts until it ends', async (t) => {
  const box = sandbox(t);
  const b = hold(box, 'test', 1, { name: 'B', hold: 2_000 });
  await started(box, 'B');
  const a = hold(box, 'build', 1, { name: 'A', then: [{ class: 'timed', wait: 0.5, child: { name: 'T', hold: 1_500 } }] });
  await started(box, 'A');
  assert.ok(await until(() => event(box, 'A', 'request'), 5_000), dump(box));
  await new Promise((done) => setTimeout(done, 300));
  // New top-level requests, after the timed one.
  const c = hold(box, 'build', 1, { name: 'C' });
  const d = hold(box, 'test', 1, { name: 'D' });
  const results = await Promise.all([a, b, c, d].map((run) => run.done));
  const all = dump(box, ...results);
  const timed = event(box, 'T', 'start'), timedEnd = event(box, 'T', 'end');
  assert.ok(timed && timedEnd, `the nested timed request never ran\n${all}`);
  assert.ok(timed.t >= event(box, 'B', 'end').t - SLACK, `timed started ${event(box, 'B', 'end').t - timed.t} ms before the test holder outside its chain ended: it passed through its build ancestor\n${all}`);
  for (const name of ['C', 'D']) {
    const start = event(box, name, 'start');
    assert.ok(start, `${name} never ran\n${all}`);
    assert.ok(start.t >= timedEnd.t - SLACK, `${name}'s grant started ${timedEnd.t - start.t} ms before the timed grant ended\n${all}`);
  }
  assert.equal(event(box, 'A', 'returned')?.status, 0, all);
});

// Two chains, each holding `kind`, each asking for a nested timed grant, the first 600 ms before the second.
async function twoChains(t, kinds) {
  const box = sandbox(t);
  const runs = kinds.map((kind, i) => hold(box, kind, 1, { name: `chain-${i}`, then: [{ delay: 300 + 600 * i, class: 'timed', wait: 0.25, child: { name: `timed-${i}`, hold: 1_000 } }] }));
  const results = await Promise.all(runs.map((run) => run.done));
  const all = dump(box, ...results);
  for (const i of [0, 1]) {
    const returned = event(box, `chain-${i}`, 'returned');
    assert.ok(returned, `chain ${i} never made its timed request\n${all}`);
    assert.equal(returned.status, 0, `chain ${i}'s nested timed request did not complete (its wait is 15 s)\n${all}`);
    assert.ok(event(box, `timed-${i}`, 'end'), `chain ${i}'s timed command never ran\n${all}`);
  }
  const [first, second] = [0, 1].sort((x, y) => event(box, `chain-${x}`, 'request').t - event(box, `chain-${y}`, 'request').t);
  assert.ok(event(box, `timed-${second}`, 'start').t >= event(box, `timed-${first}`, 'end').t - SLACK, `the timed grants overlapped or ran out of request order\n${all}`);
}

test('#1113.1f6072ef two timed requests nested in different chains (a build holder and a test holder) both complete in request order without hitting the timeout', async (t) => {
  await twoChains(t, ['build', 'test']);
});

test('#1113.1f6072ef two chains that each hold a bay pair and each make a nested timed request both complete in request order without hitting the timeout', async (t) => {
  await twoChains(t, ['bay-pair', 'bay-pair']);
});
