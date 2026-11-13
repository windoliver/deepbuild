// Test-side tools for the #500 "spawn" acceptance tests (criteria 1, 6, 7 and 8): `deep-show` built once per file and
// driven by one JSON scenario on stdin (`deep-show run`, #393's convention, as #499's mix suite drives it); the media
// document #499's suite writes, extended with what these criteria name (baked occurrence lists, spawns, a time remap,
// the item that shows a body); the `media_mix` call and its new `voices`; float WAVs read from the evidence store and
// checked against the hash the reply gives; and the formulas the tests judge samples by (the W3C equal-power pan, a
// least-squares gain). Nothing here stands in for a spawn, a pick, a voice, a pan or the mixer: each is read from what
// `deep-show` answers or writes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/500/spawn is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const SHOW_BIN = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** Every `it` passes this timeout: a first build of `deep-show` on a shared Mac can take many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its test's name. */
export const AC = {
  1: 'AC1 #500.906a6d27',
  6: 'AC6 #500.c97829c4',
  7: 'AC7 #500.02d6db61',
  8: 'AC8 #500.f09e41f0',
} as const;

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
export function int(value: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(value), `${what} is a whole number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
const hex = (v: JsonValue | undefined, what: string): string => {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is a SHA-256 in lower-case hex: ${s}`).toBe(true);
  return s;
};

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of the target folder (honoring
// CARGO_TARGET_DIR), as #499's suites do; a test that uses a build that failed fails, naming it.

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
    dir = mkdtempSync(join(tmpdir(), 'deep-500-spawn-bin-'));
    error = cargoBuild();
    const target = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
    if (error === '') copyFileSync(join(target, 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, TIMEOUT);
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
    const d = mkdtempSync(join(tmpdir(), 'deep-500-spawn-ev-'));
    made.push(d);
    return d;
  };
}

const SURFACE = 'the `media_mix` call with `occurrences`, `spawns`, `remaps` and scene items\' `body`, and its reply\'s `voices`, README: The surface under test';

/** `deep-show run` on one scenario line: exit 0, one line out, answered ok with one reply per call, in call order. A run
 * that hangs is stopped by spawnSync's own timeout, which signals only this child. */
export function runShow(bin: string, s: JsonObject, what: string, timeoutMs = 1_800_000): JsonObject[] {
  const r = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify(s)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: deep-show run did not finish within ${timeoutMs} ms`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; at 48 kHz a sample is 14,700 flicks.

export const SEC = 705_600_000;
export const MS = SEC / 1000;
export const RATE = 48_000;
export const SAMPLE = SEC / RATE; // 14,700 flicks
/** Seconds to whole flicks. */
export const secs = (s: number): number => Math.round(s * SEC);
/** Sample n's time in flicks. */
export const atSample = (n: number): number => n * SAMPLE;
/** The first sample at or after a time. */
export const sampleAt = (t: number): number => Math.ceil(t / SAMPLE);
/** A time in flicks as seconds, for messages. */
export const sOf = (t: number): string => `${(t / SEC).toFixed(6)} s`;

export type Planted = 'spawn_ignores_cooldown' | 'spawn_pans_from_item_origin' | 'spawn_starts_at_child_flick';

// ---------------------------------------------------------------------------------------------------
// The media document (#499's, README: The media document), with this issue's fields. Times are flicks.

export type Key = { t: number; value: number; interp?: 'linear' | 'hold' };
/** A strip template: a strip's fields without `track` and `start` (Spawn: `play: strip template`). */
export interface Template { asset: string; in: number; out: number }
/** One row of a baked occurrence list (Occurrence list: columns `kind`, `a`, `b` and a payload by kind), at its flick. */
export interface Row { t: number; kind: 'hit'; a: number; b: number; point?: [number, number, number]; speed?: number; impulse?: number; tags?: string[] }
export interface Spawn {
  on: { list: string; kinds?: string[] };
  play: Template | { template: Template; weight?: number }[];
  pick?: 'weighted' | 'no_repeat';
  cooldown?: number; max_voices?: number; steal?: 'oldest' | 'furthest' | 'quietest' | 'none'; seed?: number;
  at?: 'point' | 'a' | 'b' | 'none'; distance?: 'none'; follow_remap?: boolean;
}
export interface SceneItem { position: [number, number, number]; body?: number }
export interface MediaDoc {
  transport: { sample_rate: number; span: number };
  occurrences: Record<string, Row[]>;
  spawns: Record<string, Spawn>;
  remaps?: Record<string, { target: string; map: { keys: Key[] } }>;
  scene?: { camera: { position: [number, number, number]; forward: [number, number, number] }; items: Record<string, SceneItem> };
}

const templateJson = (t: Template): JsonObject => ({ src: { asset: t.asset }, in: t.in, out: t.out });
function spawnJson(s: Spawn): JsonObject {
  const play: JsonValue = Array.isArray(s.play)
    ? s.play.map((p) => ({ template: templateJson(p.template), ...(p.weight === undefined ? {} : { weight: p.weight }) }))
    : templateJson(s.play);
  return { ...(s as unknown as JsonObject), play };
}
export function docJson(d: MediaDoc): JsonObject {
  return {
    ...(d as unknown as JsonObject), strips: {},
    spawns: Object.fromEntries(Object.entries(d.spawns).map(([id, s]) => [id, spawnJson(s)])),
  };
}

// ---------------------------------------------------------------------------------------------------
// `media_mix` (#499's call): the export's sound as one transport playing and seeking through its segments in order,
// and (new) every voice the spawns start.

export interface Segment { from: number; to: number; write?: boolean }
export interface SegmentReply { from: number; to: number; first: number; frames: number; channels: number; sha256: string; wav: string | null }
export interface Voice {
  spawn: string; occurrence: number; pair: [number, number]; template: number;
  start: number; end: number; rate: [number, number]; stolen_by: number | null;
}
export interface Mix { channels: number; segments: SegmentReply[]; voices: Voice[] }

function segmentOf(v: JsonValue | undefined, want: Segment, what: string): SegmentReply {
  const g = obj(v, what);
  const from = int(g['from'], `${what}.from`);
  const to = int(g['to'], `${what}.to`);
  expect([from, to], `${what}: the segment's from and to are the ones asked`).toEqual([want.from, want.to]);
  const first = int(g['first'], `${what}.first`);
  const frames = int(g['frames'], `${what}.frames`);
  expect(first, `${what}: first is the first sample at or after from`).toBe(sampleAt(from));
  expect(first + frames, `${what}: first + frames is the first sample at or after to`).toBe(sampleAt(to));
  const wav = want.write ? str(g['wav'], `${what}.wav (asked with write: true)`) : null;
  return { from, to, first, frames, channels: int(g['channels'], `${what}.channels`), sha256: hex(g['sha256'], `${what}.sha256`), wav };
}

function voiceOf(v: JsonValue | undefined, what: string): Voice {
  const o = obj(v, what);
  const pair = arr(o['pair'], `${what}.pair`).map((x, i) => int(x, `${what}.pair[${i}]`));
  expect(pair.length, `${what}.pair is [a, b]`).toBe(2);
  const rate = arr(o['rate'], `${what}.rate`).map((x, i) => int(x, `${what}.rate[${i}]`));
  expect(rate.length, `${what}.rate is a rational [p, q]`).toBe(2);
  expect('stolen_by' in o, `${what}: the field \`stolen_by\` is present (null or a voice index)`).toBe(true);
  return {
    spawn: str(o['spawn'], `${what}.spawn`), occurrence: int(o['occurrence'], `${what}.occurrence`),
    pair: [pair[0]!, pair[1]!], template: int(o['template'], `${what}.template`),
    start: int(o['start'], `${what}.start`), end: int(o['end'], `${what}.end`), rate: [rate[0]!, rate[1]!],
    stolen_by: o['stolen_by'] === null ? null : int(o['stolen_by'], `${what}.stolen_by`),
  };
}

/** One `media_mix` run in its own scenario (offline, as #499's mix suite runs it); a missing field fails, naming it. */
export function mix(bin: string, evidence: string, doc: MediaDoc, segments: Segment[], what: string, planted?: Planted): Mix {
  const label = planted ? `${what} (planted ${planted})` : what;
  const call: JsonObject = { call: 'media_mix', doc: docJson(doc), segments: segments.map((s) => ({ from: s.from, to: s.to, ...(s.write ? { write: true } : {}) })) };
  const [reply] = runShow(bin, { evidence, ...(planted ? { planted } : {}), calls: [call] }, label);
  const m = obj(obj(reply, label)['mix'], `${label}: mix`);
  expect(int(m['sample_rate'], `${label}: mix.sample_rate`), `${label}: mix.sample_rate is the transport's 48,000 Hz`).toBe(RATE);
  const segs = arr(m['segments'], `${label}: mix.segments`);
  expect(segs.length, `${label}: one segment reply per segment asked`).toBe(segments.length);
  return {
    channels: int(m['channels'], `${label}: mix.channels`),
    segments: segs.map((v, i) => segmentOf(v, segments[i]!, `${label}: mix.segments[${i}]`)),
    voices: arr(m['voices'], `${label}: mix.voices`).map((v, i) => voiceOf(v, `${label}: mix.voices[${i}]`)),
  };
}

// ---------------------------------------------------------------------------------------------------
// PCM: a float WAV in the evidence store, tied to the segment's hash of its interleaved f32le samples.

export interface Pcm { first: number; frames: number; channels: Float32Array[] }
export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function interleaved(chs: Float32Array[]): Uint8Array {
  const frames = chs[0]?.length ?? 0;
  const b = Buffer.alloc(frames * chs.length * 4);
  let o = 0;
  for (let i = 0; i < frames; i++) for (const c of chs) { b.writeFloatLE(c[i]!, o); o += 4; }
  return new Uint8Array(b);
}

/** A segment's WAV: IEEE float 32-bit at 48 kHz, its channels and length the reply's, and its samples hashing (as
 * interleaved f32le, Export's PCM hash) to the reply's `sha256`. */
export function pcmOf(evidence: string, g: SegmentReply, what: string): Pcm {
  expect(g.wav, `${what}: a WAV was written (write: true)`).not.toBeNull();
  const wav = decodeWav(getAsset(evidence, g.wav!, `${what}: the WAV`), `${what}: the WAV ${g.wav}`);
  expect(wav.float, `${what}: the WAV is IEEE float 32-bit, the mix's own samples`).toBe(true);
  expect(wav.sampleRate, `${what}: the WAV's sample rate`).toBe(RATE);
  expect(wav.channels.length, `${what}: the WAV's channel count is the reply's`).toBe(g.channels);
  expect(wav.frames, `${what}: the WAV holds the reply's frames`).toBe(g.frames);
  expect(sha256(interleaved(wav.channels)), `${what}: the WAV's samples, interleaved f32le, hash to the reply's sha256`).toBe(g.sha256);
  return { first: g.first, frames: g.frames, channels: wav.channels };
}

/** A sample at or under this magnitude is silence (−120 dBFS). */
export const SILENCE = 2 ** -20;

/** The least-squares gain k of y ≈ k·x over absolute samples [from, to) of one channel, and the residual's RMS relative
 * to y's (0 when y is exactly k·x). `model(n)` gives x at absolute sample n. */
export function fit(p: Pcm, ch: number, from: number, to: number, model: (n: number) => number): { k: number; residual: number } {
  let xy = 0, xx = 0, yy = 0;
  for (let n = from; n < to; n++) { const y = p.channels[ch]![n - p.first]!; const x = model(n); xy += x * y; xx += x * x; yy += y * y; }
  const k = xx > 0 ? xy / xx : 0;
  let rr = 0;
  for (let n = from; n < to; n++) { const e = p.channels[ch]![n - p.first]! - k * model(n); rr += e * e; }
  return { k, residual: yy > 0 ? Math.sqrt(rr / yy) : (rr > 0 ? Infinity : 0) };
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<first 2 hex>/<other 62 hex>`, each file named by its bytes' SHA-256)

function putAsset(evidence: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
function getAsset(evidence: string, sha: string, what: string): Uint8Array {
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${sha}`).toBe(true);
  const bytes = new Uint8Array(readFileSync(path));
  expect(sha256(bytes), `${what}: the file hashes to its name`).toBe(sha);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------
// WAV (RIFF WAVE): PCM 16-bit written for assets; PCM 16-bit or IEEE float 32-bit read.

interface Wav { sampleRate: number; channels: Float32Array[]; frames: number; float: boolean }

function encodeWav(channels: Float32Array[]): Uint8Array {
  const nch = channels.length;
  const frames = channels[0]!.length;
  const data = frames * nch * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * nch * 2, 28); b.writeUInt16LE(nch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i]!)) * 32767), o); o += 2; }
  return new Uint8Array(b);
}

function decodeWav(bytes: Uint8Array, what: string): Wav {
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
  expect((tag === 1 && bits === 16) || (tag === 3 && bits === 32), `${what} is PCM 16-bit or IEEE float 32-bit, got format ${tag} at ${bits} bits`).toBe(true);
  const width = bits / 8;
  const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) {
    const o = (i * nch + c) * width;
    channels[c]![i] = tag === 3 ? data!.readFloatLE(o) : data!.readInt16LE(o) / 32768;
  }
  return { sampleRate: rate, channels, frames, float: tag === 3 };
}

// ---------------------------------------------------------------------------------------------------
// Signals: assets the tests write, and read back as the decode worker reads them (16-bit sample ÷ 32,768).

/** A cosine tone (its first sample is its peak, so a voice is audible from its first sample). */
export function tone(hz: number, frames: number, amp: number): Float32Array {
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = amp * Math.cos((2 * Math.PI * hz * i) / RATE);
  return x;
}
/** White noise at peak `amp`, from a fixed seed (xorshift32), so every run writes the same bytes. */
export function noise(frames: number, amp: number, seed: number): Float32Array {
  const x = new Float32Array(frames);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < frames; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    x[i] = amp * ((s / 4294967296) * 2 - 1);
  }
  return x;
}
/** Writes channels as a 16-bit WAV asset; returns its hash and the samples as decoded from those bytes. */
export function asset(evidence: string, channels: Float32Array[]): { sha: string; samples: Float32Array[] } {
  const bytes = encodeWav(channels);
  return { sha: putAsset(evidence, bytes), samples: decodeWav(bytes, 'the test asset').channels };
}

/** A seeded generator in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Straight-through segments over [0, end) that cut at each window, then each window again in a seeded order (each a
 * seek, as #499's cone sweep plays and seeks): `played.get(from)` is the played window's hash for a seek's `from`. */
export function playThenSeek(windows: [number, number][], end: number, order: () => number): { segments: Segment[]; played: number } {
  const sorted = [...windows].sort((p, q) => p[0] - q[0]);
  const segments: Segment[] = [];
  let at = 0;
  for (const [from, to] of sorted) { if (from > at) segments.push({ from: at, to: from }); segments.push({ from, to }); at = to; }
  if (at < end) segments.push({ from: at, to: end });
  const played = segments.length;
  const shuffled = sorted.map((w) => ({ w, k: order() })).sort((p, q) => p.k - q.k).map((x) => x.w);
  for (const [from, to] of shuffled) segments.push({ from, to });
  return { segments, played };
}

// ---------------------------------------------------------------------------------------------------
// The Emitter's pan (Emitter: `pan: equal_power`, "using the W3C Web Audio formulas"): the W3C PannerNode's equal-power
// panning of a mono input. The listener is the camera; azimuth is the source's direction projected on the listener's
// horizontal plane, positive to its right, clamped to [−90°, 90°] (a source behind folds to the front, as W3C's does).

export function equalPower(camera: { position: [number, number, number]; forward: [number, number, number] }, at: [number, number, number]): [number, number] {
  const [fx, , fz] = camera.forward;
  const norm = Math.hypot(fx, fz);
  const f = [fx / norm, fz / norm] as const;
  const right = [-f[1], f[0]] as const; // forward × up, up = +y: forward (0, −1) in (x, z) gives right (1, 0)
  const d = [at[0] - camera.position[0], at[2] - camera.position[2]] as const;
  const x = d[0] * right[0] + d[1] * right[1];
  const z = d[0] * f[0] + d[1] * f[1];
  let azimuth = (Math.atan2(x, z) * 180) / Math.PI;
  if (azimuth > 90) azimuth = 180 - azimuth;
  else if (azimuth < -90) azimuth = -180 - azimuth;
  const t = (azimuth + 90) / 180;
  return [Math.cos((t * Math.PI) / 2), Math.sin((t * Math.PI) / 2)];
}
