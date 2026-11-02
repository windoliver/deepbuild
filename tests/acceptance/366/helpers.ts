// Test-side tools for the #366 acceptance tests: the environment, temp folders, a controlled clock, a world (the
// record with its evidence store, the asks core, the budget ledger, the supervisor, project trust and the runner R1
// built, its agent the fake `claude` in fixtures/), hosts with the seams the surface names, local providers standing
// in for the market and mail hosts, test packages copied from fixtures/, and the record read back.
// Nothing here stands in for the extension host, the runner or the record: the tests reach them only through their
// public entries (README, The surface under test).
//
// Safety: every folder is under /tmp/dh366-* (real paths), removed after its file; HOME is a temp folder holding a
// fake Claude Code sign-in (made-up tokens) for this process and every child; the agent's own CLAUDE*, DEEP_*,
// ANTHROPIC_* and AI_AGENT variables are removed first; no test touches the real ~/.deepbuild, ~/.claude or Keychain;
// nothing reaches the network (each named host is a server on 127.0.0.1, and a name no server stands in for is refused
// by the client before any socket); the runner's jobs are stopped by the runner that started them (its close), and a
// replica by its PID.

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openLedger, type Ledger } from '../../../packages/budget/src/index.ts';
import { fixtures as contractFixtures } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import {
  openExtensionHost, openTrust, packageDigest, type ActionResult, type ExtensionHost, type HostGrant, type HttpAnswer, type HttpClient, type HttpRequest, type Installed,
  type InstallFrom, type ProjectTrust, type Recording, type SecretStore,
} from '../../../packages/extension-host/src/index.ts';
import { openRecord, ulid, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openRunner, type JobRecord, type Runner } from '../../../packages/runner/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** The criteria, as scripts/proof-change.mjs computes their IDs. */
export const ID = {
  ac1: '#366.c492a7c7', ac2: '#366.0ef9a5fd', ac3: '#366.f41df11e', ac4: '#366.69164550', ac5: '#366.30a7de7d', ac6: '#366.792d6463',
} as const;
/** Where each agent's recorded build of the stocks sentence lives (README, The recorded builds). */
export const RECORDED = join(REPO, 'docs', 'evidence', '366', 'stocks');
export const AGENTS = ['claude-code', 'codex'] as const;
/** The issue's sentence, word for word. */
export const SENTENCE = 'Add a stocks view: my watchlist with live prices, a chart per stock, and alerts when a price crosses a target';

/** The market host the stocks view reads (and the recorded builds were told of), and the mail host a send goes to. */
export const MARKET = 'api.market.example';
export const MAIL = 'api.mail.example';
/** The test stocks plug-in (fixtures/stocks) and its names. */
export const STOCKS_ID = 'test/stocks';
export const PRICE = 'ext.stocks.price';
export const CROSSED = 'ext.stocks.crossed';
export const KEY = 'mk/test+366c0de=';
export const ME = 'you@example.test';
/** The market key's freshness: five minutes, the issue's. */
export const FRESH = 5 * MINUTE;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The issue's times are UTC on the controlled clock.
process.env.TZ = 'UTC';
export const at = (iso: string): number => Date.parse(`${iso}:00.000Z`);
export const hhmm = (t: number): string => new Date(t).toISOString().slice(11, 19);

for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('ANTHROPIC_') || key === 'AI_AGENT') delete process.env[key];
}

/** Where cargo and rustup live, read before HOME moves, so building deep-drive uses the installed toolchain. */
export const TOOLCHAIN = {
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(process.env.HOME ?? '', '.rustup'),
  CARGO_HOME: process.env.CARGO_HOME ?? join(process.env.HOME ?? '', '.cargo'),
};

// ---- HOME: a temp folder with a fake Claude Code sign-in, as #159's suite keeps one, made with a file's first temp
// folder (so a file whose tests are all skipped makes none).
/** The account Claude Code keeps beside the fake login. */
export const ACCOUNT = '0a0a0a0a-3666-4222-8333-444444444444';
/** Made-up OAuth tokens in the fake sign-in: the hub must hold neither. */
export const TOKEN = `sk-ant-oat01-dh366FAKE${'x'.repeat(40)}`;
export const REFRESH = `sk-ant-ort01-dh366FAKE${'y'.repeat(40)}`;
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh366-home-'));
    process.env.HOME = HOME;
    mkdirSync(join(HOME, '.claude'), { recursive: true });
    writeFileSync(join(HOME, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh366@example.invalid', organizationUuid: 'org-dh366' }, mcpServers: {}, projects: {} })}\n`);
    writeFileSync(join(HOME, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: REFRESH, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
    writeFileSync(join(HOME, '.claude', 'settings.json'), '{}\n');
  }
  return HOME;
}

const made: string[] = [];
export function tempDir(tag: string): string {
  home();
  const dir = realpathSync(mkdtempSync(`/tmp/dh366-${tag}-`));
  made.push(dir);
  return dir;
}

/** You, on the trusted path, in the app. */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };

export interface Clock { now: () => number; set(t: number): void }
export function clock(start: number): Clock {
  let t = start;
  return { now: () => t, set: (next) => { if (next < t) throw Error('the clock moves forward only'); t = next; } };
}

// ---- The fake `claude` (fixtures/fake-claude.pl), installed as a file named `claude` in a folder of its own.
export function installFake(dir: string, version = '2.1.304'): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'claude');
  writeFileSync(path, readFileSync(join(FIXTURES, 'fake-claude.pl'), 'utf8').replace('__VERSION__', version), { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

// ---- The world.
export interface World {
  dir: string;
  /** The hub's root (~/.deepbuild): where packages install and the runner's jobs run. */
  home: string;
  record: RecordStore;
  asks: Asks;
  ledger: Ledger;
  sup: Supervisor;
  trust: ProjectTrust;
  runner: Runner;
  clock: Clock;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
/** A world on the controlled clock whose runner launches the fake `claude` from the login shell's PATH, with room in its plan window. */
export async function openWorld(c: Clock): Promise<World> {
  const dir = tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const bin = join(dir, 'bin');
  installFake(bin);
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence') });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: c.now, evidence });
  const asks = await openAsks({ record, now: c.now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now: c.now, price: async () => 0.5 });
  const sup = await openSupervisor({ record, asks, now: c.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const trust = await openTrust({ record, now: c.now });
  const runner = await openRunner({
    record, asks, supervisor: sup, ledger, now: c.now, root: deepHome, loginPath: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    env: { HOME: home(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
  });
  await runner.report({
    agent: 'claude-code', account: ACCOUNT,
    rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.floor((c.now() + 3 * HOUR) / 1000) }, seven_day: { used_percentage: 20, resets_at: Math.floor((c.now() + 5 * DAY) / 1000) } },
  });
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
    dir, home: deepHome, record, asks, ledger, sup, trust, runner, clock: c, events,
    close: async () => {
      if (closed) return;
      closed = true;
      await runner.close().catch(() => undefined);
      await sup.close().catch(() => undefined);
      await record.close().catch(() => undefined);
    },
  };
  worlds.push(w);
  return w;
}

/** An in-memory secret store standing in for the OS one. */
export function memoryStore(): SecretStore {
  const entries = new Map<string, string>();
  return { get: async (k) => entries.get(k), set: async (k, v) => { entries.set(k, v); }, delete: async (k) => { entries.delete(k); } };
}

export interface Seams { secrets: SecretStore; http: HttpClient; replay?: Recording; now?: () => number }
/**
 * A ready extension host on a world, with the seams the surface names: the clock, the secret store, the HTTP client,
 * a recording to replay, and the world's runner, the only way its model jobs run (README, The surface under test).
 */
export async function openHost(w: World, seams: Seams): Promise<ExtensionHost> {
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: [], now: seams.now ?? w.clock.now, asks: w.asks,
    secrets: seams.secrets, http: seams.http, runner: w.runner, ...(seams.replay ? { replay: seams.replay } : {}),
  });
  hosts.push(h);
  await h.ready();
  return h;
}

// ---- Local providers standing in for the named hosts; each keeps every request that reaches it.
export interface Seen { method: string; url: string; headers: Record<string, string>; body: string; at: number }
export type Reply = { status: number; headers?: Record<string, string>; body?: string };
export interface Provider { base: string; seen: Seen[]; close(): Promise<void> }
const providers: Provider[] = [];
export async function provider(c: Clock, reply: (req: Seen) => Reply): Promise<Provider> {
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
      const r = reply(s);
      res.writeHead(r.status, r.headers ?? {}).end(r.body ?? '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const p: Provider = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
  providers.push(p);
  return p;
}
export const json = (body: unknown, status = 200): Reply => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** The market: GET /q answers a price of 187.25 USD. */
export const market = (c: Clock) => provider(c, (req) => (req.url.startsWith('/q') ? json({ price: 187.25 }) : { status: 404 }));
/** The mail provider: POST /send answers 202. */
export const mail = (c: Clock) => provider(c, (req) => (req.url.startsWith('/send') ? json({ accepted: true }, 202) : { status: 404 }));

/**
 * The HTTP client the hub is given: `https://<name>/<path>` goes to the provider standing in for that name; a name no
 * provider stands in for is refused before any socket, as a machine with no network refuses it. `asked` keeps every call.
 */
export interface RoutedClient { client: HttpClient; asked: HttpRequest[] }
export function routedClient(routes: Record<string, Provider>): RoutedClient {
  const asked: HttpRequest[] = [];
  const client: HttpClient = async (request, signal) => {
    asked.push(structuredClone(request));
    const url = new URL(request.url);
    const server = routes[url.hostname];
    if (!server) throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${url.hostname}`), { code: 'ENOTFOUND' }) });
    const res = await fetch(`${server.base}${url.pathname}${url.search}`, {
      method: request.method, headers: request.headers, redirect: 'manual', signal, ...(request.body === undefined ? {} : { body: request.body }),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, body: await res.text() } satisfies HttpAnswer;
  };
  return { client, asked };
}

// A file whose tests are all skipped (the live one, unless asked for) runs no afterAll: its folders go as its process exits.
process.on('exit', () => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});
afterAll(async () => {
  for (const h of hosts.splice(0)) await Promise.race([h.close().catch(() => undefined), sleep(30_000)]);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const p of providers.splice(0)) await p.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 120_000);

// ---- Test packages.
/** Writes the host's own digest of a package folder into its manifest. */
export function setDigest(dir: string): void {
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
/** `fixtures/<name>` copied to a temp folder, each `*.fixture` renamed without the suffix, `probe.json` written, digest set. */
export function pkg(name: string, probe: Record<string, unknown>): string {
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
  writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
  setDigest(dir);
  return dir;
}
/** The hosts a package is granted, with room for every call a test makes. */
export const hostsGrant = (...names: string[]): HostGrant[] => names.map((n) => ({ host: n, quota: { calls: 1_000_000, per_ms: HOUR } }));
/** Install (by no agent), check and load a package; the load must succeed. */
export async function installAndLoad(h: ExtensionHost, from: string, grant: InstallFrom['grant']): Promise<Installed> {
  const p = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) });
  const checked = await h.check(p);
  expect(checked.passed, `${p.id}@${p.version}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
  const load = await h.load(p);
  expect(load.status, `${p.id}@${p.version} didn't load: ${JSON.stringify(load)}`).toBe('loaded');
  return p;
}

// ---- The stocks world: the plug-in loaded on a grant, its market key entered, the market and mail stand-ins.
export interface StocksWorld { c: Clock; w: World; h: ExtensionHost; market: Provider; mail: Provider; asked: HttpRequest[] }
export async function stocksWorld(start: number, grant: Omit<NonNullable<InstallFrom['grant']>, 'hosts'> = {}, probe: Record<string, unknown> = {}): Promise<StocksWorld> {
  const c = clock(start);
  const m = await market(c);
  const ml = await mail(c);
  const routed = routedClient({ [MARKET]: m, [MAIL]: ml });
  const w = await openWorld(c);
  const h = await openHost(w, { secrets: memoryStore(), http: routed.client });
  await installAndLoad(h, pkg('stocks', probe), { ...grant, hosts: hostsGrant(MARKET, MAIL) });
  const entered = await h.enterSecret(YOU, STOCKS_ID, 'market_key', KEY);
  expect(entered.saved, `the market key is saved: ${JSON.stringify(entered)}`).toBe(true);
  return { c, w, h, market: m, mail: ml, asked: routed.asked };
}

/** One call of a stocks action, as you make it in the app. */
export const act = (h: ExtensionHost, action: string, input: unknown, request = `req-${ulid(Date.now())}`): Promise<ActionResult> =>
  h.callAction({ action: `ext.stocks.${action}`, target: { handle: `ext:${STOCKS_ID}`, version: '1.0.0' }, input, caller: YOU, request });
/** What the plug-in got, as ext.stocks.ask and ext.stocks.notify answer it: { ok, answer | notice | error }. */
export interface Got { ok: boolean; answer?: Answer; notice?: string; error?: string }
/** A runner answer as deep.runner.run resolves it (README, The surface under test). */
export interface Answer { handle: string; value: unknown; cites: string[]; as_of: number; stale_at: number }
export function gotOf(result: ActionResult): Got {
  if (result.status !== 'done') return { ok: false, error: `the action call itself was refused: ${result.reason}` };
  const got = (result.output as { got?: unknown } | null)?.got;
  if (typeof got !== 'string') return { ok: false, error: `the action answered no got: ${JSON.stringify(result.output)}` };
  return JSON.parse(got) as Got;
}
/** The price read once through the hub, and its reading's handle and as-of time from the record. */
export async function readPrice(h: ExtensionHost, w: World): Promise<{ handle: string; as_of: number }> {
  const read = await h.readSource(PRICE);
  expect(read.status, `the price reads: ${JSON.stringify(read)}`).toBe('reading');
  const recorded = (await w.events('reading.recorded')).map((e) => e.data as { reading: string; as_of: number; source: string }).filter((d) => d.source === PRICE);
  const last = recorded[recorded.length - 1];
  if (!last) throw Error('no reading.recorded of the price');
  return { handle: last.reading, as_of: last.as_of };
}
/** The runner's jobs, and what the fake printed for each. */
export async function jobsOf(w: World): Promise<{ rec: JobRecord; stdout: string }[]> {
  return Promise.all((await w.runner.list()).map(async (rec) => ({ rec, stdout: await w.runner.output(rec.job).catch(() => '') })));
}
/** The prompt the fake read on its stdin, from its start report; '' when it never started. */
export function stdinOf(stdout: string): string {
  for (const line of stdout.split('\n')) {
    try {
      const e = JSON.parse(line) as { type?: string; message?: { content?: { type: string; text?: string }[] } };
      for (const c of e.type === 'assistant' ? e.message?.content ?? [] : []) {
        if (c.type === 'text' && c.text?.startsWith('fake:')) {
          const r = JSON.parse(c.text.slice(5)) as { cmd: string; stdin?: string };
          if (r.cmd === 'start') return Buffer.from(r.stdin ?? '', 'base64').toString('utf8');
        }
      }
    } catch { /* not a line of JSON */ }
  }
  return '';
}
/** The init event the fake printed. */
export const initOf = (stdout: string): Record<string, unknown> | undefined => stdout.split('\n').map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return undefined; } })
  .find((e) => e?.type === 'system' && e.subtype === 'init');

/** Every file under a folder, with its bytes as text (binary files included, as latin1). */
export function filesUnder(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push({ path, text: readFileSync(path).toString('latin1') });
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** A session of yours in the record, its transcript text `text`, as the hook appends it (#363's seeding). */
export async function seedSession(w: World, session: string, text: string): Promise<void> {
  const data = (name: string): Record<string, unknown> => {
    const f = contractFixtures(name)[0] as { data: Record<string, unknown> } | undefined;
    if (!f) throw Error(`no contract fixture for ${name}`);
    return structuredClone(f.data);
  };
  const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
  await w.record.append(hook, { v: 2, id: ulid(w.clock.now()), kind: 'user.ask', ts: w.clock.now(), data: { ...data('user.ask@2'), text } });
  await w.record.sync();
}
