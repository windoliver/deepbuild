// Test-side tools for the #1818 acceptance tests (criteria 1 to 7): `deep-show` built once per file and driven by one
// JSON scenario on stdin (`deep-show run`, as #499's and #500's suites drive it); the media document these tests write
// (strips, buses with their sends and loudness targets, and compressor, limiter, delay and pitch processors); the
// `media_mix` call (the export's sound) with its per-segment PCM hashes, per-processor taps and float WAVs; #500's
// `media_bake` for the true peak at 4×; deep_query on a path into a document's `buses` map; IEEE float WAV assets the
// tests write; and the readings the tests judge the master's samples by (levels, peaks, a spectrum's peak). Nothing
// here stands in for the mixer, a processor, a send, the master's limiter, the meter or deep_query: each is read from
// what `deep-show` answers or writes (README: The surface under test).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { arr, int, num, obj, pcmOf, putAsset, str, type JsonObject, type JsonValue, type Pcm } from '../499/mix/helpers.ts';

export { arr, num, obj, str, type JsonObject, type JsonValue, type Pcm };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1818 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW_BIN = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** Every `it` passes this timeout: a first build of `deep-show` on a shared Mac can take many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its test's name. */
export const AC = {
  1: 'AC1 #1818.0808feff',
  2: 'AC2 #1818.942b9d68',
  3: 'AC3 #1818.c9ace535',
  4: 'AC4 #1818.405eb9c0',
  5: 'AC5 #1818.45b936e3',
  6: 'AC6 #1818.3fad1c82',
  7: 'AC7 #1818.454109d9',
} as const;

/** The wrong programs, one per criterion, selected by name in the scenario (README: Planted programs). */
export type Planted =
  | 'limiter_holds_sample_peaks'
  | 'compressor_hard_knee'
  | 'mix_without_latency_compensation'
  | 'pitch_ignores_semitones'
  | 'send_always_post'
  | 'delay_empties_line_at_seek'
  | 'loudness_target_defaults_to_zero';

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of the target folder (honoring
// CARGO_TARGET_DIR), as #500's suites do; a test that uses a build that failed fails, naming it.

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
    dir = mkdtempSync(join(tmpdir(), 'deep-1818-bin-'));
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
    const d = mkdtempSync(join(tmpdir(), 'deep-1818-ev-'));
    made.push(d);
    return d;
  };
}

const SURFACE = 'the `media_mix` call on a media document with buses, sends and compressor, limiter, delay and pitch processors, `media_bake`, and deep_query on a `buses/<id>/loudness_target` path, README: The surface under test';

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

export const FLICKS = 705_600_000;
export const RATE = 48_000;
export const SAMPLE = FLICKS / RATE;
/** Seconds to whole flicks. */
export const secs = (s: number): number => Math.round(s * FLICKS);
/** The first sample at or after a time. */
export const sampleAt = (t: number): number => Math.ceil(t / SAMPLE);

// ---------------------------------------------------------------------------------------------------
// The media document (README: The media document): Strip and track, Bus and Processor fields, as #499's `media_mix`
// reads them. Times are flicks; gains and levels dB.

export interface Strip { track: number; asset: string; start?: number; gain?: number; bus: string }
export interface Send { to: string; gain: number; tap: 'pre' | 'post' }
export interface Bus {
  gain?: number; pan?: number; mute?: boolean; processors?: string[]; sends?: Send[]; out?: string; loudness_target?: number;
}
export type Processor = JsonObject & { kind: 'compressor' | 'limiter' | 'delay' | 'pitch' };
export interface MediaDoc { strips: Record<string, Strip>; buses: Record<string, Bus>; processors?: Record<string, Processor> }

/** A strip plays its asset from its start (`in` 0) to its end (`out` left to the source's length), so neither end fades. */
export function docJson(d: MediaDoc): JsonObject {
  const strips: JsonObject = {};
  for (const [id, s] of Object.entries(d.strips)) {
    strips[id] = { track: s.track, src: { asset: s.asset }, start: s.start ?? 0, in: 0, bus: s.bus, ...(s.gain === undefined ? {} : { gain: s.gain }) };
  }
  return { transport: { sample_rate: RATE }, strips, buses: d.buses as unknown as JsonObject, processors: (d.processors ?? {}) as unknown as JsonObject };
}

// ---------------------------------------------------------------------------------------------------
// `media_mix` (#499): one transport playing and seeking through its segments in order; each segment's interleaved f32le
// PCM hash, each processor's output hash over it (`taps`), and with `write: true` a float WAV in the evidence store.

export interface Segment { from: number; to: number; write?: boolean }
export interface SegmentReply { first: number; frames: number; channels: number; sha256: string; wav: string | null; taps: Record<string, string> }
export interface MixReply { segments: SegmentReply[]; processors: Record<string, { kind: string }> }

const hex64 = (v: JsonValue | undefined, what: string): string => {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is a SHA-256 in lower-case hex: ${s}`).toBe(true);
  return s;
};

/** A `media_mix` reply; a missing field this suite reads fails, naming it. */
export function mixOf(reply: JsonObject | undefined, segments: Segment[], what: string): MixReply {
  const r = obj(reply, what);
  expect('mix' in r, `${what}: media_mix answers a mix; got ${JSON.stringify(r).slice(0, 600)}`).toBe(true);
  const m = obj(r['mix'], `${what}: mix`);
  expect(int(m['sample_rate'], `${what}: mix.sample_rate`), `${what}: mix.sample_rate is the transport's 48,000 Hz`).toBe(RATE);
  const segs = arr(m['segments'], `${what}: mix.segments`);
  expect(segs.length, `${what}: one segment reply per segment asked`).toBe(segments.length);
  return {
    segments: segs.map((v, i) => {
      const w = `${what}: mix.segments[${i}]`;
      const g = obj(v, w);
      const first = int(g['first'], `${w}.first`);
      const frames = int(g['frames'], `${w}.frames`);
      expect([first, first + frames], `${w}: the segment covers the samples asked`).toEqual([sampleAt(segments[i]!.from), sampleAt(segments[i]!.to)]);
      const wav = segments[i]!.write ? str(g['wav'], `${w}.wav (asked with write: true)`) : null;
      const taps = obj(g['taps'], `${w}.taps`);
      return {
        first, frames, channels: int(g['channels'], `${w}.channels`), sha256: hex64(g['sha256'], `${w}.sha256`), wav,
        taps: Object.fromEntries(Object.entries(taps).map(([id, h]) => [id, hex64(h, `${w}.taps.${id}`)])),
      };
    }),
    processors: Object.fromEntries(Object.entries(obj(m['processors'], `${what}: mix.processors`)).map(([id, p]) =>
      [id, { kind: str(obj(p, `${what}: mix.processors.${id}`)['kind'], `${what}: mix.processors.${id}.kind`) }])),
  };
}

export interface MixAsk { doc: MediaDoc; segments: Segment[] }
/** Mixes, one `media_mix` call each, in one offline scenario. */
export function mixes(bin: string, evidence: string, asks: MixAsk[], what: string, planted?: Planted): MixReply[] {
  const label = planted ? `${what} (planted ${planted})` : what;
  const calls: JsonObject[] = asks.map((a) => ({
    call: 'media_mix', doc: docJson(a.doc), segments: a.segments.map((s) => ({ from: s.from, to: s.to, ...(s.write ? { write: true } : {}) })),
  }));
  return runShow(bin, { evidence, ...(planted ? { planted } : {}), calls }, label).map((r, i) => mixOf(r, asks[i]!.segments, `${label}: replies[${i}]`));
}

/** A written segment's samples, read from its WAV and tied to the segment's PCM hash (#499's `pcmOf`). */
export const pcm = (evidence: string, g: SegmentReply, what: string): Pcm => pcmOf(evidence, g, what);

// ---------------------------------------------------------------------------------------------------
// `media_bake` (#500): a loudness bake's true peak, the largest over channels at `tp_oversample`, in dBTP.

export function truePeak(bin: string, evidence: string, asset: string, oversample: 4 | 8, what: string): number {
  const [reply] = runShow(bin, { evidence, calls: [{ call: 'media_bake', bake: { asset, kind: 'loudness', tp_oversample: oversample } }] }, what);
  const b = obj(reply!['bake'], `${what}: bake`);
  expect(b['asset'], `${what}: bake.asset is the asset asked`).toBe(asset);
  return num(b['true_peak'], `${what}: bake.true_peak`);
}

// ---------------------------------------------------------------------------------------------------
// Signals: IEEE float 32-bit WAV assets at 48 kHz, so a level the test sets is the sample the mix reads.

export function floatWav(channels: Float32Array[]): Uint8Array {
  const nch = channels.length;
  const frames = channels[0]!.length;
  const data = frames * nch * 4;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * nch * 4, 28); b.writeUInt16LE(nch * 4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeFloatLE(c[i]!, o); o += 4; }
  return new Uint8Array(b);
}
/** Puts channels into the evidence store as a float WAV; its SHA-256. */
export const putSignal = (evidence: string, channels: Float32Array[]): string => putAsset(evidence, floatWav(channels));

/** amp · sin(2π · hz · n / rate + phase). */
export function sine(hz: number, frames: number, amp: number, phase = 0): Float32Array {
  const x = new Float32Array(frames);
  for (let n = 0; n < frames; n++) x[n] = amp * Math.sin((2 * Math.PI * hz * n) / RATE + phase);
  return x;
}
/** Silence with one sample of `amp` at `at`. */
export function impulse(frames: number, at: number, amp: number): Float32Array {
  const x = new Float32Array(frames);
  x[at] = amp;
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

// ---------------------------------------------------------------------------------------------------
// Readings over a PCM (absolute sample indices)

export const toDb = (g: number): number => 20 * Math.log10(g);
export const fmt = (db: number): string => (Number.isFinite(db) ? db.toFixed(3) : String(db));

/** Mean power over [from, to), averaged over channels. */
export function power(p: Pcm, from: number, to: number): number {
  let s = 0;
  for (const c of p.channels) for (let n = from; n < to; n++) { const v = c[n - p.first]!; s += v * v; }
  return s / ((to - from) * p.channels.length);
}
/** A steady sine's level: its amplitude over [from, to) from its mean power, in dBFS (a full-scale sine reads 0). */
export const sineLevel = (p: Pcm, from: number, to: number): number => 10 * Math.log10(2 * power(p, from, to));

/** The sample of largest magnitude on one channel over [from, to), and that magnitude. */
export function loudestOn(p: Pcm, channel: number, from: number, to: number): { at: number; value: number } {
  let at = from;
  let value = 0;
  const c = p.channels[channel]!;
  for (let n = from; n < to; n++) { const v = Math.abs(c[n - p.first]!); if (v > value) { value = v; at = n; } }
  return { at, value };
}

/** A channel's samples over [from, to). */
export const span = (p: Pcm, channel: number, from: number, to: number): Float32Array => p.channels[channel]!.subarray(from - p.first, to - p.first);

/**
 * The measured fundamental of a steady tone: the frequency of the largest peak of its Hann-windowed spectrum between
 * 50 Hz and 4 kHz (Goertzel power at each frequency), found coarse to fine: every 5 Hz on its first 0.1 s, then every
 * 0.5 Hz within 25 Hz of that and every 0.01 Hz within 0.5 Hz of that on the whole of it.
 */
export function fundamental(x: Float32Array): number {
  const windowed = (n: number): Float64Array => {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = x[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  };
  const peak = (w: Float64Array, from: number, to: number, step: number): number => {
    let best = from;
    let most = -1;
    for (let k = 0; from + k * step <= to + 1e-9; k++) {
      const hz = from + k * step;
      const c = 2 * Math.cos((2 * Math.PI * hz) / RATE);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < w.length; i++) { const s0 = w[i]! + c * s1 - s2; s2 = s1; s1 = s0; }
      const p = s1 * s1 + s2 * s2 - c * s1 * s2;
      if (p > most) { most = p; best = hz; }
    }
    return best;
  };
  const whole = windowed(x.length);
  const coarse = peak(windowed(Math.min(x.length, RATE / 10)), 50, 4000, 5);
  const medium = peak(whole, coarse - 25, coarse + 25, 0.5);
  return peak(whole, medium - 0.5, medium + 0.5, 0.01);
}

// ---------------------------------------------------------------------------------------------------
// deep_query (#411) on a document a release stored: #411's world (an agent's session, the process table, a panel) and
// one minted document holding the buses.

const SESSIONS: JsonObject = { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: mix buses', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }];
const PANELS: JsonObject = { main: { rect: [0, 0, 1200, 800] } };
/** A document the hub minted. */
export const DOC_ID = '01JC41D0000000000000001818';

/** One deep_query of `paths` at t = 0 by alpha's session, on `document` as stored; its reply's `values`. */
export function queryValues(bin: string, evidence: string, document: JsonObject, paths: string[], what: string, planted?: Planted): Record<string, JsonValue[]> {
  const label = planted ? `${what} (planted ${planted})` : what;
  const [reply] = runShow(bin, {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: { [DOC_ID]: { panel: 'main', document } },
    ...(planted ? { planted } : {}), calls: [{ call: 'deep_query', session: 'sess-alpha', doc: DOC_ID, paths }],
  }, label);
  const values = obj(reply!['values'], `${label}: the reply's values (${JSON.stringify(reply).slice(0, 800)})`);
  return Object.fromEntries(paths.map((p) => [p, arr(values[p], `${label}: values["${p}"]`)]));
}
