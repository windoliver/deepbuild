// #2975 AC4: a dev hub started with --root still exits 0 on SIGTERM and on SIGINT, and stays down (README: The surface).
import { test } from 'node:test';
import { join } from 'node:path';
import { CLI, LONG, NODE, WATCH_MS, assert, call, ended, hello, killAs, launch, launchd, sandbox, shown, until } from './helpers.mjs';

test('#2975.c596419b a dev hub started with --root still exits 0 on SIGTERM and on SIGINT, and stays down', LONG, async (t) => {
  const box = await sandbox(t);
  const dev = join(box.dir, 'dev'), socket = join(dev, 'hub.sock');
  const exits = {};
  for (const signal of ['TERM', 'INT']) {
    // The dev hub's own program, as `deep hub start --root` spawns it: `deep hub run --root <folder>`.
    const hub = launch(box, [NODE, CLI, 'hub', 'run', '--root', dev]);
    const up = await until(async () => (await call(box, 'hub.health', {}, { socket, ms: 30_000 }))?.result?.pid, 180_000, 250);
    assert.ok(up, `BLOCKED: the dev hub never answered hub.health: ${shown(await Promise.race([hub.done, Promise.resolve(undefined)]), box)}`);
    assert.equal(up, hub.pid, 'BLOCKED: the dev hub answering is not the process this test started');
    assert.equal(await killAs(box, signal, hub.pid), 0, `BLOCKED: kill -${signal} ${hub.pid} failed`);
    const run = await ended(hub, 60_000);
    exits[signal] = run.status === null ? run.signal : run.status;
    // Stays down: nothing answers at its socket, and no login service starts anything, past three 10 s throttles.
    const back = await until(() => hello(box, { socket, ms: 2000 }), signal === 'INT' ? WATCH_MS : 12_000);
    assert.ok(!back, `a dev hub must stay down after kill -${signal}; a hub answered at its socket again`);
  }
  assert.deepEqual(exits, { TERM: 0, INT: 0 }, 'a dev hub (--root) must exit 0 on SIGTERM and on SIGINT');
  assert.deepEqual(launchd(box), [], 'no login service may load or start anything for a dev hub');
});
