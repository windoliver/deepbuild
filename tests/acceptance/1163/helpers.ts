// Test-side tools for the #1163 checkpoint (README: The surface under test). One merged binary, `deep-show`, built
// once per file with the full set and driven by one JSON scenario per run on stdin (`deep-show run`, #393's
// convention as #501 and #1162 drive it): `deep show` from a test process standing in for an agent, deep_query,
// `export` (#501), `media_mix` and `handed` (#499), `eval`, `revisions`, `session` and the film viewer's keys. Also
// the film the issue's Scope describes, its sound assets synthesized here, and this suite's own readers: an ISO BMFF
// (MP4) box reader that counts frames and decodes PCM, a PNG reader, a WAV reader and BLAKE3. Nothing here stands in
// for the hub, the export, the mixer, the viewer or a check: each is read from what `deep-show` answers or writes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1163 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Every `it` passes this: a whole 1080p export in a debug build takes minutes, and a test makes several. */
export const TIMEOUT = 4 * 3_600_000;
/** One `deep-show run`, stopped by its own timeout (spawnSync signals only this child). */
const RUN_TIMEOUT = 2 * 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #1163.d0a72903',
  2: 'AC2 #1163.5c7e06ab',
  3: 'AC3 #1163.86d53f4f',
  4: 'AC4 #1163.dd932548',
  5: 'AC5 #1163.57ed0658',
  6: 'AC6 #1163.715560ce',
  7: 'AC7 #1163.cf2adc67',
  8: 'AC8 #1163.28f11e13',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, len = 1200): string => JSON.stringify(v)?.slice(0, len) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function int(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isSafeInteger(v), `${what} is a whole number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export function hex64(v: JsonValue | undefined, what: string): string {
  const s = str(v, what);
  expect(/^[0-9a-f]{64}$/.test(s), `${what} is 32 bytes in lower-case hex, got ${s}`).toBe(true);
  return s;
}
export const hexes = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((h, i) => hex64(h, `${what}[${i}]`));
/** A whole number as the issue writes it: 4,233,600,000. */
export const n = (x: number): string => x.toLocaleString('en-US');
/** Every string anywhere in a JSON value. */
export function stringsIn(v: JsonValue | undefined): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(stringsIn);
  if (isObject(v)) return Object.values(v).flatMap(stringsIn);
  return [];
}
/** A JSON value names `id` as one of its strings, or inside a string's words. */
export const mentions = (v: JsonValue | undefined, id: string): boolean =>
  stringsIn(v).some((s) => s === id || new RegExp(`(^|[^\\w-])${id.replace(/[-]/g, '\\-')}($|[^\\w-])`).test(s));

export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 12).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's check must fail on it, and some failure must match `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the check fails the planted program, but it found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures were:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Time: flicks (1/705,600,000 s) as integers (Time and the flick)

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
/** One beat at 120 BPM: 0.5 s. */
export const BEAT = 352_800_000;
/** Seconds as flicks; only for times that are whole flicks. */
export function fl(seconds: number): number {
  const f = Math.round(seconds * FLICKS);
  if (Math.abs(f - seconds * FLICKS) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return f;
}
/** The film: 2D, 20 s at 30 fps, 1920 × 1080, 48 kHz (the issue's Scope). */
export const FILM = {
  size: [1920, 1080] as [number, number],
  rate: [30, 1] as [number, number],
  frames: 600,
  frame: 23_520_000,
  duration: 14_112_000_000,
  sampleRate: 48_000,
  samples: 960_000,
  samplesPerFrame: 1_600,
  /** Frames [300, 330), the PNG range. */
  range: [300, 330] as [number, number],
  /** Frames [450, 480), the seek range: 15 s to 16 s. */
  seek: [450, 480] as [number, number],
  /** Shot 2's start: bar 4 (6 s). */
  shot2: 4_233_600_000,
  /** The title placement's start and the marker `title`: bar 3 beat 1 (4 s), frame 120. */
  title: 2_822_400_000,
  titleFrame: 120,
} as const;
/** A sample at 48 kHz in flicks. */
export const SAMPLE = FLICKS / FILM.sampleRate;

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, copied
// out of the target folder; a test that uses a build that failed fails with cargo's error.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
export const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
export function useShow(): { bin: () => string } {
  let dir = '';
  let made = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1163-bin-'));
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
/** Fresh folders under one root for the whole file (a file shares its first whole export), deleted after it. */
export function useRoot(): () => string {
  let root = '';
  let k = 0;
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });
  return () => {
    if (!root) root = mkdtempSync(join(tmpdir(), 'deep-1163-'));
    const d = join(root, String(k++));
    mkdirSync(d, { recursive: true });
    return d;
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test)

/** Scenario `planted` values this suite uses (README: Planted programs). */
export type Planted = 'video_drops_frame_300' | 'range_starts_one_frame_late' | 'reverb_restores_without_tail' | 'seeds_noise_from_clock';

/** `deep-show run`: one scenario on stdin, a fresh hub in a fresh process; exit 0, one answer line, ok, one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = sc['planted'] ? `${what} (planted ${String(sc['planted'])})` : what;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: RUN_TIMEOUT, killSignal: 'SIGKILL' });
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
export const DOC = ulid('01JB1163D', 1);
/** The test agent (4100), its tool shell (4101) and the test process that runs `deep show` (4102), as #1162's. */
export const AGENT = 'sess-film';
const SESSIONS: JsonObject = { [AGENT]: { thread: 'thread-film', name: 'Test agent: first film', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 },
];
const IN_AGENT: JsonObject = { pid: 4102, start: 1_200 };
export const PANEL = 'main';
const PANEL_RECT = [0, 0, 1280, 720];
/** A scenario without a display clock: the agent, the film's panel `main`, the calls (#393, #501). */
export function scenario(evidence: string, calls: JsonObject[], planted?: Planted): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: { [PANEL]: { rect: PANEL_RECT } }, docs: { [DOC]: { panel: PANEL } },
    calls, ...(planted ? { planted } : {}),
  };
}
/** `deep show` of a whole revision from the test process in the agent's tree (#393), with its issues. */
export const present = (document: JsonObject): JsonObject => ({ call: 'deep show', peer: IN_AGENT, doc: DOC, document, include: ['issues'] });
export function presented(reply: JsonObject | undefined, what: string): void {
  expect(obj(reply, what)['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}
export const query = (fields: JsonObject): JsonObject => ({ call: 'deep_query', session: AGENT, doc: DOC, ...fields });
export const REVISIONS: JsonObject = { call: 'revisions', doc: DOC };
export const session = (set?: JsonObject): JsonObject => ({ call: 'session', doc: DOC, ...(set ? { set } : {}) });
export const key = (k: string, mods: string[] = []): JsonObject => ({ call: 'input', panel: PANEL, event: { type: 'key', key: k, mods } });
export const VIEWER: JsonObject = { call: 'viewer', panel: PANEL };
/** The settled live frame at `t` (#387's `eval` with pixels, as #501 reads "the live frame"). */
export const liveFrame = (t: number): JsonObject => ({ call: 'eval', doc: DOC, t, pixels: true });

// The app world for the live transport (#400's virtual display clock, #498's gate, #499's `handed`): two displays,
// the main window with the film's panel, every call at a flick, replayed from the start with each step's calls added.
const DISPLAYS: JsonObject[] = [
  { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' },
  { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' },
];
const APP_PANEL_RECT = [0, 0, 960, 540];
function appScenario(evidence: string, calls: JsonObject[]): JsonObject {
  const at = (c: JsonObject): number => int(c['at'], 'a call\'s at');
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => at(p.c) - at(q.c) || p.i - q.i).map((p) => p.c);
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, clock: { lead: 2 * MS, check: MS / 2 }, displays: DISPLAYS, window: [1200, 700],
    panels: { [PANEL]: { rect: APP_PANEL_RECT } }, docs: { [DOC]: { panel: PANEL } }, calls: sorted,
  };
}
export class Driver {
  private calls: JsonObject[];
  private readonly bin: string;
  private readonly evidence: string;
  constructor(bin: string, evidence: string, document: JsonObject) {
    this.bin = bin; this.evidence = evidence;
    this.calls = [{ ...present(document), at: 2 }];
  }
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = appScenario(this.evidence, [...this.calls, ...fresh]);
    const replies = runShow(this.bin, s, what);
    const sorted = arr(s['calls'], 'calls');
    presented(replies[sorted.findIndex((c) => isObject(c) && c['call'] === 'deep show')], `${what}: the film`);
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

/** The current revision (`revisions`: exactly one row is current). */
export function currentOf(reply: JsonObject | undefined, what: string): { rev: number; hash: string } {
  const rows = arr(obj(reply, what)['revisions'], `${what}: revisions`).map((v, i) => obj(v, `${what}: revisions[${i}]`)).filter((r) => r['state'] === 'current');
  expect(rows.length, `${what}: exactly one revision is current: ${show(reply)}`).toBe(1);
  return { rev: int(rows[0]!['rev'], `${what}: the current revision's rev`), hash: str(rows[0]!['hash'], `${what}: the current revision's hash`) };
}

// ---------------------------------------------------------------------------------------------------
// The export call (#501's surface) and its receipt

export const exportWhole = (out: string, shards = 1): JsonObject =>
  ({ call: 'export', doc: DOC, out, video: { codec: 'h264' }, audio: { codec: 'pcm' }, ...(shards !== 1 ? { shards } : {}) });
export const exportPngRange = (out: string): JsonObject =>
  ({ call: 'export', doc: DOC, out, range: [`${FILM.range[0]}f`, `${FILM.range[1]}f`], video: { codec: 'png_seq' } });
export const exportStill = (out: string): JsonObject =>
  ({ call: 'export', doc: DOC, out, range: { still: { marker: 'title' } }, video: { codec: 'png_seq' } });
export const exportSeek = (out: string): JsonObject =>
  ({ call: 'export', doc: DOC, out, range: [`${FILM.seek[0]}f`, `${FILM.seek[1]}f`], video: { codec: 'h264' }, audio: { codec: 'pcm' } });

export interface Receipt { size: [number, number]; frame_rate: [number, number]; duration: number; frame_hashes: string[]; pcm_hashes: string[] }
/** A delivered export's receipt; a missing field fails, naming it. */
export function receiptOf(reply: JsonObject | undefined, what: string): Receipt {
  expect(obj(reply, what)['outcome'], `${what} is exported: ${show(reply)}`).toBe('exported');
  const r = obj(reply!['receipt'], `${what}: receipt`);
  return {
    size: arr(r['size'], `${what}: receipt.size`).map((v, i) => int(v, `${what}: receipt.size[${i}]`)) as [number, number],
    frame_rate: arr(r['frame_rate'], `${what}: receipt.frame_rate`).map((v, i) => int(v, `${what}: receipt.frame_rate[${i}]`)) as [number, number],
    duration: int(r['duration'], `${what}: receipt.duration (flicks)`),
    frame_hashes: hexes(r['frame_hashes'], `${what}: receipt.frame_hashes`),
    pcm_hashes: r['pcm_hashes'] === undefined ? [] : hexes(r['pcm_hashes'], `${what}: receipt.pcm_hashes`),
  };
}
/** Every file under `dir`, relative paths in name order. */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d).sort()) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p)); }
  };
  walk(dir);
  return out;
}
/** A png_seq export's PNGs under `out`, in name order (#501: names sort in frame order). */
export function pngFiles(out: string): Buffer[] {
  if (!existsSync(out)) return [];
  if (statSync(out).isFile()) return [readFileSync(out)];
  return readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort().map((f) => readFileSync(join(out, f)));
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256)

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

// ---------------------------------------------------------------------------------------------------
// Sound: the bed and the impulse, mono 16-bit WAVs at 48 kHz, made here (truth by construction)

/** The bed's loop region: the asset's whole 6 s (README: Fixtures). */
export const BED_FRAMES = 6 * FILM.sampleRate;
/** The bed's samples: 220 Hz and 330 Hz under a slow swell, each a whole number of cycles in 6 s, so the loop is seamless. */
export const BED: Int16Array = (() => {
  const s = new Int16Array(BED_FRAMES);
  for (let i = 0; i < BED_FRAMES; i++) {
    const t = i / FILM.sampleRate;
    const swell = 1 + 0.3 * Math.sin((2 * Math.PI * i) / BED_FRAMES);
    s[i] = Math.round(32767 * swell * (0.09 * Math.sin(2 * Math.PI * 220 * t) + 0.045 * Math.sin(2 * Math.PI * 330 * t)));
  }
  return s;
})();
/** A sample of the bed as a decoder gives it (Decode worker: an integer sample ÷ 2^(depth − 1)). */
export const bedAt = (i: number): number => BED[((i % BED_FRAMES) + BED_FRAMES) % BED_FRAMES]! / 32768;
/** The impulse: 0.25 at sample 0, then 0.25 s of silence; its height as a decoder gives it. */
export const IMPULSE_HEIGHT = 8192 / 32768;
const IMPULSE: Int16Array = (() => { const s = new Int16Array(12_000); s[0] = 8192; return s; })();
export function wav16(samples: Int16Array, rate = FILM.sampleRate): Buffer {
  const data = samples.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(samples[i]!, 44 + 2 * i);
  return b;
}
export const bedWav = (): Buffer => wav16(BED);
export const impulseWav = (): Buffer => wav16(IMPULSE);
/** A float or 16-bit PCM WAV's samples per channel. */
export function readWav(bytes: Buffer, what: string): { rate: number; channels: Float32Array[] } {
  expect(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', `${what} is a RIFF WAVE file`).toBe(true);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null; let data: Buffer | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4); const body = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    if (id === 'fmt ') { let tag = body.readUInt16LE(0); if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24); fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }; } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt !== null && data !== null, `${what} has fmt and data chunks`).toBe(true);
  const { tag, nch, rate, bits } = fmt!;
  expect((tag === 3 && bits === 32) || (tag === 1 && bits === 16), `${what} is float 32-bit or PCM 16-bit, got format ${tag} at ${bits} bits`).toBe(true);
  const width = bits / 8; const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) { const o = (i * nch + c) * width; channels[c]![i] = tag === 3 ? data!.readFloatLE(o) : data!.readInt16LE(o) / 32768; }
  return { rate, channels };
}
/** Interleaved f32le bytes of samples [from, to) (Export: "PCM as interleaved f32le"). */
export function interleaved(chs: Float32Array[], from: number, to: number): Buffer {
  const b = Buffer.alloc((to - from) * chs.length * 4);
  let o = 0;
  for (let i = from; i < to; i++) for (const c of chs) { b.writeFloatLE(c[i]!, o); o += 4; }
  return b;
}
/** The first sample index (from `from`) where two PCMs differ on any channel, or null. */
export function firstDiff(a: Float32Array[], aFrom: number, b: Float32Array[], bFrom: number, len: number): number | null {
  for (let i = 0; i < len; i++) for (let c = 0; c < Math.max(a.length, b.length); c++) if (!Object.is(a[c]?.[aFrom + i], b[c]?.[bFrom + i])) return i;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// The film (README: Fixtures): the one document the issue's Scope describes, sent as the agent sends it (no
// `layers`, no item `layer`; the hub stamps the writer layer).

export const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test sound made by the #1163 acceptance tests.' };
/** The dot rests at y 856 on the floor; the bounce clip's value at its local time 0 is 556, the top of the bounce. */
export const DOT = { rest: 856, top: 556 } as const;
const bezier = (x1: number, y1: number, x2: number, y2: number): JsonObject => ({ bezier: { x1, y1, x2, y2 } });
const FALL = bezier(0.55, 0, 1, 0.45);
const RISE = bezier(0, 0.55, 0.45, 1);
const rect = (id: string, name: string, order: string, box: number[], role: string): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
/** The bed's bus and its reverb, shared by the film and the sound twins. */
const BUSES: JsonObject = { bed: { processors: ['verb'], out: 'master' } };
const PROCESSORS: JsonObject = { verb: { kind: 'reverb', ir: { decay: 2.5, size: 0.7, damping: 0.4 }, mix: 0.3 } };
/** The processors on the bed's way to the master, in order: what a failure after a seek names. */
export const BED_PROCESSORS = ['verb'];
const bedStrip = (bed: string): JsonObject => ({ track: 1, src: { asset: bed }, start: 0, in: 0, out: fl(6), loop: true, bus: 'bed' });

export interface FilmOptions {
  /** A cue marker `hit` at this time (AC1). */
  cue?: string;
  /** The pull back's start, to make it overlap the pan outside any transition (AC1). */
  pullStart?: string;
}
export function film(bed: string, opts: FilmOptions = {}): JsonObject {
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [960, 540, 0], view_width: 1920 } },
    rect('backdrop', 'Backdrop', 'a1', [-800, -600, 3520, 2280], 'ground'),
    rect('floor', 'Floor', 'a2', [-800, 884, 3520, 24], 'ink'),
    rect('post-left', 'Left post', 'a3', [240, 660, 60, 224], 'ink'),
    rect('post-right', 'Right post', 'a4', [1620, 660, 60, 224], 'ink'),
    { id: 'dot', kind: 'circle@1', name: 'Bouncing dot', order: 'a5', params: { center: [0, 0], r: 28, paint: { fill: { role: 'accent' } } }, at: { pos: [760, DOT.rest, 0] } },
    {
      id: 'title', kind: 'text@1', name: 'Title', order: 'a6', params: { text: 'The first film', font: 'body', size: 96, box: { w: 900, h: 120 } },
      at: { pos: [510, 200, 0] }, adjust: { opacity: 0 },
    },
  ];
  return {
    format: 1, profile: 'film', title: 'The first film',
    description: 'The #1163 checkpoint film: three shots on a 120 BPM tempo map, a bouncing dot, a title and a looping sound bed.',
    size: FILM.size, camera: 'cam',
    transport: { span: '20s', frame_rate: FILM.rate, sample_rate: FILM.sampleRate },
    tempo_map: { segments: [{ at: '0s', bpm: 120, meter: [4, 4], span: 40, ramp: 'none' }] },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    markers: { title: { kind: 'section', t: '3:1b', name: 'Title' }, ...(opts.cue ? { hit: { kind: 'cue', t: opts.cue, name: 'Hit' } } : {}) },
    shots: {
      'shot-push': { start: '1:1b', end: '4:1b', camera: 'cam', move: 'push', target: [960, 540, 0], view_width: 1600 },
      'shot-pan': { start: '4:1b', end: '8:1b', camera: 'cam', move: 'pan', target: [1160, 540, 0], view_width: 1600 },
      'shot-pull': { start: opts.pullStart ?? '8:1b', end: '11:1b', camera: 'cam', move: 'pull', target: [960, 540, 0], view_width: 1920 },
    },
    transitions: {
      'push-to-pan': { from: 'shot-push', to: 'shot-pan', kind: 'cross_fade', span: '0.5s' },
      'pan-to-pull': { from: 'shot-pan', to: 'shot-pull', kind: 'cut' },
    },
    clips: {
      bounce: { span: '1s', channels: { y: { target: 'slot:ball/at/pos/1', type: 'f32', keys: { k0: { t: '0s', value: DOT.top, interp: FALL }, k1: { t: '0.5s', value: DOT.rest, interp: RISE }, k2: { t: '1s', value: DOT.top, interp: 'linear' } } } } },
      'title-card': {
        channels: {
          fade: { target: 'slot:text/adjust/opacity', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '0.5s', value: 1, interp: 'linear' } } },
          rise: { target: 'slot:text/at/pos/1', type: 'f32', keys: { k0: { t: '0s', value: 240, interp: RISE }, k1: { t: '0.5s', value: 200, interp: 'linear' } } },
        },
      },
    },
    placements: {
      'bounce-dot': { clip: 'bounce', slots: { ball: 'dot' }, start: '2:1b', repeat: { count: 8 } },
      'title-in': { clip: 'title-card', slots: { text: 'title' }, start: '3:1b', extend: { before: 'none', after: 'hold' } },
    },
    assets: { bed: { sha256: bed, license: LICENSE } },
    strips: { bed: bedStrip(bed) },
    buses: BUSES,
    processors: PROCESSORS,
  };
}
/** The film's sound as a media document (#499's `media_mix` document) running to `span`: `20s` is the film's own;
 * `21s` is the twin whose bed doesn't end at 20 s, so it has no fade there. */
export const filmSound = (bed: string, span: string): JsonObject =>
  ({ transport: { sample_rate: FILM.sampleRate, span }, strips: { bed: bedStrip(bed) }, buses: BUSES, processors: PROCESSORS });
/** The impulse through the bed's bus: a mono strip on `bed`, starting and ending at its own source's ends (no fade). */
export const impulseSound = (imp: string): JsonObject =>
  ({ transport: { sample_rate: FILM.sampleRate, span: '1s' }, strips: { imp: { track: 1, src: { asset: imp }, start: 0, in: 0, out: fl(0.25), bus: 'bed' } }, buses: BUSES, processors: PROCESSORS });
export const mixCall = (doc: JsonObject, from: number, to: number): JsonObject => ({ call: 'media_mix', doc, segments: [{ from, to, write: true }] });
/** A `media_mix` reply's one segment, read back from its float WAV. */
export function mixed(evidence: string, reply: JsonObject | undefined, frames: number, what: string): Float32Array[] {
  const seg = obj(arr(obj(obj(reply, what)['mix'], `${what}: mix`)['segments'], `${what}: mix.segments`)[0], `${what}: mix.segments[0]`);
  expect(int(seg['frames'], `${what}: frames`), `${what}: ${n(frames)} frames`).toBe(frames);
  const w = readWav(getEvidence(evidence, hex64(seg['wav'], `${what}: wav`), `${what}: its WAV`), `${what}: its WAV`);
  expect([w.rate, w.channels.length], `${what}: 48 kHz stereo`).toEqual([FILM.sampleRate, 2]);
  return w.channels;
}

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace) and the canonical raw buffer

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; } else if (type === 'IDAT') data.push(body); else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const ch = color === 6 ? 4 : 3; const stride = width * ch;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch]! : 0; const b = prev[i]!; const c = i >= ch ? prev[i - ch]! : 0; const x = line[i]!;
      line[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * ch]!; rgba[o + 1] = line[x * ch + 1]!; rgba[o + 2] = line[x * ch + 2]!; rgba[o + 3] = ch === 4 ? line[x * ch + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, rgba };
}
/** The canonical raw buffer of a decoded picture: BGRA8 rows top-down without padding (Export: Semantics). */
export function bgra(img: Image): Uint8Array {
  const b = new Uint8Array(img.rgba.length);
  for (let i = 0; i < img.rgba.length; i += 4) { b[i] = img.rgba[i + 2]!; b[i + 1] = img.rgba[i + 1]!; b[i + 2] = img.rgba[i]!; b[i + 3] = img.rgba[i + 3]!; }
  return b;
}
/** A decoded PNG's frame hash, as the export hashes a frame: BLAKE3 of its BGRA8 rows. */
export const pngHash = (file: Buffer): { width: number; height: number; hash: string } => {
  const img = decodePng(file);
  return { width: img.width, height: img.height, hash: blake3(bgra(img)) };
};

// ---------------------------------------------------------------------------------------------------
// BLAKE3: hash mode, 32-byte output. Ported from BLAKE3's reference implementation (reference_impl/reference_impl.rs
// at BLAKE3-team/BLAKE3 f3149ec5bb, by Jack O'Connor and Samuel Neves; CC0-1.0 OR Apache-2.0, license notice kept
// here), restructured over typed arrays for 1080p frames. It is checked against the published vectors before use.

const IV = Int32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const MSG_PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
/** The seven rounds' message word orders, flat: round r reads words SCHEDULE[16r … 16r + 15]. */
const SCHEDULE: Int32Array = (() => {
  const out: number[] = [];
  let s = Array.from({ length: 16 }, (_, i) => i);
  for (let r = 0; r < 7; r++) { out.push(...s); const prev = s; s = MSG_PERMUTATION.map((p) => prev[p]!); }
  return Int32Array.from(out);
})();
const CHUNK_START = 1; const CHUNK_END = 2; const PARENT = 4; const ROOT = 8;
const W = new Int32Array(16);
/** BLAKE3's compression of the block `m[mo .. mo + 16)` under `cv`; all 16 output words into `out`. The G function is
 * written out in place, a and c as additions mod 2^32, d and b as rotations right by 16, 12, 8 and 7. */
function compress(cv: Int32Array, m: Int32Array, mo: number, counter: number, len: number, flags: number, out: Int32Array): void {
  const w = W; const p = SCHEDULE;
  for (let i = 0; i < 16; i++) w[i] = m[mo + i]!;
  let s0 = cv[0]!; let s1 = cv[1]!; let s2 = cv[2]!; let s3 = cv[3]!; let s4 = cv[4]!; let s5 = cv[5]!; let s6 = cv[6]!; let s7 = cv[7]!;
  let s8 = IV[0]!; let s9 = IV[1]!; let s10 = IV[2]!; let s11 = IV[3]!;
  let s12 = counter | 0; let s13 = Math.floor(counter / 4294967296) | 0; let s14 = len; let s15 = flags;
  for (let o = 0; o < 112; o += 16) {
    s0 = (s0 + s4 + w[p[o]!]!) | 0; s12 ^= s0; s12 = (s12 >>> 16) | (s12 << 16); s8 = (s8 + s12) | 0; s4 ^= s8; s4 = (s4 >>> 12) | (s4 << 20);
    s0 = (s0 + s4 + w[p[o + 1]!]!) | 0; s12 ^= s0; s12 = (s12 >>> 8) | (s12 << 24); s8 = (s8 + s12) | 0; s4 ^= s8; s4 = (s4 >>> 7) | (s4 << 25);
    s1 = (s1 + s5 + w[p[o + 2]!]!) | 0; s13 ^= s1; s13 = (s13 >>> 16) | (s13 << 16); s9 = (s9 + s13) | 0; s5 ^= s9; s5 = (s5 >>> 12) | (s5 << 20);
    s1 = (s1 + s5 + w[p[o + 3]!]!) | 0; s13 ^= s1; s13 = (s13 >>> 8) | (s13 << 24); s9 = (s9 + s13) | 0; s5 ^= s9; s5 = (s5 >>> 7) | (s5 << 25);
    s2 = (s2 + s6 + w[p[o + 4]!]!) | 0; s14 ^= s2; s14 = (s14 >>> 16) | (s14 << 16); s10 = (s10 + s14) | 0; s6 ^= s10; s6 = (s6 >>> 12) | (s6 << 20);
    s2 = (s2 + s6 + w[p[o + 5]!]!) | 0; s14 ^= s2; s14 = (s14 >>> 8) | (s14 << 24); s10 = (s10 + s14) | 0; s6 ^= s10; s6 = (s6 >>> 7) | (s6 << 25);
    s3 = (s3 + s7 + w[p[o + 6]!]!) | 0; s15 ^= s3; s15 = (s15 >>> 16) | (s15 << 16); s11 = (s11 + s15) | 0; s7 ^= s11; s7 = (s7 >>> 12) | (s7 << 20);
    s3 = (s3 + s7 + w[p[o + 7]!]!) | 0; s15 ^= s3; s15 = (s15 >>> 8) | (s15 << 24); s11 = (s11 + s15) | 0; s7 ^= s11; s7 = (s7 >>> 7) | (s7 << 25);
    s0 = (s0 + s5 + w[p[o + 8]!]!) | 0; s15 ^= s0; s15 = (s15 >>> 16) | (s15 << 16); s10 = (s10 + s15) | 0; s5 ^= s10; s5 = (s5 >>> 12) | (s5 << 20);
    s0 = (s0 + s5 + w[p[o + 9]!]!) | 0; s15 ^= s0; s15 = (s15 >>> 8) | (s15 << 24); s10 = (s10 + s15) | 0; s5 ^= s10; s5 = (s5 >>> 7) | (s5 << 25);
    s1 = (s1 + s6 + w[p[o + 10]!]!) | 0; s12 ^= s1; s12 = (s12 >>> 16) | (s12 << 16); s11 = (s11 + s12) | 0; s6 ^= s11; s6 = (s6 >>> 12) | (s6 << 20);
    s1 = (s1 + s6 + w[p[o + 11]!]!) | 0; s12 ^= s1; s12 = (s12 >>> 8) | (s12 << 24); s11 = (s11 + s12) | 0; s6 ^= s11; s6 = (s6 >>> 7) | (s6 << 25);
    s2 = (s2 + s7 + w[p[o + 12]!]!) | 0; s13 ^= s2; s13 = (s13 >>> 16) | (s13 << 16); s8 = (s8 + s13) | 0; s7 ^= s8; s7 = (s7 >>> 12) | (s7 << 20);
    s2 = (s2 + s7 + w[p[o + 13]!]!) | 0; s13 ^= s2; s13 = (s13 >>> 8) | (s13 << 24); s8 = (s8 + s13) | 0; s7 ^= s8; s7 = (s7 >>> 7) | (s7 << 25);
    s3 = (s3 + s4 + w[p[o + 14]!]!) | 0; s14 ^= s3; s14 = (s14 >>> 16) | (s14 << 16); s9 = (s9 + s14) | 0; s4 ^= s9; s4 = (s4 >>> 12) | (s4 << 20);
    s3 = (s3 + s4 + w[p[o + 15]!]!) | 0; s14 ^= s3; s14 = (s14 >>> 8) | (s14 << 24); s9 = (s9 + s14) | 0; s4 ^= s9; s4 = (s4 >>> 7) | (s4 << 25);
  }
  out[0] = s0 ^ s8; out[1] = s1 ^ s9; out[2] = s2 ^ s10; out[3] = s3 ^ s11; out[4] = s4 ^ s12; out[5] = s5 ^ s13; out[6] = s6 ^ s14; out[7] = s7 ^ s15;
  out[8] = s8 ^ cv[0]!; out[9] = s9 ^ cv[1]!; out[10] = s10 ^ cv[2]!; out[11] = s11 ^ cv[3]!; out[12] = s12 ^ cv[4]!; out[13] = s13 ^ cv[5]!; out[14] = s14 ^ cv[6]!; out[15] = s15 ^ cv[7]!;
}
function blake3Raw(input: Uint8Array): string {
  const len = input.length;
  const padded = new Uint8Array(Math.max(64, Math.ceil(len / 64) * 64));
  padded.set(input);
  const words = new Int32Array(padded.buffer, 0, padded.length / 4);
  const chunks = Math.max(1, Math.ceil(len / 1024));
  const stack: Int32Array[] = [];
  const cv = new Int32Array(8); const out = new Int32Array(16); const block = new Int32Array(16);
  let last = { cv: new Int32Array(8), m: words, mo: 0, counter: 0, len: 0, flags: 0 };
  for (let c = 0; c < chunks; c++) {
    cv.set(IV);
    const start = c * 1024; const end = Math.min(len, start + 1024);
    const blocks = Math.max(1, Math.ceil((end - start) / 64));
    for (let b = 0; b < blocks; b++) {
      const o = start + 64 * b; const bl = Math.min(64, end - o);
      const flags = (b === 0 ? CHUNK_START : 0) | (b === blocks - 1 ? CHUNK_END : 0);
      if (b === blocks - 1) last = { cv: Int32Array.from(cv), m: words, mo: o / 4, counter: c, len: bl, flags };
      else { compress(cv, words, o / 4, c, 64, flags, out); cv.set(out.subarray(0, 8)); }
    }
    if (c === chunks - 1) break;
    compress(last.cv, last.m, last.mo, last.counter, last.len, last.flags, out);
    let chunkCv = Int32Array.from(out.subarray(0, 8));
    let total = c + 1;
    while ((total & 1) === 0) {
      block.set(stack.pop()!, 0); block.set(chunkCv, 8);
      compress(IV, block, 0, 0, 64, PARENT, out);
      chunkCv = Int32Array.from(out.subarray(0, 8));
      total >>= 1;
    }
    stack.push(chunkCv);
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    compress(last.cv, last.m, last.mo, last.counter, last.len, last.flags, out);
    const m = new Int32Array(16); m.set(stack[i]!, 0); m.set(out.subarray(0, 8), 8);
    last = { cv: Int32Array.from(IV), m, mo: 0, counter: 0, len: 64, flags: PARENT };
  }
  compress(last.cv, last.m, last.mo, 0, last.len, last.flags | ROOT, out);
  const bytes = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) bytes.writeUInt32LE(out[i]! >>> 0, 4 * i);
  return bytes.toString('hex');
}
/** BLAKE3's published vectors (test_vectors/test_vectors.json at f3149ec5bb; the input is 0, 1, …, 250 repeating). */
const VECTORS = [
  { bytes: 0, digest: 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262' },
  { bytes: 1024, digest: '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7' },
  { bytes: 4096, digest: '015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969' },
  { bytes: 102400, digest: 'bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085' },
];
let verified = false;
/** BLAKE3 of `input` on the CPU; the first call checks the port against the published vectors. */
export function blake3(input: Uint8Array): string {
  if (!verified) {
    for (const v of VECTORS) {
      const got = blake3Raw(Uint8Array.from({ length: v.bytes }, (_, i) => i % 251));
      if (got !== v.digest) throw Error(`the test's BLAKE3 port gives ${got} for the ${v.bytes}-byte vector, not ${v.digest}`);
    }
    verified = true;
  }
  return blake3Raw(input);
}

// ---------------------------------------------------------------------------------------------------
// The test's own MP4 reader: ISO BMFF boxes, each track's sample tables and edit list, the video samples'
// presentation times, and the audio track's PCM decoded (README: The surface under test, the MP4 this suite reads).
// It decodes no video codec: a frame is a video sample, placed by its presentation time.

interface Box { type: string; start: number; end: number; body: number }
function boxesIn(b: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  for (let p = from; p + 8 <= to;) {
    let size = b.readUInt32BE(p); const type = b.toString('latin1', p + 4, p + 8); let head = 8;
    if (size === 1) { size = Number(b.readBigUInt64BE(p + 8)); head = 16; } else if (size === 0) size = to - p;
    if (size < head || p + size > to) throw Error(`MP4: the box ${type} at byte ${p} runs past its parent`);
    out.push({ type, start: p, end: p + size, body: p + head });
    p += size;
  }
  return out;
}
const childOf = (b: Buffer, box: Box, type: string, skip = 0): Box | undefined => boxesIn(b, box.body + skip, box.end).find((x) => x.type === type);
const path = (b: Buffer, box: Box, ...types: string[]): Box | undefined => {
  let at: Box | undefined = box;
  for (const t of types) { at = at && childOf(b, at, t); }
  return at;
};

export interface Mp4Track {
  handler: string; format: string; timescale: number; samples: number;
  /** Each sample's presentation time in the track's timescale, after its edit list, in decode order. */
  pts: number[];
  /** Audio: the channel count, the sample rate and the decoded PCM per channel. */
  channels: number; rate: number; pcm: Float32Array[] | null;
  /** Audio: the PCM frame presented at time 0 (its edit list's media start, less any leading empty edit). */
  presentedFrom: number;
}
export interface Mp4 { tracks: Mp4Track[]; video: Mp4Track | undefined; audio: Mp4Track | undefined }

function table(b: Buffer, box: Box | undefined, width: number, entry: (o: number) => number[]): number[][] {
  if (!box) return [];
  const count = b.readUInt32BE(box.body + 4);
  return Array.from({ length: count }, (_, i) => entry(box.body + 8 + i * width));
}
function pcmOf(b: Buffer, entry: Box, chunks: Buffer, channels: number, what: string): Float32Array[] {
  const e = entry.body;
  let bits = 0; let float = false; let little = false;
  if (entry.type === 'fpcm' || entry.type === 'ipcm') {
    const pcmC = boxesIn(b, e + 28, entry.end).find((x) => x.type === 'pcmC');
    if (!pcmC) throw Error(`${what}: ${entry.type} without its pcmC box`);
    little = (b[pcmC.body + 4]! & 1) === 1; bits = b[pcmC.body + 5]!; float = entry.type === 'fpcm';
  } else if (entry.type === 'lpcm') {
    // QuickTime's version 2 sound description: bits a channel at 48, format flags at 52 (float 1, big-endian 2).
    if (b.readUInt16BE(e + 8) !== 2) throw Error(`${what}: an lpcm description that isn't version 2`);
    const flags = b.readUInt32BE(e + 52); bits = b.readUInt32BE(e + 48);
    float = (flags & 1) === 1; little = (flags & 2) === 0;
  } else if (entry.type === 'sowt' || entry.type === 'twos') {
    bits = 16; little = entry.type === 'sowt';
  } else throw Error(`${what}: the audio is ${entry.type}, which this reader doesn't decode: it reads uncompressed PCM only`);
  const width = bits / 8;
  if (![16, 24, 32, 64].includes(bits) || (float && bits < 32)) throw Error(`${what}: ${bits}-bit ${float ? 'float' : 'integer'} PCM`);
  const frames = Math.floor(chunks.length / (width * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * width;
      let v: number;
      if (float) v = bits === 32 ? (little ? chunks.readFloatLE(o) : chunks.readFloatBE(o)) : (little ? chunks.readDoubleLE(o) : chunks.readDoubleBE(o));
      else if (bits === 16) v = (little ? chunks.readInt16LE(o) : chunks.readInt16BE(o)) / 32768;
      else if (bits === 24) v = (little ? chunks.readIntLE(o, 3) : chunks.readIntBE(o, 3)) / 8388608;
      else v = (little ? chunks.readInt32LE(o) : chunks.readInt32BE(o)) / 2147483648;
      out[c]![i] = v;
    }
  }
  return out;
}
export function readMp4(file: Buffer, what: string): Mp4 {
  const top = boxesIn(file, 0, file.length);
  expect(top[0]?.type, `${what} is an ISO BMFF file (ftyp first)`).toBe('ftyp');
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) throw Error(`${what}: no moov box`);
  const mvhd = childOf(file, moov, 'mvhd');
  if (!mvhd) throw Error(`${what}: no mvhd box`);
  const movieScale = file.readUInt32BE(mvhd.body + (file[mvhd.body] === 1 ? 20 : 12));
  const tracks: Mp4Track[] = [];
  for (const trak of boxesIn(file, moov.body, moov.end).filter((x) => x.type === 'trak')) {
    const mdia = childOf(file, trak, 'mdia');
    const mdhd = mdia && childOf(file, mdia, 'mdhd'); const hdlr = mdia && childOf(file, mdia, 'hdlr');
    const stbl = mdia && path(file, mdia, 'minf', 'stbl');
    if (!mdhd || !hdlr || !stbl) throw Error(`${what}: a track without mdhd, hdlr or stbl`);
    const timescale = file.readUInt32BE(mdhd.body + (file[mdhd.body] === 1 ? 20 : 12));
    const handler = file.toString('latin1', hdlr.body + 8, hdlr.body + 12);
    const stsd = childOf(file, stbl, 'stsd');
    if (!stsd) throw Error(`${what}: a track without stsd`);
    const entry = boxesIn(file, stsd.body + 8, stsd.end)[0];
    if (!entry) throw Error(`${what}: an stsd without an entry`);
    const stsz = childOf(file, stbl, 'stsz');
    if (!stsz) throw Error(`${what}: a track without stsz`);
    const fixed = file.readUInt32BE(stsz.body + 4); const count = file.readUInt32BE(stsz.body + 8);
    const sizes = Array.from({ length: count }, (_, i) => (fixed !== 0 ? fixed : file.readUInt32BE(stsz.body + 12 + 4 * i)));
    // Decode times, composition offsets, then the edit list.
    const dts: number[] = [];
    let t = 0;
    for (const [c, d] of table(file, childOf(file, stbl, 'stts'), 8, (o) => [file.readUInt32BE(o), file.readUInt32BE(o + 4)])) for (let i = 0; i < c!; i++) { dts.push(t); t += d!; }
    const ctts = childOf(file, stbl, 'ctts');
    const offsets: number[] = [];
    if (ctts) {
      const signed = file[ctts.body] === 1;
      for (const [c, off] of table(file, ctts, 8, (o) => [file.readUInt32BE(o), signed ? file.readInt32BE(o + 4) : file.readUInt32BE(o + 4)])) for (let i = 0; i < c!; i++) offsets.push(off!);
    }
    let mediaStart = 0; let emptyMovie = 0;
    const elst = path(file, trak, 'edts', 'elst');
    if (elst) {
      const v1 = file[elst.body] === 1; const w = v1 ? 20 : 12;
      for (const [dur, mt] of table(file, elst, w, (o) => (v1 ? [Number(file.readBigUInt64BE(o)), Number(file.readBigInt64BE(o + 8))] : [file.readUInt32BE(o), file.readInt32BE(o + 4)]))) {
        if (mt === -1) emptyMovie += dur!; else { mediaStart = mt!; break; }
      }
    }
    const lead = (emptyMovie * timescale) / movieScale;
    const pts = dts.map((d, i) => d + (offsets[i] ?? 0) - mediaStart + lead);
    // Sample data: chunks by stsc and stco/co64, in decode order.
    let channels = 0; let rate = 0; let pcm: Float32Array[] | null = null;
    if (handler === 'soun') {
      channels = file.readUInt16BE(entry.body + 16);
      if (entry.type === 'lpcm' && file.readUInt16BE(entry.body + 8) === 2) channels = file.readUInt32BE(entry.body + 40);
      rate = timescale;
      const co = childOf(file, stbl, 'stco'); const co64 = childOf(file, stbl, 'co64');
      const chunkOffsets = co ? table(file, co, 4, (o) => [file.readUInt32BE(o)]).map((x) => x[0]!) : table(file, co64, 8, (o) => [Number(file.readBigUInt64BE(o))]).map((x) => x[0]!);
      const runs = table(file, childOf(file, stbl, 'stsc'), 12, (o) => [file.readUInt32BE(o), file.readUInt32BE(o + 4)]);
      const parts: Buffer[] = [];
      let s = 0;
      for (let c = 0; c < chunkOffsets.length && s < count; c++) {
        const run = [...runs].reverse().find((r) => r[0]! <= c + 1);
        let at = chunkOffsets[c]!;
        for (let k = 0; k < (run?.[1] ?? 0) && s < count; k++, s++) { parts.push(file.subarray(at, at + sizes[s]!)); at += sizes[s]!; }
      }
      pcm = pcmOf(file, entry, Buffer.concat(parts), channels, `${what}: audio`);
    }
    tracks.push({ handler, format: entry.type, timescale, samples: count, pts, channels, rate, pcm, presentedFrom: mediaStart - lead });
  }
  return { tracks, video: tracks.find((x) => x.handler === 'vide'), audio: tracks.find((x) => x.handler === 'soun') };
}
