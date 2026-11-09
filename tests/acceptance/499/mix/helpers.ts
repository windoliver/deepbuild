// Test-side tools for the #499 "mix" acceptance tests (criteria 2, 4, 6, 9, 15 and 16): `deep-show` built once per file
// and driven by one JSON scenario on stdin (`deep-show run`, #393's convention, as #498's suites drive it); the media
// document these tests write (strips, buses, processors, emitters and their scene); the `media_mix` call (the export's
// sound), the gate's `open` with a media document, `play` and the new `handed` call; float WAVs read from the evidence
// store and checked against the hash the reply gives; and the formulas the tests judge samples by (the W3C distance and
// cone gains, the equal-power fade). Nothing here stands in for the mixer, a processor, a ring, an emitter or the gate:
// each is read from what `deep-show` answers or writes.

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
/** The checkout root (tests/acceptance/499/mix is four levels down). */
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
export function int(value: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(value), `${what} is a whole number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
/** A field that must be present and either null or a whole number (a missing field fails, naming it). */
export function intOrNull(o: JsonObject, key: string, what: string): number | null {
  expect(key in o, `${what}: the field \`${key}\` is present (null or a whole number), got ${JSON.stringify(o).slice(0, 600)}`).toBe(true);
  return o[key] === null ? null : int(o[key], `${what}.${key}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of target/debug, as #498's suites do; a
// test that uses a build that failed fails, naming it.

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
    dir = mkdtempSync(join(tmpdir(), 'deep-499-mix-bin-'));
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
    const d = mkdtempSync(join(tmpdir(), 'deep-499-mix-ev-'));
    made.push(d);
    return d;
  };
}

interface Ran { status: number | null; signal: string | null; stdout: string; stderr: string }
/** One run of `deep-show run` on one scenario line; a run that hangs is stopped by spawnSync's own timeout, which
 * signals only this child. */
function runRaw(bin: string, s: JsonObject, timeoutMs: number): Ran {
  const run = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify(s)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`deep-show run did not finish within ${timeoutMs} ms`);
  return { status: run.status, signal: run.signal, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

const SURFACE = 'the `media_mix` and `handed` calls, `open` with a `media` document, and the media document\'s strips, buses, processors, emitters and scene, README: The surface under test';

/** `deep-show run`: exit 0, one line out, answered ok with one reply per call, in call order. */
export function runShow(bin: string, s: JsonObject, what: string, timeoutMs = 1_800_000): JsonObject[] {
  const r = runRaw(bin, s, timeoutMs);
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 800)}; stderr: ${r.stderr.slice(-2000)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; at 48 kHz a sample is 14,700 flicks.

export const FLICKS = 705_600_000;
export const SEC = FLICKS;
export const MS = FLICKS / 1000;
export const RATE = 48_000;
export const SAMPLE = FLICKS / RATE; // 14,700 flicks
export const BLOCK = 128;
/** Seconds to whole flicks. */
export const secs = (s: number): number => Math.round(s * SEC);
/** Sample n's time in flicks. */
export const atSample = (n: number): number => n * SAMPLE;
/** The first sample at or after a time. */
export const sampleAt = (t: number): number => Math.ceil(t / SAMPLE);
/** A sample index as seconds, for messages. */
export const sOf = (n: number): string => `${(n / RATE).toFixed(6)} s (sample ${n})`;

export type Planted =
  | 'reverb_restores_without_tail' | 'ring_drops_oldest' | 'mixer_holds_gain_per_block'
  | 'emitter_always_inverse' | 'cone_sign_reversed';

// ---------------------------------------------------------------------------------------------------
// The media document (README: The media document). Times are flicks; keys are a channel's keys.

export type Key = { t: number; value: number | string | boolean; interp?: 'linear' | 'hold' };
export interface Strip {
  track: number; asset: string; start: number; in: number; out: number;
  rate?: [number, number]; gain?: number | { keys: Key[] }; pan?: number; loop?: boolean; span?: number; bus?: string;
  enabled?: boolean | { keys: Key[] };
}
export interface Bus { processors?: string[]; out?: string; layout?: 'stereo' | 'mono'; gain?: number; pan?: number }
export type Processor = JsonObject & { kind: string };
export interface Emitter {
  item: string; src: { strip: string };
  distance?: { model: 'inverse' | 'linear' | 'exponential'; ref?: number; max?: number; rolloff?: number };
  cone?: { inner: number; outer: number; outer_gain: number };
}
export interface SceneItem { position: [number, number, number]; yaw?: number | { keys: Key[] } }
export interface MediaDoc {
  transport?: { sample_rate?: number; span?: number };
  strips: Record<string, Strip>;
  buses?: Record<string, Bus>;
  processors?: Record<string, Processor>;
  emitters?: Record<string, Emitter>;
  scene?: { camera: { position: [number, number, number]; forward: [number, number, number] }; items: Record<string, SceneItem> };
}

function stripJson(s: Strip): JsonObject {
  const { asset, ...rest } = s;
  return { ...(rest as unknown as JsonObject), src: { asset } };
}
export function docJson(d: MediaDoc): JsonObject {
  return { ...(d as unknown as JsonObject), strips: Object.fromEntries(Object.entries(d.strips).map(([id, s]) => [id, stripJson(s)])) };
}

// ---------------------------------------------------------------------------------------------------
// `media_mix`: the export's sound, rendered offline on the virtual clock, as one transport playing and seeking through
// its segments in order (README: Calls and replies).

export interface Segment { from: number; to: number; write?: boolean }
export interface SegmentReply {
  from: number; to: number; first: number; frames: number; channels: number; sha256: string; wav: string | null;
  taps: Record<string, string>;
  /** Null for a segment that continues where the one before ended (or the first, from the transport's start). */
  seek: null | Record<string, { restored: number | null; rendered_from: number }>;
}
export interface Ring { budget: number; bytes: number; peak_bytes: number; spacing: number; checkpoints: { t: number; bytes: number }[] }
export interface ProcessorReply { kind: string; tail: number; latency: number; ring: Ring }
export interface Mix { sample_rate: number; channels: number; segments: SegmentReply[]; processors: Record<string, ProcessorReply> }

export const mixCall = (doc: MediaDoc, segments: Segment[]): JsonObject => ({
  call: 'media_mix', doc: docJson(doc), segments: segments.map((s) => ({ from: s.from, to: s.to, ...(s.write ? { write: true } : {}) })),
});

function segmentOf(v: JsonValue | undefined, want: Segment, what: string): SegmentReply {
  const g = obj(v, what);
  const from = int(g['from'], `${what}.from`);
  const to = int(g['to'], `${what}.to`);
  expect([from, to], `${what}: the segment's from and to are the ones asked`).toEqual([want.from, want.to]);
  const first = int(g['first'], `${what}.first`);
  const frames = int(g['frames'], `${what}.frames`);
  expect(first, `${what}: first is the first sample at or after from`).toBe(sampleAt(from));
  expect(first + frames, `${what}: first + frames is the first sample at or after to`).toBe(sampleAt(to));
  const wav = want.write ? str(g['wav'], `${what}.wav (asked with write: true)`) : (g['wav'] === undefined || g['wav'] === null ? null : str(g['wav'], `${what}.wav`));
  const taps = obj(g['taps'], `${what}.taps`);
  expect('seek' in g, `${what}: the field \`seek\` is present (null or an object)`).toBe(true);
  const seek = g['seek'] === null ? null : Object.fromEntries(Object.entries(obj(g['seek'], `${what}.seek`)).map(([id, p]) => {
    const o = obj(p, `${what}.seek.${id}`);
    return [id, { restored: intOrNull(o, 'restored', `${what}.seek.${id}`), rendered_from: int(o['rendered_from'], `${what}.seek.${id}.rendered_from`) }];
  }));
  return {
    from, to, first, frames, channels: int(g['channels'], `${what}.channels`), sha256: hex(g['sha256'], `${what}.sha256`), wav,
    taps: Object.fromEntries(Object.entries(taps).map(([id, h]) => [id, hex(h, `${what}.taps.${id}`)])), seek,
  };
}

/** A `media_mix` reply; a missing field fails, naming it. */
export function mixOf(reply: JsonObject | undefined, segments: Segment[], what: string): Mix {
  const m = obj(obj(reply, what)['mix'], `${what}: mix`);
  const sampleRate = int(m['sample_rate'], `${what}: mix.sample_rate`);
  expect(sampleRate, `${what}: mix.sample_rate is the transport's 48,000 Hz`).toBe(RATE);
  const segs = arr(m['segments'], `${what}: mix.segments`);
  expect(segs.length, `${what}: one segment reply per segment asked`).toBe(segments.length);
  const procs = obj(m['processors'], `${what}: mix.processors`);
  return {
    sample_rate: sampleRate,
    channels: int(m['channels'], `${what}: mix.channels`),
    segments: segs.map((v, i) => segmentOf(v, segments[i]!, `${what}: mix.segments[${i}]`)),
    processors: Object.fromEntries(Object.entries(procs).map(([id, p]) => {
      const o = obj(p, `${what}: mix.processors.${id}`);
      const r = obj(o['ring'], `${what}: mix.processors.${id}.ring`);
      const w = `${what}: mix.processors.${id}.ring`;
      return [id, {
        kind: str(o['kind'], `${what}: mix.processors.${id}.kind`),
        tail: int(o['tail'], `${what}: mix.processors.${id}.tail`),
        latency: int(o['latency'], `${what}: mix.processors.${id}.latency`),
        ring: {
          budget: int(r['budget'], `${w}.budget`), bytes: int(r['bytes'], `${w}.bytes`), peak_bytes: int(r['peak_bytes'], `${w}.peak_bytes`),
          spacing: int(r['spacing'], `${w}.spacing`),
          checkpoints: arr(r['checkpoints'], `${w}.checkpoints`).map((c, k) => {
            const x = obj(c, `${w}.checkpoints[${k}]`);
            return { t: int(x['t'], `${w}.checkpoints[${k}].t`), bytes: int(x['bytes'], `${w}.checkpoints[${k}].bytes`) };
          }),
        },
      }];
    })),
  };
}

/** One `media_mix` run in its own scenario (no clock: offline, as #498's decode calls). */
export function mix(bin: string, evidence: string, doc: MediaDoc, segments: Segment[], what: string, planted?: Planted): Mix {
  const [reply] = runShow(bin, { evidence, ...(planted ? { planted } : {}), calls: [mixCall(doc, segments)] }, planted ? `${what} (planted ${planted})` : what);
  return mixOf(reply, segments, planted ? `${what} (planted ${planted})` : what);
}

// ---------------------------------------------------------------------------------------------------
// PCM: a float WAV in the evidence store, tied to the segment's hash of its interleaved f32le samples.

export interface Pcm { first: number; frames: number; channels: Float32Array[] }

const hex = (v: JsonValue | undefined, what: string): string => {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is a SHA-256 in lower-case hex: ${s}`).toBe(true);
  return s;
};
export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The interleaved f32le bytes of channels (Export: "PCM as interleaved f32le"). */
export function interleaved(chs: Float32Array[]): Uint8Array {
  const frames = chs[0]?.length ?? 0;
  const b = Buffer.alloc(frames * chs.length * 4);
  let o = 0;
  for (let i = 0; i < frames; i++) for (const c of chs) { b.writeFloatLE(c[i]!, o); o += 4; }
  return new Uint8Array(b);
}

/** A segment's (or a `handed` reply's) WAV: IEEE float 32-bit, its rate, channels and length the reply's, and its
 * samples hashing (as interleaved f32le) to the reply's `sha256`. */
export function pcmOf(evidence: string, g: { first: number; frames: number; channels: number; sha256: string; wav: string | null }, what: string): Pcm {
  expect(g.wav, `${what}: a WAV was written (write: true)`).not.toBeNull();
  const wav = decodeWav(getAsset(evidence, g.wav!, `${what}: the WAV`), `${what}: the WAV ${g.wav}`);
  expect(wav.float, `${what}: the WAV is IEEE float 32-bit, the mix's own samples`).toBe(true);
  expect(wav.sampleRate, `${what}: the WAV's sample rate`).toBe(RATE);
  expect(wav.channels.length, `${what}: the WAV's channel count is the reply's`).toBe(g.channels);
  expect(wav.frames, `${what}: the WAV holds the reply's frames`).toBe(g.frames);
  expect(sha256(interleaved(wav.channels)), `${what}: the WAV's samples, interleaved f32le, hash to the reply's sha256`).toBe(g.sha256);
  return { first: g.first, frames: g.frames, channels: wav.channels };
}

/** The first sample (absolute index) where two PCMs over the same span differ on any channel, or null. */
export function firstDiff(a: Pcm, b: Pcm): number | null {
  expect([a.first, a.frames, a.channels.length], 'two PCMs compared cover the same samples').toEqual([b.first, b.frames, b.channels.length]);
  for (let i = 0; i < a.frames; i++) for (let c = 0; c < a.channels.length; c++) if (!Object.is(a.channels[c]![i], b.channels[c]![i])) return a.first + i;
  return null;
}

/** Mean power over [from, to) (absolute samples), summed over channels: an equal-power pan keeps it. */
export function power(p: Pcm, from: number, to: number): number {
  let s = 0;
  for (let n = from; n < to; n++) for (const c of p.channels) { const v = c[n - p.first]!; s += v * v; }
  return s / (to - from);
}
/** A sample at or under this magnitude is silence (−120 dBFS). */
export const SILENCE = 2 ** -20;
export function loudest(p: Pcm, from: number, to: number): number {
  let m = 0;
  for (let n = from; n < to; n++) for (const c of p.channels) m = Math.max(m, Math.abs(c[n - p.first]!));
  return m;
}
export const toDb = (g: number): number => 20 * Math.log10(g);

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<first 2 hex>/<other 62 hex>`, each file named by its bytes' SHA-256)

export function putAsset(evidence: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
export function getAsset(evidence: string, sha: string, what: string): Uint8Array {
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${sha}`).toBe(true);
  const bytes = new Uint8Array(readFileSync(path));
  expect(sha256(bytes), `${what}: the file hashes to its name`).toBe(sha);
  return bytes;
}

// ---------------------------------------------------------------------------------------------------
// WAV (RIFF WAVE): PCM 16-bit written for assets; PCM 16/24/32 or IEEE float 32-bit read.

export interface Wav { sampleRate: number; channels: Float32Array[]; frames: number; float: boolean }

/** PCM 16-bit, interleaved. */
export function encodeWav(channels: Float32Array[], sampleRate = RATE): Uint8Array {
  const nch = channels.length;
  const frames = channels[0]!.length;
  const data = frames * nch * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * nch * 2, 28); b.writeUInt16LE(nch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i]!)) * 32767), o); o += 2; }
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
  const width = bits / 8;
  const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const o = (i * nch + c) * width;
      channels[c]![i] = tag === 3 ? data!.readFloatLE(o) : bits === 16 ? data!.readInt16LE(o) / 32768 : bits === 24 ? data!.readIntLE(o, 3) / 8388608 : data!.readInt32LE(o) / 2147483648;
    }
  }
  return { sampleRate: rate, channels, frames, float: tag === 3 };
}

// ---------------------------------------------------------------------------------------------------
// Signals: assets the tests write, and read back as the decode worker reads them (16-bit sample ÷ 32,768).

export function tone(hz: number, frames: number, amp: number): Float32Array {
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE);
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

// ---------------------------------------------------------------------------------------------------
// The formulas (W3C Web Audio API, PannerNode: distance models and sound cones; Strip and track: the equal-power fade)

export function distanceGain(model: 'inverse' | 'linear' | 'exponential', d: number, ref: number, max: number, rolloff: number): number {
  if (model === 'linear') return 1 - (rolloff * (Math.max(Math.min(d, max), ref) - ref)) / (max - ref);
  if (model === 'exponential') return Math.pow(Math.max(d, ref) / ref, -rolloff);
  return ref / (ref + rolloff * (Math.max(d, ref) - ref));
}
/** The cone gain for an angle in degrees between the source's orientation and the direction from it to the listener. */
export function coneGain(angle: number, inner: number, outer: number, outerGain: number): number {
  const a = Math.abs(angle);
  const i = Math.abs(inner) / 2;
  const o = Math.abs(outer) / 2;
  if (a <= i) return 1;
  if (a >= o) return outerGain;
  const x = (a - i) / (o - i);
  return (1 - x) + outerGain * x;
}
/** The equal-power fade-out's gain at sample n of a fade of `len` samples ending at sample `end` (the first sample past
 * the strip): cos(π/2 · (n − (end − len)) / len), each sample at its own time. */
export const fadeOut = (n: number, end: number, len: number): number => Math.cos((Math.PI / 2) * ((n - (end - len)) / len));

// ---------------------------------------------------------------------------------------------------
// The live transport in a panel, through the device gate (#498's scenario: displays, clock, window, panel slots,
// your click and its serial; README: The live transport)

export type Rect = [number, number, number, number];
const A = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
const B = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
const SESSIONS: JsonObject = { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: media', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
export const SLOT: Rect = [0, 0, 400, 350];
export const CLICK_UP = 60 * MS;

export interface World { evidence: string; panel: string; planted?: Planted }
function scenario(w: World, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: { lead: 2 * MS, check: MS / 2 },
    displays: [A, B] as unknown as JsonValue, window: [1200, 700], panels: { [w.panel]: { rect: SLOT } },
    ...(w.planted ? { planted: w.planted } : {}), calls: sorted,
  };
}

/** Drives one world step by step on the virtual clock, as #498's gate suite does: each step's calls may use what the
 * steps before answered (a serial), and the whole scenario is played again from the start with them added. */
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

const centre = (r: Rect): [number, number] => [r[0] + r[2] / 2, r[1] + r[3] / 2];
/** Your click in the panel: a press at its centre and its release 60 ms later; the press's reply holds its serial. */
export const click = (t: number, panel: string): JsonObject[] => [
  { call: 'input', at: t, panel, event: { type: 'down', pos: centre(SLOT) } },
  { call: 'input', at: t + CLICK_UP, panel, event: { type: 'up', pos: centre(SLOT) } },
];
/** Opens a media document in the panel (#498's `open`, with `media` in place of `strips`). */
export const openMedia = (t: number, panel: string, doc: string, media: MediaDoc): JsonObject => ({ call: 'open', at: t, panel, doc, media: docJson(media) });
/** You pressed Play in the panel: the serial of your click there. */
export const play = (t: number, panel: string, serial: number): JsonObject => ({ call: 'play', at: t, panel, serial });
/** The PCM the panel's live transport handed the device gate over [from, to) of the document's time, asked at `at`. */
export const handed = (t: number, panel: string, from: number, to: number): JsonObject => ({ call: 'handed', at: t, panel, from, to });

export function handedOf(reply: JsonObject | undefined, from: number, to: number, what: string): SegmentReply {
  const h = obj(obj(reply, what)['handed'], `${what}: handed`);
  expect(int(h['sample_rate'], `${what}: handed.sample_rate`), `${what}: handed.sample_rate is the transport's`).toBe(RATE);
  const first = int(h['first'], `${what}: handed.first`);
  const frames = int(h['frames'], `${what}: handed.frames`);
  expect(first, `${what}: handed.first is the first sample at or after from`).toBe(sampleAt(from));
  expect(first + frames, `${what}: handed.first + handed.frames is the first sample at or after to`).toBe(sampleAt(to));
  return {
    from, to, first, frames, channels: int(h['channels'], `${what}: handed.channels`), sha256: hex(h['sha256'], `${what}: handed.sha256`),
    wav: str(h['wav'], `${what}: handed.wav`), taps: {}, seek: null,
  };
}
