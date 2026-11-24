// #2570 AC1, the installed hub: `deep hub start` asked for while a stopped hub's process is still exiting ends with a
// hub answering, exit 0 (REDRAFT.md: The scene). Fails at the base: the service manager is asked while the old job
// still runs, does nothing, the job then exits 0 and stays stopped, and the start fails at 15 s with exit 3.
import { test } from 'node:test';
import { AC1, alive, assert, control, deep, hello, inconclusive, probe, quiet, sandbox, shown } from './helpers.mjs';

/** How long the stopped hub's process stays up after it removed its socket and began to exit. */
const LINGER_MS = 12_000;

test(`${AC1} deep hub start asked for while a stopped hub's process is still exiting ends with a hub answering, exit 0`, { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  box.behave({ exitMs: LINGER_MS });
  // A deep command that takes a third of the linger just to start and end would let the old process go before the
  // start could ask the service manager: the scene would judge nothing.
  const probeMs = await probe(box);
  if (probeMs > LINGER_MS / 3) inconclusive(`a deep command took ${probeMs} ms to start and end here with no hub, too slow for a ${LINGER_MS} ms exit`);

  const first = await deep(box, ['hub', 'start'], 180_000);
  assert.equal(first.status, 0, `the scene's first deep hub start, with no hub and none exiting, didn't bring one up:\n${shown(first)}`);
  const before = await hello(box);
  assert.ok(before, 'the first deep hub start exited 0, but no hub answers');
  const { pid } = await control(box, 'hub.health');
  assert.ok(box.events().some((e) => e.event === 'start' && e.pid === pid), `the hub's process (pid ${pid}) isn't the job the stand-in started: ${JSON.stringify(box.events())}`);

  // The stop as a client makes it that doesn't wait for the process: hub.stop, its reply read, the connection closed.
  const stopping = await control(box, 'hub.stop');
  assert.equal(stopping?.stopping, true, `hub.stop answered ${JSON.stringify(stopping)}`);
  assert.ok(await quiet(box, 60_000), 'the hub still answered 60 s after hub.stop');
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
