// Test-side tools for the #989 acceptance tests: temp folders, a world (the record, the asks core, the supervisor that
// is #236's local host@1, and the hub's lock, held by this process as the hub holds it) that can quit and relaunch on
// the same files, the extension host (#348) on it, the test piece copied from fixtures/, the programs the terminals run
// (Node scripts that note their PIDs and what they read in files), the tab of a hosted terminal as the hub shows it,
// files on disk, and process facts read with ps.
// Nothing here stands in for the extension host, the supervisor, a terminal's host process, its log or its tab: the
// tests reach them only through `@deepbuild/extension-host`'s public entry (README, The surface under test), loaded
// lazily so this file loads at the base.
//
// Safety: every folder is under /tmp/dh989-* (real paths); HOME is a temp folder for this process and every child; the
// agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; no network, no
// model, no real claude or codex binary. A process is only ever stopped by PID: one a test started (its programs note
// their own PIDs) or one the supervisor recorded in a world this file made, checked against the start time it had when
// first seen or recorded; never by name or port.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll } from 'vitest';
import type { ExtensionHost, Installed, Plant, TerminalTab } from '../../../packages/extension-host/src/index.ts';
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
const HOME = realpathSync(mkdtempSync('/tmp/dh989-home-'));
process.env.HOME = HOME;

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh989-${tag}-`));
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
/** You, on the trusted path: the app, which sends the focused tab's keys, paste and size. */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };

// ---- The world: a record, the asks core, the supervisor on them (#236), and the hub's lock, on files that outlive it.
export interface World {
  dir: string;
  /** The hub's root (the extension host's home): extensions/, terminals/ and hub-lock.sqlite live here. */
  home: string;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  events(kind?: string): Promise<Event[]>;
  /** The hub side stops: the supervisor and the record close and the hub's lock is let go (after the host was closed). */
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];

/**
 * The hub's lock, taken by this process as `packages/hub/src/lock.ts` takes it (the hub's own process, here this one,
 * holds an exclusive SQLite transaction on `<root>/hub-lock.sqlite`, an fcntl lock the kernel holds for the process).
 * Throws when another process holds it.
 */
function holdHubLock(path: string): () => void {
  const db = new Database(path, { timeout: 0 });
  try {
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
  } catch (e) {
    db.close();
    throw Error(`can't take the hub's lock at ${path}: ${message(e)}`);
  }
  return () => { try { db.exec('ROLLBACK'); } finally { db.close(); } };
}

/** A world on `dir`'s ledger.db and deepbuild/ folder: new ones, or the same files again (the hub restarting). */
export async function openWorld(dir = tempDir('world')): Promise<World> {
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const release = holdHubLock(join(deepHome, 'hub-lock.sqlite'));
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
      try {
        await sup.close();
        await record.close();
      } finally {
        release();
      }
    },
  };
  worlds.push(w);
  return w;
}

/** The extension-host package, loaded lazily so this file loads at the base. */
export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;

export interface HostOptions { plant?: Plant | undefined; terminalProtocol?: number | undefined }
/** A ready extension host on a world's record, supervisor and home: `plant` is a wrong program a criterion names. */
export async function openHost(w: World, options: HostOptions = {}): Promise<ExtensionHost> {
  const { openExtensionHost, openTrust } = await host();
  const trust = await openTrust({ record: w.record, now: Date.now });
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust, home: w.home, release: [], now: Date.now,
    ...(options.plant ? { plant: options.plant } : {}), ...(options.terminalProtocol !== undefined ? { terminalProtocol: options.terminalProtocol } : {}),
  });
  hosts.push(h);
  await h.ready();
  return h;
}

/** The hub stops (as when it restarts or the app quits with it): the extension host closes, then the supervisor, the record and the lock. */
export async function quit(h: ExtensionHost, w: World): Promise<void> {
  await h.close();
  await w.close();
}
/** Each installed package loads again at a later start, its conformance kept or run again. */
export async function loadAll(h: ExtensionHost): Promise<void> {
  for (const p of await h.installed()) {
    if (!h.checked(p)) await h.check(p);
    const load = await h.load(p);
    if (load.status !== 'loaded') throw Error(`${p.id} didn't load again after the hub restarted: ${load.reason}`);
  }
}

/**
 * After the file: every process the supervisor recorded in a world this file made (process.tracked@1, by the core),
 * still running with the start time recorded for it, is stopped by PID. Hosted terminals outlive their host's close by
 * design, so a test that failed before closing its terminals would otherwise leave them running.
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

// ---- The test piece.
export const PIECE = 'test/hosted';
/**
 * The piece in a temp folder: `fixtures/hosted` copied with `index.ts.fixture` renamed to index.ts (so neither Vitest
 * nor the type check picks it up), and its `digest` set to the host's own `packageDigest` of the result.
 */
export async function pkg(): Promise<string> {
  const dir = tempDir('pkg-hosted');
  cpSync(join(FIXTURES, 'hosted'), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/** Installs the piece (built by an agent session), runs its conformance, approves run-as-you on the trusted path, and loads it. */
export async function installPiece(h: ExtensionHost): Promise<Installed> {
  const p = await h.install({ from: await pkg(), builtBy: `session:${ulid()}` });
  const checked = await h.check(p);
  if (!checked.passed) throw Error(`${p.id} failed its conformance: ${checked.reasons.join('; ')}`);
  await h.approve(YOU, p.id, 'run_as_you');
  const load = await h.load(p);
  if (load.status !== 'loaded') throw Error(`${p.id} didn't load: ${load.reason}`);
  return p;
}
/** Calls one of the piece's actions as you; throws naming the refusal when it didn't run. */
export async function act(h: ExtensionHost, p: { id: string; version: string }, action: string, input: unknown): Promise<Record<string, unknown>> {
  const r = await h.callAction({ action, target: { handle: `ext:${p.id}`, version: p.version }, input, caller: YOU });
  if (r.status !== 'done') throw Error(`${action} didn't run: ${r.reason}`);
  return (r.output ?? {}) as Record<string, unknown>;
}
export interface Opened { terminal: string; run: string; pid: number }
/** A terminal the piece opens running `argv`, of `cols` x `rows` cells; throws naming the host's refusal when it didn't open. */
export async function openTerminal(h: ExtensionHost, p: { id: string; version: string }, argv: string[], cwd: string, title: string, cols: number, rows: number): Promise<Opened> {
  const out = await act(h, p, 'ext.hosted.open', { argv, cwd, title, cols, rows });
  const o = out.opened as Opened | undefined;
  if (!o) throw Error(`the approved piece couldn't open its ${title} terminal: ${String(out.refused ?? JSON.stringify(out))}`);
  if (typeof o.terminal !== 'string' || typeof o.run !== 'string' || !Number.isSafeInteger(o.pid)) throw Error(`ext.hosted.open answered an opened terminal without its terminal, run and pid: ${JSON.stringify(out)}`);
  return o;
}
export interface Listed { terminal: string; title: string; pid: number; run: string }
export async function listed(h: ExtensionHost, p: { id: string; version: string }): Promise<Listed[]> {
  return ((await act(h, p, 'ext.hosted.tabs', {})).tabs ?? []) as Listed[];
}
/** What a terminal's program wrote, read through the piece from offset 0 (the tests read this only of small outputs). */
export async function outputOf(h: ExtensionHost, p: { id: string; version: string }, terminal: string): Promise<string> {
  let text = '';
  for (let from = 0, i = 0; i < 100; i++) {
    const r = await act(h, p, 'ext.hosted.read', { terminal, from });
    text += String(r.text ?? '');
    const next = Number(r.next);
    if (!Number.isSafeInteger(next) || next <= from) break;
    from = next;
  }
  return text;
}

// ---- The tab: what the hub shows for a hosted terminal (README, ExtensionHost.tab).
const FIELDS: [keyof TerminalTab, (v: unknown) => boolean][] = [
  ['terminal', (v) => typeof v === 'string'],
  ['cols', (v) => Number.isSafeInteger(v)],
  ['rows', (v) => Number.isSafeInteger(v)],
  ['screen', (v) => Array.isArray(v) && v.every((r) => typeof r === 'string')],
  ['scrollback', (v) => Array.isArray(v) && v.every((r) => typeof r === 'string')],
  ['cursor', (v) => !!v && Number.isSafeInteger((v as { row?: unknown }).row) && Number.isSafeInteger((v as { col?: unknown }).col)],
  ['input', (v) => typeof v === 'boolean'],
  ['notice', (v) => v === null || typeof v === 'string'],
  ['ended', (v) => typeof v === 'boolean'],
];
/** The terminal's tab as the app sees it, each row's trailing blanks trimmed; throws naming a field it lacks. */
export async function tabOf(h: ExtensionHost, terminal: string): Promise<TerminalTab> {
  const t = await h.tab(YOU, terminal) as unknown as Record<string, unknown>;
  for (const [name, ok] of FIELDS) if (!t || !ok(t[name])) throw Error(`the tab of ${terminal} has no valid ${name}: ${JSON.stringify(t)?.slice(0, 300)}`);
  const tab = t as unknown as TerminalTab;
  if (tab.screen.length !== tab.rows) throw Error(`the tab of ${terminal} is ${tab.rows} rows but its screen holds ${tab.screen.length}`);
  return { ...tab, screen: tab.screen.map((r) => r.trimEnd()), scrollback: tab.scrollback.map((r) => r.trimEnd()) };
}
/** Polls the tab until `done` holds or `ms` pass; returns the last tab read (or throws the last error if none was read) and when `done` first held. */
export async function tabUntil(h: ExtensionHost, terminal: string, done: (t: TerminalTab) => boolean, ms: number, everyMs = 5): Promise<{ tab: TerminalTab; ok: boolean; at: number }> {
  const until = Date.now() + ms;
  let last: TerminalTab | undefined;
  let error: unknown;
  for (;;) {
    try {
      last = await tabOf(h, terminal);
      if (done(last)) return { tab: last, ok: true, at: Date.now() };
    } catch (e) {
      error = e;
    }
    if (Date.now() >= until) break;
    await sleep(everyMs);
  }
  if (!last) throw Error(`the tab of ${terminal} couldn't be read in ${ms} ms: ${message(error)}`);
  return { tab: last, ok: false, at: Date.now() };
}

// ---- A hosted terminal's files (README: `<home>/terminals/<id>/`, its log and its checkpoint).
export const LOG_CAP = 8 * 1024 * 1024;
export const terminalDir = (w: World, terminal: string): string => join(w.home, 'terminals', terminal.slice('term:'.length));
export interface FileFact { path: string; size: number; mode: number; kind: 'file' | 'dir' | 'other' }
/** Every entry under `dir`, recursively, with its size and permission bits; none when `dir` is gone. */
export function filesUnder(dir: string): FileFact[] {
  const out: FileFact[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const path = join(d, n);
      let st;
      try { st = lstatSync(path); } catch { continue; }
      out.push({ path, size: st.size, mode: st.mode & 0o777, kind: st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other' });
      if (st.isDirectory()) walk(path);
    }
  };
  walk(dir);
  return out;
}
export function modeOf(path: string): number | null {
  try { return lstatSync(path).mode & 0o777; } catch { return null; }
}
export const octal = (mode: number | null): string => (mode === null ? 'missing' : `0${mode.toString(8)}`);

// ---- Programs the terminals run. Each notes its PID in a file of its folder, so a test knows every process it made.

/**
 * A full-screen program: on the alternate screen it draws a frame filling its terminal (`+--+` top and bottom rows,
 * `|  |` between, `size <cols>x<rows>` on row 2), at start and again on every SIGWINCH, at the size its terminal
 * has then; each drawing's size is appended to <dir>/drawn.
 */
const FULLSCREEN = `
const fs = require('node:fs');
const dir = process.argv[2];
fs.writeFileSync(dir + '/pid', String(process.pid));
const draw = () => {
  const [c, r] = out.getWindowSize();
  const edge = '+' + '-'.repeat(c - 2) + '+';
  const mid = '|' + ' '.repeat(c - 2) + '|';
  let s = '\\x1b[?1049h\\x1b[H\\x1b[2J';
  for (let y = 1; y <= r; y++) s += '\\x1b[' + y + ';1H' + (y === 1 || y === r ? edge : y === 2 ? '|' + ('size ' + c + 'x' + r).padEnd(c - 2) + '|' : mid);
  out.write(s + '\\x1b[2;2H');
  fs.appendFileSync(dir + '/drawn', c + 'x' + r + '\\n');
};
// process.stdout first: its own SIGWINCH listener, which reads the new size, then runs before this one.
const out = process.stdout;
process.on('SIGWINCH', draw);
draw();
setInterval(() => {}, 1000);
`;
/** Prints `size <cols>x<rows>` on every SIGWINCH, the size its terminal has then; notes <dir>/ready once it listens. */
const SIZES = `
const fs = require('node:fs');
const dir = process.argv[2];
fs.writeFileSync(dir + '/pid', String(process.pid));
// process.stdout first: its own SIGWINCH listener, which reads the new size, then runs before this one.
const out = process.stdout;
process.on('SIGWINCH', () => { const [c, r] = out.getWindowSize(); out.write('size ' + c + 'x' + r + '\\n'); });
fs.writeFileSync(dir + '/ready', '1');
setInterval(() => {}, 1000);
`;
/**
 * Writes \`count\` numbered lines of 64 bytes (\`L\` and the number in 9 digits, a space, dots, a newline) as fast as its
 * terminal takes them, notes <dir>/done; with \`slow\`, then one more numbered line every 50 ms, the last number in
 * <dir>/progress, and every byte it reads from its terminal appended to <dir>/typed. Its PID in <dir>/pid.
 */
const NUMBERED = `
const fs = require('node:fs');
const [dir, count, after] = process.argv.slice(2);
fs.writeFileSync(dir + '/pid', String(process.pid));
const line = (k) => { const head = 'L' + String(k).padStart(9, '0') + ' '; return (head + 'numbered line of a busy agent ').padEnd(63, '.') + '\\n'; };
const pause = new Int32Array(new SharedArrayBuffer(4));
const writeAll = (s) => {
  const b = Buffer.from(s);
  for (let done = 0; done < b.length;) {
    try { done += fs.writeSync(1, b, done); } catch (e) { if (e.code !== 'EAGAIN') throw e; Atomics.wait(pause, 0, 0, 2); }
  }
};
let k = 0;
const total = Number(count);
while (k < total) { let s = ''; for (let i = 0; i < 1024 && k < total; i++) s += line(++k); writeAll(s); }
fs.writeFileSync(dir + '/done', String(k));
fs.writeFileSync(dir + '/progress', String(k));
if (after === 'slow') {
  fs.writeFileSync(dir + '/typed', '');
  process.stdin.on('data', (b) => fs.appendFileSync(dir + '/typed', b));
  setInterval(() => { writeAll(line(++k)); fs.writeFileSync(dir + '/progress', String(k)); }, 50);
} else setInterval(() => {}, 1000);
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
 * A program that reads slowly: raw mode, every byte it reads appended to <dir>/log, and after each read it waits as
 * long as \`rate\` bytes a second allows before reading again; meanwhile it prints \`beat N\` every 50 ms.
 */
const SLOW_READER = `
const fs = require('node:fs');
const [dir, rate] = process.argv.slice(2);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
fs.writeFileSync(dir + '/log', '');
fs.writeFileSync(dir + '/pid', String(process.pid));
let beat = 0;
setInterval(() => { beat++; process.stdout.write('beat ' + beat + '\\r\\n'); }, 50);
process.stdin.on('data', (b) => {
  fs.appendFileSync(dir + '/log', b);
  process.stdin.pause();
  setTimeout(() => process.stdin.resume(), Math.ceil((b.length * 1000) / Number(rate)));
});
process.stdin.resume();
fs.writeFileSync(dir + '/ready', '1');
`;
const SOURCES = { fullscreen: FULLSCREEN, sizes: SIZES, numbered: NUMBERED, reader: READER, 'slow-reader': SLOW_READER } as const;
export type ProgramName = keyof typeof SOURCES;
/** A program's argv, its source written in `dir`, which it also takes as its first argument (its folder of notes). */
export function program(dir: string, name: ProgramName, ...args: string[]): string[] {
  const path = join(dir, `${name}.cjs`);
  if (!existsSync(path)) writeFileSync(path, SOURCES[name]);
  return [NODE, path, dir, ...args];
}
/** One numbered line as NUMBERED writes it, without its newline. */
export const numberedLine = (k: number): string => `L${String(k).padStart(9, '0')} numbered line of a busy agent `.padEnd(63, '.');
/** The number of a numbered line, or null for any other text. */
export const numberOf = (row: string): number | null => { const m = /^L(\d{9}) numbered line of a busy agent \.+$/.exec(row); return m && row.length === 63 ? Number(m[1]) : null; };

export const readText = (path: string): string => { try { return readFileSync(path, 'latin1'); } catch { return ''; } };
export const numberIn = (path: string): number => { const t = readText(path).trim(); const n = Number(t); return t && Number.isFinite(n) ? n : 0; };
/** Polls `read` until `done` holds or `ms` pass; returns the last value either way. */
export async function waitFor<T>(read: () => T | Promise<T>, done: (v: T) => boolean, ms: number, everyMs = 50): Promise<T> {
  const until = Date.now() + ms;
  let v = await read();
  while (!done(v) && Date.now() < until) { await sleep(everyMs); v = await read(); }
  return v;
}
/** Waits for each `<dir>/<name>` to hold a number; throws naming the ones that never came. */
export async function notesIn(dir: string, names: string[], ms = 10_000): Promise<Record<string, number>> {
  const got = await waitFor(() => Object.fromEntries(names.map((n) => [n, numberIn(join(dir, n))])), (v) => Object.values(v).every((x) => x > 0), ms);
  const missing = names.filter((n) => !got[n]);
  if (missing.length) throw Error(`nothing noted in ${missing.map((n) => join(dir, n)).join(', ')} within ${ms} ms`);
  return got;
}

// ---- Processes, read with ps (LC_ALL=C). A process counts as running only while its start time is the one first seen
// and it isn't a zombie; a PID a test saw is remembered so the file can stop it by PID if a test left it running.
export interface Proc { pid: number; start: string }
const seen = new Map<number, string>();
function ps(fields: string, pids: number[]): string[] {
  if (!pids.length) return [];
  const r = spawnSync('/bin/ps', ['-o', fields, '-p', pids.join(',')], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  return (r.stdout ?? '').split('\n').filter((l) => l.trim());
}
function look(pid: number): { start: string; zombie: boolean; ppid: number } | null {
  const line = ps('pid=,ppid=,stat=,lstart=', [pid])[0];
  if (!line) return null;
  const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
  return m ? { ppid: Number(m[2]), start: m[4]!, zombie: m[3]!.startsWith('Z') } : null;
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
/** The terminal's host process: the program's parent, which holds its pseudo-terminal. */
export function parentOf(pid: number): Proc {
  const now = look(pid);
  if (!now) throw Error(`no process ${pid} to find the parent of`);
  return proc(now.ppid);
}
/** Stops, by PID, every process a test saw that still runs with the start time it had then. */
export function stopOurs(): void {
  for (const [pid, start] of seen) if (running({ pid, start })) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

// ---- Another session's agent: a shell it started, outside the hub, the same user.
/**
 * Writes `text` into every way in that the terminal's folder offers any of your processes: each FIFO opened for writing
 * and each socket connected to. `/bin/sh` execs Node with this script, so the shell's PID is the writer's.
 */
const WRITER = `
const fs = require('node:fs');
const net = require('node:net');
const [folder, out, text] = process.argv.slice(2);
const results = [];
const sockets = [];
const walk = (d) => {
  for (const n of fs.readdirSync(d)) {
    const p = d + '/' + n;
    const st = fs.lstatSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.isFIFO()) {
      try {
        const fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        const wrote = fs.writeSync(fd, text);
        fs.closeSync(fd);
        results.push({ path: p, kind: 'fifo', wrote });
      } catch (e) { results.push({ path: p, kind: 'fifo', error: e.code || String(e) }); }
    } else if (st.isSocket()) sockets.push(p);
  }
};
walk(folder);
(async () => {
  for (const p of sockets) {
    results.push(await new Promise((resolve) => {
      const r = { path: p, kind: 'socket', wrote: 0 };
      const s = net.connect(p, () => s.write(text, () => { r.wrote = Buffer.byteLength(text); }));
      s.on('data', () => {});
      s.on('error', (e) => { r.error = e.code || String(e); });
      s.on('close', () => resolve(r));
      setTimeout(() => { s.destroy(); resolve(r); }, 2000);
    }));
  }
  fs.writeFileSync(out, JSON.stringify({ pid: process.pid, results }));
})();
`;
export interface Attempt { pid: number; results: { path: string; kind: string; wrote?: number; error?: string }[] }
/** A shell an agent in another session started, which opens the terminal's input wherever its folder offers one and writes `text`. */
export async function agentShellWrites(folder: string, text: string): Promise<Attempt> {
  const dir = tempDir('agent-shell');
  const script = join(dir, 'writer.cjs');
  writeFileSync(script, WRITER);
  const out = join(dir, 'attempt.json');
  const child = spawn('/bin/sh', ['-c', 'exec "$0" "$@"', NODE, script, folder, out, text], {
    stdio: 'ignore', env: { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: `01K8B${ulid().slice(5)}` },
  });
  const pid = child.pid!;
  await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  if (!existsSync(out)) throw Error(`the agent's shell (pid ${pid}) noted no attempt`);
  const a = JSON.parse(readFileSync(out, 'utf8')) as Attempt;
  if (a.pid !== pid) throw Error(`the agent's writer ran as pid ${a.pid}, not the shell's ${pid}`);
  return a;
}

/** Whether `value` holds the number `n` anywhere (a field, an array item, nested). */
export function holdsNumber(value: unknown, n: number): boolean {
  if (value === n) return true;
  if (Array.isArray(value)) return value.some((v) => holdsNumber(v, n));
  if (value && typeof value === 'object') return Object.values(value).some((v) => holdsNumber(v, n));
  return false;
}
