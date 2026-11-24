// What the #2062 acceptance tests run on: temp folders, the controlled clock, a world (the record with its evidence
// store, the asks core and the supervisor), hosts over it, and the test packages, written to temp folders.
// Nothing here stands in for the extension host, the record or the evidence store: they are reached only through
// their packages' public entries (README, The surface under test). This file imports no test runner, so the process
// under-locale.mjs starts runs it too.
//
// Safety: every folder is under /tmp/dh2062-* (real paths), removed by `cleanup`; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE*, DEEP_*, ANTHROPIC_* and AI_AGENT variables are removed first; no
// test touches the real ~/.deepbuild or the Keychain (the secret store is in memory); nothing reaches the network (a
// source's answer is made by the HTTP client the host is given); a package's process is stopped only by the host that
// started it, never by name or port.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { d1Digest } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore, type EvidenceStore } from '../../../packages/evidence/src/index.ts';
import {
  openExtensionHost, openTrust, packageDigest, type ExtensionHost, type HttpClient, type Installed, type InstallFrom, type SecretStore,
} from '../../../packages/extension-host/src/index.ts';
import { openRecord, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('ANTHROPIC_') || key === 'AI_AGENT') delete process.env[key];
}
process.env.TZ = 'UTC';

export const SECOND = 1_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** The test's day: Monday, November 2, 2026. */
const DAY1 = Date.UTC(2026, 10, 2);
/** A time of the test's day, such as `t('10:00:30')`. */
export function t(hms: string): number {
  const [h, m, s] = hms.split(':').map(Number) as [number, number, number];
  return DAY1 + h * HOUR + m * 60 * SECOND + s * SECOND;
}

// ---- The controlled clock.
export interface Clock { now: () => number; set(at: number): void }
export function clock(start: number): Clock {
  let at = start;
  return { now: () => at, set: (next) => { if (next < at) throw Error('the clock moves forward only'); at = next; } };
}

// ---- Temp folders, HOME among them, and what `cleanup` closes.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh2062-${tag}-`));
  made.push(dir);
  return dir;
}
process.env.HOME = tempDir('home');
const hosts: ExtensionHost[] = [];
const worlds: World[] = [];
/** Closes every host and world still open, then removes every temp folder. */
export async function cleanup(): Promise<void> {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** An error's message and, behind it, each cause's. */
export function said(e: unknown): string {
  const words: string[] = [];
  for (let at = e; at !== undefined && at !== null; at = (at as Error).cause) words.push(String((at as Error).message ?? at));
  return words.join('; caused by: ');
}
/** 'done' when it resolved, else 'rejected: …' with why. */
export const settled = (p: Promise<unknown>): Promise<string> => p.then(() => 'done', (e: unknown) => `rejected: ${said(e)}`);

// ---- The world.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs packages under. */
  home: string;
  clock: Clock;
  record: RecordStore;
  evidence: EvidenceStore;
  asks: Asks;
  sup: Supervisor;
  events(kind: string): Promise<Event[]>;
  close(): Promise<void>;
}
/** A world on `dir`: a new folder, or an earlier world's, as a restarted hub opens it. */
export async function openWorld(c: Clock, dir: string = tempDir('world')): Promise<World> {
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: c.now });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: c.now, evidence });
  const asks = await openAsks({ record, now: c.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: c.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  let closed = false;
  const w: World = {
    dir, home, clock: c, record, evidence, asks, sup,
    events: (kind) => record.read({ after: 0, limit: 1000, kinds: [kind] }),
    close: async () => {
      if (closed) return;
      closed = true;
      await sup.close().catch(() => undefined);
      await record.close().catch(() => undefined);
    },
  };
  worlds.push(w);
  return w;
}

function memoryStore(): SecretStore {
  const entries = new Map<string, string>();
  return { get: async (key) => entries.get(key), set: async (key, value) => { entries.set(key, value); }, delete: async (key) => { entries.delete(key); } };
}
/** A name nothing answers, refused before any socket, as a machine with no network refuses it. */
const noNetwork: HttpClient = async (request) => { throw new TypeError(`fetch failed: no test server answers ${request.url}`); };

export interface HostOptions {
  http?: HttpClient;
  /** The record store or the evidence store the host is given in place of the world's own: a fixture round it. */
  record?: RecordStore;
  evidence?: EvidenceStore;
  /** How the host is made ready; `h.ready()` when left out. */
  ready?: (h: ExtensionHost) => Promise<void>;
}
/** A ready extension host on a world, on the world's clock. */
export async function openHost(w: World, o: HostOptions = {}): Promise<ExtensionHost> {
  const h = await openExtensionHost({
    record: o.record ?? w.record, evidence: o.evidence ?? w.evidence, supervisor: w.sup, trust: await openTrust({ record: w.record, now: w.clock.now }),
    home: w.home, release: [], now: w.clock.now, asks: w.asks, secrets: memoryStore(), http: o.http ?? noNetwork,
  });
  hosts.push(h);
  await (o.ready ? o.ready(h) : h.ready());
  return h;
}
/** Closes a host now, as a restart does; `cleanup` then skips it. */
export async function closeHost(h: ExtensionHost): Promise<void> {
  hosts.splice(hosts.indexOf(h), 1);
  await h.close();
}

// ---- Test packages.
/** A package in a temp folder, its manifest's digest the host's own packageDigest of the folder. */
export function makePackage(manifest: { id: string; version?: string; [field: string]: unknown }, index: string): string {
  const dir = tempDir(`pkg-${manifest.id.replace('/', '-')}`);
  writeFileSync(join(dir, 'index.ts'), index);
  const whole = { version: '1.0.0', ...manifest, digest: `d1:${'0'.repeat(64)}` };
  const write = (): void => writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(whole, null, 2)}\n`);
  write();
  whole.digest = packageDigest(dir);
  write();
  return dir;
}

/** What installing, checking and loading a package came to: the first refusal and its step, or that it loaded. */
export type Admitted = { ok: true; installed: Installed } | { ok: false; step: 'install' | 'check' | 'load'; reason: string };
export async function admit(h: ExtensionHost, from: string, grant?: InstallFrom['grant']): Promise<Admitted> {
  let installed: Installed;
  try { installed = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) }); } catch (e) { return { ok: false, step: 'install', reason: said(e) }; }
  const checked = await h.check(installed);
  if (!checked.passed) return { ok: false, step: 'check', reason: checked.reasons.join('; ') };
  const load = await h.load(installed);
  return load.status === 'loaded' ? { ok: true, installed } : { ok: false, step: 'load', reason: load.reason };
}

// ---- The edge from `u` to `p`, over `x@1`. A manifest lists a bare interface name only beside a `replaces` of that
// name (What a minor may change), so each provider of `x@1` lists it there.
export const X = 'x@1';
export const U = 'test/u';
export const P = 'test/p';
/** x@1 at minor 0. */
export const SHAPE = { type: 'object', properties: { level: { type: 'integer' } }, required: ['level'], additionalProperties: false };
const PROVIDER = `export default async function (deep: any): Promise<void> {
  await deep.provide('${X}', 'reading', ${JSON.stringify(SHAPE)}, async () => ({ level: 3 }));
}
`;
const USER = `export default async function (deep: any): Promise<void> {
  await deep.use('${X}');
}
`;
/** A package that provides `x@1` at minor 0: its row keeps minor 0's digest, or leaves `digests` out. */
export const provider = (id: string, keeps: 'its digest' | 'no digests', version = '1.0.0'): string => makePackage({
  id, version, replaces: [X], requires: { preview: ['deep.provide'] },
  provides: [{ interface: X, kind: 'reading', minor: 0, schema: SHAPE, ...(keeps === 'its digest' ? { digests: { '0': d1Digest(SHAPE) } } : {}) }],
}, PROVIDER);
/** Package `u`, which uses `x@1` at minor 0 and names no provider: its use states minor 0's digest, or none. */
export const user = (states: 'its digest' | 'no digest'): string => makePackage({
  id: U, requires: { preview: ['deep.use'] },
  uses: [{ interface: X, minor: 0, schema: SHAPE, ...(states === 'its digest' ? { digest: d1Digest(SHAPE) } : {}) }],
}, USER);

export interface Edge { user: string; uses: string; interface: string; provider: string }
/** The edges of package `u`, as the host lists them. */
export const edgesOfU = async (h: ExtensionHost): Promise<Edge[]> => (await h.edges()).filter((e) => e.user === U);

/** AC3's scene: the providers installed and loaded in the order given, then `u`; what `u`'s use of x@1 is wired to. */
export async function tie(providers: readonly string[]): Promise<Edge[]> {
  const h = await openHost(await openWorld(clock(t('10:00:00'))));
  for (const from of [...providers.map((id) => provider(id, 'its digest')), user('its digest')]) {
    const got = await admit(h, from);
    if (!got.ok) throw Error(`the tie's packages are admitted: ${got.step}: ${got.reason}`);
  }
  return edgesOfU(h);
}
