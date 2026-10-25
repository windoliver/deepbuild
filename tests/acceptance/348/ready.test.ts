// AC9: an extension can't start sockets, watchers or timers before the hub is ready. The host is opened and the
// package loaded before the test calls `host.ready()` (README: the hub is ready once its socket listens and its
// replay is done; `ready()` is how the hub tells its host). While it loads, the package tries a timer, an interval,
// an immediate, a Unix socket and a watcher (fixtures/ready). Before ready, the test waits, writes into the watched
// folder and tries the socket: nothing may have run and nothing may listen. After ready, the package's report lists
// every callback that ran with its time: none before the moment ready was called. A start may be refused or held
// until ready; either meets the criterion. Both places are tested: a release package in the hub (the host's own
// process, where only the host can hold these back) and a package from outside the release in the sandbox.
import { existsSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { openHost, openWorld, pkg, releaseEntry, report, sleep, tempDir } from './helpers.ts';

const opened: ExtensionHost[] = [];
afterAll(async () => { for (const h of opened.splice(0)) await h.close(); });

interface Seen { pid: number; ran: { what: string; at: number }[]; refused: { what: string; error: string }[] }

/** Whether something accepts a connection on the Unix socket at `path`. */
function accepts(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(path);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function scenario(place: 'hub' | 'sandbox'): Promise<void> {
  const w = await openWorld();
  const socket = join(tempDir('sock'), 'ext.sock');
  const watched = tempDir('watched');
  const dir = await pkg('ready', { probe: { socket, watch: watched } });
  const h = await openHost(w, place === 'hub' ? { release: [await releaseEntry(dir)] } : {});
  opened.push(h);
  const p = await h.install({ from: dir, builtBy: null });
  expect((await h.check(p)).passed).toBe(true);
  const load = await h.load(p);
  expect(load.status, JSON.stringify(load)).toBe('loaded');
  expect(load.status === 'loaded' && load.place).toBe(place);

  // Before ready: time for any timer to fire, a change in the watched folder, and the socket tried.
  await sleep(300);
  writeFileSync(join(watched, 'touched.txt'), 'x');
  await sleep(300);
  expect(existsSync(socket) && (await accepts(socket)), `the ${place} package listens on its socket before the hub is ready`).toBe(false);

  const readyAt = Date.now();
  await h.ready();
  await sleep(300);
  const seen = await report<Seen>(h, 'ext.ready.report');
  const early = seen.ran.filter((r) => r.at < readyAt);
  expect(early, `in the ${place}, these ran before the hub was ready (ready at ${readyAt}): ${JSON.stringify(early)}`).toEqual([]);
}

describe('AC9 #348.f3e43b54 an extension can\'t start sockets, watchers or timers before the hub is ready', () => {
  it('AC9 a release package loaded in the hub before it is ready: no timer, interval, immediate or watcher callback runs, and its socket doesn\'t listen, until ready', async () => {
    await scenario('hub');
  }, 60_000);

  it('AC9 a package loaded in the sandbox before the hub is ready: no timer, interval, immediate or watcher callback runs, and its socket doesn\'t listen, until ready', async () => {
    await scenario('sandbox');
  }, 60_000);
});
