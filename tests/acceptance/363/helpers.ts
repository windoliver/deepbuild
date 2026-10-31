// Test-side tools for the #363 acceptance tests that run on the extension host in this process (AC1's reason, AC2,
// AC3, AC4, AC6's installs, AC7, AC8): temp folders, a world (the record with its evidence store, the asks core, the
// supervisor and project trust), hosts, test plug-ins copied from fixtures/, installs that may be refused, action calls,
// connections, and the record read back. Nothing here stands in for the extension host: the tests reach it only
// through `@deepbuild/extension-host`'s entry (README, The surface under test), loaded lazily so this file loads at the
// base. The hub-level tools (a real hub, `deep mcp`, `deep mcp actions` and an agent stand-in) are in hub.ts.
//
// Safety: every folder is under /tmp/dh363-* (real paths); HOME is a temp folder for this process and every child; the
// agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; and no process is
// ever stopped by name or port (each host a test opens is closed, which stops what it started).

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { ActionCall, ActionResult, ExtensionHost, Installed, InstallFrom, Plant, ProjectTrust } from '../../../packages/extension-host/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { fixtures as contractFixtures } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const DAY = 86_400_000;
/** The extension host's public entry (README, The surface under test). */
export const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh363-home-'));
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
/** A request ID, as an agent's call through deep-actions carries one. */
export const requestId = (): string => `req-${randomBytes(8).toString('hex')}`;

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh363-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- Connections: who calls, as the hub's socket proved it (#16). Never a field the caller fills in.
/** A call from a panel in the app. */
export const PANEL: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/**
 * An agent session's call through deep-actions, once the hub's gate let it through (README, Readings: the gate): its
 * `deep mcp actions` credential, bound to that session.
 */
export const agentCall = (session: string): Connection => ({ writer: `mcp:${session}`, actor: 'you', scope: 'you', session, agent: 'claude-code' });

// ---- The world: a record with its evidence store, the asks core, the supervisor on them (#236) and project trust.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs extensions under. */
  home: string;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  trust: ProjectTrust;
  events(kind?: string): Promise<Event[]>;
  /** The log position of the newest event, after a sync. */
  last(): Promise<number>;
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
    await record.sync();
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  const last = async (): Promise<number> => {
    const all = await events();
    return all.length ? all[all.length - 1]!.log_pos : 0;
  };
  let closed = false;
  const w: World = {
    dir, home: deepHome, record, asks, sup, trust, events, last,
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

/** A ready extension host on a world, with no signed release: every test plug-in runs in the sandbox. */
export async function openHost(w: World, options: { plant?: Plant } = {}): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: [], now: Date.now,
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

// ---- Fixtures and test plug-ins.
/** `fixtures/<name>` copied into a temp folder, each `*.fixture` file renamed without that suffix. */
function copyFixture(name: string): string {
  const dir = tempDir(`pkg-${name}`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  return dir;
}
export interface PackageOptions {
  /** Fields merged over the fixture's deepbuild.json (a `version` or `actions` among them). */
  manifest?: Record<string, unknown>;
  /** probe.json: the plug-in's settings for this test. */
  probe?: Record<string, unknown>;
}
/**
 * A test plug-in in a temp folder: `fixtures/<name>` copied with each `*.fixture` file renamed without that suffix (so
 * neither this suite's Vitest nor its type check picks the plug-ins' code up), the manifest fields and probe settings
 * written over it, and the manifest's `digest` set to the host's own `packageDigest` of the result.
 */
export async function pkg(name: string, options: PackageOptions = {}): Promise<string> {
  const dir = copyFixture(name);
  if (options.probe) writeFileSync(join(dir, 'probe.json'), JSON.stringify(options.probe));
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = { ...(JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>), ...(options.manifest ?? {}) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  expect(packageDigest(dir), 'writing packageDigest into deepbuild.json\'s digest doesn\'t change it (#348)').toBe(manifest.digest);
  return dir;
}

/** What an install came to: installed, checked and loaded, or refused at one of those steps, with the reason given. */
export type Tried = { ok: true; installed: Installed } | { ok: false; step: 'install' | 'check' | 'load'; reason: string };
/**
 * The install as a person runs it (README, Readings: "at install"): install by no agent, conformance, load. A refusal
 * at any step is the install's refusal; its reason is the error's message, the conformance reasons or the load's.
 */
export async function tryInstall(h: ExtensionHost, from: string, grant?: InstallFrom['grant']): Promise<Tried> {
  let p: Installed;
  try {
    p = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) });
  } catch (e) {
    return { ok: false, step: 'install', reason: e instanceof Error ? e.message : String(e) };
  }
  const checked = await h.check(p);
  if (!checked.passed) return { ok: false, step: 'check', reason: checked.reasons.join('; ') };
  const load = await h.load(p);
  if (load.status !== 'loaded') return { ok: false, step: 'load', reason: load.reason };
  return { ok: true, installed: p };
}
/** Install, check and load a plug-in; each must succeed. */
export async function installAndLoad(h: ExtensionHost, from: string, grant?: InstallFrom['grant']): Promise<Installed> {
  const tried = await tryInstall(h, from, grant);
  if (!tried.ok) expect.fail(`${from} wasn't installed and loaded: refused at ${tried.step}: ${tried.reason}`);
  return tried.installed;
}

// ---- Action calls.
export const STOCKS = 'test/stocks';
export const ALERT = 'ext.stocks.alert';
/** One action call, with its explicit target (`ext:<id>` at `version`) and a request ID; `caller` defaults to a panel. */
export function call(h: ExtensionHost, action: string, input: unknown, o: { id?: string; version?: string; caller?: Connection; request?: string; focus?: string | null } = {}): Promise<ActionResult> {
  const c: ActionCall = {
    action, input, request: o.request ?? requestId(), caller: o.caller ?? PANEL,
    target: { handle: `ext:${o.id ?? STOCKS}`, version: o.version ?? '1.0.0' },
    ...(o.focus !== undefined ? { focus: o.focus } : {}),
  };
  return h.callAction(c);
}
/** A call that must be done; its output. */
export async function done(result: Promise<ActionResult>, what: string): Promise<any> {
  const r = await result;
  expect(r.status, `${what}: ${JSON.stringify(r)}`).toBe('done');
  return (r as { output: unknown }).output;
}
/** How many times the stocks plug-in's set-alert and send-digest ran in its current load (its `runs` read action). */
export async function runs(h: ExtensionHost, version = '1.0.0'): Promise<{ set_alert: number; send_digest: number }> {
  return done(call(h, 'ext.stocks.runs', {}, { version }), 'ext.stocks.runs');
}
/** The stocks plug-in's store as its list-alerts reads it: each item's key and its value as the store holds it. */
export async function alerts(h: ExtensionHost, version = '1.0.0'): Promise<Record<string, any>> {
  const out = await done(call(h, 'ext.stocks.list_alerts', {}, { version }), `ext.stocks.list_alerts at ${version}`);
  return Object.fromEntries((out.alerts as { key: string; value: string }[]).map((a) => [a.key, JSON.parse(a.value)]));
}

// ---- The record read back.
/** action.entered events for a request ID. */
export const enteredFor = (all: Event[], request: string): Event[] => all.filter((e) => e.kind === 'action.entered' && (e.data as { request?: unknown }).request === request);
/** action.reported events for a call. */
export const reportedFor = (all: Event[], call: string): Event[] => all.filter((e) => e.kind === 'action.reported' && (e.data as { call?: unknown }).call === call);
/** The store's events of a kind whose data holds `text` anywhere. */
export const storeEventsHolding = (all: Event[], kind: string, text: string): Event[] => all.filter((e) => e.kind === kind && JSON.stringify(e.data).includes(text));

// ---- Seeding events as the hook appends them: transcript text in user.ask and tool.before, the kinds whose text the
// record keeps (README, Readings: transcript text).
const fixtureData = (name: string): Record<string, unknown> => {
  const f = contractFixtures(name)[0] as { data: Record<string, unknown> } | undefined;
  if (!f) throw Error(`no contract fixture for ${name}`);
  return structuredClone(f.data);
};
export async function seedTranscript(w: World, session: string, text: string): Promise<void> {
  const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
  const ask = { ...fixtureData('user.ask@2'), text };
  await w.record.append(hook, { v: 2, id: ulid(), kind: 'user.ask', ts: Date.now(), data: ask });
  const before = { ...fixtureData('tool.before@2'), kind: 'shell', command: `echo ${text}` };
  await w.record.append(hook, { v: 2, id: ulid(), kind: 'tool.before', ts: Date.now(), data: before });
  await w.record.sync();
}
/** A task.created event, a core kind with no transcript text, appended as the CLI would. */
export async function seedTask(w: World, title: string): Promise<void> {
  await w.record.append({ writer: 'cli', actor: 'you', scope: 'you' }, { v: 1, id: ulid(), kind: 'task.created', ts: Date.now(), data: { task_ref: `task:${ulid()}`, thread: ulid(), owner: 'you', title } });
  await w.record.sync();
}
