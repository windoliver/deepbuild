// Test-side tools for #204's AC7 (README: The surface under test). One merged binary, `deep-show`, built once per
// file and driven by one JSON scenario per run on stdin (`deep-show run`, #393's convention as #501, #1163 and #502
// drive it): `deep show` from a test process standing in for an agent, `export` (#501, #502), `media_decode` (#498),
// `media_bake` (#500), and in the app world your click, `play` and `handed` (#498, #499, #1163). Also the engine
// fixture: the pack that carries its preset, written at test time, and the film that plays it. Nothing here stands in
// for the synth, the mix, the export, the decoder or the meter: each is read from what `deep-show` answers or writes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/204-redraft-ac7 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** AC7's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, white space collapsed). */
export const AC7 = 'AC7 #204.4e815a43';
/** Every `it` passes this: two exports, a decode, a bake and a live play, each a `deep-show run` of a debug build. */
export const TIMEOUT = 3_600_000;
/** One `deep-show run`, stopped by its own timeout (spawnSync signals only this child). */
const RUN_TIMEOUT = 1_800_000;

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, len = 1200): string => JSON.stringify(v)?.slice(0, len) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 800)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 800)}`).toBe(true);
  return v as JsonValue[];
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 800)}`).toBe('string');
  return v as string;
}
export function hex64(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is 32 bytes in lower-case hex, got ${s}`).toBe(true);
  return s;
}
/** A whole number as the issue writes it: 288,000. */
export const n = (x: number): string => x.toLocaleString('en-US');

export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 12).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's check must fail on it, and some failure must match `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the check fails the planted program, but it found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures were:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick) and the film's clock

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
/** Seconds as flicks; only for times that are whole flicks. */
export function fl(seconds: number): number {
  const f = Math.round(seconds * FLICKS);
  if (Math.abs(f - seconds * FLICKS) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return f;
}
/** The engine film: 320 × 180, 6 s at 30 fps, sound at 48 kHz (README: Fixtures). */
export const FILM = {
  size: [320, 180] as [number, number],
  rate: [30, 1] as [number, number],
  span: '6s',
  duration: fl(6),
  frames: 180,
  sampleRate: 48_000,
  samples: 288_000,
  samplesPerFrame: 1_600,
} as const;
/** The synth's param block (Synth `synth@1`, As built: the block rule): 128 samples. */
export const BLOCK = 128;
/** The car's speed: 0 m/s until 1.001 s, rising on a straight line to 30 m/s at 5.001 s, then held (README: Fixtures). */
export const RISE = { from: '1.001s', to: '5.001s', fromSample: 48_048, toSample: 240_048, top: 30 } as const;
/** The engine strip plays from 0 for 5.5 s. */
export const STRIP_SPAN = '5.5s';
/** The engine's pitch: 60 Hz plus 4 Hz per m/s. */
export const hzAt = (speed: number): number => 60 + 4 * speed;
export const secondsOf = (sample: number): string => (sample / FILM.sampleRate).toFixed(6);

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show`, once per file, copied out of the target folder (CARGO_TARGET_DIR
// honoured); a test whose build failed fails with cargo's error.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
export const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-show'];
export function useShow(): { bin: () => string } {
  let dir = '';
  let made = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-204-ac7-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    const bin = join(dir, exe('deep-show'));
    if (r.error) made = { bin, error: `cargo could not run: ${r.error.message}` };
    else if (r.status !== 0) made = { bin, error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}` };
    else { copyFileSync(join(targetDir(), 'debug', exe('deep-show')), bin); made = { bin, error: '' }; }
  }, 3 * 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(): string {
      expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
      return made.bin;
    },
  };
}
/** Fresh folders under one root for the whole file, deleted after it. */
export function useRoot(): () => string {
  let root = '';
  let k = 0;
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });
  return () => {
    if (!root) root = mkdtempSync(join(tmpdir(), 'deep-204-ac7-'));
    const d = join(root, String(k++));
    mkdirSync(d, { recursive: true });
    return d;
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test)

/** The planted wrong program (README: Planted program): the export renders synths with 64-sample blocks; live is unchanged. */
export const PLANTED = 'export_synth_block_64';
export type Planted = typeof PLANTED;

/** `deep-show run`: one scenario on stdin, a fresh hub in a fresh process; exit 0, one answer line, ok, one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = sc['planted'] ? `${what} (planted ${String(sc['planted'])})` : what;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: RUN_TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within ${RUN_TIMEOUT} ms`);
  if (r.error) throw Error(`${tag}: deep-show run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(replies.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
const ulid = (prefix: string, k: number): string => `${prefix}${String(k).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JC204D', 7);
/** The test agent (4300), its tool shell (4301) and the test process that runs `deep show` (4302), as #1163's world. */
const AGENT = 'sess-engine';
const SESSIONS: JsonObject = { [AGENT]: { thread: 'thread-engine', name: 'Test agent: engine sound', process: { pid: 4300, start: 1_000 } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4300, ppid: 3001, start: 1_000 },
  { pid: 4301, ppid: 4300, start: 1_100 }, { pid: 4302, ppid: 4301, start: 1_200 },
];
const IN_AGENT: JsonObject = { pid: 4302, start: 1_200 };
export const PANEL = 'main';

/** The pack folder the scenario offers the store before its first call (#306: `packs: [{id, dir}]`). */
export interface PackOffer { id: string; dir: string }
/** A scenario without a display clock: the agent, the film's panel `main`, the pack, the calls (#393, #501, #1163). */
export function scenario(evidence: string, pack: PackOffer, calls: JsonObject[], planted?: Planted): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: { [PANEL]: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: PANEL } },
    packs: [{ id: pack.id, dir: pack.dir }], calls, ...(planted ? { planted } : {}),
  };
}
/** `deep show` of a whole revision from the test process in the agent's tree (#393), with its issues. */
export const present = (document: JsonObject): JsonObject => ({ call: 'deep show', peer: IN_AGENT, doc: DOC, document, include: ['issues'] });
export const PACKS: JsonObject = { call: 'packs' };
export function presented(reply: JsonObject | undefined, packs: JsonObject | undefined, what: string): void {
  expect(obj(reply, what)['outcome'], `${what} is presented: ${show(reply, 2000)}; the pack store: ${show(packs, 1500)}`).toBe('presented');
}

// The app world for the live render (#400's virtual display clock, #498's gate, #499's `handed`, #1163's film playing
// in its own panel): two displays, the window with the film's panel, every call at a flick, replayed from the start
// with each step's calls added.
const DISPLAYS: JsonObject[] = [
  { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' },
  { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' },
];
const APP_PANEL_RECT = [0, 0, 960, 540];
function appScenario(evidence: string, pack: PackOffer, calls: JsonObject[], planted?: Planted): JsonObject {
  const at = (c: JsonObject): number => int(c['at'], 'a call\'s at');
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => at(p.c) - at(q.c) || p.i - q.i).map((p) => p.c);
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, clock: { lead: 2 * MS, check: MS / 2 }, displays: DISPLAYS, window: [1200, 700],
    panels: { [PANEL]: { rect: APP_PANEL_RECT } }, docs: { [DOC]: { panel: PANEL } }, packs: [{ id: pack.id, dir: pack.dir }],
    calls: sorted, ...(planted ? { planted } : {}),
  };
}
export class Driver {
  private calls: JsonObject[];
  private readonly bin: string;
  private readonly evidence: string;
  private readonly pack: PackOffer;
  private readonly planted: Planted | undefined;
  constructor(bin: string, evidence: string, pack: PackOffer, document: JsonObject, planted?: Planted) {
    this.bin = bin; this.evidence = evidence; this.pack = pack; this.planted = planted;
    this.calls = [{ ...present(document), at: 2 }, { ...PACKS, at: 3 }];
  }
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = appScenario(this.evidence, this.pack, [...this.calls, ...fresh], this.planted);
    const replies = runShow(this.bin, s, what);
    const sorted = arr(s['calls'], 'calls');
    const at = (call: string): JsonObject | undefined => replies[sorted.findIndex((c) => isObject(c) && c['call'] === call)];
    presented(at('deep show'), at('packs'), `${what}: the engine film`);
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
}
/** Your click in the film's panel at `t`: a press at its centre and its release 60 ms later; the press's reply holds its serial. */
export const click = (t: number): JsonObject[] => {
  const centre = [APP_PANEL_RECT[0]! + APP_PANEL_RECT[2]! / 2, APP_PANEL_RECT[1]! + APP_PANEL_RECT[3]! / 2];
  return [
    { call: 'input', at: t, panel: PANEL, event: { type: 'down', pos: centre } },
    { call: 'input', at: t + 60 * MS, panel: PANEL, event: { type: 'up', pos: centre } },
  ];
};
/** You pressed Play in the film's panel: the serial of your click there (#498's gate). */
export const play = (t: number, serial: number): JsonObject => ({ call: 'play', at: t, panel: PANEL, serial });
/** The PCM the panel's live transport handed the device gate over [from, to) of the film's time, asked at `t` (#499). */
export const handed = (t: number, from: number, to: number): JsonObject => ({ call: 'handed', at: t, panel: PANEL, from, to });

// ---------------------------------------------------------------------------------------------------
// The export (#501's surface, #502's loudness profile), the decode worker (#498) and the loudness bake (#500)

/** The whole film as an MP4 with PCM sound; `profile` names its loudness profile, or none is named (`none`). */
export const exportCall = (out: string, profile?: string): JsonObject =>
  ({ call: 'export', doc: DOC, out, video: { codec: 'h264' }, audio: { codec: 'pcm' }, ...(profile ? { loudness_profile: profile } : {}) });
/** The decode worker reads a delivered file back from its own bytes (#498's `media_decode`), its sound into `out`. */
export const decodeCall = (path: string, out: string): JsonObject => ({ call: 'media_decode', path, out, video_frames: 0 });

/** A sound per channel at its rate. */
export interface Sound { rate: number; channels: Float32Array[] }
/** A `media_decode` reply's one audio track, read from the raw interleaved f32le file it wrote into `out`. */
export function decodedSound(reply: JsonObject | undefined, out: string, what: string): Sound {
  const d = obj(obj(reply, what)['decoded'], `${what}: media_decode's decoded (${show(reply, 600)})`);
  const audio = arr(d['streams'], `${what}: decoded.streams`).filter((s): s is JsonObject => isObject(s) && s['type'] === 'audio');
  expect(audio.length, `${what}: the delivery holds one audio track`).toBe(1);
  const s = audio[0]!;
  const nch = int(s['channels'], `${what}: the audio track's channels`);
  const file = join(out, str(s['file'], `${what}: the audio track's file`));
  expect(existsSync(file), `${what}: the decode worker wrote ${file}`).toBe(true);
  const bytes = readFileSync(file);
  const frames = Math.floor(bytes.length / (4 * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) channels[c]![i] = bytes.readFloatLE(4 * (i * nch + c));
  return { rate: int(s['sample_rate'], `${what}: the audio track's sample_rate`), channels };
}

/** The loudness readings this suite holds a profile to. */
export interface Readings { integrated: number; true_peak: number; max_s: number }
/** A receipt's loudness: of the PCM it delivers, its profile, its one static gain, whether the limiter cut, and of the
 * decoded delivery (Loudness and caption profiles). */
export interface Loudness extends Readings { profile: string; gain: number; limiter_cut: boolean; delivery: Readings }
const readingsOf = (o: JsonObject, what: string): Readings => ({
  integrated: num(o['integrated'], `${what}.integrated (LUFS)`),
  true_peak: num(o['true_peak'], `${what}.true_peak (dBTP)`),
  max_s: num(o['max_s'], `${what}.max_s (LUFS)`),
});
export function loudnessOf(receipt: JsonObject, what: string): Loudness {
  const w = `${what}: receipt`;
  const profile = str(receipt['loudness_profile'], `${w}.loudness_profile`);
  const gain = num(receipt['gain'], `${w}.gain (dB)`);
  expect(typeof receipt['limiter_cut'], `${w}.limiter_cut is whether the limiter ever cut, a boolean, got ${show(receipt['limiter_cut'])}`).toBe('boolean');
  return { ...readingsOf(receipt, w), profile, gain, limiter_cut: receipt['limiter_cut'] === true, delivery: readingsOf(obj(receipt['delivery'], `${w}.delivery`), `${w}.delivery`) };
}
/** A delivered export's receipt: its PCM hashes (one SHA-256 per frame's span of interleaved f32le) and the rest raw. */
export function receiptOf(reply: JsonObject | undefined, what: string): { raw: JsonObject; pcm_hashes: string[] } {
  expect(obj(reply, what)['outcome'], `${what} is exported: ${show(reply, 2000)}`).toBe('exported');
  const raw = obj(reply!['receipt'], `${what}: receipt`);
  return { raw, pcm_hashes: arr(raw['pcm_hashes'], `${what}: receipt.pcm_hashes`).map((h, i) => hex64(h, `${what}: receipt.pcm_hashes[${i}]`)) };
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256), WAVs and PCM

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export function getEvidence(evidence: string, h: string, what: string): Buffer {
  const path = join(evidence, h.slice(0, 2), h.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${h}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(h);
  return bytes;
}
/** An IEEE float 32-bit WAV of `channels` at `rate`. */
export function floatWav(channels: Float32Array[], rate: number): Buffer {
  const nch = channels.length; const frames = channels[0]?.length ?? 0; const data = frames * nch * 4;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(nch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * nch * 4, 28); b.writeUInt16LE(nch * 4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) for (const c of channels) { b.writeFloatLE(c[i]!, o); o += 4; }
  return b;
}
/** A float 32-bit WAV's samples per channel. */
export function readWav(bytes: Buffer, what: string): Sound {
  expect(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', `${what} is a RIFF WAVE file`).toBe(true);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null; let data: Buffer | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4); const body = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    if (id === 'fmt ') { let tag = body.readUInt16LE(0); if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24); fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }; } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt !== null && data !== null, `${what} has fmt and data chunks`).toBe(true);
  const { tag, nch, rate, bits } = fmt!;
  expect(tag === 3 && bits === 32, `${what} is float 32-bit, got format ${tag} at ${bits} bits`).toBe(true);
  const frames = Math.floor(data!.length / (4 * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) channels[c]![i] = data!.readFloatLE((i * nch + c) * 4);
  return { rate, channels };
}
/** Interleaved f32le bytes of samples [from, to) (Export: "PCM as interleaved f32le"). */
export function interleaved(chs: Float32Array[], from: number, to: number): Buffer {
  const b = Buffer.alloc((to - from) * chs.length * 4);
  let o = 0;
  for (let i = from; i < to; i++) for (const c of chs) { b.writeFloatLE(c[i]!, o); o += 4; }
  return b;
}
/** The first sample index in [0, len) where two PCMs differ on any channel, bit for bit, or null. */
export function firstDiff(a: Float32Array[], b: Float32Array[], len: number): number | null {
  for (let i = 0; i < len; i++) for (let c = 0; c < Math.max(a.length, b.length); c++) if (!Object.is(a[c]?.[i], b[c]?.[i])) return i;
  return null;
}
/** The loudness bake's readings (#500's `media_bake`, the meter #500's suites hold to the EBU signals) of a sound put
 * in the store as a float WAV: integrated, true peak at 8×, and the short-term maximum. */
export function meter(bin: string, evidence: string, sound: Sound, what: string): Readings {
  const asset = putEvidence(evidence, floatWav(sound.channels, sound.rate));
  const [reply] = runShow(bin, { evidence, calls: [{ call: 'media_bake', bake: { asset, kind: 'loudness', tp_oversample: 8 } }] }, what);
  const b = obj(reply!['bake'], `${what}: bake (${show(reply, 600)})`);
  return { integrated: num(b['integrated'], `${what}: bake.integrated`), true_peak: num(b['true_peak'], `${what}: bake.true_peak`), max_s: num(b['short_term_max'], `${what}: bake.short_term_max`) };
}

// ---------------------------------------------------------------------------------------------------
// The engine fixture (README: Fixtures): the pack `acme/cars@1.0.0` carrying the preset `engine@1`, and the film whose
// strip plays `cars.engine@1` with its pitch from the car's speed channel.

export const PACK_ID = 'acme/cars';
export const PACK_VERSION = '1.0.0';
/** The document names the preset `<pack>.<name>@<major>` from the pack it pins. */
export const PRESET = 'cars.engine@1';
/** The engine preset: a sine oscillator whose `hz` is the preset's param `hz`, through a gain of 0.25 to `out`. */
const ENGINE_PRESET: JsonObject = {
  nodes: { tone: { osc: { wave: 'sine', hz: 'hz' } }, level: { gain: { gain: 0.25 } } },
  edges: [['tone', 'level', 'in']],
  out: 'level',
  params: { hz: { unit: 'Hz', range: [20, 400], default: 60 } },
  cost: 8,
};
/** Writes the pack's folder under `dir`: `pack.json`, its presets carried in the manifest as data. */
export function writePack(dir: string): PackOffer {
  const folder = join(dir, 'cars');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'pack.json'), `${JSON.stringify({
    name: 'cars', version: PACK_VERSION, license: 'CC0-1.0',
    description: 'The #204 AC7 acceptance suite\'s pack: one engine preset, a sine whose pitch is a param.',
    requires: { core: '>=0.0.0', modules: { media: '>=0.0.0' } },
    presets: { 'engine@1': ENGINE_PRESET },
  }, null, 2)}\n`);
  return { id: PACK_ID, dir: folder };
}

const rect = (id: string, name: string, order: string, box: number[], role: string): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
/** The engine film, as the agent sends it (no `layers`, no item `layer`; the hub stamps the writer layer). */
export function engineFilm(): JsonObject {
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [FILM.size[0] / 2, FILM.size[1] / 2, 0], view_width: FILM.size[0] } },
    rect('back', 'Road', 'a1', [0, 0, FILM.size[0], FILM.size[1]], 'ground'),
    rect('car', 'Car', 'a2', [40, 110, 120, 40], 'accent'),
    rect('dial', 'Speedometer scale', 'a3', [0, 28, 34, 4], 'muted'),
    rect('needle', 'Speedometer needle', 'a4', [0, 20, 3, 20], 'ink'),
  ];
  return {
    format: 1, profile: 'film', title: 'Engine sound',
    description: 'The #204 AC7 engine fixture: a car speeds up from 0 to 30 m/s over 4 s and its engine, a synth, follows.',
    size: FILM.size, camera: 'cam',
    transport: { span: FILM.span, frame_rate: FILM.rate, sample_rate: FILM.sampleRate },
    packs: [`${PACK_ID}@${PACK_VERSION}`],
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    // The car's speed in m/s, read by the engine's param; it also moves the speedometer needle one u per m/s.
    channels: {
      speed: {
        target: 'items/needle/params/box/0', type: 'f32',
        keys: { k0: { t: RISE.from, value: 0, interp: 'linear' }, k1: { t: RISE.to, value: RISE.top, interp: 'linear' } },
      },
    },
    strips: {
      engine: {
        track: 0,
        src: { synth: { preset: PRESET, params: { hz: '60 + 4 * speed' }, voices: 1, seed: 204 } },
        start: '0s', span: STRIP_SPAN,
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Reading the engine in a PCM

/** The mean square of one channel over [from, to). */
export function meanSquare(x: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return s / (to - from);
}
/** One channel's pitch over [from, to): its rising zero crossings a second, measured between the first and last. */
export function crossingsHz(x: Float32Array, from: number, to: number, rate: number): number {
  const up: number[] = [];
  for (let i = from + 1; i < to; i++) if (x[i - 1]! < 0 && x[i]! >= 0) up.push(i);
  if (up.length < 2) return 0;
  return ((up.length - 1) * rate) / (up[up.length - 1]! - up[0]!);
}
