// Test-side tools for #499's clock part (criteria 1 and 11): `deep-show` (and, for criterion 11's headless run,
// `deep-logic`) built once per file; `deep-show run` driven by one JSON scenario on stdin, #498's gate surface with the
// test audio backend, the transport log, device changes and a logic item's full state added (README: The surface under
// test); the test devices' sample clocks, which are the hardware truth the transport is judged against; and WAV files
// read from the evidence store. Nothing here stands in for the transport, the gate, the mixer or the logic module: each
// is read from what the binaries answer or write.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import type { Piece } from './program.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rect = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/499/clock is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
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
/** A field that must be present and either null or a string (a missing field fails, naming it). */
export function strOrNull(o: JsonObject, key: string, what: string): string | null {
  expect(key in o, `${what}: the field \`${key}\` is present (null or a string), got ${JSON.stringify(o).slice(0, 600)}`).toBe(true);
  return o[key] === null ? null : str(o[key], `${what}.${key}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin <name>` once per file, copied out of target/debug, as #498's suites do; a test
// that uses a build that failed fails, naming it.

function cargoBuild(bin: string): string {
  const args = ['build', '--locked', '--bin', bin];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** A binary of the checkout for this file's tests, built once and copied into a temporary folder deleted after. */
export function useBin(bin: string): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `deep-499-clock-${bin}-`));
    error = cargoBuild(bin);
    const built = join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', exe(bin));
    if (error === '') copyFileSync(built, join(dir, exe(bin)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${bin}`).toBe('');
    return join(dir, exe(bin));
  };
}

/** A fresh evidence store per call (one per world, so a wrong program's run never sees the clean run's files), all
 * deleted after the test. */
export function useEvidence(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), 'deep-499-clock-ev-'));
    made.push(d);
    return d;
  };
}

export interface Ran { status: number | null; signal: string | null; stdout: string; stderr: string }
/** One run of a binary on JSON lines; a run that hangs is stopped by spawnSync's own timeout, which signals only this
 * child. */
export function runRaw(bin: string, args: string[], lines: JsonObject[], timeoutMs = 1_800_000): Ran {
  const run = spawnSync(bin, args, {
    cwd: REPO, input: lines.map((l) => `${JSON.stringify(l)}\n`).join(''), encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${bin} ${args.join(' ')} did not finish within ${timeoutMs} ms`);
  return { status: run.status, signal: run.signal, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/** The answer lines of a run that exited 0, one per input line. */
export function answersOf(r: Ran, count: number, what: string): JsonObject[] {
  expect(r.status, `${what}: exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 800)}; stderr: ${r.stderr.slice(-2000)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line per input line`).toBe(count);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: answer ${i}`));
}

const SURFACE = 'the scenario\'s `audio` test backend, `open`\'s `piece`, the gate\'s `notice`, `output`\'s `device`, and the `audio_device`, `transport` and `full_state` calls, README: The surface under test';

/** `deep-show run`: exit 0, one line out, answered ok with one reply per call, in call order. */
export function runShow(bin: string, s: JsonObject, what: string): JsonObject[] {
  const [answer] = answersOf(runRaw(bin, ['run'], [s]), 1, `${what}: deep-show run`);
  expect(answer!['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer!['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The clock, the displays, the window and the sessions (#400's and #401's, as #498's gate suite has them)

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000; // 705,600 flicks
export const SEC = FLICKS;
/** The transport's sample rate (Transport: `sample_rate: Hz = 48,000`) and every test device's here. */
export const RATE = 48_000;
/** Flicks a sample at 48 kHz: 14,700. */
export const SAMPLE = FLICKS / RATE;
/** One audio block: 128 samples (Sound and video on the picture's clock: Blocks), 1,881,600 flicks. */
export const BLOCK = 128 * SAMPLE;
/** One 60 Hz logic step: 11,760,000 flicks (16.7 ms). */
export const STEP = FLICKS / 60;
const LEAD = 2 * MS;
const CHECK = MS / 2;

interface Display { uuid: string; bounds: Rect; scale: number; refresh_hz: number; next_vsync: number; color_space: string }
const A: Display = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
const B: Display = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
const WINDOW: [number, number] = [1200, 700];
export const SLOT: Rect = [0, 0, 400, 350];
const centre = (r: Rect): [number, number] => [r[0] + r[2] / 2, r[1] + r[3] / 2];
const SESSIONS: JsonObject = { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: media', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];

// ---------------------------------------------------------------------------------------------------
// The test audio backend's devices (README: The test audio backend)

/**
 * A test output device. Its sample clock is the hardware truth: its k-th sample since it was connected (from host flick
 * 0 for a device in the scenario's `audio.devices`, from the `audio_device` call's `at` for one added later) plays at
 * host flick `connected + ⌊k × 705,600,000 × 10⁶ ÷ (rate × (10⁶ + ppm))⌋`.
 */
export interface TestDevice {
  id: string;
  /** Hz; it divides 705,600,000. */
  rate: number;
  /** Its crystal against host time, in whole parts per million: +100 plays 100 ppm more samples a host second. */
  ppm: number;
  /** Frames the device pulls a callback. */
  buffer: number;
  /** Output latency in samples: a buffer is pulled `latency + buffer` samples before its first sample plays. */
  latency: number;
  /** The most a callback's reported host time is off the true one, in flicks (a seeded error). */
  jitter: number;
  seed: number;
}

const PPM = 1_000_000n;
/** The host flick a device's k-th sample since it was connected plays at. */
export function playAt(d: TestDevice, connected: number, k: number): number {
  return connected + Number((BigInt(k) * BigInt(FLICKS) * PPM) / (BigInt(d.rate) * (PPM + BigInt(d.ppm))));
}
/** The first of a device's samples that plays at or after host flick `from` (0 for a time before it connected). */
export function firstAtOrAfter(d: TestDevice, connected: number, from: number): number {
  if (from <= connected) return 0;
  let k = Math.floor(((from - connected) * d.rate * (1e6 + d.ppm)) / (FLICKS * 1e6));
  while (k > 0 && playAt(d, connected, k - 1) >= from) k--;
  while (playAt(d, connected, k) < from) k++;
  return k;
}
/** How many samples the device has played by host flick `h`, as a real number: the position it plays at `h`. */
export const positionAt = (d: TestDevice, connected: number, h: number): number => ((h - connected) * d.rate * (1e6 + d.ppm)) / (FLICKS * 1e6);

// ---------------------------------------------------------------------------------------------------
// Scenarios

export type Planted = 'clock_follows_display' | 'backend_keeps_removed_device' | 'clock_restarts_from_sample_0';

export interface World {
  evidence: string;
  devices: TestDevice[];
  default: string;
  planted?: Planted;
}

const deviceJson = (d: TestDevice): JsonObject => ({ id: d.id, rate: d.rate, ppm: d.ppm, buffer: d.buffer, latency: d.latency, jitter: d.jitter, seed: d.seed });

/** A scenario: #498's gate world (displays, clock, window, one plain panel `player`) with the test audio backend, then
 * the calls in `at` order. */
export function scenario(w: World, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: { lead: LEAD, check: CHECK },
    displays: [A, B].map((d) => ({ ...d }) as unknown as JsonObject), window: WINDOW,
    panels: { player: { rect: SLOT } },
    audio: { backend: 'test', devices: w.devices.map(deviceJson), default: w.default },
    ...(w.planted ? { planted: w.planted } : {}),
    calls: sorted,
  };
}

/** Drives one world step by step on the virtual clock, as #498's gate suite does: each step's calls may be made from
 * what the steps before answered, and the whole scenario is played again from the start with them added. */
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

const PANEL = 'player';
/** Your click in the panel: a press at its centre and, 60 ms later, its release. The press's reply holds its serial. */
export const click = (t: number): JsonObject[] => [
  { call: 'input', at: t, panel: PANEL, event: { type: 'down', pos: centre(SLOT) } },
  { call: 'input', at: t + 60 * MS, panel: PANEL, event: { type: 'up', pos: centre(SLOT) } },
];
export const CLICK_UP = 60 * MS;

/** A strip (Strip and track): its asset by hash, placed at `start` on the document's time, playing its source from `in`
 * to `out`; a looping strip repeats [in, out) to the transport's end. Times in flicks. */
export interface Strip { track: number; asset: string; start: number; in: number; out: number; loop?: boolean }
const stripJson = (s: Strip): JsonObject => ({ track: s.track, src: { asset: s.asset }, start: s.start, in: s.in, out: s.out, ...(s.loop ? { loop: true } : {}) });
/** Opens a document of strips (and, with `piece`, logic items) in the panel. */
export const open = (t: number, doc: string, strips: Strip[], piece?: Piece): JsonObject => ({
  call: 'open', at: t, panel: PANEL, doc, strips: strips.map(stripJson), ...(piece ? { piece: piece as unknown as JsonObject } : {}),
});
/** Play, pressed by you: the serial of your click in the panel. */
export const play = (t: number, serial: number): JsonObject => ({ call: 'play', at: t, panel: PANEL, serial });
export const gate = (t: number): JsonObject => ({ call: 'gate', at: t, panel: PANEL });
/** What the device `device` played over host [from, to), asked at `to`. */
export const output = (device: string, from: number, to: number): JsonObject => ({ call: 'output', at: to, from, to, device });
/** The system's outputs change at `at`: a device is added, the default changes, a device is removed (in that order). */
export const audioDevice = (t: number, change: { add?: TestDevice; default?: string | null; remove?: string }): JsonObject => ({
  call: 'audio_device', at: t,
  ...(change.add ? { add: deviceJson(change.add) } : {}),
  ...(change.default !== undefined ? { default: change.default } : {}),
  ...(change.remove ? { remove: change.remove } : {}),
});
/** The panel's transport over host [from, to), asked at `to`: every vsync's frame and every logic step run. */
export const transport = (from: number, to: number): JsonObject => ({ call: 'transport', at: to, panel: PANEL, from, to });
/** A logic item's full state when this live play reached step `step`. */
export const fullState = (t: number, item: string, step: number): JsonObject => ({ call: 'full_state', at: t, panel: PANEL, item, step });

// ---------------------------------------------------------------------------------------------------
// Replies

export const serialOf = (reply: JsonObject | undefined, what: string): number => num(obj(reply, what)['serial'], `${what}: serial (the input router's serial for your input)`);
export const opened = (reply: JsonObject | undefined): boolean => isObject(reply) && reply['opened'] === true && !('code' in reply);
export const playing = (reply: JsonObject | undefined): boolean => isObject(reply) && reply['playing'] === true && !('code' in reply);

export interface Notice { code: string; device: string }
export interface Gate { granted_by: number | null; state: string; notice: Notice | null }
/** A `gate` reply: #498's fields this suite reads, and `notice`. A missing field fails, naming it. */
export function gateOf(reply: JsonObject | undefined, what: string): Gate {
  const g = obj(obj(reply, what)['gate'], `${what}: gate`);
  const state = str(g['state'], `${what}: gate.state`);
  expect(['suspended', 'running', 'interrupted', 'muted'], `${what}: gate.state is suspended, running, interrupted or muted`).toContain(state);
  expect('granted_by' in g, `${what}: gate.granted_by is present`).toBe(true);
  expect('notice' in g, `${what}: gate.notice is present (null, or the notice the gate shows)`).toBe(true);
  let notice: Notice | null = null;
  if (g['notice'] !== null) {
    const n = obj(g['notice'], `${what}: gate.notice`);
    notice = { code: str(n['code'], `${what}: gate.notice.code`), device: str(n['device'], `${what}: gate.notice.device`) };
  }
  return { granted_by: g['granted_by'] === null ? null : num(g['granted_by'], `${what}: gate.granted_by`), state, notice };
}

export const MASTERS = ['display', 'audio', 'virtual'] as const;
/** One vsync of the panel's display while its transport plays: the host time it presents at, the t its frame shows, the
 * clock that led and, under the audio master, the device. */
export interface Frame { at: number; t: number; master: string; device: string | null }
/** A logic step run: its item, its number, and the vsync whose frame ran it. */
export interface StepRun { item: string; step: number; at: number }
export function transportOf(reply: JsonObject | undefined, what: string): { frames: Frame[]; steps: StepRun[] } {
  const tr = obj(obj(reply, what)['transport'], `${what}: transport`);
  const frames = arr(tr['frames'], `${what}: transport.frames`).map((v, i) => {
    const f = obj(v, `${what}: transport.frames[${i}]`);
    const master = str(f['master'], `${what}: transport.frames[${i}].master`);
    expect(MASTERS as readonly string[], `${what}: transport.frames[${i}].master is display, audio or virtual`).toContain(master);
    return { at: num(f['at'], `${what}: frames[${i}].at`), t: num(f['t'], `${what}: frames[${i}].t`), master, device: strOrNull(f, 'device', `${what}: frames[${i}]`) };
  });
  const steps = arr(tr['steps'], `${what}: transport.steps`).map((v, i) => {
    const s = obj(v, `${what}: transport.steps[${i}]`);
    return { item: str(s['item'], `${what}: steps[${i}].item`), step: num(s['step'], `${what}: steps[${i}].step`), at: num(s['at'], `${what}: steps[${i}].at`) };
  });
  return { frames, steps };
}

/** A `full_state` reply: the item's full-state hash and its arrays at that step, or the refusal's code when it answers
 * one (`{"code": "not_reached"}`). */
export function fullStateOf(reply: JsonObject | undefined, what: string): { deep_hash: string; arrays: JsonObject } | { code: string } {
  const r = obj(reply, what);
  if (typeof r['code'] === 'string') return { code: r['code'] };
  const s = obj(r['full_state'], `${what}: full_state`);
  const deep = str(s['deep_hash'], `${what}: full_state.deep_hash`);
  expect(/^[0-9a-f]{16}$/.test(deep), `${what}: full_state.deep_hash is 16 lowercase hex digits`).toBe(true);
  return { deep_hash: deep, arrays: obj(s['arrays'], `${what}: full_state.arrays`) };
}

/** What a device played: every channel's samples from its sample `first` (counted since it connected). */
export interface Heard { device: TestDevice; connected: number; first: number; channels: Float32Array[]; frames: number }
/** An `output` reply for a test device, its WAV read from the evidence store by its hash and checked against the reply
 * and the device's own clock. */
export function outputOf(reply: JsonObject | undefined, evidence: string, d: TestDevice, connected: number, from: number, to: number, what: string): Heard {
  const o = obj(obj(reply, what)['output'], `${what}: output`);
  expect(o['device'], `${what}: output.device`).toBe(d.id);
  expect(num(o['sample_rate'], `${what}: output.sample_rate`), `${what}: output.sample_rate is the device's rate`).toBe(d.rate);
  const first = num(o['first'], `${what}: output.first`);
  const frames = num(o['frames'], `${what}: output.frames`);
  const channels = num(o['channels'], `${what}: output.channels`);
  expect(first, `${what}: output.first is the device's first sample playing at or after \`from\``).toBe(firstAtOrAfter(d, connected, from));
  expect(first + frames, `${what}: output.first + output.frames is its first sample playing at or after \`to\``).toBe(firstAtOrAfter(d, connected, to));
  const wav = decodeWav(getAsset(evidence, str(o['sha256'], `${what}: output.sha256`), `${what}: output.sha256`), `${what}: the output WAV`);
  expect(wav.sampleRate, `${what}: the output WAV's rate is output.sample_rate`).toBe(d.rate);
  expect(wav.channels.length, `${what}: the output WAV's channel count is output.channels`).toBe(channels);
  expect(wav.frames, `${what}: the output WAV holds output.frames samples a channel`).toBe(frames);
  return { device: d, connected, first, channels: wav.channels, frames };
}

/** A sample at or under this magnitude is silence (−120 dBFS; 0 in 16-bit PCM). */
export const SILENCE = 2 ** -20;
const loud = (h: Heard, n: number): boolean => h.channels.some((c) => Math.abs(c[n - h.first]!) > SILENCE);
/** The first device sample in [from, to) above silence on any channel, or null. */
export function firstSound(h: Heard, from = h.first, to = h.first + h.frames): number | null {
  for (let n = Math.max(from, h.first); n < Math.min(to, h.first + h.frames); n++) if (loud(h, n)) return n;
  return null;
}
/** The last device sample in [from, to) above silence on any channel, or null. */
export function lastSound(h: Heard, from = h.first, to = h.first + h.frames): number | null {
  for (let n = Math.min(to, h.first + h.frames) - 1; n >= Math.max(from, h.first); n--) if (loud(h, n)) return n;
  return null;
}
/** The host flick a heard sample played at. */
export const heardAt = (h: Heard, n: number): number => playAt(h.device, h.connected, n);

/** Flicks as seconds, for messages. */
export const s = (flicks: number): string => `${(flicks / SEC).toFixed(6)} s`;
/** A frame named for a message: its index in the transport log and the vsync it presented at. */
export const frameName = (i: number, f: Frame): string => `frame ${i} (vsync at host ${s(f.at)})`;

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
// WAV (RIFF WAVE): PCM 16-, 24- or 32-bit integer, or IEEE float 32-bit, interleaved, read; PCM 16-bit mono written.

export interface Wav { sampleRate: number; channels: Float32Array[]; frames: number }

export function encodeWav(x: Float32Array, sampleRate: number): Uint8Array {
  const data = x.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + 2 * i);
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
  expect((tag === 1 && [16, 24, 32].includes(bits)) || (tag === 3 && bits === 32), `${what} is PCM 16/24/32-bit or IEEE float 32-bit, got format ${tag} at ${bits} bits`).toBe(true);
  expect(nch >= 1, `${what} has at least one channel`).toBe(true);
  const width = bits / 8;
  const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const o = (i * nch + c) * width;
      channels[c]![i] = tag === 3 ? data!.readFloatLE(o) : bits === 16 ? data!.readInt16LE(o) / 32768 : bits === 24 ? data!.readIntLE(o, 3) / 8388608 : data!.readInt32LE(o) / 2147483648;
    }
  }
  return { sampleRate: rate, channels, frames };
}

/** A 1 s cosine at 440 Hz, amplitude 0.2, 48 kHz mono, as a WAV asset: a whole number of cycles, so it loops without a
 * seam, and its first sample is its peak, so its start is heard at once. Its hash. */
export function loopAsset(evidence: string): string {
  const x = new Float32Array(RATE);
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.cos((2 * Math.PI * 440 * i) / RATE);
  return putAsset(evidence, encodeWav(x, RATE));
}
