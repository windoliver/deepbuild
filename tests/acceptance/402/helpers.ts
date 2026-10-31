// Test-side tools for the #402 acceptance tests: `deep-show` built once per file (and per build set where a test needs
// one), driven by JSON scenarios (`deep-show run`, the virtual display clock of #400/#401) or by one long-lived process
// (`deep-show serve`, the wall clock, for what only real processes show); the real programs the tests run in terminals
// (Node scripts on a real PTY); the calls this suite adds and parsers for their replies; and the checks each criterion's
// wrong program must fail. Nothing here stands in for the terminal, the stream, the cell grid, the input router, the
// session page or the verdict: each is read from what `deep-show` (or the verdict engine) answers.

import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { A, B, CHECK, FLICKS, LEAD, MS, PERIOD_A, SEC, SLOTS, WINDOW, arr, isObject, num, obj, str } from '../401/helpers.ts';
import type { Display, JsonObject, JsonValue, Point, Rect } from '../401/helpers.ts';

export { A, B, CHECK, FLICKS, LEAD, MS, PERIOD_A, SEC, SLOTS, WINDOW, arr, isObject, num, obj, str };
export type { Display, JsonObject, JsonValue, Point, Rect };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/402 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_BIN = 'deep-show';
export const PERIOD_B = FLICKS / B.refresh_hz;
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: billing', process: { pid: 4100, start: 1_000 } };
export const BETA = { id: 'sess-beta', thread: 'thread-beta', name: 'Claude Code: reports', process: { pid: 4200, start: 2_000 } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4200, ppid: 3001, start: 2_000 }];

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const strs = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));

// ---------------------------------------------------------------------------------------------------
// Folders: under /tmp/dh402-* (a socket path must fit 104 bytes), a fresh HOME for every child, deleted after.

const made: string[] = [];
export function tmp(name: string): string {
  const dir = mkdtempSync(join('/tmp', `dh402-${name}-`));
  made.push(dir);
  return dir;
}
afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A fresh scratch folder per test (the evidence store, the programs' logs), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = tmp('t'); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file and build set, copied out of target/debug; a test that
// uses a build that failed fails, naming it.

function cargoBuild(features: readonly string[] | null): string {
  const args = ['build', '--locked', '--bin', SHOW_BIN, ...(features ? ['--no-default-features', '--features', features.join(',')] : [])];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** The deep-show binary for this file's tests: the default (full) build, or one build set (`['r1']`, `['r2']`, `['core']`). */
export function useShow(features: readonly string[] | null = null): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = tmp('bin');
    error = cargoBuild(features);
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', SHOW_BIN), join(dir, SHOW_BIN));
  }, 3_600_000);
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}${features ? ` --no-default-features --features ${features.join(',')}` : ''}`).toBe('');
    return join(dir, SHOW_BIN);
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario per input line, one reply line per scenario (#393's convention).

/** Pipes JSON lines into one run of `bin args…`: exit 0 and exactly one line out per line in, or the test fails. */
export function lines(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 600_000): JsonObject[] {
  const label = `${bin.split('/').pop()} ${args.join(' ')}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', env: childEnv() });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within ${timeoutMs} ms`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `${label}: line ${i + 1}`));
}

/** The environment of every child: a HOME of its own, a minimal PATH, no network settings. */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: tmp('home'), PATH: '/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', ...extra };
}

export interface World {
  evidence: string;
  /** Plug-ins installed (401's `install`) at flicks 1, 2, 3 …, before every other call; each must install. */
  plugins?: Record<string, JsonObject>;
  /** Panel ID → slot, in the main window. */
  panels?: Record<string, Rect>;
  sessions?: JsonObject;
  planted?: string;
}
export const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const displayJson = (d: Display): JsonObject => ({ uuid: d.uuid, bounds: d.bounds, scale: d.scale, refresh_hz: d.refresh_hz, next_vsync: d.next_vsync, color_space: d.color_space });
/** The setup every scenario and every `serve` shares: #400's displays, clock and window, the panels' slots, the sessions. */
export function setupOf(w: World): JsonObject {
  return {
    evidence: w.evidence, sessions: w.sessions ?? SESSIONS, processes: PROCESSES, clock: { lead: LEAD, check: CHECK },
    displays: [A, B].map(displayJson), window: WINDOW,
    panels: Object.fromEntries(Object.entries(w.panels ?? {}).map(([id, r]) => [id, { rect: r }])),
    ...(w.planted ? { planted: w.planted } : {}),
  };
}
export const installCall = (at: number, plugin: string, manifest: JsonObject): JsonObject => ({ call: 'install', at, plugin, manifest });
/** A scenario: the setup, the installs, then the calls in `at` order. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  const installs = Object.entries(w.plugins ?? {}).map(([plugin, manifest], i) => installCall(1 + i, plugin, manifest));
  const sorted = [...installs, ...calls].map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  return { ...setupOf(w), calls: sorted };
}

const SURFACE = 'README: The surface under test';
/** `deep-show run`: one scenario, answered ok with one reply per call, in call order; every set-up install installed. */
export function runShow(bin: string, s: JsonObject, what: string): JsonObject[] {
  const [answer] = lines(bin, ['run'], [s]);
  expect(answer!['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer!['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  const calls = arr(s['calls'], 'calls');
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  calls.forEach((c, i) => {
    if (isObject(c) && c['call'] === 'install' && num(c['at'], 'at') < 100) expect(replies[i]!['installed'], `${what}: the plug-in ${String(c['plugin'])} installs: ${JSON.stringify(replies[i]).slice(0, 600)}`).toBe(true);
  });
  return replies;
}

/** Drives one world step by step on the virtual clock (as #401's): each step's calls may be made from what the steps before answered. */
export class Driver {
  private calls: JsonObject[] = [];
  constructor(private readonly bin: string, private readonly world: World) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = scenario(this.world, [...this.calls, ...fresh]);
    const replies = runShow(this.bin, s, what);
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
  one(call: JsonObject, what: string): JsonObject { return this.step([call], what)[0]!; }
}

// ---------------------------------------------------------------------------------------------------
// `deep-show serve`: one long-lived hub on the wall clock. The first line is the setup (answered {"ok": true}), each
// later line one call (its `at`, if any, is ignored), answered in order by one line; stdin closing ends it, and with it
// every panel host and terminal program it started.

export class Serve {
  private buf = '';
  private waiting: { resolve: (v: JsonObject) => void; reject: (e: Error) => void }[] = [];
  private err = '';
  private ended: string | null = null;
  /** Every process the hub reported starting (hosts and programs), by PID, for the end of the test. */
  readonly known = new Set<number>();
  private constructor(readonly child: ChildProcess) {}

  static async start(bin: string, setup: JsonObject, extraEnv: Record<string, string> = {}): Promise<Serve> {
    const child = spawn(bin, ['serve'], { cwd: REPO, env: childEnv(extraEnv), stdio: ['pipe', 'pipe', 'pipe'] });
    const s = new Serve(child);
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => s.onData(d));
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (d: string) => { s.err = (s.err + d).slice(-4000); });
    child.on('exit', (code, signal) => s.onEnd(`exited (${code ?? 'no code'}, ${signal ?? 'no signal'})`));
    child.on('error', (e) => s.onEnd(`could not start: ${e.message}`));
    try {
      const first = await s.call(setup, 120_000);
      expect(first['ok'], `deep-show serve accepts the setup (${SURFACE}); got ${JSON.stringify(first).slice(0, 600)}; stderr: ${s.err.slice(-1500)}`).toBe(true);
    } catch (e) {
      await s.close();
      throw e;
    }
    return s;
  }
  get pid(): number { return this.child.pid!; }
  private onData(d: string): void {
    this.buf += d;
    for (let i = this.buf.indexOf('\n'); i >= 0; i = this.buf.indexOf('\n')) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line === '') continue;
      const w = this.waiting.shift();
      if (!w) continue;
      try { w.resolve(obj(JSON.parse(line) as JsonValue, 'a deep-show serve reply')); } catch (e) { w.reject(new Error(`deep-show serve wrote a line that is not a JSON object: ${line.slice(0, 300)}`)); }
    }
  }
  private onEnd(why: string): void {
    this.ended = why;
    for (const w of this.waiting.splice(0)) w.reject(new Error(`deep-show serve ${why} before answering; stderr: ${this.err.slice(-1500)}`));
  }
  call(c: JsonObject, timeoutMs = 120_000): Promise<JsonObject> {
    if (this.ended) return Promise.reject(new Error(`deep-show serve ${this.ended}; stderr: ${this.err.slice(-1500)}`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`deep-show serve did not answer ${JSON.stringify(c).slice(0, 200)} within ${timeoutMs} ms`)), timeoutMs);
      this.waiting.push({ resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.child.stdin!.write(`${JSON.stringify(c)}\n`);
    });
  }
  /** A call that must answer without a `code` (a refusal or an error). */
  async ok(c: JsonObject, what: string, timeoutMs?: number): Promise<JsonObject> {
    const r = await this.call(c, timeoutMs);
    expect(r['code'], `${what} is answered, not refused: ${JSON.stringify(r).slice(0, 600)}`).toBeUndefined();
    return r;
  }
  /** Ends the hub: stdin closes, then (after a grace) any process it started that is still alive is killed by PID. */
  async close(): Promise<void> {
    for (const pid of this.known) signal(pid, 'SIGCONT');
    if (!this.ended) {
      this.child.stdin!.end();
      for (let i = 0; i < 200 && !this.ended; i++) await sleep(100);
    }
    for (const pid of [...this.known, this.pid]) if (alive(pid)) signal(pid, 'SIGKILL');
  }
}
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
export function signal(pid: number, sig: NodeJS.Signals): void {
  try { process.kill(pid, sig); } catch { /* already gone */ }
}

/** Runs `body` against a serve, then always ends it (a stopped host is continued first). */
export async function withServe<T>(bin: string, setup: JsonObject, body: (s: Serve) => Promise<T>, extraEnv: Record<string, string> = {}): Promise<T> {
  const s = await Serve.start(bin, setup, extraEnv);
  try { return await body(s); } finally { await s.close(); }
}

/** Polls `read` until `done` holds or `ms` pass; returns the last value either way. */
export async function waitFor<T>(read: () => T | Promise<T>, done: (v: T) => boolean, ms: number, everyMs = 50): Promise<T> {
  const until = Date.now() + ms;
  let v = await read();
  while (!done(v) && Date.now() < until) { await sleep(everyMs); v = await read(); }
  return v;
}

// ---------------------------------------------------------------------------------------------------
// Terminals' programs: real Node scripts run on a real PTY by the hub. Each logs to files the test reads; none touches
// the network, the system clipboard or anything outside its own folder.

/** Line n of the numbered stream: 36 characters, `L` and eight digits of n, a space, 26 characters derived from n. */
export function lineText(n: number): string {
  const h = (Math.imul(n, 0x9e3779b1) >>> 0).toString(36).padStart(7, '0');
  return `L${String(n).padStart(8, '0')} ${h.repeat(4).slice(0, 26)}`;
}
export const LINE_BYTES = 37; // 36 characters and the newline
/** 50 MB of numbered lines (50 MiB, rounded up to a whole line). */
export const LINES_50MB = Math.ceil((50 * 1024 * 1024) / LINE_BYTES);
export const pad8 = (n: number): string => `L${String(n).padStart(8, '0')}`;

const COMMON = `
const fs = require('node:fs');
const lineText = ${lineText.toString()};
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function writeAll(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off); }
    catch (e) { if (e.code === 'EAGAIN') { sleepMs(1); continue; } throw e; }
  }
}
`;

/** Writes `count` numbered lines as fast as the terminal takes them, noting its progress in a file as it goes. */
const WRITER = `${COMMON}
const [count, progress, done] = process.argv.slice(2);
const N = Number(count);
const CHUNK = 2000;
for (let n = 1; n <= N; n += CHUNK) {
  const to = Math.min(N, n + CHUNK - 1);
  let s = '';
  for (let k = n; k <= to; k++) s += lineText(k) + '\\n';
  writeAll(s);
  fs.writeFileSync(progress, String(to));
}
fs.writeFileSync(done, String(N));
`;

/** Reads its own terminal's input raw and logs every byte to a file; may first write escapes, then waits. Config: a JSON file. */
const READER = `${COMMON}
const log = process.argv[2];
const config = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {};
if (process.stdin.isTTY) process.stdin.setRawMode(true);
fs.writeFileSync(log, '');
process.stdin.on('data', (b) => fs.appendFileSync(log, b));
process.stdin.resume();
const size = () => fs.appendFileSync(log + '.size', process.stdout.columns + 'x' + process.stdout.rows + '\\n');
size();
process.on('SIGWINCH', size);
if (config.enable) writeAll(config.enable);
fs.writeFileSync(log + '.ready', '1');
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let idx = 0;
  for (const item of config.emit || []) {
    fs.appendFileSync(log, '\\n#' + idx + '#\\n');
    for (const piece of Array.isArray(item) ? item : [item]) { writeAll(piece); await wait(config.gap_ms ?? 5); }
    await wait(config.gap_ms ?? 5);
    idx++;
  }
  if (config.emit) { await wait(config.tail_ms ?? 1500); fs.appendFileSync(log, '\\n#end#\\n'); fs.writeFileSync(log + '.done', '1'); }
})();
setInterval(() => {}, 1000);
`;

/** Prints \`count\` lines, \`every\`th of them holding the marker. */
const MARKER_LINES = `${COMMON}
const [count, marker, every, done] = process.argv.slice(2);
let s = '';
for (let i = 1; i <= Number(count); i++) {
  s += 'line ' + i + ' ' + (i % Number(every) === 0 ? marker : 'plain') + '\\n';
  if (i % 500 === 0) { writeAll(s); s = ''; }
}
writeAll(s);
fs.writeFileSync(done, count);
`;

export type ProgramName = 'writer' | 'reader' | 'marker';
const SOURCES: Record<ProgramName, string> = { writer: WRITER, reader: READER, marker: MARKER_LINES };
/** A program: `{argv}` for `terminal_open`, its source written in `dir`. */
export function program(dir: string, name: ProgramName, ...args: string[]): { argv: string[]; env: Record<string, string>; cwd: string } {
  const path = join(dir, `${name}.cjs`);
  if (!existsSync(path)) writeFileSync(path, SOURCES[name]);
  return { argv: [process.execPath, path, ...args], env: childEnv(), cwd: dir };
}
export function readBytes(path: string): Buffer {
  try { return readFileSync(path); } catch { return Buffer.alloc(0); }
}
export const readText = (path: string): string => readBytes(path).toString('latin1');
export const progressOf = (path: string): number => { const n = Number(readText(path)); return Number.isFinite(n) ? n : 0; };

// ---------------------------------------------------------------------------------------------------
// Plug-ins and calls (README: The surface under test)

/** A plug-in whose panels each show one terminal's cell grid and take raw input: `{panel ID → terminal ID}`. */
export function terminalPlugin(panels: Record<string, string>): JsonObject {
  return { panels: Object.fromEntries(Object.entries(panels).map(([panel, terminal]) => [panel, { raw_input: true, tree: [{ id: 'screen', component: 'cells', terminal }] }])) };
}
export const at = (call: string, t: number, extra: JsonObject = {}): JsonObject => ({ call, at: t, ...extra });
export interface OpenOptions { panel?: string; session?: string; cols?: number; rows?: number; history?: number; feed?: { at: number; text: string }[]; program?: { argv: string[]; env: Record<string, string>; cwd: string }; window?: number }
export function openCall(t: number, terminal: string, o: OpenOptions): JsonObject {
  return {
    call: 'terminal_open', at: t, terminal, cols: o.cols ?? 120, rows: o.rows ?? 36, ...(o.history === undefined ? {} : { history: o.history }),
    ...(o.panel ? { panel: o.panel } : {}), ...(o.session ? { session: o.session } : {}),
    ...(o.feed ? { feed: o.feed } : {}), ...(o.program ? { program: o.program } : {}), ...(o.window === undefined ? {} : { stream: { window: o.window } }),
  };
}
export const down = (t: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at: t, panel, event: { type: 'down', pos } });
export const upAt = (t: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at: t, panel, event: { type: 'up', pos } });
export const moveTo = (t: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at: t, panel, event: { type: 'move', pos } });
export const centre = (r: Rect): Point => [r[0] + r[2] / 2, r[1] + r[3] / 2];
export const seamKey = (key: string, phase: 'press' | 'repeat' | 'release' = 'press', mods: string[] = [], t = 0): JsonObject => ({ call: 'seam', at: t, event: { type: 'key', key, phase, mods } });

export interface Opened { host: { pid: number } | null; program: { pid: number } | null; stream: string }
export function openedOf(reply: JsonObject, what: string): Opened {
  expect(reply['opened'], `${what}: the terminal opens (${SURFACE}): ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
  const pidOf = (v: JsonValue | undefined, k: string): { pid: number } | null => (v === null || v === undefined ? null : { pid: num(obj(v, `${what}: ${k}`)['pid'], `${what}: ${k}.pid`) });
  return { host: pidOf(reply['host'], 'host'), program: pidOf(reply['program'], 'program'), stream: str(reply['stream'], `${what}: stream`) };
}

export interface Upd { revision: number; base: number | null; at: number | null; presented: number | null; dropped: boolean; rows: number | null }
/** An `updates` reply: one entry per update the terminal made, in order. */
export function updatesOf(reply: JsonObject | undefined, what: string): Upd[] {
  return arr(obj(reply, what)['updates'], `${what}: updates`).map((v, i) => {
    const u = obj(v, `${what}: updates[${i}]`);
    const opt = (k: string): number | null => (u[k] === null || u[k] === undefined ? null : num(u[k], `${what}: updates[${i}].${k}`));
    expect(typeof u['dropped'], `${what}: updates[${i}].dropped is a boolean`).toBe('boolean');
    return { revision: num(u['revision'], `${what}: updates[${i}].revision`), base: opt('base'), at: opt('at'), presented: opt('presented'), dropped: u['dropped'] === true, rows: opt('rows') };
  });
}

export interface Cursor { x: number; y: number; shape: string; visible: boolean; blink: boolean }
export interface Grid {
  vsync: number | null; revision: number; cols: number; rows: number; text: string[]; cursor: Cursor; history: number; offset: number;
  title: string | null; cwd: string | null; progress: number | null; bell: number; modes: Record<string, JsonValue>; links: Record<string, string>;
  clipboard: { writes: string[]; reads_refused: number }; drawnBy: string; raw: JsonObject;
}
/** A `cells` reply: the terminal's grid as the cell grid shows it. */
export function gridOf(reply: JsonObject | undefined, what: string): Grid {
  const r = obj(reply, what);
  const cur = obj(r['cursor'], `${what}: cursor`);
  const scroll = obj(r['scroll'], `${what}: scroll`);
  const clip = obj(r['clipboard'], `${what}: clipboard`);
  const opt = (k: string): string | null => (r[k] === null || r[k] === undefined ? null : str(r[k], `${what}: ${k}`));
  return {
    vsync: r['vsync'] === null || r['vsync'] === undefined ? null : num(r['vsync'], `${what}: vsync`),
    revision: num(r['revision'], `${what}: revision`), cols: num(r['cols'], `${what}: cols`), rows: num(r['rows'], `${what}: rows`), text: strs(r['text'], `${what}: text`),
    cursor: { x: num(cur['x'], 'cursor.x'), y: num(cur['y'], 'cursor.y'), shape: str(cur['shape'], 'cursor.shape'), visible: cur['visible'] === true, blink: cur['blink'] === true },
    history: num(scroll['history'], `${what}: scroll.history`), offset: num(scroll['offset'], `${what}: scroll.offset`),
    title: opt('title'), cwd: opt('cwd'), progress: r['progress'] === null || r['progress'] === undefined ? null : num(r['progress'], `${what}: progress`),
    bell: num(r['bell'], `${what}: bell`), modes: obj(r['modes'], `${what}: modes`), links: Object.fromEntries(Object.entries(obj(r['links'], `${what}: links`)).map(([k, v]) => [k, str(v, `${what}: links.${k}`)])),
    clipboard: { writes: strs(clip['writes'], `${what}: clipboard.writes`), reads_refused: num(clip['reads_refused'], `${what}: clipboard.reads_refused`) },
    drawnBy: str(r['drawn_by'], `${what}: drawn_by (the canvas module that drew the grid)`), raw: r,
  };
}
export interface Cell { g: string; fg: string; bg: string; attrs: string[]; link: string | null }
export function cellOf(reply: JsonObject | undefined, what: string): Cell {
  const r = obj(reply, what);
  return { g: str(r['g'], `${what}: g`), fg: str(r['fg'], `${what}: fg`), bg: str(r['bg'], `${what}: bg`), attrs: strs(r['attrs'], `${what}: attrs`), link: r['link'] === null || r['link'] === undefined ? null : str(r['link'], `${what}: link`) };
}

/** The rows of a terminal's whole grid, history first, read in chunks (a `rows` call: right-trimmed text). */
export async function allRows(s: Serve, terminal: string, total: number, chunk = 50_000): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; from < total; from += chunk) {
    const r = await s.ok({ call: 'rows', terminal, from, count: Math.min(chunk, total - from) }, `rows ${from}…`, 300_000);
    out.push(...strs(r['rows'], `rows from ${from}`));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The checks the criteria's wrong programs must fail. Each returns its failures as sentences; none is a pass when empty
// of what it reads (a check of an empty reading fails).

/**
 * "Keeps up": every update of a terminal or a cell grid is presented, on the display that paces its panel, in a frame
 * no earlier than it lands (plus the checker's time and the latch lead) and within one frame of that; no two updates share a
 * frame; none is dropped or merged away; the revisions chain (each update's base is the one before it).
 */
export function keepUpProblems(updates: Upd[], arrivals: number[], display: Display | { period: number; phase: number }, label: string): string[] {
  const period = 'period' in display ? display.period : FLICKS / display.refresh_hz;
  const phase = 'phase' in display ? display.phase : display.next_vsync % period;
  const f: string[] = [];
  if (updates.length !== arrivals.length) f.push(`${label}: ${updates.length} updates were made for ${arrivals.length} sent`);
  let prev = -1;
  const n = Math.min(updates.length, arrivals.length);
  for (let i = 0; i < n; i++) {
    const u = updates[i]!, t = arrivals[i]!;
    const name = `${label}: update ${i + 1} (revision ${u.revision}, sent at ${(t / FLICKS).toFixed(4)} s)`;
    if (u.dropped) { f.push(`${name} was dropped`); continue; }
    if (u.presented === null) { f.push(`${name} was never presented`); continue; }
    if (u.presented < t + CHECK + LEAD) f.push(`${name} is presented at ${(u.presented / FLICKS).toFixed(5)} s, before it could be current`);
    if (u.presented > t + period + LEAD + CHECK) f.push(`${name} is presented at ${(u.presented / FLICKS).toFixed(5)} s, more than one frame (${((period + LEAD + CHECK) / MS).toFixed(2)} ms) late`);
    if ((u.presented - phase) % period !== 0) f.push(`${name} is presented at ${u.presented}, which is no vsync of the display that paces the panel`);
    if (u.presented <= prev) f.push(`${name} shares its frame with the update before it`);
    prev = u.presented;
    if (i > 0 && u.base !== updates[i - 1]!.revision) f.push(`${name} has base ${String(u.base)}, not the revision before it (${updates[i - 1]!.revision})`);
  }
  return f.slice(0, 6);
}

/** The first line of the numbered stream the rows lack, and every line out of place, as sentences. */
export function numberedLineProblems(rows: string[], lines: number): { problems: string[]; firstMissing: number | null } {
  const problems: string[] = [];
  let expected = 1;
  let firstMissing: number | null = null;
  const missing = (n: number, why: string): void => { if (firstMissing === null) firstMissing = n; problems.push(`line ${pad8(n)} is missing ${why}`); };
  let idx = 0;
  for (; idx < rows.length; idx++) {
    const row = rows[idx]!;
    const m = /^L(\d{8}) /.exec(row);
    if (!m) { if (row === '') continue; problems.push(`row ${idx} is not a numbered line: ${JSON.stringify(row.slice(0, 60))}`); continue; }
    const n = Number(m[1]);
    if (row !== lineText(n)) { problems.push(`line ${pad8(n)} is garbled: ${JSON.stringify(row)}`); continue; }
    if (n === expected) expected++;
    else if (n > expected) { missing(expected, `(the grid goes on from ${pad8(expected - 1)} to ${pad8(n)})`); expected = n + 1; }
    else problems.push(`line ${pad8(n)} shows again after ${pad8(expected - 1)}`);
  }
  if (expected <= lines) missing(expected, `(the grid ends at ${pad8(expected - 1)} of ${lines})`);
  if (problems.length === 0 && rows.length === 0) problems.push('the grid has no rows');
  return { problems: problems.slice(0, 8), firstMissing };
}

// ---------------------------------------------------------------------------------------------------
// OKLab, for the status distance (the look's `min_distance`, in OKLab)

export type Rgb = [number, number, number];
export const hexRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
export function oklab([r, g, b]: Rgb): [number, number, number] {
  const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)] as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function distance(a: Rgb, b: Rgb): number {
  const [x, y] = [oklab(a), oklab(b)] as const;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
/** The clean look's status colors and its `min_distance` (crates/deep-canvas-marks/looks/clean.json, which render-back draws in). */
export function cleanStatus(): { colors: Record<string, Rgb>; min: number } {
  const look = obj(JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonValue, 'the clean look');
  const status = obj(look['status'], 'the clean look\'s status');
  return { colors: Object.fromEntries(Object.entries(status).map(([k, v]) => [k, hexRgb(str(v, `status.${k}`))])), min: num(look['min_distance'], 'min_distance') };
}

// ---------------------------------------------------------------------------------------------------
// The reference Mac and the design's rule for timing results (as #401's AC8 and tests/acceptance/96, 237)

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timing readings are not results: not a reference Mac, not on mains power, Low Power Mode, thermal state, or load. Null when they count. */
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
  const reading = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(reading);
  const problem = environmentProblem();
  if (problem) expect.fail(`INCONCLUSIVE: ${problem}; the reading is not a result: ${reading}`);
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${reading}`).toBe(false);
  if (!runs.every((r) => r <= limit)) expect.fail(`INCONCLUSIVE: ${reading}`);
}
export function timed(bin: string, s: JsonObject, what: string): number {
  const t = performance.now();
  runShow(bin, s, what);
  return performance.now() - t;
}
