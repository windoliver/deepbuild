// #2974 AC4 (README: The scenes): `deep hub promote` whose drain call times out leaves no drain: start.session is
// served again within 1 s of its exit, with the hub still on the build that was in. The hub is made too slow to answer
// as a heavy load makes it: paused with SIGSTOP (by the PID its own health gave) for 14 s, past promote's 10 s control
// timeout, from just after promote said it waits for a running turn, and resumed with SIGCONT then, or as soon as
// promote exits if it exits sooner.
import { test } from 'node:test';
import { AFTER_EXIT_MS, LONG, assert, current, drained, hello, hubPid, promotedWithTurn, promoting, redact, runs, said, sandbox, servedAfter, sha7, start, waitsForTurn } from './helpers.mjs';

const PAUSE_MS = 14_000;

test('#2974.b5722acf deep hub promote whose drain call times out leaves no drain: start.session is served within 1 s of its exit, the hub still on the build that was in', LONG, async (t) => {
  const box = await sandbox(t);
  const { fx, before, pid, build } = await promotedWithTurn(box);
  const p = promoting(box, fx, build);
  const blocked = await waitsForTurn(box, p);
  assert.ok(!blocked, blocked);
  const under = await start(box);
  assert.ok(drained(under), `BLOCKED: while deep hub promote waits for the running turn, a start wasn't paused by its drain: ${said(under, box)}`);

  // Promote renews its drain each second while it waits: the next call meets a hub that can't answer.
  box.stopped.push(pid);
  process.kill(pid, 'SIGSTOP');
  const paused = Date.now();
  const early = await Promise.race([p.exited, new Promise((done) => setTimeout(() => done(undefined), PAUSE_MS))]);
  process.kill(pid, 'SIGCONT');
  const resumed = Date.now();
  const exit = early ?? await Promise.race([p.exited, new Promise((done) => setTimeout(() => done(undefined), 180_000))]);
  const run = exit ? await p.done : undefined;
  assert.ok(exit, `BLOCKED: deep hub promote didn't exit within 180 s of its drain call timing out (the hub paused ${Math.round((resumed - paused) / 1000)} s): ${redact(p.out + p.err, box)}`);
  assert.ok(/drain/i.test(run.stderr), `BLOCKED: deep hub promote didn't end on its drain call (exit ${run.status ?? run.signal}): ${redact(run.stdout + run.stderr, box)}`);

  const { got, sent } = await servedAfter(box, exit, AFTER_EXIT_MS);
  assert.ok(got && got.t <= exit + AFTER_EXIT_MS, `deep hub promote whose hub.drain call timed out left its drain holding: no start.session sent within ${AFTER_EXIT_MS / 1000} s of its exit was served (${sent.length} sent; the last: ${said(sent.at(-1), box)}). It must lift its own drain when it fails before the hub stops. The hub was paused ${Math.round((resumed - paused) / 1000)} s; promote exited ${Math.round((exit - paused) / 1000)} s after the pause began, ${run.status ?? run.signal}: ${redact(run.stderr.slice(-500), box)}`);

  const now = await hello(box, { ms: 10_000 });
  assert.equal(now?.start, before.start, 'a promotion whose drain call timed out must leave the hub that was in: the installed hub\'s start ID changed');
  assert.ok(runs(pid) && (await hubPid(box, { ms: 60_000 })) === pid, `a promotion whose drain call timed out must leave the hub that was in (PID ${pid}) running`);
  assert.equal(current(box)?.commit, fx.c1, `a promotion whose drain call timed out must leave ~/.deepbuild/versions/current on the build that was in, ${sha7(fx.c1)}; it names ${redact(JSON.stringify(current(box)), box)}`);
});
