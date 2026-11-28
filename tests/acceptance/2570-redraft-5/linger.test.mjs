import { join } from 'node:path';
import { test } from 'node:test';
import { AC1, AC2, WAIT_MS, alive, assert, control, deep, hello, inconclusive, probe, quiet, sandbox, shown } from '../2570-redraft-4/helpers.mjs';
import { until } from '../2570/helpers.mjs';
import { confirming } from './helpers.mjs';

const LINGER_MS = 12_000;

async function stopAsYou(box) {
  const run = await deep(box, ['hub', 'stop'], 120_000);
  assert.equal(run.status, 0, `the scene's own step, deep hub stop, failed:\n${shown(run)}`);
}

function asksAtOnce(box, run, since, probeMs, what) {
  const call = box.events().find((e) => e.event === 'call' && e.t >= since);
  assert.ok(call, `${AC2} ${what}: deep hub start never asked the service manager:\n${shown(run)}`);
  const before = call.t - run.started;
  const bound = 2 * probeMs + 3000;
  if (before > bound && probeMs > 3000) inconclusive(`${what}: deep hub start asked the service manager ${before} ms after it began, past ${bound} ms, with a deep command taking ${probeMs} ms here`);
  assert.ok(before <= bound, `${AC2} ${what}: deep hub start waited ${before} ms before it asked the service manager, where there was no hub and none exiting (a deep command takes ${probeMs} ms here; bound ${bound} ms)`);
}

test(`${AC1} deep hub start asked for while a stopped hub's process is still exiting ends with a hub answering, exit 0`, { timeout: 600_000 }, async (t) => {
  const box = confirming(sandbox(t), true);
  box.behave({ exitMs: LINGER_MS });
  const probeMs = await probe(box);
  if (probeMs > LINGER_MS / 3) inconclusive(`a deep command took ${probeMs} ms to start and end here with no hub, too slow for a ${LINGER_MS} ms exit`);

  const first = await deep(box, ['hub', 'start'], 180_000);
  assert.equal(first.status, 0, `the scene's first deep hub start, with no hub and none exiting, didn't bring one up:\n${shown(first)}`);
  const before = await hello(box);
  assert.ok(before, 'the first deep hub start exited 0, but no hub answers');
  const { pid } = await control(box, 'hub.health');
  assert.ok(box.events().some((e) => e.event === 'start' && e.pid === pid), `the hub's process (pid ${pid}) isn't the job the stand-in started: ${JSON.stringify(box.events())}`);

  await stopAsYou(box);
  assert.ok(await quiet(box, 60_000), 'the hub still answered 60 s after deep hub stop');
  if (!alive(pid)) inconclusive(`the stopped hub's process (pid ${pid}) ended before deep hub start could be asked for`);
  const quietAt = Date.now();

  const run = await deep(box, ['hub', 'start'], 180_000);
  const events = box.events().filter((e) => e.t >= quietAt);
  const exited = events.find((e) => e.event === 'exit' && e.pid === pid);
  if (exited && exited.t <= run.started) inconclusive(`the stopped hub's process ended ${run.started - exited.t} ms before deep hub start began`);
  const told = events.map((e) => `+${e.t - run.started} ms ${JSON.stringify({ ...e, t: undefined })}`).join('\n');
  assert.equal(run.status, 0, `${AC1} deep hub start, asked for while the stopped hub's process (pid ${pid}) was still exiting, didn't end with a hub answering:\n${shown(run)}\nthe stand-in, from deep hub start's start:\n${told}`);
  const after = await hello(box);
  assert.ok(after, `${AC1} deep hub start exited 0, but no hub answers at ${box.socket}`);
  assert.notEqual(after.start, before.start, `${AC1} the hub that answers is the one that was stopped (start ${before.start})`);
  const now = await control(box, 'hub.health');
  assert.notEqual(now.pid, pid, `${AC1} the hub that answers is the stopped hub's process`);
  assert.equal(alive(pid), false, `${AC1} the stopped hub's process (pid ${pid}) still runs beside the new hub`);
  box.untouched();
});

test(`${AC2} with no hub and none exiting, deep hub start starts one as today: exit 0, a hub answering`, { timeout: 600_000 }, async (t) => {
  const box = confirming(sandbox(t), true);
  box.behave({});
  const probeMs = await probe(box);

  const fresh = await deep(box, ['hub', 'start'], 180_000);
  assert.equal(fresh.status, 0, `${AC2} deep hub start in a home with no hub didn't start one:\n${shown(fresh)}`);
  const first = await hello(box);
  assert.ok(first, `${AC2} deep hub start exited 0, but no hub answers at ${box.socket}`);
  asksAtOnce(box, fresh, fresh.started, probeMs, 'a home that never had a hub');

  const { pid } = await control(box, 'hub.health');
  await stopAsYou(box);
  assert.ok(await quiet(box, 60_000), 'the hub still answered 60 s after deep hub stop');
  await until(() => !alive(pid), 60_000, 50);
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
  const waited = run.ended - call.t;
  assert.ok(waited >= WAIT_MS - 100, `${AC2} deep hub start gave up ${waited} ms after it asked the service manager, before 15 s`);
  const bound = WAIT_MS + Math.max(5000, 2 * probeMs);
  if (waited > bound && probeMs > 2500) inconclusive(`deep hub start ended ${waited} ms after it asked the service manager, past ${bound} ms, with a deep command taking ${probeMs} ms here`);
  assert.ok(waited <= bound, `${AC2} deep hub start ended ${waited} ms after it asked the service manager, not at 15 s (bound ${bound} ms; a deep command takes ${probeMs} ms here)`);
  box.untouched();
});
