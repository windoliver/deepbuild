// #1865 AC2: a confirmed `deep hub stop` still stops the installed hub, and the login service doesn't start it again
// before your next login (README: The scenes).
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { LONG, WATCH_MS, assert, confirming, deep, hello, launchd, runs, sandbox, shown, startInstalled, until } from './helpers.mjs';

test('#1865.2e5dc4d0 a confirmed deep hub stop still stops the installed hub, and the login service doesn\'t start it again before your next login', LONG, async (t) => {
  const box = await sandbox(t);
  const { pid } = await startInstalled(box);
  confirming(box, 'confirmed');

  const run = await deep(box, ['hub', 'stop']);
  assert.equal(run.status, 0, `deep hub stop, the OS confirming you, must stop the installed hub and exit 0: ${shown(run, box)}`);
  const gone = await until(async () => !(await hello(box, { ms: 2000 })) && !runs(pid), 60_000);
  assert.ok(gone, `after a confirmed deep hub stop the installed hub (PID ${pid}) still runs a minute later`);

  // No login yet: the login service must leave it stopped, past three of launchd's 10 s restart throttles.
  const back = await until(() => hello(box, { ms: 2000 }), WATCH_MS);
  const started = launchd(box).filter((e) => e.event === 'start' && e.t >= run.started);
  const exits = launchd(box).filter((e) => e.event === 'exit' && e.pid === pid);
  assert.ok(!back && started.length === 0, `after a confirmed deep hub stop the login service started the installed hub again before any login (${started.length} start(s) within ${WATCH_MS / 1000} s; the stopped hub's exit: ${JSON.stringify(exits)}; a hub answers: ${!!back}). A confirmed stop must leave it down until your next login`);

  // Your next login: the login service loads its definition again, and the hub starts.
  const file = launchd(box).filter((e) => e.event === 'load').at(-1)?.file;
  const login = spawnSync(box.env.DEEP_HUB_LAUNCHER, [file], { env: box.env, encoding: 'utf8' });
  assert.equal(login.status, 0, `BLOCKED: the login service's stand-in didn't load ${file}: ${login.stderr}`);
  const next = await until(() => hello(box, { ms: 2000 }), 120_000);
  assert.ok(next, 'at your next login the login service must start the installed hub again: its definition must still be there, and no hub answered within 120 s');
});
