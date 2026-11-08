// #41 scope: "The hub's health reports its own open files, memory and child processes, and the release runs an 8-hour
// soak with 30 sessions that fails on steady growth in any of them." This file covers the health half; soak-*.test.ts
// cover AC18 #41.8d96c961 through the soak runner.
//
// Surface assumed (the issue and design name no code surface, so this is the one the tests pin):
//   The hub's existing health method (`hub.health`, alias `health`, on an app or cli connection) gains
//     process: { openFiles: number, rssBytes: number, children: number }
//   measured from the hub process itself (the process whose `pid` the same reply carries):
//   - openFiles: the open file descriptors the hub process holds now (sockets included), a positive integer.
//   - rssBytes: the hub process's resident memory in bytes, a positive integer.
//   - children: the processes running under the hub process now (children and their descendants), an integer >= 0.
//   Each reading is the hub's own at the time of the call, not a cached or start-time value.
// The planted child source is the existing #824 plant DEEP_HUB_PLANT=churn-leaves-child (packages/hub/src/plant.ts),
// which leaves one /bin/sleep under the hub per ended session.
// Needs the CLI built (packages/cli/dist/main.js), as every test using packages/hub/test/hub.ts does.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { client, hookLine, recorded, send, session, withHub } from '../../../../packages/hub/test/hub.js';

type Proc = { openFiles: number; rssBytes: number; children: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function health(root: string) {
  const call = await client(join(root, 'hub.sock'), readFileSync(join(root, 'control.token'), 'utf8').trim());
  return async () => (await call('hub.health', {})) as { pid: number; process: Proc };
}

/** The processes under `pid`, from the OS. */
function descendants(pid: number): number {
  const table = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  const kids = new Map<string, string[]>();
  for (const row of table.stdout.split('\n')) {
    const [child, parent] = row.trim().split(/\s+/);
    if (child && parent) kids.set(parent, [...(kids.get(parent) ?? []), child]);
  }
  let n = 0;
  const walk = (p: string) => { for (const c of kids.get(p) ?? []) { n++; walk(c); } };
  walk(String(pid));
  return n;
}
/** The numbered file descriptors `pid` holds, from the OS. */
function descriptors(pid: number): number {
  if (existsSync(`/proc/${pid}/fd`)) return readdirSync(`/proc/${pid}/fd`).length;
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof';
  const out = spawnSync(lsof, ['-n', '-P', '-p', String(pid), '-F', 'f'], { encoding: 'utf8' }).stdout;
  return out.split('\n').filter((l) => /^f\d+$/.test(l)).length;
}
/** `n` connections to the hub that said hello as the CLI and stay open. */
async function holdOpen(root: string, n: number): Promise<net.Socket[]> {
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  return Promise.all(Array.from({ length: n }, () => new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect(join(root, 'hub.sock'));
    let got = '';
    let said = false;
    s.setEncoding('utf8');
    s.on('error', reject);
    s.on('data', (d: string) => {
      got += d;
      const lines = got.split('\n').slice(0, -1).map((l) => JSON.parse(l) as Record<string, unknown>);
      if (!said && lines.some((l) => 'hello' in l)) { said = true; s.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
      if (lines.some((l) => l.role)) resolve(s);
    });
  })));
}
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID now, with a counter for its random part, as a hook request's id is. */
function ulid(): string {
  let s = '';
  let value = (BigInt(Date.now()) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const isCount =(v: unknown, least: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= least;

describe('#41 the hub health reports its own open files, memory and child processes', () => {
  it('#41 health carries process.openFiles, process.rssBytes and process.children as whole numbers read from the hub process', async () => {
    await withHub(async (root) => {
      const read = await health(root);
      const h = await read();
      expect(h.process).toBeTypeOf('object');
      expect(isCount(h.process.openFiles, 1)).toBe(true);
      expect(isCount(h.process.rssBytes, 1)).toBe(true);
      expect(isCount(h.process.children, 0)).toBe(true);
      // The hub's own process, not the caller's or a worker's guess: resident memory near what ps reads for its pid.
      const rssKiB = Number(spawnSync('ps', ['-o', 'rss=', '-p', String(h.pid)], { encoding: 'utf8' }).stdout.trim());
      expect(rssKiB).toBeGreaterThan(0);
      expect(h.process.rssBytes).toBeGreaterThan(rssKiB * 1024 * 0.5);
      expect(h.process.rssBytes).toBeLessThan(rssKiB * 1024 * 2);
      // Open files near what the OS lists for its pid; a few may come and go between the two readings.
      expect(Math.abs(h.process.openFiles - descriptors(h.pid))).toBeLessThanOrEqual(10);
      expect(Math.abs(h.process.children - descendants(h.pid))).toBeLessThanOrEqual(1);
    });
  }, 60_000);

  it('#41 openFiles rises by the connections the test holds open, and falls back once they close', async () => {
    await withHub(async (root) => {
      const read = await health(root);
      // The hub's start holds a few short-lived descriptors a moment past ready: the baseline is taken once two
      // readings 500 ms apart agree, for up to 10 s.
      let before = (await read()).process.openFiles;
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const again = (await read()).process.openFiles;
        if (again === before) break;
        before = again;
      }
      const held = await holdOpen(root, 25);
      await sleep(300);
      const during = (await read()).process.openFiles;
      expect(during).toBeGreaterThanOrEqual(before + 25);
      for (const s of held) s.destroy();
      let after = during;
      for (let i = 0; i < 50 && after > before + 3; i++) { await sleep(100); after = (await read()).process.openFiles; }
      expect(after).toBeLessThanOrEqual(before + 3);
      expect(after).toBeLessThan(during - 20);
    });
  }, 60_000);

  it('#41 children counts the real processes under the hub: three left by a planted hub are counted', async () => {
    // The body's own result is kept apart from withHub's teardown, whose removal of the home can race the stopping
    // hub's last writes there (ENOTEMPTY) and would otherwise be the only error reported.
    let failed: { error: unknown } | undefined;
    let left: string | undefined;
    try {
      await withHub(async (root, home) => { left = home; try {
      const read = await health(root);
      const socket = join(root, 'hub.sock');
      const ids = ['a', 'b', 'c'].map((x) => `0000000${x}-0000-4000-8000-000000000041`);
      for (const id of ids) {
        const s = session(home, id);
        await send(socket, hookLine(ulid(), 'SessionStart', s.payload('SessionStart', { source: 'startup' }), { ppid: process.pid }));
        await send(socket, hookLine(ulid(), 'SessionEnd', s.payload('SessionEnd', { reason: 'other' }), { ppid: process.pid }));
        expect(await recorded(root, id, 'session.end', 1)).toBe(1);
      }
      // The plant spawns as the session ends; give the three sleeps a moment to be in the process table.
      let h = await read();
      for (let i = 0; i < 50 && descendants(h.pid) < 3; i++) { await sleep(100); h = await read(); }
      expect(descendants(h.pid)).toBeGreaterThanOrEqual(3);
      h = await read();
      expect(h.process.children).toBeGreaterThanOrEqual(3);
      expect(Math.abs(h.process.children - descendants(h.pid))).toBeLessThanOrEqual(1);
      } catch (error) { failed = { error }; } }, { DEEP_HUB_PLANT: 'churn-leaves-child' });
    } catch (error) {
      if (failed || (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw failed ? failed.error : error;
      // Only the teardown's removal raced: remove the home again once the hub's last writes are done.
      for (let i = 0; i < 20 && left && existsSync(left); i++) { await sleep(250); try { rmSync(left, { recursive: true, force: true }); } catch { /* still being written */ } }
    }
    if (failed) throw failed.error;
  }, 60_000);
});
