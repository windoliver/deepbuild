// A world for the #1820 tests: #1731's world (a real hub in a temp home with its test CA, `deep mcp`, the cli socket, the
// OS confirmation stubbed), plus a pack server on 127.0.0.1 under the same CA and two pack folders installed with
// `deep install`. Reused read-only from tests/acceptance/1731/helpers.ts; nothing there is edited.
import { spawn } from 'node:child_process';
import { readFileSync, statfsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll } from 'vitest';
import { asks, blocked, CLI, events, kinds, must, NODE, openWorld, refusal, show, sleep, stored, yes, type Line, type Outcome, type Ran, type World } from '../1731/helpers.ts';
import { A, B, openPacks, PACK_A, PACK_A_VERSION, PACK_B, PACK_B_VERSION, writePack, type Asset, type PackServer } from './pack.ts';

export { asks, blocked, events, kinds, must, refusal, show, sleep, stored, yes };
export type { Line, Outcome, World };

export interface PackWorld extends World { packs: PackServer; free: number; hugeSize: number; installs: Ran[] }
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const c of closers.splice(0)) await c().catch(() => undefined); }, 30_000);

/** The free bytes on the volume holding the hub's folder. */
export const freeBytes = (w: World): number => { const s = statfsSync(w.home); return Number(s.bavail) * Number(s.bsize); };

function cli(w: World, args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)/.test(k)) env[k] = v;
    const child = spawn(NODE, [CLI, ...args], { cwd: w.work, env: { ...env, HOME: w.home, XDG_CONFIG_HOME: join(w.home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/**
 * The world: pack A (acme/sounds@1.0.0) and pack B (acme/voices@2.0.0) installed, their assets listed by url on a local
 * server. GAP: the base has no route that installs a canvas data pack into the hub (#1731's README says so too), so
 * `deep install <pack folder>` is the natural one, the path `deep install` has for every package; one place, here.
 */
export async function packWorld(): Promise<PackWorld> {
  const w = await openWorld();
  const tls = { key: readFileSync(join(w.tmp, 'tls', 'leaf.key'), 'utf8'), cert: readFileSync(join(w.tmp, 'tls', 'leaf.pem'), 'utf8') };
  const packs = await openPacks(tls);
  closers.push(() => packs.close());
  const free = freeBytes(w);
  // Listed larger than 1/2.2 of the free space but smaller than it: only the 2.2x rule refuses it.
  const hugeSize = Math.floor(free * 0.6);
  const huge: Asset = { ...A.huge, size: hugeSize };
  const listA = Object.values(A).map((a) => (a === A.huge ? huge : a));
  const installs: Ran[] = [];
  installs.push(await cli(w, ['install', writePack(join(w.tmp, 'pack-a'), packs.host, PACK_A, PACK_A_VERSION, listA)]));
  installs.push(await cli(w, ['install', writePack(join(w.tmp, 'pack-b'), packs.host, PACK_B, PACK_B_VERSION, Object.values(B))]));
  return Object.assign(w, { packs, free, hugeSize, installs });
}
/** A world that must have its packs installed: BLOCKED naming the install's output otherwise (the gap). */
export async function readyWorld(): Promise<PackWorld> {
  const w = await packWorld();
  const bad = w.installs.find((r) => r.code !== 0);
  if (bad) throw Error(`BLOCKED: deep install of a pack folder with url-listed assets did not install it: exit ${bad.code}, ${bad.stdout.slice(-600)} ${bad.stderr.slice(-600)}`);
  return w;
}

export const idOf = (pack: string, version: string) => `${pack}@${version}`;
export const fetchA = (a: Asset): Line => ({ op: 'fetch', pack: idOf(PACK_A, PACK_A_VERSION), asset: a.path });
export const fetchB = (a: Asset): Line => ({ op: 'fetch', pack: idOf(PACK_B, PACK_B_VERSION), asset: a.path });

/** A fetch called again until it is no longer held (the job after your yes), up to `ms`. */
export async function until(w: World, args: Line, ms = 120_000): Promise<Outcome> {
  const deadline = Date.now() + ms;
  for (;;) {
    const o = await kinds(w, args);
    if (o.value.status !== 'held' || Date.now() > deadline) return o;
    await sleep(500);
  }
}
/** The new asks since `before`, of a kind. */
export const newAsks = async (w: World, before: number, kind?: string) => (await asks(w, kind)).slice(before);

/** A document with one asset.game@1 item naming an asset by its sha256, in a document that names the pack (#1731's `from: {asset}`). */
export function doc(item: string, sha: string, pack: string): Line {
  return { format: 1, profile: 'scene', title: 'Pack asset', description: 'One prop naming a pack asset by hash (#1820).', size: [320, 200], packs: [pack],
    items: { [item]: { id: item, kind: 'asset.game@1', name: item, from: { asset: sha }, budget: 'small_prop' } } };
}
