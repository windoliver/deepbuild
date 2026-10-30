// Test-side tools for the #349 acceptance tests: temp folders, a world (the record, the asks core, the supervisor
// and project trust), hosts, test packages copied from fixtures/, hook lines, asks and answers, and the files the
// test adapters write what they saw into. Nothing here stands in for the slots, the gate or the owner rule: the
// tests reach them only through the surfaces the README names (`@deepbuild/extension-host`, `@deepbuild/asks`,
// `@deepbuild/conformance`, `@deepbuild/contracts`, `scripts/slots-check.mjs`). The host and the asks core are
// loaded lazily, so this file loads at the base, where the surface doesn't exist. The wrong programs are in wrong.ts.
//
// Safety: every folder is under /tmp/dh349-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; no network;
// and no process is ever stopped by name or port (each host a test opens is closed, which stops what it started).

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { HookRequestLine } from '../../../packages/adapters/src/index.ts';
import type { Asks, AsksPlant, Delivery } from '../../../packages/asks/src/index.ts';
import { shownPlanHash, withPlans } from '../plans.ts';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type { ExtensionHost, Plant, ProjectTrust, ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const DAY = 86_400_000;
/** The public entries the tests reach the surface through (README, The surface under test). */
export const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';
export const ASKS_ENTRY = '../../../packages/asks/src/index.ts';
export const CONFORMANCE_ENTRY = '../../../packages/conformance/src/index.ts';
export const CONTRACTS_ENTRY = '../../../packages/contracts/src/index.ts';
/** The built entry the journey test package imports in the hub (its folder is a temp copy, outside the workspace). */
export const CONFORMANCE_DIST = join(REPO, 'packages/conformance/dist/index.js');
/** The slot check the local preflight runs (README, The surface under test). */
export const SLOTS_CHECK = join(REPO, 'scripts/slots-check.mjs');

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh349-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
/** An agent session ID, as the agent's hooks carry it. */
export const sessionId = (): string => ulid();

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh349-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- Connections. The trusted path (the app's question card) is the only writer whose answer saves a decision.
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/** deep-hook's connection for an agent session: what raises the session's asks and appends its events. */
export const hookIn = (session: string, agent = 'claude-code'): Connection => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent });

// ---- The surface, loaded lazily so this file loads at the base.
export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;
export const asksCore = () => import(new URL(ASKS_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/asks/src/index.ts')>;
export const conformance = () => import(new URL(CONFORMANCE_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/conformance/src/index.ts')>;
export const contracts = () => import(new URL(CONTRACTS_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/contracts/src/index.ts')>;

// ---- The world: a record, the asks core (whose deliveries the test keeps), the supervisor and project trust.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs extensions under. */
  home: string;
  record: RecordStore;
  asks: Asks;
  /** Every answer the asks core handed out for an agent, in order. */
  deliveries: Delivery[];
  sup: Supervisor;
  trust: ProjectTrust;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
export async function openWorld(options: { plant?: AsksPlant } = {}): Promise<World> {
  const dir = tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const deliveries: Delivery[] = [];
  const { openAsks } = await asksCore();
  const asks = withPlans(await openAsks({ record, now: Date.now, deliver: (d) => { deliveries.push(d); }, ...(options.plant ? { plant: options.plant } : {}) }));
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const { openTrust } = await host();
  const trust = await openTrust({ record, now: Date.now });
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  let closed = false;
  const w: World = {
    dir, home: deepHome, record, asks, deliveries, sup, trust, events,
    close: async () => {
      if (closed) return;
      closed = true;
      await sup.close();
      await record.close();
    },
  };
  worlds.push(w);
  return w;
}

/** An extension host on a world's record, asks, supervisor, trust and home: `release` is DeepBuild's signed release. */
export async function openHost(w: World, options: { release?: ReleaseEntry[]; plant?: Plant } = {}): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, asks: w.asks, supervisor: w.sup, trust: w.trust, home: w.home, release: options.release ?? [], now: Date.now,
    ...(options.plant ? { plant: options.plant } : {}),
  });
  hosts.push(h);
  await h.ready();
  return h;
}

afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

// ---- Fixtures and test packages.
export interface PackageOptions {
  /** Fields merged over the fixture's deepbuild.json. */
  manifest?: Record<string, unknown>;
  /** Files written over the copy, by relative path. */
  files?: Record<string, string>;
}
/**
 * A test package in a temp folder: `fixtures/<name>` copied with each `*.fixture` file renamed without that suffix
 * (so neither this suite's Vitest nor its type check picks the packages' code up), the manifest fields and files
 * written over it, and the manifest's `digest` set to the host's own `packageDigest` of the result.
 */
export async function pkg(name: string, options: PackageOptions = {}): Promise<string> {
  const dir = tempDir(`pkg-${name}`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.fixture')) renameSync(join(dir, entry.name), join(dir, entry.name.slice(0, -'.fixture'.length)));
  }
  for (const [path, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = { ...(JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>), ...(options.manifest ?? {}) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  expect(packageDigest(dir), 'writing packageDigest into deepbuild.json\'s digest doesn\'t change it (#348)').toBe(manifest.digest);
  return dir;
}
/** The release entry for a package folder: DeepBuild's signed release listing it, so it runs in the hub. */
export async function releaseEntry(dir: string): Promise<ReleaseEntry> {
  const { packageDigest } = await host();
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
}
/** A first-party test package installed, checked and loaded in the hub of a fresh host on `w`. */
export async function loadInHub(w: World, dir: string, options: { plant?: Plant; release?: string[] } = {}): Promise<ExtensionHost> {
  const release = [await releaseEntry(dir), ...(await Promise.all((options.release ?? []).map(releaseEntry)))];
  const h = await openHost(w, { release, ...(options.plant ? { plant: options.plant } : {}) });
  await installAndLoad(h, dir);
  return h;
}
export async function installAndLoad(h: ExtensionHost, dir: string): Promise<void> {
  const p = await h.install({ from: dir, builtBy: null });
  const c = await h.check(p);
  expect(c.passed, `${p.id} passes conformance: ${JSON.stringify(c)}`).toBe(true);
  const load = await h.load(p);
  expect(load.status === 'loaded' && load.place, `${p.id} loads in the hub: ${JSON.stringify(load)}`).toBe('hub');
}

// ---- Check runs. The kit's known-pass suite, copied, is the checkout a journey runs in.
export const KNOWN_PASS = join(REPO, 'packages/conformance/fixtures/check-kind/known-pass');
export const COMMAND_SPEC = (kind: string): CheckSpec => ({ kind, runner: 'node --test --test-isolation=none spec/*.test.mjs', inputs: ['src/cart.mjs', 'spec/cart.test.mjs'], depth: 'unit', oracle: 'code', contract: null });
export async function runKnownPass(h: ExtensionHost, kind: string): Promise<CheckResult> {
  const checkout = tempDir('checkout');
  cpSync(KNOWN_PASS, checkout, { recursive: true });
  return h.runCheck(kind, COMMAND_SPEC(kind), { checkout, deadline: 60_000 });
}

// ---- Hook lines: what deep-hook sends for one hook of one agent session (hook.request@2 on the wire).
let seq = BigInt(Date.now()) * 1_000_000n;
export function hookLine(agent: string, session: string, event: string, payload: Record<string, unknown> = {}): HookRequestLine {
  seq += 1n;
  return {
    v: 1, agent, event, seq: seq.toString(), id: ulid(), pid: process.pid, ppid: process.ppid, matched: [],
    payload: { session_id: session, cwd: process.cwd(), hook_event_name: event, ...payload },
  };
}

// ---- Asks: an authority ask (effect.push's fixture, due in a day) raised for a session, and your approval of it.
export function authorityAsk(options: { question?: string } = {}): Record<string, unknown> {
  return {
    kind: 'authority', question: options.question ?? 'Push feature/login to origin?',
    options: [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }],
    recommended: null, deadline: Date.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you',
    key: 'd2d8657f71c5081497de05489d87e82d95083fa201453bd9297aa4a1959715e5', pinned_to: { kind: 'commit', ref: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46' },
  };
}
/** An ask of another kind and key (effect.merge's fixture): a decision saved from it covers no push. */
export function mergeAsk(): Record<string, unknown> {
  return { ...authorityAsk({ question: 'Merge PR 42 into main?' }), options: [{ id: 'approve', label: 'Merge it', decision: 'allow' }, { id: 'decline', label: 'Hold the merge', decision: 'deny' }], key: '3f0e6b2c9a1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b' };
}
/** A session's start in a worktree: the repo a decision at repo scope covers. */
export async function startSession(w: World, session: string, worktree: string, agent = 'claude-code'): Promise<void> {
  await w.record.append(hookIn(session, agent), { v: 2, id: ulid(), kind: 'session.start', ts: Date.now(), data: { agent, worktree, branch: null, thread: session, billing: {} } });
  await w.record.sync();
}
/** The core's connection for a session: an effect ask (its allow option is DeepBuild's) is raised by the core for the session. */
export const coreFor = (session: string): Connection => ({ writer: 'core', actor: 'you', scope: 'you', session });
export const raise = (w: World, session: string, source = 'effect.push', ask: Record<string, unknown> = authorityAsk()): Promise<string> => w.asks.raise(coreFor(session), source, ask);
/** Your approval on the trusted path: the card's click. */
export const approve = async (w: World, ask: string): Promise<void> => w.asks.answer(YOU, ask, { option: 'approve', plan_hash: await shownPlanHash(w.asks, ask), token: `click-${ulid()}` });
export async function inboxRow(w: World, ask: string) {
  const row = (await w.asks.inbox()).find((r) => r.ask === ask);
  if (!row) throw Error(`${ask} has no inbox row`);
  return row;
}

// ---- What a test adapter saw: one JSON line per call to its deliver (fixtures/adapter).
export interface Seen { answer: Delivery; session: string; route: string; at: number }
export function seenFile(tag: string): string {
  const file = join(tempDir(`seen-${tag}`), 'seen.jsonl');
  writeFileSync(file, '');
  return file;
}
export const readSeen = (file: string): Seen[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Seen);
/** Polls until `test` holds or `ms` pass; returns whether it held. */
export async function until(test: () => boolean, ms = 3_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(25);
  }
  return test();
}
