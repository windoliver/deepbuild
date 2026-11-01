// Test-side tools for the #498 device-gate acceptance tests (criteria 1, 5 and 9): `deep-show` built once per file and
// driven by one JSON scenario on stdin (`deep-show run`, #393's convention, with #400's displays and virtual clock and
// #401's panels and gesture serials); the calls this suite adds and parsers for their replies; the shipped plug-ins,
// read from the app's own panel inventory; WAV files written into and read from the evidence store; and the signal
// arithmetic the tests judge the gate's output with (tones, noise, a tape-style pitch shift, tone amplitudes). Nothing
// here stands in for the gate, the mixer, the comparer or the shipped panels: each is read from what `deep-show` answers
// or writes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rect = [number, number, number, number];
export type Point = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/498/gate is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
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
/** A field that must be present and either null or a number (a missing field fails, naming it). */
export function numOrNull(o: JsonObject, key: string, what: string): number | null {
  expect(key in o, `${what}: the field \`${key}\` is present (null or a number), got ${JSON.stringify(o).slice(0, 600)}`).toBe(true);
  return o[key] === null ? null : num(o[key], `${what}.${key}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of target/debug, as #105's and #401's
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
    dir = mkdtempSync(join(tmpdir(), 'deep-498-gate-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh evidence store per call (one per world, so a wrong program's run never sees the clean run's files), all
 * deleted after the test. */
export function useEvidence(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), 'deep-498-gate-ev-'));
    made.push(d);
    return d;
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

/** The one answer line of a run that exited 0. */
export function answerOf(r: Ran, what: string): JsonObject {
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 800)}; stderr: ${r.stderr.slice(-2000)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  return obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
}

const SURFACE = 'the panels\' `shipped` field and the `open`, `close`, `play`, `gate`, `output` and `reserved` calls, README: The surface under test';

/** `deep-show run`: exit 0, one line out, answered ok with one reply per call, in call order. */
export function runShow(bin: string, s: JsonObject, what: string): JsonObject[] {
  const answer = answerOf(runRaw(bin, s), what);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The clock, the displays, the window and the sessions (#400's and #401's, unchanged)

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000; // 705,600 flicks
export const SEC = FLICKS;
export const LEAD = 2 * MS;
export const CHECK = MS / 2;
export const CLOCK: JsonObject = { lead: LEAD, check: CHECK };
/** Seconds to whole flicks. */
export const secs = (s: number): number => Math.round(s * SEC);

interface Display { uuid: string; bounds: Rect; scale: number; refresh_hz: number; next_vsync: number; color_space: string }
const A: Display = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
const B: Display = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };

export const WINDOW: [number, number] = [1200, 700];
export const SLOTS: Rect[] = [[0, 0, 400, 350], [400, 0, 400, 350], [800, 0, 400, 350], [0, 350, 400, 350], [400, 350, 400, 350], [800, 350, 400, 350]];
export const centre = (r: Rect): Point => [r[0] + r[2] / 2, r[1] + r[3] / 2];

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: media', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];

// ---------------------------------------------------------------------------------------------------
// Scenarios (README: The surface under test)

export type Planted = 'shipped_panels_ungated' | 'comparer_matches_hash' | 'keeps_voices_on_switch' | 'fades_on_close';

/** A panel slot in the main window; with `shipped`, the slot holds that shipped panel (an ID from the app's inventory). */
export interface PanelSlot { rect: Rect; shipped?: string }

export interface World {
  evidence: string;
  panels: Record<string, PanelSlot>;
  planted?: Planted;
}

/** A scenario: #400's displays, clock and window, #401's panel slots and alpha, then the calls in `at` order. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: CLOCK,
    displays: [A, B].map((d) => ({ ...d }) as unknown as JsonObject), window: WINDOW,
    panels: Object.fromEntries(Object.entries(w.panels).map(([id, p]) => [id, { rect: p.rect, ...(p.shipped ? { shipped: p.shipped } : {}) }])),
    ...(w.planted ? { planted: w.planted } : {}),
    calls: sorted,
  };
}

/**
 * Drives one world step by step on the virtual clock, as #400's, #401's and #105's suites do: each step's calls may be
 * made from what the steps before answered (a serial), and the whole scenario is played again from the start with them
 * added; it reads no wall time, so a replay answers the same. Returns each step's replies, in the order its calls were
 * given.
 */
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
}

// ---------------------------------------------------------------------------------------------------
// Calls (README: Calls and replies)

export const at = (call: string, t: number, extra: JsonObject = {}): JsonObject => ({ call, at: t, ...extra });
const down = (t: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at: t, panel, event: { type: 'down', pos } });
const up = (t: number, panel: string, pos: Point): JsonObject => ({ call: 'input', at: t, panel, event: { type: 'up', pos } });
/** Your click in a panel (#401's): a press at its centre and, 60 ms later, its release. The press's reply holds its serial. */
export const click = (t: number, panel: string, slot: Rect): JsonObject[] => [down(t, panel, centre(slot)), up(t + 60 * MS, panel, centre(slot))];
export const CLICK_UP = 60 * MS;

/** A strip on a track (Strip and track): its asset by hash, placed at `start` on the document's time, playing the
 * source from `in` to `out`; a looping strip repeats [in, out) to the transport's end. Times in flicks. */
export interface Strip { track: number; asset: string; start: number; in: number; out: number; loop?: boolean }
const stripJson = (s: Strip): JsonObject => ({ track: s.track, src: { asset: s.asset }, start: s.start, in: s.in, out: s.out, ...(s.loop ? { loop: true } : {}) });
/** Opens a document of strips in a panel, replacing the one it shows. */
export const open = (t: number, panel: string, doc: string, strips: Strip[]): JsonObject => ({ call: 'open', at: t, panel, doc, strips: strips.map(stripJson) });
export const close = (t: number, panel: string): JsonObject => ({ call: 'close', at: t, panel });
/** Play on the panel's transport: with `serial`, you pressed Play (your input with that serial); with `session`, that
 * session's agent asks; with neither, the panel's own code asks (its script, a timer, an autoplay). */
export const play = (t: number, panel: string, by: { serial?: number; session?: string } = {}): JsonObject => ({
  call: 'play', at: t, panel, ...(by.serial === undefined ? {} : { serial: by.serial }), ...(by.session === undefined ? {} : { session: by.session }),
});
export const gate = (t: number, panel: string): JsonObject => ({ call: 'gate', at: t, panel });
/** What the gate passed to the device over [from, to), asked at `to`. */
export const output = (from: number, to: number): JsonObject => ({ call: 'output', at: to, from, to });
export const reserved = (t: number): JsonObject => ({ call: 'reserved', at: t });

// ---------------------------------------------------------------------------------------------------
// Replies

export const serialOf = (reply: JsonObject | undefined, what: string): number => num(obj(reply, what)['serial'], `${what}: serial (the input router's serial for your input)`);

/** A refusal: a string `code`, and no `playing: true` / `opened: true`. Null when it is not one. */
export function refusal(reply: JsonObject | undefined, what: string): string | null {
  const r = obj(reply, what);
  if (typeof r['code'] !== 'string') return null;
  if (r['playing'] === true || r['opened'] === true) return null;
  return r['code'];
}
export const playing = (reply: JsonObject | undefined, what: string): boolean => obj(reply, what)['playing'] === true && !('code' in obj(reply, what));
export const opened = (reply: JsonObject | undefined, what: string): boolean => obj(reply, what)['opened'] === true && !('code' in obj(reply, what));

export const STATES = ['suspended', 'running', 'interrupted', 'muted'] as const;
export interface Gate { owner: string; granted_by: number | null; state: string; reserved: string[] }
/** A `gate` reply: the Device gate's fields for the panel's owner. A missing field fails, naming it. */
export function gateOf(reply: JsonObject | undefined, what: string): Gate {
  const g = obj(obj(reply, what)['gate'], `${what}: gate`);
  const state = str(g['state'], `${what}: gate.state`);
  expect(STATES as readonly string[], `${what}: gate.state is one of ${STATES.join(', ')}`).toContain(state);
  return {
    owner: str(g['owner'], `${what}: gate.owner`),
    granted_by: numOrNull(g, 'granted_by', `${what}: gate`),
    state,
    reserved: arr(g['reserved'], `${what}: gate.reserved`).map((v, i) => str(v, `${what}: gate.reserved[${i}]`)),
  };
}

export interface ReservedSound { sound: string; for: string; sha256: string }
export function reservedOf(reply: JsonObject | undefined, what: string): ReservedSound[] {
  return arr(obj(reply, what)['reserved'], `${what}: reserved`).map((v, i) => {
    const r = obj(v, `${what}: reserved[${i}]`);
    return { sound: str(r['sound'], `${what}: reserved[${i}].sound`), for: str(r['for'], `${what}: reserved[${i}].for`), sha256: str(r['sha256'], `${what}: reserved[${i}].sha256`) };
  });
}

/** What reached the device: every channel's samples from sample `first`, at `sampleRate`, on the device's sample clock
 * (sample n plays at flick n × 705,600,000 ÷ sampleRate). */
export interface Heard { sampleRate: number; first: number; channels: Float32Array[]; frames: number }
/** An `output` reply, its WAV read from the evidence store by its hash and checked against the reply. */
export function outputOf(reply: JsonObject | undefined, evidence: string, from: number, to: number, what: string): Heard {
  const o = obj(obj(reply, what)['output'], `${what}: output`);
  const sampleRate = num(o['sample_rate'], `${what}: output.sample_rate`);
  expect(Number.isInteger(sampleRate) && sampleRate > 0 && FLICKS % sampleRate === 0, `${what}: output.sample_rate ${sampleRate} Hz divides a second's 705,600,000 flicks, so every sample has an exact time`).toBe(true);
  const first = num(o['first'], `${what}: output.first`);
  const frames = num(o['frames'], `${what}: output.frames`);
  const channels = num(o['channels'], `${what}: output.channels`);
  const sha = str(o['sha256'], `${what}: output.sha256`);
  expect(first, `${what}: output.first is the first sample at or after \`from\``).toBe(Math.ceil((from * sampleRate) / FLICKS));
  expect(first + frames, `${what}: output.first + output.frames is the first sample at or after \`to\``).toBe(Math.ceil((to * sampleRate) / FLICKS));
  const bytes = getAsset(evidence, sha, `${what}: output.sha256`);
  const wav = decodeWav(bytes, `${what}: the output WAV ${sha}`);
  expect(wav.sampleRate, `${what}: the output WAV's sample rate is output.sample_rate`).toBe(sampleRate);
  expect(wav.channels.length, `${what}: the output WAV's channel count is output.channels`).toBe(channels);
  expect(wav.frames, `${what}: the output WAV holds output.frames samples a channel`).toBe(frames);
  return { sampleRate, first, channels: wav.channels, frames };
}

/** The device sample a flick time falls on (the first sample at or after it). */
export const sampleAt = (h: Heard, t: number): number => Math.ceil((t * h.sampleRate) / FLICKS);
/** A sample at or under this magnitude is silence (−120 dBFS; 0 in 16-bit PCM). */
export const SILENCE = 2 ** -20;

/** The first sample in [from, to) where any channel is above silence, or null. */
export function firstSound(h: Heard, from: number, to: number): number | null {
  const a = Math.max(from, h.first);
  const b = Math.min(to, h.first + h.frames);
  for (let n = a; n < b; n++) for (const c of h.channels) if (Math.abs(c[n - h.first]!) > SILENCE) return n;
  return null;
}
/** The last sample in [from, to) where any channel is above silence, or null. */
export function lastSound(h: Heard, from: number, to: number): number | null {
  const a = Math.max(from, h.first);
  const b = Math.min(to, h.first + h.frames);
  for (let n = b - 1; n >= a; n--) for (const c of h.channels) if (Math.abs(c[n - h.first]!) > SILENCE) return n;
  return null;
}
/** How many samples in [from, to) are above silence on any channel. */
export function soundCount(h: Heard, from: number, to: number): number {
  const a = Math.max(from, h.first);
  const b = Math.min(to, h.first + h.frames);
  let k = 0;
  for (let n = a; n < b; n++) if (h.channels.some((c) => Math.abs(c[n - h.first]!) > SILENCE)) k++;
  return k;
}
/** The amplitude of a sine at `hz` in the channels' sum over [from, from + n) samples: a Hann-windowed single-bin DFT
 * (Goertzel's sum), scaled so a full sine of amplitude a reads a. */
export function toneIn(h: Heard, hz: number, from: number, n: number): number {
  let re = 0;
  let im = 0;
  let wsum = 0;
  for (let k = 0; k < n; k++) {
    const i = from + k - h.first;
    if (i < 0 || i >= h.frames) continue;
    let x = 0;
    for (const c of h.channels) x += c[i]!;
    x /= h.channels.length;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
    const ph = (2 * Math.PI * hz * (from + k)) / h.sampleRate;
    re += w * x * Math.cos(ph);
    im -= w * x * Math.sin(ph);
    wsum += w;
  }
  return wsum === 0 ? 0 : (2 * Math.hypot(re, im)) / wsum;
}
/** A sample index as seconds on the device clock, for messages. */
export const sAt = (h: Heard, n: number): string => `${(n / h.sampleRate).toFixed(4)} s`;

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<first 2 hex>/<other 62 hex>`, each file named by its bytes' SHA-256)

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
export function putAsset(evidence: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
export function getAsset(evidence: string, sha: string, what: string): Uint8Array {
  expect(/^[0-9a-f]{64}$/.test(sha), `${what} is a SHA-256 in lower-case hex: ${sha}`).toBe(true);
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${sha}`).toBe(true);
  const bytes = new Uint8Array(readFileSync(path));
  expect(sha256(bytes), `${what}: the file hashes to its name`).toBe(sha);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------
// WAV (RIFF WAVE): PCM 16-, 24- or 32-bit integer, or IEEE float 32-bit, interleaved, read; PCM 16-bit written.

export interface Wav { sampleRate: number; channels: Float32Array[]; frames: number }

export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const nch = channels.length;
  const frames = channels[0]!.length;
  const data = frames * nch * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * nch * 2, 28); b.writeUInt16LE(nch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (const c of channels) {
      const v = Math.max(-1, Math.min(1, c[i]!));
      b.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  return new Uint8Array(b);
}

export function decodeWav(bytes: Uint8Array, what: string): Wav {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE', `${what} is a RIFF WAVE file`).toBe(true);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    const body = b.subarray(o + 8, Math.min(b.length, o + 8 + size));
    if (id === 'fmt ') {
      let tag = body.readUInt16LE(0);
      if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24);
      fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt, `${what} has a fmt chunk`).not.toBeNull();
  expect(data, `${what} has a data chunk`).not.toBeNull();
  const { tag, nch, rate, bits } = fmt!;
  const ok = (tag === 1 && [16, 24, 32].includes(bits)) || (tag === 3 && bits === 32);
  expect(ok, `${what} is PCM 16/24/32-bit or IEEE float 32-bit, got format ${tag} at ${bits} bits`).toBe(true);
  expect(nch >= 1, `${what} has at least one channel`).toBe(true);
  const width = bits / 8;
  const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const o = (i * nch + c) * width;
      let v: number;
      if (tag === 3) v = data!.readFloatLE(o);
      else if (bits === 16) v = data!.readInt16LE(o) / 32768;
      else if (bits === 24) v = data!.readIntLE(o, 3) / 8388608;
      else v = data!.readInt32LE(o) / 2147483648;
      channels[c]![i] = v;
    }
  }
  return { sampleRate: rate, channels, frames };
}

// ---------------------------------------------------------------------------------------------------
// Signals

export const RATE = 48_000;
/** A sine of `hz` at amplitude `amp` for `seconds`, mono. */
export function tone(hz: number, seconds: number, amp: number, rate = RATE): Float32Array {
  const n = Math.round(seconds * rate);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}
/** White noise at peak `amp` for `seconds`, mono, from a fixed seed (xorshift32), so every run writes the same bytes. */
export function noise(seconds: number, amp: number, seed: number, rate = RATE): Float32Array {
  const n = Math.round(seconds * rate);
  const x = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    x[i] = amp * ((s / 4294967296) * 2 - 1);
  }
  return x;
}
/** A tone as a WAV asset in the evidence store; its hash. */
export const toneAsset = (evidence: string, hz: number, seconds: number, amp = 0.2): string => putAsset(evidence, encodeWav([tone(hz, seconds, amp)], RATE));

/**
 * The tape-style pitch shift: `x` played `ratio` times as fast at the same sample rate, so every frequency is multiplied
 * by `ratio` and the length divided by it (Strip and track: a rate ramp, "pitch follows the rate"). Band-limited
 * resampling: a Hann-windowed sinc, its cutoff lowered by the ratio when it is above 1 so nothing folds back.
 */
export function speedUp(x: Float32Array, ratio: number): Float32Array {
  const out = new Float32Array(Math.floor(x.length / ratio));
  const cutoff = Math.min(1, 1 / ratio); // of the Nyquist frequency
  const half = Math.ceil(32 / cutoff);
  for (let i = 0; i < out.length; i++) {
    const c = i * ratio;
    const k0 = Math.floor(c);
    let acc = 0;
    for (let k = k0 - half + 1; k <= k0 + half; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = c - k;
      const arg = Math.PI * cutoff * d;
      const sinc = d === 0 ? 1 : Math.sin(arg) / arg;
      const w = Math.abs(d) >= half ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / half);
      acc += x[k]! * cutoff * sinc * w;
    }
    out[i] = acc;
  }
  return out;
}
export const SEMITONE = 2 ** (1 / 12);
export const dB = (db: number): number => 10 ** (db / 20);
export const peak = (chs: Float32Array[]): number => chs.reduce((m, c) => c.reduce((a, v) => Math.max(a, Math.abs(v)), m), 0);

// ---------------------------------------------------------------------------------------------------
// The shipped plug-ins: the app's panel inventory (#882), checked current against the app's source first

export const INVENTORY = 'crates/deep-app/inventory.json';
/** Every shipped panel, by the ID the inventory gives it; fails when the inventory is stale against the app's source or
 * lists none. */
export function shippedPlugins(): string[] {
  const check = spawnSync(process.execPath, ['scripts/app-inventory.mjs', '--check'], { cwd: REPO, encoding: 'utf8' });
  expect(check.status, `node scripts/app-inventory.mjs --check: ${INVENTORY} matches the app's shipped panels: ${check.stdout}${check.stderr}`).toBe(0);
  const inv = obj(JSON.parse(readFileSync(join(REPO, INVENTORY), 'utf8')) as JsonValue, INVENTORY);
  const ids = arr(inv['panels'], `${INVENTORY}: panels`).map((p, i) => str(obj(p, `${INVENTORY}: panels[${i}]`)['panel'], `${INVENTORY}: panels[${i}].panel`));
  expect(ids.length, `${INVENTORY} lists at least one shipped panel; a sweep over none proves nothing`).toBeGreaterThan(0);
  expect(new Set(ids).size, `${INVENTORY} lists each shipped panel once`).toBe(ids.length);
  return ids;
}
