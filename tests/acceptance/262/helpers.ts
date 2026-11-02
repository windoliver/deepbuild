// Test-side tools for the #262 acceptance tests: temp folders, a controlled clock, a world (the record with its
// evidence store on that clock, the asks core, the supervisor and project trust), hosts with the seams the surface
// names (the clock, a secret store, an HTTP client routing api.metrics.example to a local server, the evidence store),
// the test packages copied from fixtures/, the app's views/shown and views/hidden reports on a clock, the probe a test
// package reports through, and the record read back.
// Nothing here stands in for the extension host, the record or the evidence store: the tests reach the host only
// through `@deepbuild/extension-host`'s entry, the record through `@deepbuild/record`'s and the store through
// `@deepbuild/evidence`'s (README, The surface under test). The host is loaded lazily, so this file loads at the base,
// where the new surface doesn't exist.
//
// Safety: every folder is under /tmp/dh262-* (real paths), removed after its file; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE_*, DEEP_* and AI_AGENT variables are removed first; no test touches
// the real ~/.deepbuild or the Keychain; nothing reaches the network (api.metrics.example is a server on 127.0.0.1,
// and any other name is refused by the client before a socket opens); a plug-in's process is stopped only through
// the host that started it, never by name or port.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type { ExtensionHost, HttpAnswer, HttpClient, HttpRequest, Installed, InstallFrom, ProjectTrust, SecretStore } from '../../../packages/extension-host/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore, type EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

process.env.TZ = 'UTC';
/** Day 1 of the test clock: Monday, November 2, 2026, 00:00:00 UTC. */
export const DAY1 = Date.UTC(2026, 10, 2);
/** A time on the controlled clock: `t('10:00:30')` on day 1, `t('10:00:05', 3)` on day 3, `t('24:00:00')` the end of day 1. */
export function t(hms: string, day = 1): number {
  const [h, m, s] = hms.split(':').map(Number) as [number, number, number?];
  return DAY1 + (day - 1) * DAY + h * HOUR + m * MINUTE + (s ?? 0) * SECOND;
}
/** A time as the problems name it: `10:00:30`, or `10:00:30 on day 3` past day 1. */
export function hms(ms: number): string {
  const day = Math.floor((ms - DAY1) / DAY) + 1;
  const clock = new Date(ms).toISOString().slice(11, 19);
  return day === 1 ? clock : `${clock} on day ${day}`;
}
/** A count as the issue writes it: 4,320,000. */
export const count = (n: number): string => n.toLocaleString('en-US');

/** The plug-ins, their host, their names. */
export const API = 'api.metrics.example';
export const SHOP_ID = 'test/shop';
export const GLANCE_ID = 'test/glance';
export const PASSED = 'ext.shop.rate_passed';
export const LATENCY = 'ext.shop.latency_high';
export const WATCH = 'ext.shop.watch_rate';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh262-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh262-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- Connections, as the hub's socket proved them. You, in the app: the app API's views/shown and views/hidden come
// on the app's connection, and so do your Read now click and the notice you create.
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/** The core, as the asks core appends a decision (AC15, AC16). */
export const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };

// ---- The controlled clock.
export interface Clock { now: () => number; set(t: number): void }
export function clock(start: number): Clock {
  let at = start;
  return { now: () => at, set: (next) => { if (next < at) throw Error(`the clock moves forward only: ${hms(next)} < ${hms(at)}`); at = next; } };
}
/** The real clock, for the budgets. */
export const realClock: Clock = { now: Date.now, set: () => { throw Error('the real clock is not set'); } };

// ---- The world: a record with its evidence store, both on the controlled clock, the asks core, the supervisor, trust.
export interface World {
  dir: string;
  home: string;
  record: RecordStore;
  evidence: EvidenceStore;
  /** Where the evidence store keeps its files: evidence/ab/cdef…. */
  evidenceRoot: string;
  asks: Asks;
  sup: Supervisor;
  trust: ProjectTrust;
  clock: Clock;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
export async function openWorld(c: Clock): Promise<World> {
  const dir = tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const evidenceRoot = join(dir, 'evidence');
  const evidence = await openEvidenceStore({ root: evidenceRoot, now: c.now });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: c.now, evidence });
  const asks = await openAsks({ record, now: c.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: c.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const { openTrust } = await host();
  const trust = await openTrust({ record, now: c.now });
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000, ...(kind ? { kinds: [kind] } : {}) });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return all;
  };
  let closed = false;
  const w: World = {
    dir, home: deepHome, record, evidence, evidenceRoot, asks, sup, trust, clock: c, events,
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

export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;

export function memoryStore(): SecretStore {
  const entries = new Map<string, string>();
  return { get: async (key) => entries.get(key), set: async (key, value) => { entries.set(key, value); }, delete: async (key) => { entries.delete(key); } };
}

/**
 * A ready extension host on a world, with the seams the surface names: the clock, a secret store, the HTTP client,
 * and the world's evidence store, which the host writes batch and rollup files to (README, The surface under test).
 */
export async function openHost(w: World, http: HttpClient, now: () => number = w.clock.now): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: [], now, asks: w.asks,
    secrets: memoryStore(), http, evidence: w.evidence,
  });
  hosts.push(h);
  await h.ready();
  return h;
}

// ---- The local provider standing in for api.metrics.example: /s/<source> answers with what `answers[source]` gives
// for its n-th call (from 0). Every request is kept, stamped with the controlled clock.
export interface Seen { source: string; url: string; at: number; n: number }
export type Reply = { status: number; headers?: Record<string, string>; body?: string };
export interface Provider { base: string; seen: Seen[]; calls(source: string): number[]; close(): Promise<void> }
export type Answers = Record<string, (n: number, at: number) => Reply>;
const providers: Provider[] = [];
export async function metricsApi(c: Clock, answers: Answers): Promise<Provider> {
  const seen: Seen[] = [];
  const counts = new Map<string, number>();
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      const url = req.url ?? '';
      const source = /^\/s\/([a-z][a-z0-9_.-]*)/.exec(url)?.[1];
      const answer = source ? answers[source] : undefined;
      if (!source || !answer) return void res.writeHead(404).end();
      const n = counts.get(source) ?? 0;
      counts.set(source, n + 1);
      const at = c.now();
      seen.push({ source, url, at, n });
      const r = answer(n, at);
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) }).end(r.body ?? '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const p: Provider = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen,
    calls: (source) => seen.filter((s) => s.source === source).map((s) => s.at),
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
  };
  providers.push(p);
  return p;
}
export const json = (body: unknown, status = 200): Reply => ({ status, body: JSON.stringify(body) });
/** A number source's answer. */
export const num = (value: number): Reply => json({ value });
/** A series source's answer: each field a named value. */
export const seriesOf = (values: Record<string, number>): Reply => json(values);
/** `n` named values, svc000 … , each from `value(i)`. */
export function named(n: number, value: (i: number) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) out[`svc${String(i).padStart(n > 1000 ? 5 : 3, '0')}`] = value(i);
  return out;
}

/** The HTTP client the hub is given: api.metrics.example goes to the local provider; any other name is refused before a socket. */
export function routedClient(routes: Record<string, Provider>): HttpClient {
  return (request, signal) => send(routes, request, signal);
}
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
/** One call to the provider as a host that isn't the hub would make it (the twins'): GET https://api.metrics.example/s/<source>. */
export const callDirect = (routes: Record<string, Provider>, source: string) => send(routes, { url: `https://${API}/s/${source}`, method: 'GET', headers: {} });

afterAll(async () => {
  for (const h of hosts.splice(0)) await Promise.race([h.close().catch(() => undefined), sleep(30_000)]);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const p of providers.splice(0)) await p.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 300_000);

// ---- Test packages.
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
/** A test package in a temp folder: its fixture with `*.fixture` renamed, `probe.json` written, its digest the host's own. */
export async function pkg(name: string, probe: unknown): Promise<string> {
  const dir = copyFixture(name);
  writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
export const grant = (): NonNullable<InstallFrom['grant']> => ({ hosts: [{ host: API, quota: { calls: 100_000_000, per_ms: HOUR } }] });

/** What the shop plug-in registers (fixtures/shop). */
export interface SourceProbe {
  name: string;
  series?: boolean;
  while_shown?: { every: number };
  quota?: { per_minute: number; per_day: number };
  timeout?: number;
  freshFor?: number;
}
export interface MetricsProbe {
  sources: SourceProbe[];
  views: { name: string; binds: string[] }[];
  polls?: { name: string; every: number; reads: string }[];
  /** ext.shop.watch_rate: the job that checks ext.shop.rate_passed, with no cadence of its own. */
  watch?: { source: string; threshold: number; key: string };
}

/** Install (by no agent), check and load; the first refusal, or null when it loaded. */
export async function tryInstall(h: ExtensionHost, from: string): Promise<{ refusal: string | null; installed: Installed | null }> {
  let installed: Installed;
  try {
    installed = await h.install({ from, builtBy: null, grant: grant() });
  } catch (e) {
    return { refusal: `install: ${(e as Error).message}`, installed: null };
  }
  const checked = await h.check(installed);
  if (!checked.passed) return { refusal: `conformance: ${checked.reasons.join('; ')}`, installed };
  const load = await h.load(installed);
  if (load.status !== 'loaded') return { refusal: `load: ${load.reason}`, installed };
  return { refusal: null, installed };
}
export async function installAndLoad(h: ExtensionHost, from: string): Promise<Installed> {
  const { refusal, installed } = await tryInstall(h, from);
  expect(refusal, `${from} installs and loads`).toBeNull();
  return installed!;
}

/** A world on the controlled clock from `start`, the provider, a host, and the shop plug-in loaded with `probe`. */
export interface Metrics { c: Clock; w: World; h: ExtensionHost; api: Provider; routes: Record<string, Provider> }
export async function metricsWorld(start: number, probe: MetricsProbe, answers: Answers, plugin = 'shop'): Promise<Metrics> {
  const c = clock(start);
  const api = await metricsApi(c, answers);
  const routes = { [API]: api };
  const w = await openWorld(c);
  const h = await openHost(w, routedClient(routes));
  await installAndLoad(h, await pkg(plugin, probe));
  return { c, w, h, api, routes };
}

// ---- The probe: a package reports what it saw through a check kind it registers.
const PROBE_SPEC: CheckSpec = { kind: 'probe', runner: 'report', inputs: [], depth: 'unit', oracle: 'code', contract: null };
export async function report<T>(h: ExtensionHost, kind = 'ext.shop.report'): Promise<T> {
  const r: CheckResult = await h.runCheck(kind, PROBE_SPEC, { checkout: tempDir('checkout'), deadline: 60_000 });
  const message = r.failures?.[0]?.message;
  if (typeof message !== 'string') throw Error(`the probe ${kind} returned no report: ${JSON.stringify(r)}`);
  return JSON.parse(message) as T;
}
/** A check kind's spec whose inputs name what ext.shop.cites cites. */
export const citing = (inputs: string[]): CheckSpec => ({ kind: 'ext.shop.cites', runner: 'cites', inputs, depth: 'unit', oracle: 'code', contract: null });

// ---- Actions: the view's Read now button, and a notice sent for a subscription.
async function act(h: ExtensionHost, action: string, input: unknown): Promise<{ ok: boolean; [k: string]: unknown }> {
  const r = await h.callAction({ action, target: { handle: `ext:${SHOP_ID}`, version: '1.0.0' }, input, caller: YOU });
  if (r.status !== 'done') throw Error(`${action}: ${JSON.stringify(r)}`);
  return JSON.parse((r.output as { result: string }).result) as { ok: boolean };
}
/** Your click on the view's Read now button: the panel calls ext.shop.read_now, which calls deep.readNow(view). */
export const readNow = (h: ExtensionHost, view: string) => act(h, 'ext.shop.read_now', { view });
export const notify = (h: ExtensionHost, subscription: string, key: string, readings: string[]) => act(h, 'ext.shop.notify', { subscription, key, readings });

// ---- The app's reports on the app API: views/shown for each shown view, repeated every 5 s, and views/hidden.
/** A views/shown report (README, The surface under test). */
export interface ShownReport { view: string; window: string; visible: boolean; minimized: boolean; display_awake: boolean; session_locked: boolean; replica: boolean }
export interface Sent { at: number; kind: 'shown' | 'hidden'; report: ShownReport | { view: string; window: string } }
/** The app: each view it shows is reported at once and then every 5 s, until it is hidden or the app goes silent. */
export class App {
  readonly sent: Sent[] = [];
  private readonly showing = new Map<string, { report: ShownReport; last: number | null }>();
  private silent = false;
  constructor(private readonly h: ExtensionHost | null, private readonly c: Clock) {}
  /** The view is shown in a window of its own (or as `over` says: minimized, a replica's, …); reported at the next step. */
  show(view: string, over: Partial<ShownReport> = {}): void {
    const report: ShownReport = { view, window: `window:${view}`, visible: true, minimized: false, display_awake: true, session_locked: false, replica: false, ...over };
    this.showing.set(`${report.replica ? 'replica:' : ''}${view}`, { report, last: null });
  }
  /** Your window changes: what the next reports say, from the next step. */
  change(view: string, over: Partial<ShownReport>, replica = false): void {
    const at = this.showing.get(`${replica ? 'replica:' : ''}${view}`);
    if (!at) throw Error(`${view} isn't shown`);
    at.report = { ...at.report, ...over };
    at.last = null;
  }
  /** The view is closed: views/hidden, now. */
  async hide(view: string): Promise<void> {
    const at = this.showing.get(view);
    if (!at) throw Error(`${view} isn't shown`);
    this.showing.delete(view);
    const report = { view, window: at.report.window };
    this.sent.push({ at: this.c.now(), kind: 'hidden', report });
    if (this.h) await this.h.viewsHidden(YOU, report);
  }
  /** The app's window draws nothing from now on while its socket stays open: no report of any kind. */
  goSilent(): void { this.silent = true; }
  /** Each report due at the clock's time. */
  async report(): Promise<void> {
    if (this.silent) return;
    const now = this.c.now();
    for (const at of this.showing.values()) {
      if (at.last !== null && now - at.last < 5 * SECOND) continue;
      at.last = now;
      this.sent.push({ at: now, kind: 'shown', report: { ...at.report } });
      if (this.h) await this.h.viewsShown(YOU, { ...at.report });
    }
  }
}
/** The hub's timer, a step at a time from `from` to `to` (both ends in): the clock moves, the app reports, the hub ticks and settles. */
export async function run(h: ExtensionHost, c: Clock, app: App | null, from: number, to: number, every = SECOND): Promise<void> {
  for (let at = from; at <= to; at += every) {
    c.set(at);
    if (app) await app.report();
    await h.tick();
    await h.idle();
  }
}
export const between = (calls: number[], from: number, to: number): number[] => calls.filter((x) => x >= from && x < to);

// ---- The record read back.
export interface BatchData { source: string; as_of: number; file: string }
/** A source's reading.batch events, in log order. */
export async function batches(w: World, source: string): Promise<Event[]> {
  return (await w.events('reading.batch')).filter((e) => (e.data as unknown as BatchData).source === source);
}
export async function batchAt(w: World, source: string, asOf: number): Promise<Event> {
  const found = (await batches(w, source)).filter((e) => (e.data as unknown as BatchData).as_of === asOf);
  if (found.length !== 1) throw Error(`the record holds ${found.length} reading.batch events of ${source} as of ${hms(asOf)}, not one`);
  return found[0]!;
}
/** A batch's handle: its reading.batch event's subject, else reading:<its ID> (README, The surface under test). */
export const batchHandle = (e: Event): string => e.subject ?? `reading:${e.id}`;
export const fileOf = (e: Event): string => (e.data as unknown as BatchData).file;
export interface RollupData { source: string; span: 'minute' | 'hour'; start: number; file: string }
export async function rollupEvents(w: World, source: string): Promise<Event[]> {
  return (await w.events('reading.rollup')).filter((e) => (e.data as unknown as RollupData).source === source);
}
/** The evidence file a hash names, in the store's folder: evidence/ab/cdef…. */
export const evidencePath = (w: World, sha: string): string => join(w.evidenceRoot, sha.slice(0, 2), sha.slice(2));

/** One bound value, resolved live or at a pinned log position. */
export async function value(h: ExtensionHost, handle: string, pinned?: number) {
  const [v] = await h.boundValues([handle], pinned === undefined ? undefined : { log_pos: pinned });
  if (!v) throw Error(`no bound value came back for ${handle}`);
  return v;
}

export async function waitUntil<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(25);
  }
}
