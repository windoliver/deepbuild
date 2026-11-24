// #2570 AC2, the installed hub: with no hub and none exiting `deep hub start` starts one as today; a hub that never
// answers still fails at 15 s with today's message and exit 3 (REDRAFT.md: The scene). Both describe today's
// behaviour, so both pass at the base; they fail on a fix that waits where nothing is exiting, or changes the failure.
import { join } from 'node:path';
import { test } from 'node:test';
import { AC2, WAIT_MS, alive, assert, control, deep, hello, inconclusive, probe, quiet, sandbox, shown, wait } from './helpers.mjs';

/**
 * How long `deep hub start` took before it asked the service manager, from its own start: a deep command's start and
 * end (the probe) and its look at the socket, with room for a loaded machine. A start that waits for an exiting
 * process where there is none takes longer.
 */
function asksAtOnce(box, run, since, probeMs, what) {
  const call = box.events().find((e) => e.event === 'call' && e.t >= since);
  assert.ok(call, `${AC2} ${what}: deep hub start never asked the service manager:\n${shown(run)}`);
  const before = call.t - run.started;
  const bound = 2 * probeMs + 3000;
  if (before > bound && probeMs > 3000) inconclusive(`${what}: deep hub start asked the service manager ${before} ms after it began, past ${bound} ms, with a deep command taking ${probeMs} ms here`);
  assert.ok(before <= bound, `${AC2} ${what}: deep hub start waited ${before} ms before it asked the service manager, where there was no hub and none exiting (a deep command takes ${probeMs} ms here; bound ${bound} ms)`);
}

test(`${AC2} with no hub and none exiting, deep hub start starts one as today: exit 0, a hub answering`, { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  box.behave({});
  const probeMs = await probe(box);

  // A home that never had a hub.
  const fresh = await deep(box, ['hub', 'start'], 180_000);
  assert.equal(fresh.status, 0, `${AC2} deep hub start in a home with no hub didn't start one:\n${shown(fresh)}`);
  const first = await hello(box);
  assert.ok(first, `${AC2} deep hub start exited 0, but no hub answers at ${box.socket}`);
  asksAtOnce(box, fresh, fresh.started, probeMs, 'a home that never had a hub');

  // A hub that stopped and whose process is gone: none answers and none is exiting.
  const { pid } = await control(box, 'hub.health');
  await control(box, 'hub.stop');
  assert.ok(await quiet(box, 60_000), 'the hub still answered 60 s after hub.stop');
  for (const deadline = Date.now() + 60_000; alive(pid) && Date.now() < deadline;) await wait(50);
  if (alive(pid)) inconclusive(`the stopped hub's process (pid ${pid}) took over 60 s to end`);
  const since = Date.now();
  const again = await deep(box, ['hub', 'start'], 180_000);
  assert.equal(again.status, 0, `${AC2} deep hub start, after the last hub stopped and its process ended, didn't start one:\n${shown(again)}`);
  const second = await hello(box);
  assert.ok(second, `${AC2} deep hub start exited 0 after a stop, but no hub answers at ${box.socket}`);
  assert.notEqual(second.start, first.start, `${AC2} the hub that answers is the stopped one (start ${first.start})`);
  asksAtOnce(box, again, since, probeMs, 'a hub that stopped and whose process ended');
  box.untouched();
});

test(`${AC2} a hub that never answers still fails at 15 s with today's message and exit 3`, { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  box.behave({ neverAnswers: true });
  const probeMs = await probe(box);
  const run = await deep(box, ['hub', 'start'], 180_000);
  const call = box.events().find((e) => e.event === 'call');
  assert.ok(call, `${AC2} deep hub start never asked the service manager:\n${shown(run)}`);
  assert.ok(box.events().some((e) => e.event === 'never-answers'), `the stand-in's job didn't run as a hub that never answers: ${JSON.stringify(box.events())}`);
  assert.equal(run.status, 3, `${AC2} deep hub start, with a hub that never answers, didn't exit 3:\n${shown(run)}`);
  assert.equal(run.stderr, `deep hub start: no hub answered at unix:${box.socket} within 15 s; see ${join(box.logs, 'hub.log')}\n`, `${AC2} deep hub start's failure isn't today's message:\n${shown(run)}`);
  // At 15 s: the wait runs from the service manager's answer, which comes just after its call is logged.
  const waited = run.ended - call.t;
  assert.ok(waited >= WAIT_MS - 100, `${AC2} deep hub start gave up ${waited} ms after it asked the service manager, before 15 s`);
  const bound = WAIT_MS + Math.max(5000, 2 * probeMs);
  if (waited > bound && probeMs > 2500) inconclusive(`deep hub start ended ${waited} ms after it asked the service manager, past ${bound} ms, with a deep command taking ${probeMs} ms here`);
  assert.ok(waited <= bound, `${AC2} deep hub start ended ${waited} ms after it asked the service manager, not at 15 s (bound ${bound} ms; a deep command takes ${probeMs} ms here)`);
  box.untouched();
});
