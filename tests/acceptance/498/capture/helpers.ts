// Test-side tools for the #498 capture acceptance tests (criterion 4): `deep-show` built once per file and driven by
// one JSON scenario on stdin (`deep-show run`, #393's convention, with #400's displays on the virtual clock and #105's
// capture calls), extended with a camera and a microphone as scenario inputs, the OS's answer for each, a panel's
// capture request and an agent's tool-call request (README: The surface under test). Nothing here stands in for the
// gate, the device sessions, the indicator or the store: each is read from what `deep-show` answers or writes.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/498/capture is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
export const SHOW_BIN = 'deep-show';
export const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** Where cargo puts its builds: `CARGO_TARGET_DIR` when set, else the checkout's `target`. */
export const TARGET = process.env['CARGO_TARGET_DIR'] ? process.env['CARGO_TARGET_DIR'] : join(REPO, 'target');

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
/** A field that must be there, null allowed: a missing one fails naming it. */
export function present(o: JsonObject, key: string, what: string): JsonValue {
  expect(key in o, `${what} has a ${key} field`).toBe(true);
  return o[key]!;
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of the target folder, as #105's suite
// does; a test that uses a build that failed fails, naming it.

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
    dir = mkdtempSync(join(tmpdir(), 'deep-498-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh evidence store root and hub state folder per call (one per world), all deleted after the test. */
export function useFolders(): () => { evidence: string; state: string } {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const evidence = mkdtempSync(join(tmpdir(), 'deep-498-ev-'));
    const state = mkdtempSync(join(tmpdir(), 'deep-498-state-'));
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

const SURFACE = 'the scenario\'s `devices` and `permissions` fields and the `capture` call with `source: camera | microphone`, `panel` and `tool`, beside #105\'s `shortcut`, `indicator` and `captures` calls, README: The surface under test';

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
// The clock, the displays (#400's, which the virtual clock needs) and the two devices

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000; // 705,600 flicks
export const SEC = FLICKS;
export const CLOCK: JsonObject = { lead: 2 * MS, check: MS / 2 };

interface Display { uuid: string; bounds: [number, number, number, number]; scale: number; refresh_hz: number; next_vsync: number; color_space: string }
const A: Display = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
const B: Display = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };

export type Source = 'camera' | 'microphone';
/** A capture device DeepBuild can open: it delivers item k (a frame, or a buffer of samples) at `first + k * period`. */
export interface Device { kind: Source; uuid: string; rate_hz: number; first: number }
/** The camera: 30 frames a second, its first frame at 5 ms. */
export const CAMERA: Device = { kind: 'camera', uuid: 'C4A1E7D0-3B52-4F19-9E6A-2D8B0C7F1A35', rate_hz: 30, first: 5 * MS };
/** The microphone: 48 kHz in buffers of 480 samples, 100 buffers a second, its first at 1 ms. */
export const MICROPHONE: Device = { kind: 'microphone', uuid: 'A7F3B9C2-58E1-4D06-B2A4-6E0C9D1F8B73', rate_hz: 100, first: 1 * MS };
export const DEVICES: Record<Source, Device> = { camera: CAMERA, microphone: MICROPHONE };
export const periodOf = (d: Device): number => FLICKS / d.rate_hz;
export const itemName = (s: Source): string => (s === 'camera' ? 'frame' : 'sample buffer');

/** Every item time of `d` in [from, to). */
export function itemsOf(d: Device, from: number, to: number): number[] {
  const p = periodOf(d);
  const out: number[] = [];
  for (let k = Math.max(0, Math.ceil((from - d.first) / p)); d.first + k * p < to; k++) out.push(d.first + k * p);
  return out;
}

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: video call', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
/** The panel whose piece asks for the camera and microphone. */
export const PANEL = 'panel-call';

/** A feed: a token every item of that input carries (README: Items). 40 characters, random per test. */
export const newFeed = (tag: string): string => `${tag}-${randomBytes(16).toString('hex')}`.slice(0, 40);
export interface Feeds { camera: string; microphone: string; a: string; b: string }
export const newFeeds = (): Feeds => ({ camera: newFeed('cam'), microphone: newFeed('mic'), a: newFeed('dispA'), b: newFeed('dispB') });

// ---------------------------------------------------------------------------------------------------
// Scenarios (README: The surface under test)

export type Planted =
  | 'keeps_session_open' | 'records_for_agent' | 'records_without_permission'
  | 'records_without_hold' | 'records_past_max' | 'labels_redaction_complete';

export type Permission = 'granted' | 'denied' | 'undetermined';
export interface World {
  evidence: string;
  state?: string;
  feeds: Feeds;
  permissions?: { camera: Permission; microphone: Permission };
  planted?: Planted;
}

/** A scenario: #400's displays, clock and window, alpha, the camera and microphone with the OS's answer for each
 * (granted unless the world says otherwise), then the calls in `at` order. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  const display = (d: Display, feed: string): JsonObject => ({ uuid: d.uuid, bounds: d.bounds, scale: d.scale, refresh_hz: d.refresh_hz, next_vsync: d.next_vsync, color_space: d.color_space, feed });
  const device = (d: Device, feed: string): JsonObject => ({ kind: d.kind, uuid: d.uuid, rate_hz: d.rate_hz, first: d.first, feed });
  return {
    evidence: w.evidence, ...(w.state ? { state: w.state } : {}),
    sessions: SESSIONS, processes: PROCESSES, clock: CLOCK,
    displays: [display(A, w.feeds.a), display(B, w.feeds.b)], window: [1200, 700], panels: {},
    devices: [device(CAMERA, w.feeds.camera), device(MICROPHONE, w.feeds.microphone)],
    permissions: w.permissions ?? { camera: 'granted', microphone: 'granted' },
    ...(w.planted ? { planted: w.planted } : {}),
    calls: sorted,
  };
}

/**
 * Drives one world step by step on the virtual clock, as #105's suite does: each step's calls may be made from what
 * the steps before answered, and the whole scenario is played again from the start with them added; it reads no wall
 * time, so a replay answers the same. Returns each step's replies, in the order its calls were given.
 */
export class Driver {
  private calls: JsonObject[] = [];
  constructor(private readonly bin: string, private readonly world: World) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = scenario(this.world, [...this.calls, ...fresh]);
    const { replies } = runShow(this.bin, s, what);
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
}

// ---------------------------------------------------------------------------------------------------
// Calls (README: Calls and replies)

export const at = (call: string, t: number, extra: JsonObject = {}): JsonObject => ({ call, at: t, ...extra });
/** A panel's piece asks for the camera or the microphone. */
export const request = (t: number, source: Source, panel = PANEL): JsonObject => ({ call: 'capture', at: t, source, panel });
/** The same request, made by an agent's tool call in `session`. */
export const agentRequest = (t: number, source: Source, session: string, panel = PANEL): JsonObject => ({ call: 'capture', at: t, source, panel, tool: { session } });
/** The capture chord on the keyboard: it writes the HID key-state table (#105, #339). */
export const hid = (t: number, phase: 'down' | 'up'): JsonObject => ({ call: 'shortcut', at: t, phase, source: 'hid' });
/** A synthetic press of the chord: an event software posted, carrying the source state and pid its poster set. */
export const synthetic = (t: number, phase: 'down' | 'up', state: number, pid: number): JsonObject => ({ call: 'shortcut', at: t, phase, source: 'synthetic', state, pid });
/** #339's four forms of a synthetic press. */
export const FORMS = [
  { state: 0, pid: 4242 }, { state: 1, pid: 0 }, { state: 0, pid: 0 }, { state: 1, pid: 4242 },
] as const;

// ---------------------------------------------------------------------------------------------------
// Replies

/** The capture a granted request opened: its id, from the reply. */
export function openedOf(reply: JsonObject | undefined, what: string): string {
  const r = obj(reply, what);
  return str(r['capture'], `${what}: capture (the id of the capture the request opened)`);
}

export interface Asset { sha256: string; redaction: string; origin: string }
export interface Capture {
  capture: string; source: string; panel: string | null; via: string; hold: string; state: string;
  frames: number; first: number | null; last: number | null; asset: Asset | null;
}
/** The device captures in a `captures` reply (entries with source camera or microphone), each field read or failed by
 * name. */
export function capturesOf(reply: JsonObject | undefined, what: string): Capture[] {
  return arr(obj(reply, what)['captures'], `${what}: captures`).flatMap((v, i) => {
    const c = obj(v, `${what}: captures[${i}]`);
    const w = `${what}: captures[${i}]`;
    const source = str(c['source'], `${w}.source`);
    if (source !== 'camera' && source !== 'microphone') return [];
    const a = present(c, 'asset', w);
    const asset = a === null ? null : obj(a, `${w}.asset`);
    const nullableNum = (k: string): number | null => { const x = present(c, k, w); return x === null ? null : num(x, `${w}.${k}`); };
    const panel = present(c, 'panel', w);
    return [{
      capture: str(c['capture'], `${w}.capture`), source,
      panel: panel === null ? null : str(panel, `${w}.panel`),
      via: str(c['via'], `${w}.via`), hold: str(c['hold'], `${w}.hold`), state: str(c['state'], `${w}.state`),
      frames: num(c['frames'], `${w}.frames`), first: nullableNum('first'), last: nullableNum('last'),
      asset: asset && { sha256: str(asset['sha256'], `${w}.asset.sha256`), redaction: str(asset['redaction'], `${w}.asset.redaction`), origin: str(asset['origin'], `${w}.asset.origin`) },
    }];
  });
}

export function indicatorOf(reply: JsonObject | undefined, what: string): { system: boolean; app: boolean } {
  const i = obj(obj(reply, what)['indicator'], `${what}: indicator`);
  return { system: bool(i['system'], `${what}: indicator.system`), app: bool(i['app'], `${what}: indicator.app`) };
}

// ---------------------------------------------------------------------------------------------------
// What a run leaves on disk

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

// ---------------------------------------------------------------------------------------------------
// Items (README: Items)

export interface Item { uuid: string; t: number; feed: string }
/** The items a virtual recording holds, in order: one line `frame <uuid> <t> <feed>` each. */
export function itemsIn(bytes: Buffer, what: string): Item[] {
  const text = bytes.toString('utf8');
  expect(text.endsWith('\n') || text === '', `${what}: the recording ends with its last item's newline`).toBe(true);
  return text.split('\n').filter((l) => l !== '').map((l, i) => {
    const m = /^frame (\S+) (\d+) (\S*)$/.exec(l);
    expect(m, `${what}: item ${i + 1} reads \`frame <uuid> <t> <feed>\`, got ${JSON.stringify(l.slice(0, 200))}`).not.toBeNull();
    return { uuid: m![1]!, t: Number(m![2]!), feed: m![3]! };
  });
}

const ms = (flicks: number): string => (flicks / MS).toFixed(2);

/**
 * What is wrong with `items` as the recording of device `d` over a hold from `down` to `up` (the HID up, or where
 * `max` ends it): an item of another input or feed; one before the hold; one at or past `up` plus one period of `d`
 * (README: Items: "within one frame after release"), the first named; one missing between the first kept and the
 * last item before `up`; or a first later than 100 ms after `down` (`first_frame`). Messages for items kept too late
 * start with `after the release:`; for items kept too early, `before the hold:`.
 */
export function holdProblems(items: Item[], d: Device, feed: string, down: number, up: number, label: string): string[] {
  const f: string[] = [];
  const p = periodOf(d);
  const name = itemName(d.kind);
  const foreign = items.filter((it) => it.uuid !== d.uuid || it.feed !== feed);
  if (foreign.length > 0) f.push(`${label}: ${foreign.length} item(s) not of the ${d.kind}, the first of ${foreign[0]!.uuid} at ${foreign[0]!.t}`);
  const own = items.filter((it) => it.uuid === d.uuid && it.feed === feed);
  const early = own.filter((it) => it.t < down);
  if (early.length > 0) f.push(`before the hold: ${label} keeps ${early.length} ${d.kind} ${name}(s) from before the shortcut went down at ${down}, the first at ${early[0]!.t} (${ms(down - early[0]!.t)} ms before)`);
  const late = own.filter((it) => it.t >= up + p);
  if (late.length > 0) f.push(`after the release: ${label} keeps ${late.length} ${d.kind} ${name}(s) past one ${name} after the release at ${up}, the first at ${late[0]!.t} (${ms(late[0]!.t - up)} ms after the release)`);
  const inHold = own.filter((it) => it.t >= down && it.t < up).map((it) => it.t);
  if (inHold.length === 0) { f.push(`${label}: no ${d.kind} ${name} of the hold [${down}, ${up})`); return f; }
  if (inHold[0]! > down + 100 * MS) f.push(`${label}: the first ${name} is ${ms(inHold[0]! - down)} ms after the shortcut went down, past 100 ms (first_frame)`);
  const want = itemsOf(d, inHold[0]!, up);
  const missing = want.filter((t) => !inHold.includes(t));
  if (missing.length > 0) f.push(`${label}: ${missing.length} ${d.kind} ${name}(s) of the hold are missing, the first at ${missing[0]} (${ms(missing[0]! - down)} ms in)`);
  const times = own.map((it) => it.t);
  if (new Set(times).size !== times.length || times.some((t, i) => i > 0 && t <= times[i - 1]!)) f.push(`${label}: the ${d.kind}'s items are not in time order, each once`);
  return f;
}
