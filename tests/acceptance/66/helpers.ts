// Test-side tools for the #66 acceptance tests (README): the criteria's IDs, temp folders, a controlled clock, a world
// (the record with its evidence store, the asks core, the supervisor and project trust), an extension host with the
// seams #364 gave it (the clock, a secret store standing in for the OS one, an HTTP client routing the providers'
// names to local servers), the hub's stop and next start, test packages and the shipped sources copied to temp
// folders, and the clock steps. Cut down from tests/acceptance/365/helpers.ts (same repo, same license); this suite
// keeps its own copy so a redraft of theirs never moves these tests.
//
// Nothing here stands in for the extension host or the record: the tests reach the host only through
// `@deepbuild/extension-host`'s entry, loaded lazily so this file loads at the base, where the work-source surface
// doesn't exist. Its new methods are typed here (`WorkMethods`, README "The surface under test").
//
// Safety: every folder is under /tmp/dh66-* (real paths), removed after its file; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE_*, DEEP_* and AI_AGENT variables are removed first; no test touches
// the real ~/.deepbuild or the real Keychain; nothing reaches the network (each provider name is a server on
// 127.0.0.1, and a name no server stands in for is refused before any socket); a plug-in's process is stopped only
// through the supervisor run that started it, never by name or port.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type {
  ExtensionHost, HttpAnswer, HttpClient, HttpRequest, Installed, InstallFrom, ProjectTrust, ScheduleRow, ScheduleRun, SecretStore,
} from '../../../packages/extension-host/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, testStorage, type Connection, type Event, type RecordStore, type TestStorage } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { shownPlanHash } from '../plans.ts';

// ---- The criteria, in the issue's order: `#66.<first 8 hex of the SHA-256 of the text, trimmed, white space collapsed>`.
export const AC1 = 'AC1 #66.3e42b2ec';
export const AC2 = 'AC2 #66.63dbbb33';
export const AC3 = 'AC3 #66.5b2f0bb8';
export const AC4 = 'AC4 #66.29d53e6f';
export const AC5 = 'AC5 #66.3ddbb14e';
export const AC6 = 'AC6 #66.c02d2c19';
export const AC7 = 'AC7 #66.79249ba8';
export const AC8 = 'AC8 #66.61304a77';
export const AC9 = 'AC9 #66.839c6774';
export const AC10 = 'AC10 #66.c521a2ac';
export const AC11 = 'AC11 #66.c9794944';
export const AC12 = 'AC12 #66.64143d81';
export const AC13 = 'AC13 #66.ae3a36b9';
export const AC14 = 'AC14 #66.91ad44c4';
export const AC15 = 'AC15 #66.e73c1ce6';
export const AC16 = 'AC16 #66.abf37817';
export const AC17 = 'AC17 #66.a51b9fa2';
export const AC18 = 'AC18 #66.c7bb08f1';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

process.env.TZ = 'UTC';
/** A time on the controlled clock: `at('2026-11-02T09:00')`. */
export const at = (iso: string): number => Date.parse(iso.length === 16 ? `${iso}:00.000Z` : iso);
export const iso = (t: number): string => new Date(t).toISOString();
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh66-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh66-${tag}-`));
  made.push(dir);
  return dir;
}

/** You, on the trusted path, in the app. */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };

// ---- The surface under test (README): the work-source methods the extension host gains. Typed here, since the base
// has none of them; a call at the base throws "is not a function", the failure BASE-FAILURE.txt shows.
export type Role = 'owner' | 'collaborator' | 'outside';
export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'INVALID';
/** A work.item@1 reading. */
export interface WorkItem { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: Role }[]; updated: string }
/** One event a work source's read took in on a task's thread: its identity, its kind and its reading. */
export interface WorkEvent { id: string; kind: 'item' | 'comment' | 'edit' | 'status'; at: string; reading: WorkItem }
export interface WorkTask { task_ref: string; source: string; id: string; link: string; title: string; criteria: string[]; opened: number; ended: number | null }
export interface WorkPage {
  on: boolean;
  position: string | null;
  skipped: number;
  dropped: { id: string; why: 'deleted' | 'not found' | 'forbidden'; at: number }[];
  failing: { id: string; error: string; since: number }[];
  refused: { event: string; why: string }[];
}
export interface DeliveryRow {
  key: string; task_ref: string; source: string; thread: string;
  outcome: 'queued' | 'waiting' | 'sent' | 'not sent' | 'unknown' | 'gone';
  cause: string | null; ask: string | null; rule: string | null; at: number | null;
}
export interface WorkResult { verdict: Verdict; summary: string; requirements: { id: string; text: string; verdict: Verdict; evidence: string[] }[]; receipt: string }
export interface WorkKitFixture { scope: string; items: string[]; roles: Record<string, Role> }
export interface WorkMethods {
  addWorkSource(connection: Connection, spec: { source: string; scope: string; every: number }): Promise<string>;
  removeWorkSource(connection: Connection, handle: string): Promise<void>;
  setWorkRule(connection: Connection, handle: string, rule: { sentence: string }): Promise<string>;
  fix(connection: Connection, id: string): Promise<WorkTask>;
  workTasks(): Promise<WorkTask[]>;
  workEvents(task_ref: string): Promise<WorkEvent[]>;
  endTask(connection: Connection, task_ref: string): Promise<void>;
  workPage(handle: string): Promise<WorkPage>;
  deliverResult(task_ref: string, result: WorkResult): Promise<string>;
  deliveries(): Promise<DeliveryRow[]>;
  workKit(source: string, fixture: WorkKitFixture): Promise<{ verdict: 'PASS' | 'FAIL'; failures: string[] }>;
}
export type Host = ExtensionHost & WorkMethods;

// ---- The controlled clock.
export interface Clock { now: () => number; set(t: number): void }
export function clock(start: number): Clock {
  let t = start;
  return { now: () => t, set: (next) => { if (next < t) throw Error(`the clock moves forward only: ${iso(next)} < ${iso(t)}`); t = next; } };
}

// ---- The world.
export interface World {
  dir: string; home: string; record: RecordStore; asks: Asks; sup: Supervisor; trust: ProjectTrust; clock: Clock;
  storage?: TestStorage;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;

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
    dir, home: deepHome, record, asks, sup, trust, clock: c, events, ...(options.storage ? { storage: options.storage } : {}),
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
export const vfsWorld = (c: Clock, storage: TestStorage = testStorage()) => openWorld(c, { storage });

export interface TestStore extends SecretStore { holds(value: string): boolean }
export function memoryStore(): TestStore {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key),
    set: async (key, value) => { entries.set(key, value); },
    delete: async (key) => { entries.delete(key); },
    holds: (value) => [...entries.values()].includes(value),
  };
}

export interface HostSeams { secrets: SecretStore; http: HttpClient; now?: () => number }
export async function openHost(w: World, seams: HostSeams): Promise<Host> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: [], now: seams.now ?? w.clock.now,
    asks: w.asks, secrets: seams.secrets, http: seams.http,
  });
  hosts.push(h);
  await h.ready();
  return h as Host;
}
export async function stopHub(h: ExtensionHost, w: World): Promise<void> {
  await h.close();
  await w.close();
}
/** The hub's next start on the same files (and the same test VFS): a new record, supervisor and host; each installed package loads again. */
export async function startHub(w: World, seams: HostSeams, storage?: TestStorage): Promise<{ w: World; h: Host }> {
  const again = await openWorld(w.clock, { dir: w.dir, ...(storage ?? w.storage ? { storage: storage ?? w.storage } : {}) });
  const h = await openHost(again, seams);
  for (const p of await h.installed()) {
    if (!h.checked(p)) await h.check(p);
    const load = await h.load(p);
    if (load.status !== 'loaded') throw Error(`${p.id} didn't load again at the hub's next start: ${load.reason}`);
  }
  return { w: again, h };
}
/** The plug-in's own process dies: SIGKILL to the supervisor run its host started it under. */
export async function killPlugin(w: World, h: ExtensionHost, id: string): Promise<void> {
  const run = (await h.loaded()).find((l) => l.id === id)?.run;
  if (run) await w.sup.signal(run, 'SIGKILL').catch(() => undefined);
}

// ---- Local providers standing in for the named hosts: each keeps every request that reaches it, stamped with the
// controlled clock, and answers it with what `reply` gives, which may wait ('hang' never answers).
export interface Seen { method: string; url: string; path: string; query: URLSearchParams; headers: Record<string, string>; body: string; at: number }
export type Reply = { status: number; headers?: Record<string, string>; body?: string } | 'hang';
export interface Provider { base: string; seen: Seen[]; close(): Promise<void>; drop(): void }
const providers: Provider[] = [];
export async function provider(c: Clock, reply: (req: Seen) => Reply | Promise<Reply>): Promise<Provider> {
  const seen: Seen[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://local');
      const s: Seen = {
        method: req.method ?? '', url: req.url ?? '', path: url.pathname, query: url.searchParams, at: c.now(), body: Buffer.concat(chunks).toString('utf8'),
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])),
      };
      seen.push(s);
      void Promise.resolve().then(() => reply(s)).then((r) => {
        if (r === 'hang' || res.destroyed) return;
        res.writeHead(r.status, r.headers ?? {}).end(r.body ?? '');
      }, (e: unknown) => { if (!res.destroyed) res.writeHead(500).end(String(e)); });
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
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Reply => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
export function gate(): { wait: Promise<void>; open(): void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

/** The hub's HTTP client: `https://<name>/<path>` goes to the provider standing in for that name; any other name is refused before a socket. */
export function routedClient(routes: Record<string, Provider>): { client: HttpClient; asked: HttpRequest[] } {
  const asked: HttpRequest[] = [];
  const client: HttpClient = async (request, signal) => {
    asked.push(structuredClone(request));
    return send(routes, request, signal);
  };
  return { client, asked };
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

afterAll(async () => {
  for (const h of hosts.splice(0)) await Promise.race([h.close().catch(() => undefined), sleep(30_000)]);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const p of providers.splice(0)) await p.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 120_000);

// ---- Packages: the test plug-ins in fixtures/ and the sources the implementation ships in packages/sources/.
function copy(from: string, tag: string): string {
  const dir = tempDir(`pkg-${tag}`);
  cpSync(from, dir, { recursive: true });
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
async function sealed(dir: string): Promise<string> {
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/** A test package: `fixtures/<name>` in a temp folder, `*.fixture` renamed, `probe.json` written, the digest set. */
export async function pkg(name: string, probe: Record<string, unknown> = {}): Promise<string> {
  const dir = copy(join(FIXTURES, name), name);
  writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
  return sealed(dir);
}
/** A source the implementation ships (README): `packages/sources/<name>` copied as it is, its digest set for this copy. */
export async function shipped(name: 'linear' | 'gmail'): Promise<string> {
  const from = join(REPO, 'packages/sources', name);
  if (!existsSync(join(from, 'deepbuild.json'))) throw Error(`packages/sources/${name}/deepbuild.json doesn't exist: the ${name} work source isn't shipped`);
  return sealed(copy(from, name));
}
export const grantFor = (...names: string[]): NonNullable<InstallFrom['grant']> => ({ hosts: names.map((n) => ({ host: n, quota: { calls: 1_000_000, per_ms: HOUR } })) });
export async function installAndLoad(h: ExtensionHost, from: string, grant: InstallFrom['grant']): Promise<Installed> {
  const p = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) });
  const checked = await h.check(p);
  expect(checked.passed, `${p.id}@${p.version}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
  const load = await h.load(p);
  expect(load.status, `${p.id}@${p.version} didn't load: ${JSON.stringify(load)}`).toBe('loaded');
  return p;
}
/** The work sources a loaded package registered, by the manifest's sources whose reading is work.item@1. */
export function workSourcesOf(dir: string): string[] {
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { sources?: { name: string; reading?: string }[] };
  return (m.sources ?? []).filter((s) => s.reading === 'work.item@1').map((s) => s.name);
}

// ---- Driving the clock.
/** Moves the clock to each step in [from, to] and runs what is due at each. */
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
/** The run now of a work source, on the trusted path, and what it started ended. */
export async function runNow(h: ExtensionHost, handle: string): Promise<void> {
  await h.runNow(YOU, handle);
  await h.idle();
}
export const tasksOf = async (h: Host, handle: string): Promise<WorkTask[]> => (await h.workTasks()).filter((t) => t.source === handle);
export const taskFor = async (h: Host, id: string): Promise<WorkTask | undefined> => (await h.workTasks()).find((t) => t.id === id);
export const deliveryOf = async (h: Host, key: string): Promise<DeliveryRow | undefined> => (await h.deliveries()).find((d) => d.key === key);
export const authorityAsks = async (w: World) => (await w.asks.inbox()).filter((r) => r.kind === 'authority');
export async function approve(w: World, ask: string): Promise<void> {
  const card = await w.asks.card(ask);
  const option = card.options.find((o) => o.decision === 'allow') ?? card.options[0]!;
  await w.asks.answer(YOU, ask, { option: option.id, plan_hash: await shownPlanHash(w.asks, ask), token: `click-${Date.now()}` });
}

/** A result with `n` requirements and a long summary of what changed, its receipt at `receipt`. */
export function result(verdict: Verdict, n: number, receipt: string): WorkResult {
  const requirements = Array.from({ length: n }, (_, i) => ({
    id: `R${i + 1}`, text: `Requirement ${i + 1} of the task holds on every path the issue names`, verdict,
    evidence: [`https://receipts.example/ev/${i + 1}`],
  }));
  const summary = Array.from({ length: 30 }, (_, i) => `Changed module ${i + 1} so the export keeps its rows in order and reports each skipped one.`).join(' ');
  return { verdict, summary, requirements, receipt };
}
export const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
