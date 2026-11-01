// Test-side tools for the #105 acceptance tests: `deep-show` built once per file and driven by one JSON scenario on
// stdin (`deep-show run`, #393's convention, with #400's two displays on the virtual display clock and #96's state
// folder); the calls this suite adds and parsers for their replies; readers for what the run leaves on disk (the
// evidence store, the record) and for frames in any encoding. Nothing here stands in for the picker, the shortcut's
// gate, the indicator, the recorder, the ask or the send: each is read from what `deep-show` answers or writes.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/105 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_BIN = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)}`).toBe('boolean');
  return value as boolean;
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of target/debug, as #400's and #401's
// suites do; a test that uses a build that failed fails, naming it.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', SHOW_BIN];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** The deep-show binary for this file's tests. */
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-105-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh evidence store root and hub state folder per call (one per world, so a wrong program's run never sees the
 * clean run's files), all deleted after the test. */
export function useFolders(): () => { evidence: string; state: string } {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const evidence = mkdtempSync(join(tmpdir(), 'deep-105-ev-'));
    const state = mkdtempSync(join(tmpdir(), 'deep-105-state-'));
    made.push(evidence, state);
    return { evidence, state };
  };
}

export interface Ran { status: number | null; signal: string | null; stdout: string; stderr: string }
/** One run of `deep-show run` on one scenario line; a run that hangs is stopped by spawnSync's own timeout, which
 * signals only this child. */
export function runRaw(bin: string, s: JsonObject, timeoutMs = 600_000): Ran {
  const run = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify(s)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`deep-show run did not finish within ${timeoutMs} ms`);
  return { status: run.status, signal: run.signal, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

const SURFACE = 'the scenario\'s `feed`, `state` and `fault` fields and the `capture`, `pick`, `shortcut`, `indicator`, `captures`, `task`, `send` and `approve` calls, README: The surface under test';

/** `deep-show run`: exit 0, one line out, answered ok with one reply per call, in call order. */
export function runShow(bin: string, s: JsonObject, what: string): { replies: JsonObject[]; stderr: string } {
  const r = runRaw(bin, s);
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 800)}; stderr: ${r.stderr.slice(-2000)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return { replies, stderr: r.stderr };
}

// ---------------------------------------------------------------------------------------------------
// The clock and the displays (#400's, with a feed each)

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000; // 705,600 flicks
export const SEC = FLICKS;
export const LEAD = 2 * MS;
export const CHECK = MS / 2;
export const CLOCK: JsonObject = { lead: LEAD, check: CHECK };

export interface Display { uuid: string; bounds: [number, number, number, number]; scale: number; refresh_hz: number; next_vsync: number; color_space: string }
/** The built-in display: 120 Hz, at 2×, the main display. */
export const A: Display = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
/** The second display, to A's right: 60 Hz, at 1×, its first vsync at 3 ms. */
export const B: Display = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
export const periodOf = (d: Display): number => FLICKS / d.refresh_hz;
export const PERIOD_B = periodOf(B); // 11,760,000 flicks, 16.67 ms

/** Every vsync of `d` in [from, to). */
export function vsyncs(d: Display, from: number, to: number): number[] {
  const p = periodOf(d);
  const out: number[] = [];
  for (let k = Math.max(0, Math.ceil((from - d.next_vsync) / p)); d.next_vsync + k * p < to; k++) out.push(d.next_vsync + k * p);
  return out;
}

export const WINDOW: [number, number] = [1200, 700];
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: billing', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];

/** A display's feed: a token every frame it presents carries (README: Frames). 40 characters, random per test. */
export const newFeed = (tag: string): string => `${tag}-${randomBytes(16).toString('hex')}`.slice(0, 40);

// ---------------------------------------------------------------------------------------------------
// Scenarios (README: The surface under test)

export type Planted =
  | 'records_without_hold' | 'records_past_max' | 'drafts_no_check' | 'frames_to_record' | 'keeps_asset_after_crash'
  | 'labels_redaction_complete' | 'sends_without_approval';

export interface World {
  evidence: string;
  state?: string;
  feeds: { a: string; b: string };
  planted?: Planted;
  /** `{kill_at: flicks}`: the hub ends at that time as SIGKILL would. */
  fault?: JsonObject;
}

/** A scenario: #400's displays (with feeds), clock and window, alpha, then the calls in `at` order. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  const display = (d: Display, feed: string): JsonObject => ({ uuid: d.uuid, bounds: d.bounds, scale: d.scale, refresh_hz: d.refresh_hz, next_vsync: d.next_vsync, color_space: d.color_space, feed });
  return {
    evidence: w.evidence, ...(w.state ? { state: w.state } : {}),
    sessions: SESSIONS, processes: PROCESSES, clock: CLOCK,
    displays: [display(A, w.feeds.a), display(B, w.feeds.b)], window: WINDOW, panels: {},
    ...(w.planted ? { planted: w.planted } : {}), ...(w.fault ? { fault: w.fault } : {}),
    calls: sorted,
  };
}

/**
 * Drives one world step by step on the virtual clock, as #400's and #401's suites do: each step's calls may be made
 * from what the steps before answered, and the whole scenario is played again from the start with them added; it reads
 * no wall time, so a replay answers the same. Returns each step's replies, in the order its calls were given.
 */
export class Driver {
  private calls: JsonObject[] = [];
  stderr = '';
  constructor(private readonly bin: string, private readonly world: World) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = scenario(this.world, [...this.calls, ...fresh]);
    const { replies, stderr } = runShow(this.bin, s, what);
    this.stderr = stderr;
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
}

// ---------------------------------------------------------------------------------------------------
// Calls (README: Calls and replies)

export const at = (call: string, t: number, extra: JsonObject = {}): JsonObject => ({ call, at: t, ...extra });
/** You start a bug capture for a session's ask: the system picker opens. */
export const capture = (t: number, session: string, words: string): JsonObject => ({ call: 'capture', at: t, session, source: 'screen', words });
/** Your answer in the system picker: a display, or cancel. */
export const pick = (t: number, display: string): JsonObject => ({ call: 'pick', at: t, display });
export const cancelPick = (t: number): JsonObject => ({ call: 'pick', at: t, cancel: true });
/** The capture chord on the keyboard: it writes the HID key-state table. */
export const hid = (t: number, phase: 'down' | 'up'): JsonObject => ({ call: 'shortcut', at: t, phase, source: 'hid' });
/** A synthetic press of the chord: an event software posted, carrying the source state table and pid its poster set. */
export const synthetic = (t: number, phase: 'down' | 'up', state: number, pid: number): JsonObject => ({ call: 'shortcut', at: t, phase, source: 'synthetic', state, pid });

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Asset { sha256: string; redaction: string; origin: string }
export interface Capture { capture: string; session: string; state: string; frames: number; asset: Asset | null; ask: string | null }
export function capturesOf(reply: JsonObject | undefined, what: string): Capture[] {
  return arr(obj(reply, what)['captures'], `${what}: captures`).map((v, i) => {
    const c = obj(v, `${what}: captures[${i}]`);
    const a = c['asset'];
    const asset = a === null || a === undefined ? null : obj(a, `${what}: captures[${i}].asset`);
    expect('asset' in c, `${what}: captures[${i}] has an asset field (null until saved)`).toBe(true);
    expect('ask' in c, `${what}: captures[${i}] has an ask field (null until attached)`).toBe(true);
    return {
      capture: str(c['capture'], `${what}: captures[${i}].capture`), session: str(c['session'], `${what}: captures[${i}].session`),
      state: str(c['state'], `${what}: captures[${i}].state`), frames: num(c['frames'], `${what}: captures[${i}].frames`),
      asset: asset && { sha256: str(asset['sha256'], `${what}: captures[${i}].asset.sha256`), redaction: str(asset['redaction'], `${what}: captures[${i}].asset.redaction`), origin: str(asset['origin'], `${what}: captures[${i}].asset.origin`) },
      ask: c['ask'] === null || c['ask'] === undefined ? null : str(c['ask'], `${what}: captures[${i}].ask`),
    };
  });
}

export function indicatorOf(reply: JsonObject | undefined, what: string): { system: boolean; app: boolean } {
  const i = obj(obj(reply, what)['indicator'], `${what}: indicator`);
  return { system: bool(i['system'], `${what}: indicator.system`), app: bool(i['app'], `${what}: indicator.app`) };
}

export interface Check { id: string; state: string; reproduces: string | null; required: boolean }
export interface Task { handle: string; session: string; open: boolean; words: string; evidence: { sha256: string; redaction: string }[]; checks: Check[] }
export function taskOf(reply: JsonObject | undefined, what: string): Task {
  const t = obj(obj(reply, what)['task'], `${what}: task`);
  return {
    handle: str(t['handle'], `${what}: task.handle`), session: str(t['session'], `${what}: task.session`), open: bool(t['open'], `${what}: task.open`),
    words: str(t['words'], `${what}: task.words`),
    evidence: arr(t['evidence'], `${what}: task.evidence`).map((v, i) => {
      const e = obj(v, `${what}: task.evidence[${i}]`);
      return { sha256: str(e['sha256'], `${what}: task.evidence[${i}].sha256`), redaction: str(e['redaction'], `${what}: task.evidence[${i}].redaction`) };
    }),
    checks: arr(t['checks'], `${what}: task.checks`).map((v, i) => {
      const c = obj(v, `${what}: task.checks[${i}]`);
      return {
        id: str(c['id'], `${what}: task.checks[${i}].id`), state: str(c['state'], `${what}: task.checks[${i}].state`),
        reproduces: c['reproduces'] === null || c['reproduces'] === undefined ? null : str(c['reproduces'], `${what}: task.checks[${i}].reproduces`),
        required: bool(c['required'], `${what}: task.checks[${i}].required`),
      };
    }),
  };
}

export function sendOf(reply: JsonObject | undefined, what: string): { id: string; state: string } {
  const s = obj(obj(reply, what)['send'], `${what}: send`);
  return { id: str(s['id'], `${what}: send.id`), state: str(s['state'], `${what}: send.state`) };
}

// ---------------------------------------------------------------------------------------------------
// What a run leaves on disk

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/** Every file under `root`, by path relative to it. */
export function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p));
    }
  };
  walk(root);
  return out.sort();
}

/** The evidence store's files by hash (`<first 2 hex>/<other 62 hex>`, an extension allowed), as #15 lays them out. */
export function storeFiles(root: string): { sha: string; path: string; bytes: Buffer }[] {
  return filesUnder(root).flatMap((rel) => {
    const m = /^([0-9a-f]{2})[/\\]([0-9a-f]{62})(\.[A-Za-z0-9]+)?$/.exec(rel);
    return m ? [{ sha: m[1]! + m[2]!, path: rel, bytes: readFileSync(join(root, rel)) }] : [];
  });
}

export interface Logged { line: number; text: string; event: JsonObject | null }
/** The hub's record in the state folder: `record.jsonl`, one appended event per line (#96's). */
export function recordLines(state: string): Logged[] {
  const path = join(state, 'record.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l !== '').map((text, i) => {
    let event: JsonObject | null = null;
    try { const v = JSON.parse(text) as JsonValue; if (isObject(v) && isObject(v['event'])) event = v['event']; } catch { /* named by the caller */ }
    return { line: i + 1, text, event };
  });
}

/** A row's name in a failure: its line, log position and kind. */
export const rowName = (r: Logged): string => {
  const kind = r.event && typeof r.event['kind'] === 'string' ? r.event['kind'] : '?';
  const pos = (() => { try { const v = JSON.parse(r.text) as JsonObject; return v['log_pos']; } catch { return '?'; } })();
  return `record.jsonl line ${r.line} (log_pos ${JSON.stringify(pos)}, kind ${kind})`;
};

// ---------------------------------------------------------------------------------------------------
// Frames (README: Frames)

export interface Frame { uuid: string; vsync: number; feed: string }
/** The frames a virtual recording holds, in order: one line `frame <uuid> <vsync> <feed>` each. */
export function framesOf(bytes: Buffer, what: string): Frame[] {
  const text = bytes.toString('utf8');
  expect(text.endsWith('\n') || text === '', `${what}: the recording ends with its last frame's newline`).toBe(true);
  return text.split('\n').filter((l) => l !== '').map((l, i) => {
    const m = /^frame (\S+) (\d+) (\S*)$/.exec(l);
    expect(m, `${what}: frame ${i + 1} reads \`frame <uuid> <vsync> <feed>\`, got ${JSON.stringify(l.slice(0, 200))}`).not.toBeNull();
    return { uuid: m![1]!, vsync: Number(m![2]!), feed: m![3]! };
  });
}

/**
 * Where a frame's bytes show in `text`, in any of the forms the record could hold them: raw, hex (either case),
 * or base64 at each of the three byte offsets in the standard and URL-safe alphabets. Every frame carries its
 * display's feed, so finding the feed in any form finds a frame. Returns the form, or null.
 */
export function frameIn(text: string, feed: string): string | null {
  if (text.includes(feed)) return 'raw';
  const hex = Buffer.from(feed).toString('hex');
  if (text.includes(hex) || text.includes(hex.toUpperCase())) return 'hex';
  for (let shift = 0; shift < 3; shift++) {
    const std = Buffer.concat([Buffer.alloc(shift, 0x20), Buffer.from(feed)]).toString('base64');
    // Only the groups of three bytes wholly inside the feed encode the same whatever comes before and after it.
    const core = std.slice(4 * Math.ceil(shift / 3), 4 * Math.floor((shift + Buffer.byteLength(feed)) / 3));
    if (core.length < 16) continue;
    if (text.includes(core)) return `base64 at offset ${shift}`;
    const url = core.replace(/\+/g, '-').replace(/\//g, '_');
    if (text.includes(url)) return `base64url at offset ${shift}`;
  }
  return null;
}

/** Each place on disk or in the log where a frame of either feed shows: the record's rows by name, every other file
 * under the state folder by path, and the run's log lines (stderr) by number. */
export function framesHeld(state: string, stderr: string, feeds: string[]): string[] {
  const f: string[] = [];
  const rows = recordLines(state);
  for (const r of rows) for (const feed of feeds) { const form = frameIn(r.text, feed); if (form) f.push(`${rowName(r)} holds a frame (${form})`); }
  for (const rel of filesUnder(state).filter((p) => p !== 'record.jsonl')) {
    const text = readFileSync(join(state, rel)).toString('latin1');
    for (const feed of feeds) { const form = frameIn(text, feed); if (form) f.push(`the state folder's ${rel} holds a frame (${form})`); }
  }
  stderr.split('\n').forEach((l, i) => { for (const feed of feeds) { const form = frameIn(l, feed); if (form) f.push(`log line ${i + 1} holds a frame (${form})`); } });
  return f;
}

/**
 * What is wrong with `frames` as the recording of a hold of `d` from `down` to `up`: a frame of another display or
 * feed, one outside the hold, one missing between the first and the last vsync before `up`, or a first frame later
 * than 100 ms after `down` (README: Frames). For a hold past `max`, `up` is where `max` ends it.
 */
export function holdProblems(frames: Frame[], d: Display, feed: string, down: number, up: number): string[] {
  const f: string[] = [];
  for (const fr of frames) {
    if (fr.uuid !== d.uuid || fr.feed !== feed) f.push(`a frame of display ${fr.uuid} (feed ${fr.feed.slice(0, 12)}…) at ${fr.vsync}, not of the picked display`);
    else if (fr.vsync < down || fr.vsync >= up) f.push(`a frame at ${fr.vsync}, outside the hold [${down}, ${up})`);
  }
  const ok = frames.filter((fr) => fr.uuid === d.uuid && fr.vsync >= down && fr.vsync < up).map((fr) => fr.vsync);
  const all = vsyncs(d, down, up);
  if (ok.length === 0) { f.push(`no frame of the hold [${down}, ${up})`); return f; }
  if (ok[0]! > down + 100 * MS) f.push(`the first frame is ${((ok[0]! - down) / MS).toFixed(1)} ms after the shortcut went down, past 100 ms`);
  const want = all.filter((v) => v >= ok[0]!);
  const missing = want.filter((v) => !ok.includes(v));
  if (missing.length > 0) f.push(`${missing.length} frame(s) of the hold are missing, the first at ${missing[0]} (${((missing[0]! - down) / MS).toFixed(1)} ms in)`);
  if (new Set(ok).size !== ok.length || ok.some((v, i) => i > 0 && v <= ok[i - 1]!)) f.push('the frames are not in vsync order, each once');
  return f;
}

// ---------------------------------------------------------------------------------------------------
// A local listener standing for a send's destination: a child of the test, stopped by its PID.

export class Listener {
  private child: ChildProcess | null = null;
  constructor(readonly log: string) {}
  /** Starts it; resolves to its port. Each request appends `<method> <path> <sha256 of body> <length>` to the log. */
  async start(): Promise<number> {
    const code = `const fs=require('fs'),c=require('crypto');const s=require('http').createServer((q,r)=>{const b=[];q.on('data',d=>b.push(d));q.on('end',()=>{const body=Buffer.concat(b);fs.appendFileSync(${JSON.stringify(this.log)},q.method+' '+q.url+' '+c.createHash('sha256').update(body).digest('hex')+' '+body.length+'\\n');r.end('ok')})});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
    this.child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
    return new Promise((resolve, reject) => {
      this.child!.stdout!.once('data', (d: Buffer) => resolve(Number(String(d).trim())));
      this.child!.once('error', reject);
    });
  }
  requests(): { method: string; path: string; sha: string; length: number }[] {
    if (!existsSync(this.log)) return [];
    return readFileSync(this.log, 'utf8').split('\n').filter(Boolean).map((l) => {
      const [method, path, sha, length] = l.split(' ');
      return { method: method!, path: path!, sha: sha!, length: Number(length) };
    });
  }
  clear(): void { rmSync(this.log, { force: true }); }
  stop(): void { if (this.child?.pid) this.child.kill(); this.child = null; }
}

// ---------------------------------------------------------------------------------------------------
// The reference Macs (Numbers version 0 has to hold), as tests/acceptance/401 and 96 read them.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings can't count, or null on a fit reference Mac. */
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
