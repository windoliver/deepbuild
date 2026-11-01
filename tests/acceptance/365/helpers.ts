// Test-side tools for the #365 acceptance tests: temp folders, a controlled clock, a world (the record with its
// evidence store, the asks core, the supervisor and project trust), hosts with the seams the surface names (the clock,
// a secret store standing in for the OS one, an HTTP client routing named hosts to local servers), the hub's stop and
// next start, test packages copied from fixtures/, the probe a test package reports through, local providers standing
// in for remote hosts, and the record read back.
// Nothing here stands in for the extension host or the record: the tests reach the host only through
// `@deepbuild/extension-host`'s entry and the record only through `@deepbuild/record`'s (README, The surface under
// test). This file imports the host's types only and loads it lazily, so it loads at the base, where the new surface
// doesn't exist.
//
// Safety: every folder is under /tmp/dh365-* (real paths), removed after its file; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE_*, DEEP_* and AI_AGENT variables are removed first; no test touches
// the real ~/.deepbuild or the real Keychain; nothing reaches the network (each named host is a server on 127.0.0.1,
// and a name no test server stands in for is refused by the client before any socket); a plug-in's process is stopped
// only through the supervisor run that started it (by its process group), never by name or port.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type {
  ExtensionHost, HttpAnswer, HttpClient, HttpRequest, Installed, InstallFrom, ProjectTrust, ScheduleRow, ScheduleRun, SecretStore, SendRow,
} from '../../../packages/extension-host/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, testStorage, type Connection, type Event, type RecordStore, type TestStorage } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { shownPlanHash } from '../plans.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** The extension host's public entry (README, The surface under test). */
const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

// The issue's times are UTC on the controlled clock; the hub reads cron lines in the machine's zone, set here.
process.env.TZ = 'UTC';
/** A time on the controlled clock: `at('2026-11-02T09:00')`. */
export const at = (iso: string): number => Date.parse(`${iso}:00.000Z`);
/** A time as the problems name it: `10:05`, or `2026-11-02 10:05` across days. */
export const hhmm = (t: number): string => new Date(t).toISOString().slice(11, 16);

/** The market key (a test value), its host, the price source, the schedule and check that need it, and the mail host. */
export const KEY = 'mk/test+51f0c9=';
export const MARKET = 'api.market.example';
export const MAIL = 'api.mail.example';
export const MARKET_ID = 'test/market';
export const BRIEF_ID = 'test/brief';
export const TALLY_ID = 'test/tally';
export const PRICE = 'ext.market.price';
export const WATCH = 'ext.market.watch';
export const ABOVE = 'ext.market.above_target';
export const CROSSED = 'ext.market.crossed';
export const ALERT = 'ext.market.alert';
/** You, and a second address (test values, no person's). */
export const ME = 'you@example.test';
export const OTHER = 'friend@example.test';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh365-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh365-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- Connections: who calls, as the hub's socket proved it. You, on the trusted path, in the app.
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/** An agent session's call through deep-actions, once the hub's gate let it through (#363's reading). */
export const agentCall = (session: string): Connection => ({ writer: `mcp:${session}`, actor: 'you', scope: 'you', session, agent: 'claude-code' });

// ---- The controlled clock: the issue's times; the tests never wait real hours.
export interface Clock { now: () => number; set(t: number): void }
export function clock(start: number): Clock {
  let t = start;
  return { now: () => t, set: (next) => { if (next < t) throw Error(`the clock moves forward only: ${new Date(next).toISOString()} < ${new Date(t).toISOString()}`); t = next; } };
}

// ---- The world: a record with its evidence store, the asks core, the supervisor and project trust.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs extensions under. */
  home: string;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  trust: ProjectTrust;
  clock: Clock;
  /** The record's test VFS, when the world runs on it (AC3). */
  storage?: TestStorage;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
/**
 * A world on `dir` (a new folder when left out), on the controlled clock. `storage` runs the record on the record's
 * own test VFS (or a storage wrapping it), which keeps writes in memory until a sync and drops the rest at a cut.
 */
export async function openWorld(c: Clock, options: { dir?: string; storage?: TestStorage } = {}): Promise<World> {
  const dir = options.dir ?? tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence') });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: c.now, evidence, ...(options.storage ? { storage: options.storage } : {}) });
  const asks = await openAsks({ record, now: c.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: c.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const { openTrust } = await host();
  const trust = await openTrust({ record, now: c.now });
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
    dir, home: deepHome, record, asks, sup, trust, clock: c, events,
    ...(options.storage ? { storage: options.storage } : {}),
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
/** A world on the record's test VFS (AC3): `storage` defaults to a fresh `testStorage()`. */
export const vfsWorld = (c: Clock, storage: TestStorage = testStorage()) => openWorld(c, { storage });

/** The extension-host package, loaded lazily so this file loads at the base. */
export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;

/** An in-memory secret store standing in for the OS one; `holds(value)` says whether any entry holds that value. */
export interface TestStore extends SecretStore { holds(value: string): boolean; clear(): void }
export function memoryStore(): TestStore {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key),
    set: async (key, value) => { entries.set(key, value); },
    delete: async (key) => { entries.delete(key); },
    holds: (value) => [...entries.values()].includes(value),
    clear: () => entries.clear(),
  };
}

export interface HostSeams { secrets: SecretStore; http: HttpClient; now?: () => number }
/** A ready extension host on a world, with the seams the surface names: the clock, the secret store, the HTTP client; and the world's asks core. */
export async function openHost(w: World, seams: HostSeams): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: [], now: seams.now ?? w.clock.now,
    asks: w.asks, secrets: seams.secrets, http: seams.http,
  });
  hosts.push(h);
  await h.ready();
  return h;
}

/** The hub stops: the extension host closes (which stops what it started), then the supervisor and the record. */
export async function stopHub(h: ExtensionHost, w: World): Promise<void> {
  await h.close();
  await w.close();
}
/**
 * The hub's next start on the same files (and the same test VFS, when the world had one): a new record, supervisor
 * and extension host; each installed package loads again, as the hub loads them at its start.
 */
export async function startHub(w: World, seams: HostSeams, storage?: TestStorage): Promise<{ w: World; h: ExtensionHost }> {
  const again = await openWorld(w.clock, { dir: w.dir, ...(storage ?? w.storage ? { storage: storage ?? w.storage } : {}) });
  const h = await openHost(again, seams);
  for (const p of await h.installed()) {
    if (!h.checked(p)) await h.check(p);
    const load = await h.load(p);
    if (load.status !== 'loaded') throw Error(`${p.id} didn't load again at the hub's next start: ${load.reason}`);
  }
  return { w: again, h };
}

/** The PIDs the supervisor tracked for a loaded plug-in's run (process.tracked, by the core), read while the record is up. */
export async function pluginPids(w: World, h: ExtensionHost, id: string): Promise<number[]> {
  const run = (await h.loaded()).find((l) => l.id === id)?.run;
  if (!run) throw Error(`${id} has no process of its own: it isn't loaded in the sandbox (${JSON.stringify(await h.loaded())})`);
  return (await w.events('process.tracked')).map((e) => e.data as { run?: string; pid?: number }).filter((d) => d.run === run && typeof d.pid === 'number').map((d) => d.pid!);
}
/**
 * The plug-in's own process dies: the supervisor run its host started it under gets SIGKILL (its process group), and
 * each PID tracked for that run before (`pids`, when the record can no longer be read) gets it too.
 */
export async function killPlugin(w: World, h: ExtensionHost, id: string, pids: number[] = []): Promise<void> {
  const run = (await h.loaded()).find((l) => l.id === id)?.run;
  if (!run) throw Error(`${id} has no process of its own to kill: it isn't loaded in the sandbox (${JSON.stringify(await h.loaded())})`);
  await w.sup.signal(run, 'SIGKILL').catch(() => undefined);
  for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

// ---- Local providers standing in for the named hosts. Each keeps every request that reaches it, stamped with the
// controlled clock, and answers it with what `reply` gives, which may wait (a provider that never answers waits until
// the server closes).
export interface Seen { method: string; url: string; headers: Record<string, string>; body: string; at: number }
export type Reply = { status: number; headers?: Record<string, string>; body?: string } | 'hang';
export interface Provider { base: string; seen: Seen[]; close(): Promise<void>; /** Drops every open connection, answered or not; the provider keeps listening. */ drop(): void }
const providers: Provider[] = [];
export async function provider(c: Clock, reply: (req: Seen) => Reply | Promise<Reply>): Promise<Provider> {
  const seen: Seen[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const s: Seen = {
        method: req.method ?? '', url: req.url ?? '', at: c.now(), body: Buffer.concat(chunks).toString('utf8'),
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])),
      };
      seen.push(s);
      void Promise.resolve(reply(s)).then((r) => {
        if (r === 'hang' || res.destroyed) return;
        res.writeHead(r.status, r.headers ?? {}).end(r.body ?? '');
      }, () => { if (!res.destroyed) res.writeHead(500).end(); });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const p: Provider = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen,
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
    drop: () => server.closeAllConnections(),
  };
  providers.push(p);
  return p;
}
export const json = (body: unknown, status = 200): Reply => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** A gate a provider's reply can wait on: `open()` lets every waiting and later reply through. */
export function gate(): { wait: Promise<void>; open(): void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

/**
 * The HTTP client the hub is given: a call for `https://<name>/<path>` goes to the provider standing in for that
 * name; it never follows a redirect; a name no provider stands in for is refused before any socket, as a machine with
 * no network refuses it. `asked` keeps every call the hub made through it.
 */
export interface RoutedClient { client: HttpClient; asked: HttpRequest[] }
export function routedClient(routes: Record<string, Provider>): RoutedClient {
  const asked: HttpRequest[] = [];
  const client: HttpClient = async (request, signal) => {
    asked.push(structuredClone(request));
    return send(routes, request, signal);
  };
  return { client, asked };
}
/** One call to the provider a name maps to; exported for the twins that send a request again. */
export async function send(routes: Record<string, Provider>, request: HttpRequest, signal?: AbortSignal): Promise<HttpAnswer> {
  const url = new URL(request.url);
  const server = routes[url.hostname];
  if (!server) throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${url.hostname}`), { code: 'ENOTFOUND' }) });
  const res = await fetch(`${server.base}${url.pathname}${url.search}`, {
    method: request.method, headers: request.headers, redirect: 'manual', ...(signal ? { signal } : {}), ...(request.body === undefined ? {} : { body: request.body }),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: await res.text() };
}

afterAll(async () => {
  // A host whose close waits on something that never ends (an open ask, a provider that never answers) is let go
  // after 30 s, so one such close doesn't take the file's other results with it.
  for (const h of hosts.splice(0)) await Promise.race([h.close().catch(() => undefined), sleep(30_000)]);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const p of providers.splice(0)) await p.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 120_000);

// ---- Fixtures and test packages.
function copyFixture(name: string): string {
  const dir = tempDir(`pkg-${name}`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.fixture')) renameSync(path, path.slice(0, -'.fixture'.length));
    }
  };
  walk(dir);
  return dir;
}
/**
 * A test package in a temp folder: `fixtures/<name>` copied with each `*.fixture` renamed without that suffix (so
 * neither Vitest nor tsc picks the package's code up), `probe.json` written, and the manifest's `digest` set to the
 * host's own `packageDigest` of the result.
 */
export async function pkg(name: string, probe: Record<string, unknown>): Promise<string> {
  const dir = copyFixture(name);
  writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/** The hosts a package is granted, with room for every call a test makes. */
export const grantFor = (...names: string[]): NonNullable<InstallFrom['grant']> => ({ hosts: names.map((n) => ({ host: n, quota: { calls: 1_000_000, per_ms: HOUR } })) });
/** Install (by no agent), check and load a package; the load must succeed. */
export async function installAndLoad(h: ExtensionHost, from: string, grant: InstallFrom['grant']): Promise<Installed> {
  const p = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) });
  const checked = await h.check(p);
  expect(checked.passed, `${p.id}@${p.version}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
  const load = await h.load(p);
  expect(load.status, `${p.id}@${p.version} didn't load: ${JSON.stringify(load)}`).toBe('loaded');
  return p;
}

// ---- The market plug-in (fixtures/market): the price source, the watch schedule, the check, the alert actions.
export interface MarketProbe {
  /** false: the plug-in registers no watch schedule (AC5's actions need none). */
  watch?: boolean;
  /** The watch schedule's cadence: `{ every: ms }` or `{ cron }`. */
  cadence: { every: number } | { cron: string };
  /** The watch run's deadline, ms. Default 4 minutes. */
  deadline?: number;
  freshFor?: number;
  timeout?: number;
  quota?: { per_minute: number; per_day: number };
  /** Notices the watch job sends each run, citing its fresh reading, or from its second run the previous run's. */
  notices?: { subscriptions: string[]; cite: 'fresh' | 'previous-after-first' };
  /** set_alert as planted: writes the alert, then throws. */
  setAlert?: 'plain' | 'write-then-throw';
}
export const marketPackage = (probe: MarketProbe) => pkg('market', probe as unknown as Record<string, unknown>);
/** What the market plug-in saw, through its probe check: each watch job, and the most jobs it ever had running at once. */
export interface MarketJob { run: string; at: number; read: string | null; cause?: string; handle?: string; notices: { subscription: string; cited: string; sent?: string; refused?: string }[] }
export interface MarketReport { jobs: MarketJob[]; most: number }

/** A price provider: `answer(n, req)` gives the n-th call's reply (from 0). */
export async function priceProvider(c: Clock, answer: (n: number, req: Seen) => Reply | Promise<Reply> = () => json({ price: 187.25 })): Promise<Provider> {
  let n = 0;
  return provider(c, (req) => (req.url.startsWith('/q') ? answer(n++, req) : { status: 404 }));
}

/** A world with the market plug-in loaded and its key entered on the trusted path. */
export async function marketWorld(start: number, probe: MarketProbe, api: (c: Clock) => Promise<Provider>): Promise<{ c: Clock; w: World; h: ExtensionHost; store: TestStore; api: Provider; seams: HostSeams }> {
  const c = clock(start);
  const server = await api(c);
  const store = memoryStore();
  const seams: HostSeams = { secrets: store, http: routedClient({ [MARKET]: server }).client };
  const w = await openWorld(c);
  const h = await openHost(w, seams);
  await installAndLoad(h, await marketPackage(probe), grantFor(MARKET));
  const entered = await h.enterSecret(YOU, MARKET_ID, 'market_key', KEY);
  expect(entered.saved, `the market key is saved: ${JSON.stringify(entered)}`).toBe(true);
  return { c, w, h, store, api: server, seams };
}

// ---- The brief plug-in (fixtures/brief): scheduled sends to a mail provider, and a send action.
export interface BriefProbe {
  /** Its schedules: each a name and a cadence. */
  schedules: ({ name: string; every: number } | { name: string; cron: string })[];
  /** Each send's recipients. */
  to: string[];
  /** A send's key: one per schedule and day, or one per run. */
  key: 'day' | 'run';
  /** After its send, the job reads ext.brief.pause, which the provider may hold. */
  pause?: boolean;
  /** The schedules' run deadline, ms. Default 4 minutes. */
  deadline?: number;
}
export const briefPackage = (probe: BriefProbe) => pkg('brief', probe as unknown as Record<string, unknown>);
export interface BriefJob { run: string; at: number; key: string; sent?: unknown; refused?: string }
export interface BriefReport { jobs: BriefJob[] }
/** The provider's requests that carry a send's key. */
export const carrying = (p: Provider, key: string): Seen[] => p.seen.filter((s) => s.url.startsWith('/send') && (s.body.includes(key) || s.url.includes(key)));

/** A standing rule for sends, set on the trusted path: the piece that sends, its recipients and the schedule. */
export const weeklyRule = { sentence: 'my weekly summary, to me', piece: BRIEF_ID, recipients: [ME], schedule: 'ext.brief.weekly' };

// ---- The probe: a test package reports what it saw through a check kind it registers (#348's convention): its
// runner returns one failure whose message is the JSON of its observations.
const PROBE_SPEC: CheckSpec = { kind: 'probe', runner: 'report', inputs: [], depth: 'unit', oracle: 'code', contract: null };
export async function report<T>(h: ExtensionHost, kind: string): Promise<T> {
  const r: CheckResult = await h.runCheck(kind, PROBE_SPEC, { checkout: tempDir('checkout'), deadline: 60_000 });
  const message = r.failures?.[0]?.message;
  if (typeof message !== 'string') throw Error(`the probe ${kind} returned no report: ${JSON.stringify(r)}`);
  return JSON.parse(message) as T;
}

// ---- Driving the clock: each step moves it, then runs the hub's timer and waits for what it started to end.
/** Moves the clock to each minute in [from, to] (both ends in) and runs what is due at each. */
export async function step(h: ExtensionHost, c: Clock, from: number, to: number, every = MINUTE): Promise<void> {
  for (let t = from; t <= to; t += every) {
    c.set(t);
    await h.tick();
    await h.idle();
  }
}
export async function waitUntil<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}
export const runsOf = async (h: ExtensionHost, schedule: string): Promise<ScheduleRun[]> => (await h.runs(schedule)).slice().sort((a, b) => a.due - b.due);
export const rowOf = async (h: ExtensionHost, schedule: string): Promise<ScheduleRow> => {
  const row = (await h.schedules()).find((r) => r.name === schedule);
  if (!row) throw Error(`the schedules list has no row ${schedule}: ${JSON.stringify(await h.schedules())}`);
  return row;
};
export const sendOf = async (h: ExtensionHost, key: string): Promise<SendRow | undefined> => (await h.sends()).find((s) => s.key === key);
/** Removes the market key on the trusted path: the list first, then your yes naming exactly what it listed. */
export async function removeKey(h: ExtensionHost): Promise<string[]> {
  const listed = await h.removeSecret(YOU, MARKET_ID, 'market_key');
  const done = await h.removeSecret(YOU, MARKET_ID, 'market_key', { yes: listed.blocked });
  expect(done.removed, `the key is removed on your yes to ${JSON.stringify(listed.blocked)}: ${JSON.stringify(done)}`).toBe(true);
  return listed.blocked;
}
/** The authority asks raised so far, open or closed. */
export const authorityAsks = async (w: World): Promise<string[]> => (await w.asks.inbox()).filter((r) => r.kind === 'authority').map((r) => r.ask);
/** Your yes to an ask, on the trusted path, binding the plan its card shows. */
export async function approve(w: World, ask: string): Promise<void> {
  const card = await w.asks.card(ask);
  const option = card.options.find((o) => o.decision === 'allow') ?? card.options[0]!;
  await w.asks.answer(YOU, ask, { option: option.id, plan_hash: await shownPlanHash(w.asks, ask), token: `click-${Date.now()}` });
}
