// Test-side tools for the #350 acceptance tests: temp folders, a world (the record with its evidence store, the asks
// core, the supervisor that is #236's local host@1, and project trust), hosts, test packages copied from fixtures/,
// the probe every test package reports through, hook requests, connections, and a byte search of every file a world
// wrote. Nothing here stands in for the extension host: the tests reach it only through `@deepbuild/extension-host`'s
// entry (README, The surface under test). This file imports that package's types only and loads the package itself
// lazily, so it loads at the base, where the new surface doesn't exist. The judges and wrong programs are in wrong.ts.
//
// Safety: every folder is under /tmp/dh350-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; and no
// process is ever stopped by name or port (each host a test opens is closed, which stops what it started).

import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type { ExtensionHost, HookReply, HookRequest, Installed, InstallFrom, Plant, ProjectTrust, ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
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
    HOME = realpathSync(mkdtempSync('/tmp/dh350-home-'));
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

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh350-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- Connections: who calls, as the hub's socket proved it (#16). Never a field the caller fills in.
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/** A headless call: the `deep` CLI. */
export const HEADLESS: Connection = { writer: 'cli', actor: 'you', scope: 'you' };
/** A call from a panel in the app. */
export const PANEL: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/** An agent session's call through deep-actions: its `deep mcp` credential, bound to that session. */
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
    dir, home: deepHome, record, asks, sup, trust, events,
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

/** A ready extension host on a world: `release` is DeepBuild's signed release, `plant` a wrong program the criteria name. */
export async function openHost(w: World, options: { release?: ReleaseEntry[]; plant?: Plant } = {}): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: options.release ?? [], now: Date.now,
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
/** `fixtures/<name>` copied into a temp folder, each `*.fixture` file renamed without that suffix. */
function copyFixture(name: string, tag = name): string {
  const dir = tempDir(tag);
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
export interface PackageOptions {
  /** Fields merged over the fixture's deepbuild.json (an `id` or `version` among them). */
  manifest?: Record<string, unknown>;
  /** probe.json: the package's settings for this test. */
  probe?: Record<string, unknown>;
}
/**
 * A test package in a temp folder: `fixtures/<name>` copied with each `*.fixture` file renamed without that suffix
 * (so neither this suite's Vitest nor its type check picks the packages' code up), the manifest fields and probe
 * settings written over it, and the manifest's `digest` set to the host's own `packageDigest` of the result.
 */
export async function pkg(name: string, options: PackageOptions = {}): Promise<string> {
  const dir = copyFixture(name, `pkg-${name}`);
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
/** The release entry for a package folder: DeepBuild's signed release listing it, byte for byte. */
export async function releaseEntry(dir: string): Promise<ReleaseEntry> {
  const { packageDigest } = await host();
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
}

/** What every hook handler here is given to read: tool.before. */
export const HOOK_GRANT: NonNullable<InstallFrom['grant']> = { record: ['tool.before'] };
/** Install (by no agent), check and load a package; the load must succeed. Returns what was installed. */
export async function installAndLoad(h: ExtensionHost, from: string, grant: InstallFrom['grant'] = HOOK_GRANT): Promise<Installed> {
  const p = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) });
  const checked = await h.check(p);
  expect(checked.passed, `${p.id}@${p.version}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
  const load = await h.load(p);
  expect(load.status, `${p.id}@${p.version} didn't load: ${JSON.stringify(load)}`).toBe('loaded');
  return p;
}

// ---- Hook requests. The event a tool.before handler is given is tool.before@2's contract fixture.
const TOOL_BEFORE = (contractFixtures('tool.before@2')[0] as { data: unknown } | undefined)?.data;
export function toolBefore(deadline: number, bound: number): HookRequest {
  if (TOOL_BEFORE === undefined) throw Error('no contract fixture for tool.before@2');
  return { kind: 'tool.before', data: TOOL_BEFORE, deadline, bound };
}
/** What the agent sees of a reply: its context blocks and its denies' reasons (README, Readings: what the agent sees). */
export const agentSees = (reply: HookReply): string => JSON.stringify({ context: reply.context, denies: reply.denies });
export const blocksOf = (reply: HookReply, id: string) => reply.context.filter((b) => b.extension === id);
/** Code points, as hook.joined@1 and joinHookReplies count the bound. */
export const chars = (text: string): number => [...text].length;

// ---- The probe. A test package reports what it saw through a check kind it registers, `ext.<plugin>.report`:
// its runner returns one failure whose message is the JSON of its observations (#348's convention).
export const PROBE_SPEC: CheckSpec = { kind: 'probe', runner: 'report', inputs: [], depth: 'unit', oracle: 'code', contract: null };
export async function report<T = Record<string, unknown>>(h: ExtensionHost, kind: string, deadline = 60_000): Promise<T> {
  const r: CheckResult = await h.runCheck(kind, PROBE_SPEC, { checkout: tempDir('checkout'), deadline });
  const message = r.failures?.[0]?.message;
  if (typeof message !== 'string') throw Error(`the probe ${kind} returned no report: ${JSON.stringify(r)}`);
  return JSON.parse(message) as T;
}

/** The PIDs the supervisor tracked for a run (#236's process.tracked). */
export async function tracked(w: World, run: string | null): Promise<number[]> {
  if (!run) return [];
  return (await w.events('process.tracked')).filter((e) => (e.data as { run?: string }).run === run).map((e) => (e.data as { pid: number }).pid);
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A task.created event an action appends, as its input carries it: the record's own kind that an extension may write. */
export function taskEvent(title: string): { v: number; id: string; kind: string; ts: number; data: unknown } {
  return { v: 1, id: ulid(), kind: 'task.created', ts: Date.now(), data: { task_ref: `task:${ulid()}`, thread: ulid(), owner: 'you', title } };
}
export async function tasksTitled(w: World, title: string): Promise<Event[]> {
  return (await w.events('task.created')).filter((e) => (e.data as { title?: string }).title === title);
}

// ---- Bytes on disk: every file under the folders, searched for a string's UTF-8 bytes (and its UTF-16LE bytes,
// which SQLite may use). Returns the paths that hold it.
export function filesHolding(text: string, roots: string[]): string[] {
  const needles = [Buffer.from(text, 'utf8'), Buffer.from(text, 'utf16le')];
  const found: string[] = [];
  const walk = (path: string): void => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (stat.isDirectory()) { for (const name of readdirSync(path)) walk(join(path, name)); return; }
    if (!stat.isFile()) return;
    const bytes = readFileSync(path);
    if (needles.some((n) => bytes.includes(n))) found.push(path);
  };
  for (const root of roots) walk(root);
  return found;
}
