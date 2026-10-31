// Test-side tools for the #364 acceptance tests: temp folders, a world (the record with its evidence store, the asks
// core, the supervisor and project trust), hosts, test packages copied from fixtures/, the probe a test package
// reports through, local HTTP servers standing in for the named hosts, the HTTP client that routes those names to
// them, an in-memory secret store standing in for the OS one, and a byte search of every file a world wrote.
// Nothing here stands in for the extension host: the tests reach it only through `@deepbuild/extension-host`'s entry
// (README, The surface under test). This file imports that package's types only and loads it lazily, so it loads at
// the base, where the new surface doesn't exist.
//
// Safety: every folder is under /tmp/dh364-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_*, DEEP_* and AI_AGENT variables are removed first; no test touches the real ~/.deepbuild
// or the real Keychain; nothing reaches the network (each named host is a server on 127.0.0.1, and a name no test
// server stands in for is refused by the client before any socket); no process is ever stopped by name or port.

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type {
  ExtensionHost, HookRequest, HttpAnswer, HttpClient, HttpRequest, Installed, InstallFrom, ProjectTrust, Recording, ReleaseEntry, SecretStore,
} from '../../../packages/extension-host/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { fixtures as contractFixtures } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The extension host's public entry (README, The surface under test). */
const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

/** The issue's market key, its two hosts and the header the price source puts the key in. */
export const KEY = 'mk/test+51f0c9=';
export const MARKET = 'api.market.example';
export const OTHER = 'cdn.other.example';
export const PRICE = 'ext.market.price';
export const MARKET_ID = 'test/market';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh364-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh364-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- Connections: who calls, as the hub's socket proved it. You, on the trusted path, in the app.
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };

// ---- The world: a record with its evidence store, the asks core, the supervisor and project trust.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs extensions under. */
  home: string;
  record: RecordStore;
  sup: Supervisor;
  trust: ProjectTrust;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
export async function openWorld(): Promise<World> {
  const dir = tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence') });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
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
    dir, home: deepHome, record, sup, trust, events,
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

export interface HostOptions {
  release?: ReleaseEntry[];
  secrets: SecretStore;
  http: HttpClient;
  replay?: Recording;
  now?: () => number;
}
/** A ready extension host on a world, with the test seams the surface names: the secret store, the HTTP client, a recording to replay and the clock. */
export async function openHost(w: World, options: HostOptions): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: options.release ?? [], now: options.now ?? Date.now,
    secrets: options.secrets, http: options.http, ...(options.replay ? { replay: options.replay } : {}),
  });
  hosts.push(h);
  await h.ready();
  return h;
}

// ---- Local HTTP servers standing in for the named hosts. Each counts and keeps every request that reaches it.
export interface Seen { method: string; url: string; headers: Record<string, string> }
export type Reply = { status: number; headers?: Record<string, string>; body?: string } | 'hang';
export interface TestServer { base: string; seen: Seen[]; close(): Promise<void> }
const servers: TestServer[] = [];
export async function testServer(reply: (req: Seen) => Reply): Promise<TestServer> {
  const seen: Seen[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const s: Seen = { method: req.method ?? '', url: req.url ?? '', headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])) };
    seen.push(s);
    req.resume();
    const r = reply(s);
    if (r === 'hang') return; // never answers: the source's timeout must end the call
    res.writeHead(r.status, r.headers ?? {}).end(r.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const t: TestServer = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen,
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
  };
  servers.push(t);
  return t;
}

/**
 * The HTTP client the hub is given (README, The surface under test): it sends a call for `https://<name>/<path>` to
 * the local server standing in for that name, never follows a redirect (a 3xx comes back as it is, Location and all),
 * and passes the hub's signal on. A name no server stands in for, or one marked offline, is refused before any socket,
 * as a machine with no network refuses it. `asked` keeps every call the hub made through it; `answers` what came back,
 * as the client got it, before the hub did anything to it.
 */
export interface RoutedClient { client: HttpClient; asked: HttpRequest[]; answers: { request: HttpRequest; answer: HttpAnswer }[]; offline: Set<string> }
export function routedClient(routes: Record<string, TestServer>): RoutedClient {
  const asked: HttpRequest[] = [];
  const answers: RoutedClient['answers'] = [];
  const offline = new Set<string>();
  const client: HttpClient = async (request, signal) => {
    asked.push(structuredClone(request));
    return send(routes, offline, request, signal, (answer) => answers.push({ request: structuredClone(request), answer: structuredClone(answer) }));
  };
  return { client, asked, answers, offline };
}
/** One call to the server a name maps to, the redirect handed back; exported for the twin that follows redirects. */
export async function send(routes: Record<string, TestServer>, offline: Set<string>, request: HttpRequest, signal: AbortSignal, keep?: (a: HttpAnswer) => void): Promise<HttpAnswer> {
  const url = new URL(request.url);
  const server = routes[url.hostname];
  if (!server || offline.has(url.hostname)) {
    // No network: what fetch throws when the name doesn't resolve.
    throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${url.hostname}`), { code: 'ENOTFOUND' }) });
  }
  const res = await fetch(`${server.base}${url.pathname}${url.search}`, { method: request.method, headers: request.headers, redirect: 'manual', signal });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  const answer: HttpAnswer = { status: res.status, headers, body: await res.text() };
  keep?.(answer);
  return answer;
}

afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const s of servers.splice(0)) await s.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

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
 * neither Vitest nor tsc picks the package's code up), the manifest fields and probe settings written over it, and
 * the manifest's `digest` set to the host's own `packageDigest` of the result.
 */
export async function pkg(name: string, options: { manifest?: Record<string, unknown>; probe?: Record<string, unknown> } = {}): Promise<string> {
  const dir = copyFixture(name);
  if (options.probe) writeFileSync(join(dir, 'probe.json'), JSON.stringify(options.probe));
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = { ...(JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>), ...(options.manifest ?? {}) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
export async function releaseEntry(dir: string): Promise<ReleaseEntry> {
  const { packageDigest } = await host();
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
}

/** What the market package is granted: the market host, with room for every call a test makes. */
export const MARKET_GRANT: NonNullable<InstallFrom['grant']> = { hosts: [{ host: MARKET, quota: { calls: 1000, per_ms: HOUR } }] };
/** Install (by no agent), check and load a package; the load must succeed. */
export async function installAndLoad(h: ExtensionHost, from: string, grant: InstallFrom['grant'] = MARKET_GRANT): Promise<Installed> {
  const p = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) });
  const checked = await h.check(p);
  expect(checked.passed, `${p.id}@${p.version}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
  const load = await h.load(p);
  expect(load.status, `${p.id}@${p.version} didn't load: ${JSON.stringify(load)}`).toBe('loaded');
  return p;
}

/**
 * The market package's settings (fixtures/market): how its price source sends the key (`header`: X-Api-Key, or
 * `basic`: Basic credentials for `user`), its timeout and freshness, whether it declares the key test, and whether it
 * adds what it was given to a tool.before context (a release package only).
 */
export interface MarketProbe { auth: 'header' | 'basic'; timeout?: number; freshFor?: number; keyTest?: boolean; hook?: boolean }
export function marketPackage(probe: MarketProbe, manifest: Record<string, unknown> = {}): Promise<string> {
  return pkg('market', { probe: { timeout: 2_000, freshFor: 60_000, keyTest: false, hook: false, ...probe }, manifest });
}

// ---- The probe: a test package reports what it saw through a check kind it registers (#348's convention): its
// runner returns one failure whose message is the JSON of its observations.
const PROBE_SPEC: CheckSpec = { kind: 'probe', runner: 'report', inputs: [], depth: 'unit', oracle: 'code', contract: null };
export async function report<T = Record<string, unknown>>(h: ExtensionHost, kind: string): Promise<T> {
  const r: CheckResult = await h.runCheck(kind, PROBE_SPEC, { checkout: tempDir('checkout'), deadline: 60_000 });
  const message = r.failures?.[0]?.message;
  if (typeof message !== 'string') throw Error(`the probe ${kind} returned no report: ${JSON.stringify(r)}`);
  return JSON.parse(message) as T;
}
/** What the market package's parser was given, call by call, and the handle deep.secret gave it. */
export interface MarketReport { handle: unknown; seen: HttpAnswer[] }

/** A tool.before hook request: its event is tool.before@2's contract fixture (#350's surface). */
export function toolBefore(): HookRequest {
  const data = (contractFixtures('tool.before@2')[0] as { data: unknown } | undefined)?.data;
  if (data === undefined) throw Error('no contract fixture for tool.before@2');
  return { kind: 'tool.before', data, deadline: 5_000, bound: 100_000 };
}

// ---- Bytes on disk: every file under the roots, searched for each needle's UTF-8 and UTF-16LE bytes.
export function filesHolding(needles: string[], roots: string[]): string[] {
  const bytes = needles.flatMap((n) => [Buffer.from(n, 'utf8'), Buffer.from(n, 'utf16le')]);
  const found: string[] = [];
  const walk = (path: string): void => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (stat.isDirectory()) { for (const name of readdirSync(path)) walk(join(path, name)); return; }
    if (!stat.isFile()) return;
    const content = readFileSync(path);
    if (bytes.some((n) => content.includes(n))) found.push(path);
  };
  for (const root of roots) walk(root);
  return found;
}
