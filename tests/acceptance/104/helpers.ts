// Test-side tools for the #104 acceptance tests: temp folders, a world (the record, the asks core, the supervisor that
// is #236's local host@1, and project trust) that can quit and relaunch on the same files, the extension host (#348)
// on it, the test packages copied from fixtures/, the programs the terminals run (Node scripts and shells that note
// their PIDs and what they read in files), process facts read with ps, and the reference-Mac timing judge.
// Nothing here stands in for the extension host, the supervisor, a hosted terminal or the permission: the tests reach
// them only through `@deepbuild/extension-host`'s public entry (README, The surface under test), loaded lazily so
// this file loads at the base.
//
// Safety: every folder is under /tmp/dh104-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; no network,
// no model, no real claude or codex binary. A process is only ever stopped by PID: one a test started (its programs
// note their own PIDs), checked against the start time it had when the test first saw it; never by name or port.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { ExtensionHost, Installed, Plant } from '../../../packages/extension-host/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
const DAY = 86_400_000;
const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const message = (e: unknown): string => String((e as Error)?.message ?? e);

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
const HOME = realpathSync(mkdtempSync('/tmp/dh104-home-'));
process.env.HOME = HOME;

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh104-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- IDs and connections.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
/** The handle of the agent session that built a package from its sentence. */
export const agentSession = (): string => `session:${ulid()}`;
/** You, on the trusted path: the app (its question card and panels). */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/** An agent's session, through its deep MCP server (#26's connection, as #351's tests write it). */
export const AGENT_MCP: Connection = { writer: 'mcp', actor: 'you', scope: 'you', session: '01K8A0000000000000000AGENT', agent: 'claude-code' };
/** An agent's session, through its hooks. */
export const AGENT_HOOK: Connection = { writer: 'hook', actor: 'you', scope: 'you', session: '01K8A00000000000000000HOOK', agent: 'codex' };
/** A `deep` command run inside an agent session's process tree: the CLI, but the hub's peer check found the agent. */
export const AGENT_CLI: Connection = { writer: 'cli', actor: 'you', scope: 'you', session: '01K8A000000000000000000CLI', agent: 'claude-code' };
/** A piece's own connection, as the host writes its calls. */
export const PIECE: Connection = { writer: 'ext:test/relay', actor: 'you', scope: 'you' };

// ---- The world: a record, the asks core, the supervisor on them (#236) and project trust, on files that outlive it.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs extensions under. */
  home: string;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  events(kind?: string): Promise<Event[]>;
  /** The hub side stops: the supervisor and the record close (after the host was closed). */
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];

/** A world on `dir`'s ledger.db and deepbuild/ folder: new ones, or the same files again (a relaunch). */
export async function openWorld(dir = tempDir('world')): Promise<World> {
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
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
    dir, home: deepHome, record, asks, sup, events,
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

/** A ready extension host on a world's record, supervisor and home: `plant` is a wrong program a criterion names. */
export async function openHost(w: World, plant?: Plant): Promise<ExtensionHost> {
  const { openExtensionHost, openTrust } = await host();
  const trust = await openTrust({ record: w.record, now: Date.now });
  const h = await openExtensionHost({ record: w.record, supervisor: w.sup, trust, home: w.home, release: [], now: Date.now, ...(plant ? { plant } : {}) });
  hosts.push(h);
  await h.ready();
  return h;
}

/** The app quits, and the hub with it: the extension host closes, then the supervisor and the record. */
export async function quit(h: ExtensionHost, w: World): Promise<void> {
  await h.close();
  await w.close();
}
/** The next launch: a new record, supervisor and extension host on the same files; each installed package loads again. */
export async function relaunch(w: World, plant?: Plant): Promise<{ w: World; h: ExtensionHost }> {
  const again = await openWorld(w.dir);
  const h = await openHost(again, plant);
  for (const p of await h.installed()) {
    if (!h.checked(p)) await h.check(p);
    const load = await h.load(p);
    if (load.status !== 'loaded') throw Error(`${p.id} didn't load again at the next launch: ${load.reason}`);
  }
  return { w: again, h };
}

/**
 * After the file: every process the supervisor recorded in a world this file made (process.tracked@1, by the core),
 * still running with the start time recorded for it, is stopped by PID. Terminals that live past the app outlive their
 * host's close by design, so a test that failed before its revoke would otherwise leave them running.
 */
async function reapWorlds(): Promise<void> {
  for (const dir of new Set(worlds.map((w) => w.dir))) {
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now }).catch(() => undefined);
    if (!record) continue;
    try {
      for (let after = 0; ;) {
        const page = await record.read({ after, limit: 1000 });
        for (const e of page) {
          const d = e.data as { pid?: unknown; start?: unknown };
          if (e.kind === 'process.tracked' && e.writer === 'core' && typeof d.pid === 'number' && typeof d.start === 'string' && running({ pid: d.pid, start: d.start })) {
            try { process.kill(d.pid, 'SIGKILL'); } catch { /* gone */ }
          }
        }
        if (page.length < 1000) break;
        after = page[page.length - 1]!.log_pos;
      }
    } finally {
      await record.close();
    }
  }
}

afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds) await w.close().catch(() => undefined);
  await reapWorlds().catch(() => undefined);
  worlds.splice(0);
  stopOurs();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
});

// ---- Test packages.
export interface PackageOptions {
  /** Fields set over the fixture's deepbuild.json. */
  manifest?: Record<string, unknown>;
}
/**
 * A test package in a temp folder: `fixtures/<name>` copied with each `*.fixture` file renamed without that suffix (so
 * neither Vitest nor the type check picks the package's code up), the manifest fields set over it, and its `digest`
 * set to the host's own `packageDigest` of the result.
 */
export async function pkg(name: string, options: PackageOptions = {}): Promise<string> {
  const dir = tempDir(`pkg-${name}`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  const path = join(dir, 'deepbuild.json');
  const manifest = { ...(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>), ...(options.manifest ?? {}) };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/** Installs a package an agent built from its sentence, runs its conformance, and loads it; approves run-as-you on the trusted path first when asked. */
export async function installAndLoad(h: ExtensionHost, from: string, options: { approve: boolean; grant?: { record?: string[] } }): Promise<Installed> {
  const p = await h.install({ from, builtBy: agentSession(), ...(options.grant ? { grant: options.grant } : {}) });
  const checked = await h.check(p);
  if (!checked.passed) throw Error(`${p.id} failed its conformance: ${checked.reasons.join('; ')}`);
  if (options.approve) await h.approve(YOU, p.id, 'run_as_you');
  const load = await h.load(p);
  if (load.status !== 'loaded') throw Error(`${p.id} didn't load: ${load.reason}`);
  return p;
}

/** Calls one of a loaded piece's actions, as `caller`; throws naming the refusal when it didn't run. */
export async function act(h: ExtensionHost, p: { id: string; version: string }, action: string, input: unknown, caller: Connection = YOU): Promise<Record<string, unknown>> {
  const r = await h.callAction({ action, target: { handle: `ext:${p.id}`, version: p.version }, input, caller });
  if (r.status !== 'done') throw Error(`${action} didn't run: ${r.reason}`);
  return (r.output ?? {}) as Record<string, unknown>;
}
export interface Opened { terminal: string; run: string; pid: number }
/** The piece's open action: a terminal running `argv`; returns what opened, or the host's refusal's text. */
export async function openTerminal(h: ExtensionHost, p: { id: string; version: string }, action: string, argv: string[], cwd: string, title: string): Promise<{ opened?: Opened; refused?: string }> {
  const out = await act(h, p, action, { argv, cwd, title });
  if (out.opened) {
    const o = out.opened as Opened;
    if (typeof o.terminal !== 'string' || typeof o.run !== 'string' || !Number.isSafeInteger(o.pid)) throw Error(`${action} answered an opened terminal without its terminal, run and pid: ${JSON.stringify(out)}`);
    return { opened: o };
  }
  return { refused: String(out.refused ?? JSON.stringify(out)) };
}
export interface Tab { terminal: string; title: string; pid: number; run: string }
export async function tabsOf(h: ExtensionHost, p: { id: string; version: string }): Promise<Tab[]> {
  return ((await act(h, p, 'ext.agent-terminals.tabs', {})).tabs ?? []) as Tab[];
}
/** Everything a hosted terminal's program wrote, read through the piece from offset 0. */
export async function outputOf(h: ExtensionHost, p: { id: string; version: string }, terminal: string): Promise<string> {
  let text = '';
  for (let from = 0, i = 0; i < 1000; i++) {
    const r = await act(h, p, 'ext.agent-terminals.read', { terminal, from });
    text += String(r.text ?? '');
    const next = Number(r.next);
    if (!Number.isSafeInteger(next) || next <= from) break;
    from = next;
  }
  return text;
}

// ---- Programs the terminals run. Each notes its PID in a file of its folder, so a test knows every process it made.

/** Prints `tick N` every 50 ms and notes N in `progress`; its PID in `pid`. Exits as soon as its terminal goes. */
const COUNTER = `
const fs = require('node:fs');
const dir = process.argv[2];
fs.writeFileSync(dir + '/pid', String(process.pid));
let n = 0;
setInterval(() => { n++; process.stdout.write('tick ' + n + '\\n'); fs.writeFileSync(dir + '/progress', String(n)); }, 50);
`;
/**
 * A process tree: the program, a child in its group, a grandchild that calls setsid, an orphan whose parent exits so
 * it is reparented to launchd, and a child that ignores SIGTERM, SIGHUP and SIGINT. Each notes its PID as <role>.pid.
 */
const TREE = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [dir, role = 'program'] = process.argv.slice(2);
const self = (r, detached) => spawn(process.execPath, [__filename, dir, r], { detached, stdio: 'ignore' });
if (role === 'stubborn') for (const s of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(s, () => {});
if (role === 'program') { self('child', false); self('setsid', true); self('launcher', false); self('stubborn', false); process.stdout.write('tree up\\n'); }
if (role === 'launcher') { self('orphan', true).unref(); setTimeout(() => process.exit(0), 300); }
else setInterval(() => {}, 1000);
fs.writeFileSync(dir + '/' + role + '.pid', String(process.pid));
`;
/** Puts its terminal in raw mode and logs every byte it reads to <dir>/log; writes <dir>/ready once it reads. */
const READER = `
const fs = require('node:fs');
const dir = process.argv[2];
if (process.stdin.isTTY) process.stdin.setRawMode(true);
fs.writeFileSync(dir + '/log', '');
fs.writeFileSync(dir + '/pid', String(process.pid));
process.stdin.on('data', (b) => fs.appendFileSync(dir + '/log', b));
process.stdin.resume();
fs.writeFileSync(dir + '/ready', '1');
setInterval(() => {}, 1000);
`;
/**
 * Writes \`count\` numbered lines, line k at start + (k - 1)/rate s (start 300 ms after it starts), then notes the time
 * in <dir>/done and idles; with \`quiet\`, keeps the same schedule and writes nothing. Its PID in <dir>/pid.
 */
const PACED = `
const fs = require('node:fs');
const [dir, count, rate, quiet] = process.argv.slice(2);
fs.writeFileSync(dir + '/pid', String(process.pid));
const sleepMs = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const start = Date.now() + 300;
fs.writeFileSync(dir + '/start', String(start));
for (let k = 1; k <= Number(count); k++) {
  sleepMs(start + ((k - 1) * 1000) / Number(rate) - Date.now());
  if (quiet !== 'quiet') process.stdout.write('L' + String(k).padStart(8, '0') + ' paced line of the hosted terminal\\n');
}
fs.writeFileSync(dir + '/done', String(Date.now()));
setInterval(() => {}, 1000);
`;
/** Writes \`count\` numbered lines as fast as its terminal takes them, notes <dir>/done, then idles. */
const FILLER = `
const fs = require('node:fs');
const [dir, count] = process.argv.slice(2);
fs.writeFileSync(dir + '/pid', String(process.pid));
let s = '';
for (let k = 1; k <= Number(count); k++) {
  s += 'L' + String(k).padStart(8, '0') + ' a line of scrollback in a hosted terminal, sixty-odd bytes\\n';
  if (k % 500 === 0) { process.stdout.write(s); s = ''; }
}
process.stdout.write(s, () => fs.writeFileSync(dir + '/done', String(Date.now())));
setInterval(() => {}, 1000);
`;
const SOURCES = { counter: COUNTER, tree: TREE, reader: READER, paced: PACED, filler: FILLER } as const;
export type ProgramName = keyof typeof SOURCES;
/** A program's argv, its source written in `dir`, which it also takes as its first argument (its folder of notes). */
export function program(dir: string, name: ProgramName, ...args: string[]): string[] {
  const path = join(dir, `${name}.cjs`);
  if (!existsSync(path)) writeFileSync(path, SOURCES[name]);
  return [NODE, path, dir, ...args];
}
export const readText = (path: string): string => { try { return readFileSync(path, 'latin1'); } catch { return ''; } };
export const numberIn = (path: string): number => { const n = Number(readText(path).trim()); return readText(path).trim() && Number.isFinite(n) ? n : 0; };
/** Polls `read` until `done` holds or `ms` pass; returns the last value either way. */
export async function waitFor<T>(read: () => T | Promise<T>, done: (v: T) => boolean, ms: number, everyMs = 50): Promise<T> {
  const until = Date.now() + ms;
  let v = await read();
  while (!done(v) && Date.now() < until) { await sleep(everyMs); v = await read(); }
  return v;
}
/** Waits for each `<dir>/<name>` to hold a PID; throws naming the ones that never came. */
export async function pidsIn(dir: string, names: string[], ms = 10_000): Promise<Record<string, number>> {
  const got = await waitFor(() => Object.fromEntries(names.map((n) => [n, numberIn(join(dir, n))])), (v) => Object.values(v).every((x) => x > 0), ms);
  const missing = names.filter((n) => !got[n]);
  if (missing.length) throw Error(`no PID noted in ${missing.map((n) => join(dir, n)).join(', ')} within ${ms} ms`);
  return got;
}

// ---- Processes, read with ps (LC_ALL=C). A process counts as running only while its start time is the one first seen
// and it isn't a zombie; a PID a test saw is remembered so the file can stop it by PID if a test left it running.
export interface Proc { pid: number; start: string }
const seen = new Map<number, string>();
function ps(fields: string, pids: number[]): string[] {
  if (!pids.length) return [];
  // ps exits 1 when one of the PIDs is gone, and still lists the others.
  const r = spawnSync('/bin/ps', ['-o', fields, '-p', pids.join(',')], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  return (r.stdout ?? '').split('\n').filter((l) => l.trim());
}
/** A process's start time and state now, or null when no process has the PID. */
function look(pid: number): { start: string; zombie: boolean } | null {
  const line = ps('pid=,stat=,lstart=', [pid])[0];
  if (!line) return null;
  const m = /^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
  return m ? { start: m[3]!, zombie: m[2]!.startsWith('Z') } : null;
}
/** Records the process's start time, the first time a test sees it. */
export function proc(pid: number): Proc {
  const now = look(pid);
  if (!now) throw Error(`no process ${pid} to watch`);
  if (!seen.has(pid)) seen.set(pid, now.start);
  return { pid, start: seen.get(pid)! };
}
export function running(p: Proc): boolean {
  const now = look(p.pid);
  return !!now && !now.zombie && now.start === p.start;
}
/** Stops, by PID, every process a test saw that still runs with the start time it had then. */
export function stopOurs(): void {
  for (const [pid, start] of seen) if (running({ pid, start })) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
/** The suite's own copy of a program, started outside any piece: a decoy no revoke may stop. */
export function startDecoy(argv: string[]): number {
  const child = spawn(argv[0]!, argv.slice(1), { stdio: 'ignore', detached: true });
  child.unref();
  return child.pid!;
}
/** The PIDs the supervisor recorded for these runs (process.tracked@1, written by the core). */
export async function trackedPids(w: World, runs: string[]): Promise<number[]> {
  const pids = new Set<number>();
  for (const e of await w.events('process.tracked')) {
    const d = e.data as { run?: unknown; pid?: unknown };
    if (e.writer === 'core' && typeof d.run === 'string' && runs.includes(d.run) && typeof d.pid === 'number') pids.add(d.pid);
  }
  return [...pids];
}
/** CPU seconds these processes have used, summed (ps's cputime); a PID gone counts nothing. */
export function cpuSeconds(pids: number[]): number {
  let total = 0;
  for (const line of ps('time=', pids)) {
    const parts = line.trim().split(':').map(Number);
    total += parts.reduce((acc, x) => acc * 60 + x, 0);
  }
  return total;
}
/** Resident memory of these processes, summed, in bytes. */
export function rssBytes(pids: number[]): number {
  return ps('rss=', pids).reduce((acc, line) => acc + Number(line.trim()) * 1024, 0);
}

// ---- The run-as-you refusal, as the record and the host's own message say it.
export const RUN_AS_YOU = 'run_as_you';
/** The capability.refused events the host recorded for a package's terminal command naming run_as_you. */
export async function refusalsNaming(w: World, id: string): Promise<Event[]> {
  return (await w.events('capability.refused')).filter((e) => {
    const d = e.data as { call?: unknown; clause?: unknown };
    return e.writer === `ext:${id}` && d.call === 'deep.terminal.open' && String(d.clause).includes(RUN_AS_YOU);
  });
}

// ---- The reference Mac and the design's rule for timing and memory results (as #402's and #401's AC8).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's readings are not results: not a reference Mac, not on mains power, Low Power Mode, thermal state, or load. Null when they count. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${message(e)}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}
/**
 * PASS when every run is within the limit; FAIL when every run is over it by more than the margin (the larger of 5% and
 * the runs' spread); else, and off a fit reference Mac, INCONCLUSIVE, which fails: it is not a pass.
 */
export function judge(name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const reading = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(reading);
  const problem = environmentProblem();
  if (problem) expect.fail(`INCONCLUSIVE: ${problem}; the reading is not a result: ${reading}`);
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${reading}`).toBe(false);
  if (!runs.every((r) => r <= limit)) expect.fail(`INCONCLUSIVE: ${reading}`);
}
