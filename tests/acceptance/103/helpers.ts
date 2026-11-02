// Test-side tools for the #103 acceptance tests: the environment, temp folders, a world (the record with its evidence
// store, the asks core, the supervisor, project trust and, for AC4, the runner R1 built with the fake `claude` from
// fixtures/), hosts with the seams the surface names, local servers standing in for named hosts, test packages
// written to temp folders (the generic piece below, or a test's own code), the manifest rows composition reads, the
// record read back and asks answered.
// Nothing here stands in for the extension host, the asks core, the runner or the record: the tests reach them only
// through their public entries (README, The surface under test). This file imports the host's types only and loads
// it lazily, so it loads at the base, where the new surface doesn't exist.
//
// Safety: every folder is under /tmp/dh103-* (real paths), removed after its file; HOME is a temp folder holding a
// fake Claude Code sign-in (made-up tokens) for this process and every child; the agent's own CLAUDE*, DEEP_*,
// ANTHROPIC_* and AI_AGENT variables are removed first; no test touches the real ~/.deepbuild, ~/.claude or Keychain;
// nothing reaches the network (each named host is a server on 127.0.0.1, and a name no server stands in for is refused
// by the client before any socket); a plug-in's process is stopped only by the host that started it (its close), and
// the runner's jobs by the runner (its close); nothing is stopped by name or port.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type {
  ActionResult, ExtensionHost, HttpAnswer, HttpClient, HttpRequest, Installed, InstallFrom, SecretStore,
} from '../../../packages/extension-host/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openLedger } from '../../../packages/budget/src/index.ts';
import { d1Digest, fixtures as contractFixtures } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, ulid, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openRunner, type JobRecord, type Runner } from '../../../packages/runner/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { shownPlanHash, withPlans } from '../plans.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** The extension host's public entry (README, The surface under test). */
const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

/** The criteria, as scripts/proof-change.mjs computes their IDs from the issue's text. */
export const ID = {
  ac1: '#103.119d48b4', ac2: '#103.0c4256a2', ac3: '#103.3419af40', ac4: '#103.41052f7f', ac5: '#103.c7b27417',
  ac6: '#103.fce0bc6c', ac7: '#103.680f00cb', ac8: '#103.a7f0eb05', ac9: '#103.04e2ba94', ac10: '#103.770ba796',
  ac11: '#103.592e1775', ac12: '#103.cacc49e2', ac13: '#103.de8a47db', ac14: '#103.84a93fb7', ac15: '#103.334e66dd',
} as const;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const message = (e: unknown): string => String((e as Error)?.message ?? e);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
process.env.TZ = 'UTC';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('ANTHROPIC_') || key === 'AI_AGENT') delete process.env[key];
}

// ---- HOME: a temp folder with a fake Claude Code sign-in (made-up tokens), as #366's suite keeps one, for the runner.
export const ACCOUNT = '0a0a0a0a-1031-4222-8333-444444444444';
const TOKEN = `sk-ant-oat01-dh103FAKE${'x'.repeat(40)}`;
const REFRESH = `sk-ant-ort01-dh103FAKE${'y'.repeat(40)}`;
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh103-home-'));
    process.env.HOME = HOME;
    mkdirSync(join(HOME, '.claude'), { recursive: true });
    writeFileSync(join(HOME, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh103@example.invalid', organizationUuid: 'org-dh103' }, mcpServers: {}, projects: {} })}\n`);
    writeFileSync(join(HOME, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: REFRESH, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
    writeFileSync(join(HOME, '.claude', 'settings.json'), '{}\n');
  }
  return HOME;
}
home();

const made: string[] = [];
export function tempDir(tag: string): string {
  home();
  const dir = realpathSync(mkdtempSync(`/tmp/dh103-${tag}-`));
  made.push(dir);
  return dir;
}

/** You, on the trusted path, in the app. */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };

// ---- The world: the record with its evidence store, the asks core, the supervisor, project trust, and for AC4 the
// runner with its budget ledger, its agent the fake `claude`. Every timing here is on the real clock.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs extensions under (and the runner runs its jobs in). */
  home: string;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  runner?: Runner;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];

/** The fake `claude` (fixtures/fake-claude.pl, #366's), installed as a file named `claude` in a folder of its own. */
function installFake(dir: string, version = '2.1.304'): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'claude');
  writeFileSync(path, readFileSync(join(FIXTURES, 'fake-claude.pl'), 'utf8').replace('__VERSION__', version), { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

/** A world on `dir` (a new folder when left out); `runner` adds the runner whose agent is the fake `claude`. */
export async function openWorld(o: { dir?: string; runner?: boolean } = {}): Promise<World> {
  const dir = o.dir ?? tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const now = Date.now;
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence') });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now, evidence });
  const asks = withPlans(await openAsks({ record, now, deliver: () => undefined }));
  const sup = await openSupervisor({ record, asks, now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  let runner: Runner | undefined;
  if (o.runner) {
    const bin = join(dir, 'bin');
    installFake(bin);
    const ledger = await openLedger({ record, asks, now, price: async () => 0.5 });
    runner = await openRunner({
      record, asks, supervisor: sup, ledger, now, root: deepHome, loginPath: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      env: { HOME: home(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
      settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    });
    await runner.report({
      agent: 'claude-code', account: ACCOUNT,
      rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.floor((now() + 3 * HOUR) / 1000) }, seven_day: { used_percentage: 20, resets_at: Math.floor((now() + 5 * DAY) / 1000) } },
    });
  }
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
    dir, home: deepHome, record, asks, sup, events, ...(runner ? { runner } : {}),
    close: async () => {
      if (closed) return;
      closed = true;
      await runner?.close().catch(() => undefined);
      await sup.close().catch(() => undefined);
      await record.close().catch(() => undefined);
    },
  };
  worlds.push(w);
  return w;
}

/** The extension-host package, loaded lazily so this file loads at the base. */
export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;

/** An in-memory secret store standing in for the OS one; `holds(value)` says whether any entry holds that value. */
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

/** A first-party piece the hub runs itself, as the host is told of it (README: `firstParty`, AC6). */
export interface FirstParty { id: string; version: string; provides: string[] }
export interface HostOptions {
  /** A planted wrong program (README, Plants); the base's own plants are accepted too. */
  plant?: string;
  http?: HttpClient;
  secrets?: SecretStore;
  firstParty?: FirstParty[];
}
/** A ready extension host on a world: the real clock, the world's asks core and runner, and the seams given. */
export async function openHost(w: World, o: HostOptions = {}): Promise<ExtensionHost> {
  const { openExtensionHost, openTrust } = await host();
  const options = {
    record: w.record, supervisor: w.sup, trust: await openTrust({ record: w.record, now: Date.now }), home: w.home, release: [], now: Date.now, asks: w.asks,
    secrets: o.secrets ?? memoryStore(), http: o.http ?? routedClient({}).client,
    ...(w.runner ? { runner: w.runner } : {}), ...(o.plant ? { plant: o.plant } : {}), ...(o.firstParty ? { firstParty: o.firstParty } : {}),
  };
  const h = await openExtensionHost(options as unknown as Parameters<typeof openExtensionHost>[0]);
  hosts.push(h);
  await h.ready();
  return h;
}
/** Closes a host now (its processes stop); the file's afterAll then skips it. */
export async function closeHost(h: ExtensionHost): Promise<void> {
  const at = hosts.indexOf(h);
  if (at >= 0) hosts.splice(at, 1);
  await h.close();
}

// ---- Local servers standing in for the named hosts; each keeps every request that reaches it.
export interface Seen { method: string; url: string; headers: Record<string, string>; body: string; at: number }
export type Reply = { status: number; headers?: Record<string, string>; body?: string };
export interface Provider { base: string; seen: Seen[]; close(): Promise<void> }
const servers: Provider[] = [];
export async function server(reply: (req: Seen) => Reply): Promise<Provider> {
  const seen: Seen[] = [];
  const s: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const got: Seen = {
        method: req.method ?? '', url: req.url ?? '', at: Date.now(), body: Buffer.concat(chunks).toString('utf8'),
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])),
      };
      seen.push(got);
      const r = reply(got);
      res.writeHead(r.status, r.headers ?? {}).end(r.body ?? '');
    });
  });
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const p: Provider = {
    base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, seen,
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; s.close(() => resolve()); s.closeAllConnections(); })),
  };
  servers.push(p);
  return p;
}
export const json = (body: unknown, status = 200): Reply => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/**
 * The HTTP client the hub is given: `https://<name>/<path>` goes to the server standing in for that name; a name no
 * server stands in for is refused before any socket, as a machine with no network refuses it.
 */
export function routedClient(routes: Record<string, Provider>): { client: HttpClient; asked: HttpRequest[] } {
  const asked: HttpRequest[] = [];
  const client: HttpClient = async (request, signal) => {
    asked.push(structuredClone(request));
    const url = new URL(request.url);
    const target = routes[url.hostname];
    if (!target) throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${url.hostname}`), { code: 'ENOTFOUND' }) });
    const res = await fetch(`${target.base}${url.pathname}${url.search}`, {
      method: request.method, headers: request.headers, redirect: 'manual', ...(signal ? { signal } : {}), ...(request.body === undefined ? {} : { body: request.body }),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, body: await res.text() } satisfies HttpAnswer;
  };
  return { client, asked };
}

afterAll(async () => {
  // A host whose close waits on something that never ends (an open ask) is let go after 30 s.
  for (const h of hosts.splice(0)) await Promise.race([h.close().catch(() => undefined), sleep(30_000)]);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const p of servers.splice(0)) await p.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 120_000);

// ---- Composition's manifest rows (README, The surface under test).
/** A JSON Schema object with these properties, all required unless listed in `optional`, closed to others. */
export function shape(properties: Record<string, Json>, optional: string[] = []): Json {
  return { type: 'object', properties, required: Object.keys(properties).filter((k) => !optional.includes(k)), additionalProperties: false };
}
/**
 * A `provides` row: the interface at the minor of the last schema given, that schema, and the digest it keeps for
 * each minor from 0 (`schemas[m]` is the shape at minor m; its digest is d1 of it).
 */
export function provides(iface: string, schemas: Json[], kind: 'reading' | 'action' = 'reading'): Json {
  const minor = schemas.length - 1;
  return { interface: iface, kind, minor, schema: schemas[minor], digests: Object.fromEntries(schemas.map((s, m) => [String(m), d1Digest(s)])) };
}
/** A `uses` row: the interface, the minor it was built against, that minor's schema and its digest, and `from` / `optional`. */
export function uses(iface: string, minor: number, schema: Json, extra: { from?: string; optional?: true } = {}): Json {
  return { interface: iface, minor, digest: d1Digest(schema), schema, ...extra };
}
/** The preview methods the test packages call, each listed so #139's rule refuses none of them. */
export const PREVIEW = [
  'deep.provide', 'deep.use', 'deep.read', 'deep.call', 'deep.schedule', 'deep.send', 'deep.registerAction', 'deep.registerSource', 'deep.secret',
  'deep.store', 'deep.store.put', 'deep.store.get', 'deep.store.list', 'deep.record.query', 'deep.runner.run', 'deep.config.get',
];

// ---- Test packages.
export interface PackageInput {
  id: string;
  version?: string;
  /** deepbuild.json's fields, merged over id, version, digest and requires.preview. */
  manifest?: Record<string, unknown>;
  /** index.ts. */
  index: string;
  /** Other files, by path in the package (a package's own tests under tests/). */
  files?: Record<string, string>;
}
/** A package in a temp folder, its manifest's digest set to the host's own packageDigest of the folder. */
export async function makePackage(o: PackageInput): Promise<string> {
  const dir = tempDir(`pkg-${o.id.replace('/', '-')}`);
  writeFileSync(join(dir, 'index.ts'), o.index);
  for (const [path, text] of Object.entries(o.files ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const manifest: Json = { id: o.id, version: o.version ?? '1.0.0', digest: `d1:${'0'.repeat(64)}`, requires: { preview: PREVIEW }, ...(o.manifest ?? {}) };
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/**
 * The generic piece (its code is PIECE below; what it does comes from spec.json):
 * - each output: `deep.provide(interface, kind, schema, fn)`; a reading's fn answers `value` (after `delayMs`); an
 *   action output is served by the read action of the interface's name without `@major`, which answers `{ echo }`
 * - each use: `deep.use(interface)`
 * - `read`: the read action ext.<plugin>.read, `{ interface }` → `{ got }`, the JSON of what `deep.read` gave, or
 *   `{ error }` naming why it threw
 * - `schedule`: ext.<plugin>.weekly (a cron line that never comes due in a test; runs are Run now), whose job reads
 *   each of `reads` with deep.read; and the probe check ext.<plugin>.report, answering every run's reads
 * - `bench`: the read action ext.<plugin>.bench, `{ n }` → per-call mean ms of n `deep.read(interface)` and of n
 *   `deep.config.get` (a hub round trip that crosses no edge), timed inside the plug-in's own process (AC14)
 * - `failStart`: its code throws once it has registered, so it never starts
 */
export interface PieceSpec {
  outputs?: { interface: string; kind: 'reading' | 'action'; schema: Json; value?: Json; delayMs?: number }[];
  uses?: string[];
  read?: boolean;
  schedule?: { reads: string[] };
  bench?: { interface: string };
  failStart?: boolean;
}
const PIECE = `// The generic test piece (#103 acceptance tests): what it does comes from spec.json (helpers.ts, PieceSpec).
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('./spec.json', import.meta.url), 'utf8'));
const strict = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const said = (e: any) => String(e?.message ?? e);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function (deep: any): Promise<void> {
  const me = spec.plugin;
  for (const o of spec.outputs ?? []) {
    if (o.kind === 'reading') {
      await deep.provide(o.interface, 'reading', o.schema, async () => { if (o.delayMs) await sleep(o.delayMs); return o.value; });
    } else {
      const name = o.interface.slice(0, o.interface.lastIndexOf('@'));
      await deep.provide(o.interface, 'action', o.schema);
      await deep.registerAction(name, { declares: 'read', reads: [], input: o.schema, output: strict({ echo: { type: 'string' } }) }, async (input: unknown) => ({ echo: JSON.stringify(input) }));
    }
  }
  for (const u of spec.uses ?? []) await deep.use(u);
  const read = async (i: string) => { try { return await deep.read(i); } catch (e) { return { error: said(e) }; } };
  if (spec.read) {
    await deep.registerAction('ext.' + me + '.read', { declares: 'read', reads: [], input: strict({ interface: { type: 'string' } }), output: strict({ got: { type: 'string' } }) },
      async (input: { interface: string }) => ({ got: JSON.stringify(await read(input.interface)) }));
  }
  if (spec.bench) {
    await deep.registerAction('ext.' + me + '.bench', { declares: 'read', reads: [], input: strict({ n: { type: 'integer' } }), output: strict({ read_ms: { type: 'number' }, hub_ms: { type: 'number' } }) },
      async (input: { n: number }) => {
        let t = performance.now();
        for (let i = 0; i < input.n; i++) { const r = await deep.read(spec.bench.interface); if (!r || !('value' in r)) throw Error('no value: ' + JSON.stringify(r)); }
        const read_ms = (performance.now() - t) / input.n;
        t = performance.now();
        for (let i = 0; i < input.n; i++) await deep.config.get('dh103-bench');
        return { read_ms, hub_ms: (performance.now() - t) / input.n };
      });
  }
  if (spec.schedule) {
    const runs: any[] = [];
    await deep.schedule('ext.' + me + '.weekly', {
      cron: '0 0 1 1 *', deadline: 120_000, declares: { readings: [], notices: [], stores: [], sends: [], noop: true },
    }, async (ctx: { run: string }) => {
      const reads: Record<string, unknown> = {};
      for (const i of spec.schedule.reads) reads[i] = await read(i);
      runs.push({ run: ctx.run, reads });
    });
    await deep.registerCheck('ext.' + me + '.report', async () => ({
      outcome: 'failed', testsRun: 1, evidence: [], read: [], mask: null,
      failures: [{ test: 'report', file: 'index.ts', line: 1, stack: null, assertion: false, message: JSON.stringify({ runs }) }],
    }));
  }
  if (spec.failStart) throw Error(me + ' fails to start');
}
`;
/** The plug-in a package id names: `acme/brief` → `brief`. */
export const pluginOf = (id: string): string => id.slice(id.indexOf('/') + 1);
/**
 * A generic piece's package: its manifest lists the actions and check its spec registers, and `manifest` adds the
 * rest (its `provides` and `uses` rows above all).
 */
export function piece(o: { id: string; version?: string; spec: PieceSpec; manifest?: Record<string, unknown>; files?: Record<string, string> }): Promise<string> {
  const me = pluginOf(o.id);
  const actions = [
    ...(o.spec.outputs ?? []).filter((x) => x.kind === 'action').map((x) => x.interface.slice(0, x.interface.lastIndexOf('@'))),
    ...(o.spec.read ? [`ext.${me}.read`] : []), ...(o.spec.bench ? [`ext.${me}.bench`] : []),
  ];
  return makePackage({
    id: o.id, ...(o.version ? { version: o.version } : {}), index: PIECE,
    files: { 'spec.json': JSON.stringify({ plugin: me, ...o.spec }), ...(o.files ?? {}) },
    manifest: { ...(actions.length ? { actions } : {}), ...(o.spec.schedule ? { checks: [`ext.${me}.report`] } : {}), ...(o.manifest ?? {}) },
  });
}

// ---- Admitting packages.
export type Admitted = { ok: true; installed: Installed } | { ok: false; step: 'install' | 'check' | 'load'; reason: string };
/** What admitting a package came to: the first refusal of install, check and load (and which), or that it loaded. */
export async function admit(h: ExtensionHost, dir: string, grant?: InstallFrom['grant']): Promise<Admitted> {
  let p: Installed;
  try { p = await h.install({ from: dir, builtBy: null, ...(grant ? { grant } : {}) }); } catch (e) { return { ok: false, step: 'install', reason: message(e) }; }
  try {
    const c = await h.check(p);
    if (!c.passed) return { ok: false, step: 'check', reason: c.reasons.join('; ') };
  } catch (e) { return { ok: false, step: 'check', reason: message(e) }; }
  try {
    const l = await h.load(p);
    if (l.status !== 'loaded') return { ok: false, step: 'load', reason: l.reason };
  } catch (e) { return { ok: false, step: 'load', reason: message(e) }; }
  return { ok: true, installed: p };
}
/** Admits a package that must load: an assertion naming the package and the refusal otherwise. */
export async function admitted(h: ExtensionHost, dir: string, what: string, grant?: InstallFrom['grant']): Promise<Installed> {
  const got = await admit(h, dir, grant);
  expect(got.ok, `${what} is admitted (installed, checked, loaded): ${got.ok ? '' : `${got.step}: ${got.reason}`}`).toBe(true);
  return (got as { installed: Installed }).installed;
}
/** The version of a piece the host has loaded, or undefined. */
export async function loadedVersion(h: ExtensionHost, id: string): Promise<string | undefined> {
  return (await h.loaded()).find((l) => l.id === id)?.version;
}

// ---- Observing pieces.
export interface Edge { user: string; uses: string; interface: string; provider: string }
export const edgesOf = async (h: ExtensionHost): Promise<Edge[]> => h.edges();
/** One call of a piece's action as you make it in the app, at the version loaded. */
export async function act(h: ExtensionHost, id: string, action: string, input: unknown): Promise<ActionResult> {
  const version = (await loadedVersion(h, id)) ?? '1.0.0';
  return h.callAction({ action, target: { handle: `ext:${id}`, version }, input, caller: YOU });
}
/** What a generic piece's `deep.read(interface)` gave, through its read action: `{ value, … }`, `{ missing: true }` or `{ error }`. */
export async function readThrough(h: ExtensionHost, id: string, iface: string): Promise<Json> {
  const r = await act(h, id, `ext.${pluginOf(id)}.read`, { interface: iface });
  if (r.status !== 'done') return { error: `the read action itself was refused: ${r.reason}` };
  return JSON.parse(String((r.output as { got?: unknown } | null)?.got)) as Json;
}
/** A probe check's report: the JSON its runner answers in its one failure's message. */
export async function report(h: ExtensionHost, kind: string): Promise<Json> {
  const result = await h.runCheck(kind, { kind, runner: 'report', inputs: [], depth: 'unit', oracle: 'code', contract: null }, { checkout: tempDir('co'), deadline: 30_000 });
  const text = result.failures[0]?.message;
  if (typeof text !== 'string') throw Error(`${kind} answered no report: ${JSON.stringify(result)}`);
  return JSON.parse(text) as Json;
}
/** Run now on a generic piece's schedule, then what that run read (its last run in the probe's report). */
export async function runOnce(h: ExtensionHost, id: string): Promise<Record<string, Json>> {
  const me = pluginOf(id);
  const before = ((await report(h, `ext.${me}.report`)).runs as Json[]).length;
  await h.runNow(YOU, `ext.${me}.weekly`);
  await h.idle();
  const runs = (await report(h, `ext.${me}.report`)).runs as Json[];
  if (runs.length !== before + 1) throw Error(`Run now on ext.${me}.weekly ran ${runs.length - before} jobs, not one: ${JSON.stringify(runs)}`);
  return runs[runs.length - 1].reads as Record<string, Json>;
}

// ---- The record: what composition appends (README, The surface under test).
export interface Reopened { piece: string; provider: string; version: string }
export interface Tested { user: string; interface: string; provider: string; version: string; passed: boolean }
export const reopened = async (w: World): Promise<Reopened[]> => (await w.events('composition.reopened')).map((e) => e.data as unknown as Reopened);
export const tested = async (w: World): Promise<Tested[]> => (await w.events('composition.tested')).map((e) => e.data as unknown as Tested);
/** How many times each piece's claims reopened for one provider version: { piece: count }. */
export async function reopenCounts(w: World, provider: string, version: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const r of await reopened(w)) if (r.provider === provider && r.version === version) counts[r.piece] = (counts[r.piece] ?? 0) + 1;
  return counts;
}

// ---- Asks.
/** The open asks whose card names `text`. */
export async function asksNaming(w: World, text: string): Promise<{ ask: string; card: string }[]> {
  return (await w.asks.needsYou()).map((c) => ({ ask: (c as { ask: string }).ask, card: JSON.stringify(c) })).filter((c) => c.card.includes(text));
}
/** Your answer on the trusted path: the option whose decision is allow (yes) or deny (no). */
export async function answer(w: World, ask: string, decision: 'allow' | 'deny'): Promise<void> {
  const card = await w.asks.card(ask);
  const option = card.options.find((o: { decision?: string }) => o.decision === decision) ?? (decision === 'allow' ? card.options[0]! : card.options[card.options.length - 1]!);
  await w.asks.answer(YOU, ask, { option: option.id, plan_hash: await shownPlanHash(w.asks, ask), token: `click-${ulid(Date.now())}` });
}
export async function waitUntil<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}
/** Settles to 'done', 'refused: …' or, past `ms`, 'waiting', without consuming the promise's rejection. */
export function settledWithin(p: Promise<unknown>, ms: number): Promise<string> {
  const s = p.then(() => 'done', (e: unknown) => `refused: ${message(e)}`);
  return Promise.race([s, sleep(ms).then(() => 'waiting')]);
}

// ---- AC4: a session of yours in the record, its transcript text `text`, as the hook appends it (#363's seeding).
export async function seedSession(w: World, session: string, text: string): Promise<void> {
  const f = contractFixtures('user.ask@2')[0] as { data: Record<string, unknown> } | undefined;
  if (!f) throw Error('no contract fixture for user.ask@2');
  const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
  await w.record.append(hook, { v: 2, id: ulid(Date.now()), kind: 'user.ask', ts: Date.now(), data: { ...structuredClone(f.data), text } as never });
  await w.record.sync();
}
/** The runner's jobs. */
export const jobsOf = async (w: World): Promise<JobRecord[]> => (w.runner ? w.runner.list() : []);
