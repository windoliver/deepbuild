// #2975 AC5: a confirmed `deep hub stop` (you.confirm answered yes) still exits 0 and stays down, including when a
// SIGTERM reaches the hub after the confirmation and before it exits (README: The surface).
import { test } from 'node:test';
import { LONG, NODE, WATCH_MS, CLI, assert, asks, confirming, ended, exitOf, hello, launch, launchd, redact, refuses, runs, sandbox, shown, startInstalled, until, wait } from './helpers.mjs';

test('#2975.03961608 a confirmed deep hub stop still exits 0 and stays down, with a SIGTERM reaching the hub after the confirmation and before it exits', LONG, async (t) => {
  const box = await sandbox(t);
  const { pid } = await startInstalled(box);
  confirming(box, 'confirmed');

  const stop = launch(box, [NODE, CLI, 'hub', 'stop']);
  // After the confirmation: the OS was asked and said yes, and the hub has begun its stop (it no longer listens).
  const stopping = await until(async () => asks(box).length > 0 && (await refuses(box.socket)), 120_000, 5);
  assert.ok(stopping, `BLOCKED: the confirmed deep hub stop never got the hub to stop listening within 120 s (asks of the OS: ${asks(box).length}; the stop: ${shown(await Promise.race([stop.done, wait(1).then(() => undefined)]), box)})`);
  // Before it exits: SIGTERMs, each one delivered to the hub's still-running process, until it is gone.
  let landed = 0;
  while (runs(pid) && !exitOf(box, pid)) {
    try { process.kill(pid, 'SIGTERM'); landed++; } catch { break; }
    await wait(10);
  }
  const run = await ended(stop, 300_000);
  assert.equal(run.status, 0, `deep hub stop, the OS confirming you, must exit 0: ${shown(run, box)}`);
  const exit = await until(() => exitOf(box, pid), 60_000);
  assert.ok(exit, `after a confirmed deep hub stop the installed hub (PID ${pid}) still ran a minute later`);
  t.diagnostic(`SIGTERMs delivered after the confirmation and before the exit: ${landed}`);
  if (landed === 0) return t.skip('INCONCLUSIVE: the hub exited before any SIGTERM could reach it after the confirmation; run again');
  assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 0, signal: null }, `a confirmed stop must still exit 0 though ${landed} SIGTERM(s) reached the hub while it stopped; it exited ${exit.code === null ? `on ${exit.signal}` : exit.code}`);

  // Stays down: no hub answers and the login service starts none, past three of launchd's 10 s throttles.
  const back = await until(() => hello(box, { ms: 2000 }), WATCH_MS);
  const started = launchd(box).filter((e) => e.event === 'start' && e.t >= exit.t);
  assert.ok(!back && started.length === 0, `after a confirmed deep hub stop the installed hub must stay down; ${started.length} start(s) within ${WATCH_MS / 1000} s, a hub answers: ${!!back} (${redact(JSON.stringify(started), box)})`);
});
