// Test-side tools for the #348 acceptance tests: temp folders, a world (the record, the asks core, the supervisor
// that is #236's local host@1, and the one project trust decision), test packages copied from fixtures/, the probe
// every test package reports through, listeners read with lsof, the tool gate and the reference-Mac timing judge.
// Nothing here stands in for the extension host: the tests reach it only through `@deepbuild/extension-host`
// (README, The surface under test). This file imports that package's types only, and loads the package itself
// lazily, so it loads at the base, where that package doesn't exist. The wrong programs are in wrong.ts.
//
// Safety: every folder is under /tmp/dh348-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; and no
// process is ever stopped by name or port (each host a test opens is closed, which stops what it started).

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type { ExtensionHost, Plant, ProjectTrust, ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { fixtures as contractFixtures } from '../../../packages/contracts/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const DAY = 86_400_000;
/** The extension host's public entry (README, The surface under test). */
export const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh348-home-'));
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
/** The handle of an agent session: who built a package your agent built. */
export const agentSession = (): string => `session:${ulid()}`;

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh348-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- Connections. The trusted path (the app's question card) is the only writer whose answer sets trust.
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
export const hookIn = (session: string): Connection => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });

// ---- The world: a record, the asks core, the supervisor on them (#236) and the project trust decision.
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
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
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

/** An extension host on a world's record, supervisor, trust and home: `release` is DeepBuild's signed release. */
export async function openHost(w: World, options: { release?: ReleaseEntry[]; plant?: Plant } = {}): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: options.release ?? [], now: Date.now,
    ...(options.plant ? { plant: options.plant } : {}),
  });
  hosts.push(h);
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
export function copyFixture(name: string, tag = name): string {
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
  /** Fields merged over the fixture's deepbuild.json. */
  manifest?: Record<string, unknown>;
  /** Files written over the copy, by relative path. */
  files?: Record<string, string>;
  /** probe.json: what the package's probe reads (a canary path, a socket, a folder to watch). */
  probe?: Record<string, unknown>;
}
/**
 * A test package in a temp folder: `fixtures/<name>` copied with each `*.fixture` file renamed without that suffix
 * (so neither this suite's Vitest nor its type check picks the packages' code up), the manifest fields, files and
 * probe settings written over it, a `main` made executable with its first line naming this machine's python3, and
 * the manifest's `digest` set to the host's own `packageDigest` of the result.
 */
export async function pkg(name: string, options: PackageOptions = {}): Promise<string> {
  const dir = copyFixture(name, `pkg-${name}`);
  for (const [path, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  if (options.probe) writeFileSync(join(dir, 'probe.json'), JSON.stringify(options.probe));
  const main = join(dir, 'main');
  if (existsSync(main)) {
    const python = needPython3();
    const lines = readFileSync(main, 'utf8').split('\n');
    lines[0] = `#!${python}`;
    writeFileSync(main, lines.join('\n'));
    chmodSync(main, 0o755);
  }
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = { ...(JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>), ...(options.manifest ?? {}) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await stamp(dir);
  return dir;
}
/** Sets the manifest's `digest` to the host's `packageDigest` of the folder, as a package's build does. */
export async function stamp(dir: string): Promise<string> {
  const { packageDigest } = await host();
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const digest = packageDigest(dir);
  expect(digest, 'writing packageDigest into deepbuild.json\'s digest doesn\'t change it (README, The surface under test)').toBe(manifest.digest);
  return digest;
}
/** The release entry for a package folder: DeepBuild's signed release listing it, byte for byte. */
export async function releaseEntry(dir: string): Promise<ReleaseEntry> {
  const { packageDigest } = await host();
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
}

// ---- The probe. A test package reports what it saw through a check kind it registers, `ext.<plugin>.report`:
// its runner returns one failure whose message is the JSON of its observations (README, Readings: the probe).
export const PROBE_SPEC: CheckSpec = { kind: 'probe', runner: 'report', inputs: [], depth: 'unit', oracle: 'code', contract: null };
export async function report<T = Record<string, unknown>>(h: ExtensionHost, kind: string): Promise<T> {
  const r: CheckResult = await h.runCheck(kind, PROBE_SPEC, { checkout: tempDir('checkout'), deadline: 30_000 });
  const message = r.failures?.[0]?.message;
  if (typeof message !== 'string') throw Error(`the probe ${kind} returned no report: ${JSON.stringify(r)}`);
  return JSON.parse(message) as T;
}

/** The PIDs the supervisor tracked for a run (#236's process.tracked). */
export async function tracked(w: World, run: string | null): Promise<number[]> {
  if (!run) return [];
  return (await w.events('process.tracked')).filter((e) => (e.data as { run?: string }).run === run).map((e) => (e.data as { pid: number }).pid);
}

/** A contract fixture of an event kind, as an extension would hand it to `deep.record.append`: a fresh ID and time. */
export function eventInput(kind: string): { v: number; id: string; kind: string; ts: number; data: unknown } {
  const fixture = contractFixtures(`${kind}@1`)[0] as { v: number; kind: string; data: unknown } | undefined;
  if (!fixture) throw Error(`no contract fixture for ${kind}@1`);
  return { v: fixture.v, id: ulid(), kind: fixture.kind, ts: Date.now(), data: fixture.data };
}

// ---- Listeners: what a process listens on, as lsof lists it (lsof exits 1 with nothing when there is none).
function lsof(args: string[]): string[] {
  try {
    return execFileSync('lsof', args, { encoding: 'utf8' }).split('\n').slice(1).filter(Boolean);
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    if (e.status === 1 && !e.stdout?.trim()) return [];
    throw error;
  }
}
/** Each listening TCP socket and each UDP socket the processes hold, as "<proto> <address>" (the NAME column). */
export function listeners(pids: number[]): string[] {
  const out: string[] = [];
  for (const pid of pids) {
    for (const line of lsof(['-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-n', '-P'])) out.push(`TCP ${line.split(/\s+/).slice(8).join(' ')}`);
    for (const line of lsof(['-a', '-p', String(pid), '-iUDP', '-n', '-P'])) out.push(`UDP ${line.split(/\s+/).slice(8).join(' ')}`);
  }
  return out.sort();
}

// ---- Tools this machine may lack. A test that needs one fails BLOCKED naming it; it is never skipped.
let python: string | null | undefined;
/** python3's real path, for the JSON-RPC package's first line. */
export function needPython3(): string {
  if (python === undefined) {
    python = null;
    for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
      const candidate = join(dir, 'python3');
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        const real = realpathSync(candidate);
        const r = spawnSync(real, ['-c', 'import json, sys; print(sys.version_info[0])'], { encoding: 'utf8', timeout: 30_000 });
        if (r.status === 0 && r.stdout.trim() === '3') { python = real; break; }
      }
    }
  }
  if (!python) throw Error('BLOCKED: no working python3 on PATH, so the JSON-RPC test package can\'t run on this machine');
  return python;
}

// ---- Timing on the reference Mac (tests/acceptance/14, 16, 236 and 30's rule).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/**
 * The design's timing rule on five readings of an absolute quantity (never a ratio): PASS when every reading is
 * within the limit, FAIL when every reading is over it by more than the margin (the larger of 5% and the five
 * readings' spread as a fraction of the limit, as scripts/benchmark.mjs's judgeLimit takes it), otherwise
 * INCONCLUSIVE, which fails the test with that word (Nothing missing passes), never a skip. Returns the problem,
 * or null on PASS.
 */
export function judgeTiming(name: string, runs: number[], limit: number): string | null {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return null;
  if (runs.every((r) => r > limit * (1 + margin))) return `FAIL ${shown}`;
  return `INCONCLUSIVE ${shown}`;
}
