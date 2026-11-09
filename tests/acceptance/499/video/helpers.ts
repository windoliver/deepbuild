// Test-side tools for the #499 video acceptance tests (criteria 3, 7, 8, 12, 13, 14 and 17): the two binaries the
// suite drives, built once per file (`deep-show run`, #393's scenarios, for documents, canonical frames and seek
// against play; `deep-canvas-render`, the live view through GPUI's Metal renderer, for the live shader, the players and
// the view); fixtures made at test time by pinned recipes (ffmpeg makes fixtures and reference decodes only, never
// the code under test); exact flick arithmetic; the evidence store; a PNG reader; and the reference-Mac gate.
// Nothing here stands in for the media module, the decode worker or the live view: each is read from what a binary
// answers or writes.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/499/video is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** Every `it` passes this: a first cargo build can take many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  3: 'AC3 #499.65f30d78',
  7: 'AC7 #499.035a05de',
  8: 'AC8 #499.a9397111',
  12: 'AC12 #499.96045131',
  13: 'AC13 #499.d5826069',
  14: 'AC14 #499.09623041',
  17: 'AC17 #499.9dbb482c',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict prefixes

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
  expect(typeof value === 'number' && Number.isSafeInteger(value), `${what} is a whole number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A platform need is missing here: never a pass. */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// Time: flicks, 1/705,600,000 s, as integers.

export const FLICKS = 705_600_000;
/** Whole seconds, or a fraction that is a whole number of flicks, as flicks. */
export function fl(seconds: number): number {
  const f = Math.round(seconds * FLICKS);
  if (Math.abs(f - seconds * FLICKS) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return f;
}
export const secs = (flicks: number): string => `${(flicks / FLICKS).toFixed(6)} s`;

/** A stream's frames by their presentation times in its own ticks of 1/`den` s (presentation order, ascending). */
export interface Timeline { den: number; ticks: number[]; endTicks: number }
/** The first flick at or after frame k's presentation time: ⌈ticks × 705,600,000 ÷ den⌉, in integers. */
export function ownFlick(tl: Timeline, k: number): number {
  const n = BigInt(tl.ticks[k]!) * BigInt(FLICKS); const d = BigInt(tl.den);
  return Number((n + d - 1n) / d);
}
/** The frame whose presentation interval [pts_k, pts_k+1) holds source time t (flicks); before frame 0, frame 0. */
export function frameAt(tl: Timeline, t: number): number {
  const tt = BigInt(t) * BigInt(tl.den);
  let k = 0;
  for (let i = 0; i < tl.ticks.length; i++) if (BigInt(tl.ticks[i]!) * BigInt(FLICKS) <= tt) k = i;
  return k;
}
export const endFlick = (tl: Timeline): number => Number((BigInt(tl.endTicks) * BigInt(FLICKS)) / BigInt(tl.den));

/** A seeded generator in [0, 1) (mulberry32), so the 200 times are the same on every run. */
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
export function seededFlicks(seed: number, n: number, from: number, to: number): number[] {
  const r = seeded(seed);
  return Array.from({ length: n }, () => from + Math.floor(r() * (to - from)));
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin <name>` once per file, copied out of target/debug; a test that uses a build that
// failed fails, naming it.

export function useBinary(name: 'deep-show' | 'deep-canvas-render'): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-499-bin-'));
    const args = ['build', '--locked', '--bin', name];
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(name)), join(dir, exe(name)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${name}`).toBe('');
    return join(dir, exe(name));
  };
}

/** A fresh folder per call, deleted after the test. */
export function useTemp(tag: string): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), `deep-499-${tag}-`));
    made.push(d);
    return d;
  };
}

// ---------------------------------------------------------------------------------------------------
// ffmpeg: fixtures and reference decodes only. Missing, a test that needs it fails `BLOCKED:` with the unblock line.

function findTool(name: 'ffmpeg' | 'ffprobe'): string | null {
  const env = name === 'ffmpeg' ? process.env['DEEP_FFMPEG'] : process.env['DEEP_FFPROBE'];
  for (const c of [env, name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].filter((x): x is string => !!x)) {
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}
let tools: { ffmpeg: string; ffprobe: string } | null | undefined;
export function ffmpegTools(): { ffmpeg: string; ffprobe: string } {
  if (tools === undefined) {
    const ffmpeg = findTool('ffmpeg');
    const ffprobe = findTool('ffprobe');
    tools = ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null;
    if (tools) {
      const enc = spawnSync(tools.ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout ?? '';
      const bsf = spawnSync(tools.ffmpeg, ['-hide_banner', '-bsfs'], { encoding: 'utf8' }).stdout ?? '';
      if (!/\blibx264\b/.test(enc) || !/\bsetts\b/.test(bsf)) tools = null;
    }
  }
  if (!tools) blocked('these fixtures are made by ffmpeg (libx264 and the setts bitstream filter, FFmpeg 4.4 or later) with ffprobe; none was found on PATH, /opt/homebrew/bin or DEEP_FFMPEG/DEEP_FFPROBE. Unblock: brew install ffmpeg');
  return tools;
}
export function ffmpeg(args: string[], input?: Buffer): Buffer {
  const t = ffmpegTools();
  return execFileSync(t.ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : { stdio: ['ignore', 'pipe', 'pipe'] }) });
}
function ffprobeJson(args: string[]): JsonObject {
  const t = ffmpegTools();
  return JSON.parse(execFileSync(t.ffprobe, ['-v', 'error', '-of', 'json', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })) as JsonObject;
}

/** What ffprobe reads of a fixture's video stream: used only to check a fixture came out as its recipe says. */
export function probeFixture(path: string): { tb: string; pts: number[]; color: JsonObject; width: number; height: number } {
  const s = obj(arr(ffprobeJson(['-select_streams', 'v:0', '-show_entries', 'stream=time_base,width,height,color_range,color_space,color_transfer,color_primaries', path])['streams'], 'ffprobe streams')[0], 'ffprobe stream');
  const frames = arr(ffprobeJson(['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=pts', path])['frames'], 'ffprobe frames');
  return {
    tb: str(s['time_base'], 'ffprobe time_base'), width: int(s['width'], 'ffprobe width'), height: int(s['height'], 'ffprobe height'), color: s,
    pts: frames.map((f, i) => int(obj(f, `ffprobe frame ${i}`)['pts'], `ffprobe frame ${i} pts`)).sort((a, b) => a - b),
  };
}

/** The presentation-order indices of a file's key frames, as ffprobe reads them: to check a proxy's GOP. */
export function keyFrames(path: string): number[] {
  const frames = arr(ffprobeJson(['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=key_frame,pts', path])['frames'], 'ffprobe frames')
    .map((f, i) => { const o = obj(f, `ffprobe frame ${i}`); return { pts: int(o['pts'], 'pts'), key: o['key_frame'] === 1 }; })
    .sort((a, b) => a.pts - b.pts);
  return frames.flatMap((f, i) => (f.key ? [i] : []));
}

/** The accurate reference: ffmpeg's own decode of every frame in presentation order, no frame dropped or doubled
 * (passthrough timing), as I420 planes (Y, then Cb, then Cr, rows top-down, no padding). H.264 decoding is exact by
 * the standard, so a conforming decoder gives these planes bit for bit. */
export function referenceFrames(path: string, w: number, h: number, count: number): Buffer[] {
  const args = (timing: string[]): string[] => ['-i', path, '-map', '0:v:0', ...timing, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'];
  let out: Buffer;
  try { out = ffmpeg(args(['-fps_mode', 'passthrough'])); } catch { out = ffmpeg(args(['-vsync', 'passthrough'])); }
  const size = (w * h * 3) / 2;
  expect(out.length, `reference decode of ${path}: ${count} frames of ${w} × ${h} I420`).toBe(size * count);
  return Array.from({ length: count }, (_, k) => out.subarray(k * size, (k + 1) * size));
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** "source frame k" for a hash among the reference frames, else the hash itself: how a failure names what it saw. */
export function nameFrame(refs: readonly string[], hash: string | null): string {
  if (hash === null) return 'no frame';
  const k = refs.indexOf(hash);
  return k >= 0 ? `source frame ${k}` : `a frame that is no source frame (planes ${hash.slice(0, 16)}…)`;
}

// The two criterion-7 fixtures, the recipes of #498's decode suite (tests/acceptance/498/decode/helpers.ts), copied.

/** 60 frames at 30 fps in an MP4 whose video time base is 1/15360, frame k presented at (512k + 1)/15360 s, so no
 * frame's time is a whole number of flicks (a tick is 45,937.5 flicks). */
export function cfr30(path: string): void {
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-frames:v', '60', '-c:v', 'libx264', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p',
    '-enc_time_base', '1/15360', '-bsf:v', 'setts=pts=PTS+1', '-video_track_timescale', '15360', '-use_editlist', '0', path]);
}
export const CFR30: Timeline = { den: 15360, ticks: Array.from({ length: 60 }, (_, k) => 512 * k + 1), endTicks: 512 * 60 + 1 };
/** A screen recording in a MOV at time base 1/600, nominally 60 fps (10 ticks a frame), 20 frames, whose frame 10
 * lasts three nominal frames (30 ticks). */
export function screenVfr(path: string): void {
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=60', '-frames:v', '20', '-c:v', 'libx264', '-bf', '0', '-g', '60', '-pix_fmt', 'yuv420p',
    '-bsf:v', 'setts=ts=if(gt(N\\,10)\\,PTS+2\\,PTS)', '-video_track_timescale', '600', '-use_editlist', '0', path]);
}
export const VFR: Timeline = { den: 600, ticks: Array.from({ length: 20 }, (_, k) => (k <= 10 ? 10 * k : 10 * k + 20)), endTicks: 10 * 19 + 20 + 10 };

// The recording (criteria 3, 8 and 13): 320 × 240 at 30 fps, 300 frames (10 s), gray, every frame different.
//
// Each frame is 8 × 8 blocks of gray at levels 40, 56, … 200 (Y′, limited range), drawn from a hash of the frame and
// the block, so any two frames, and any two places in a frame, differ; around the recorded click at image pixel
// (200, 120) a flat 48 × 48 field of Y′ 128 holds a white 4 × 4 mark (Y′ 235) centred on the click. Cb and Cr are 128
// everywhere, so the matrix doesn't change its RGB. Tagged BT.709 primaries and matrix, limited range and the sRGB
// transfer (iec61966-2-1), so its R′G′B′ code values are the display's. libx264 at QP 10, no B-frames, a key frame
// every 60 frames, time base 1/15360 with no edit list: frame k is presented at 512k/15360 = k/30 s.

export const REC = { w: 320, h: 240, fps: 30, count: 300, click: [200, 120] as [number, number] } as const;
export const REC_TIMELINE: Timeline = { den: 15360, ticks: Array.from({ length: REC.count }, (_, k) => 512 * k), endTicks: 512 * REC.count };
const FIELD = { x0: 176, x1: 224, y0: 96, y1: 144 };
const MARK = { x0: 198, x1: 202, y0: 118, y1: 122 };
function blockLevel(k: number, bx: number, by: number): number {
  let x = Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(bx + 7, 0x85ebca6b) ^ Math.imul(by + 13, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return 40 + 16 * (((x ^ (x >>> 16)) >>> 0) % 11);
}
export function recordingFrame(k: number): Buffer {
  const { w, h } = REC;
  const f = Buffer.alloc((w * h * 3) / 2, 128);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inMark = x >= MARK.x0 && x < MARK.x1 && y >= MARK.y0 && y < MARK.y1;
      const inField = x >= FIELD.x0 && x < FIELD.x1 && y >= FIELD.y0 && y < FIELD.y1;
      f[y * w + x] = inMark ? 235 : inField ? 128 : blockLevel(k, x >> 3, y >> 3);
    }
  }
  return f;
}
export function recordingMp4(path: string): void {
  const raw = Buffer.concat(Array.from({ length: REC.count }, (_, k) => recordingFrame(k)));
  ffmpeg(['-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${REC.w}x${REC.h}`, '-r', String(REC.fps), '-i', '-',
    '-vf', 'setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv',
    '-c:v', 'libx264', '-qp', '10', '-bf', '0', '-g', '60', '-pix_fmt', 'yuv420p',
    '-video_track_timescale', '15360', '-use_editlist', '0', path], raw);
  const p = probeFixture(path);
  expect(p.tb, `fixture ${path}: time base 1/15360 (the recipe broke if not)`).toBe('1/15360');
  expect(p.pts, `fixture ${path}: frame k at 512k ticks (the recipe broke if not)`).toEqual(REC_TIMELINE.ticks);
  expect([p.width, p.height], `fixture ${path}: 320 × 240`).toEqual([REC.w, REC.h]);
  expect(p.color['color_transfer'], `fixture ${path}: tagged with the sRGB transfer`).toBe('iec61966-2-1');
}

/** Five 1080p recordings at 30 fps, 11 s each (criterion 12), each its own asset: testsrc2 encoded at a different
 * quality, so the five files differ. */
export function players1080(dir: string): string[] {
  return Array.from({ length: 5 }, (_, i) => {
    const path = join(dir, `player-${i + 1}.mp4`);
    ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-frames:v', '330', '-c:v', 'libx264', '-preset', 'veryfast',
      '-crf', String(18 + i), '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p', path]);
    return path;
  });
}

// 75% colour bars (criterion 14), the recipe of #498's decode suite, copied: eight bars left to right, each W/8 wide,
// converted by the test to limited-range Y′CbCr 4:2:0 with the BT.709 matrix, libx264 at QP 10 without B-frames, in
// an MP4 with no colour description in the stream or the container.
export const BARS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'white', rgb: [191, 191, 191] }, { name: 'yellow', rgb: [191, 191, 0] }, { name: 'cyan', rgb: [0, 191, 191] }, { name: 'green', rgb: [0, 191, 0] },
  { name: 'magenta', rgb: [191, 0, 191] }, { name: 'red', rgb: [191, 0, 0] }, { name: 'blue', rgb: [0, 0, 191] }, { name: 'black', rgb: [0, 0, 0] },
];
function barsI420(w: number, h: number): Buffer {
  const k = { r: 0.2126, b: 0.0722 };
  const ycc = ([R, G, B]: [number, number, number]): [number, number, number] => {
    const [r, g, b] = [R / 255, G / 255, B / 255];
    const y = k.r * r + (1 - k.r - k.b) * g + k.b * b;
    return [Math.round(16 + 219 * y), Math.round(128 + (224 * (b - y)) / (2 * (1 - k.b))), Math.round(128 + (224 * (r - y)) / (2 * (1 - k.r)))];
  };
  const bw = w / 8;
  const Y = Buffer.alloc(w * h), U = Buffer.alloc((w * h) / 4), V = Buffer.alloc((w * h) / 4);
  for (let x = 0; x < w; x++) {
    const [y, u, v] = ycc(BARS[Math.floor(x / bw)]!.rgb);
    for (let r = 0; r < h; r++) Y[r * w + x] = y;
    if (x % 2 === 0) for (let r = 0; r < h / 2; r++) { U[(r * w) / 2 + x / 2] = u; V[(r * w) / 2 + x / 2] = v; }
  }
  return Buffer.concat([Y, U, V]);
}
export function untaggedBars1080(path: string): void {
  const f = barsI420(1920, 1080);
  ffmpeg(['-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', '1920x1080', '-r', '30', '-i', '-', '-c:v', 'libx264', '-qp', '10', '-bf', '0', '-pix_fmt', 'yuv420p', path], Buffer.concat([f, f, f]));
  const p = probeFixture(path);
  expect([p.width, p.height], `fixture ${path}: 1920 × 1080`).toEqual([1920, 1080]);
  const tags = ['color_range', 'color_space', 'color_transfer', 'color_primaries'].map((t) => (p.color[t] === undefined ? 'unknown' : str(p.color[t], `fixture ${t}`)));
  expect(tags, `fixture ${path}: untagged (the recipe broke if not)`).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
}
/** Per bar, the worst channel error over its interior (16 px in from its sides, the middle half of the rows) of an RGBA
 * picture against the bars, when over `tol` code values. */
export function barsErrors(img: Image, tol: number): { bar: string; want: number[]; got: number[]; off: number }[] {
  const out: { bar: string; want: number[]; got: number[]; off: number }[] = [];
  const bw = img.width / 8;
  BARS.forEach((bar, i) => {
    let worst = 0; let got: number[] = [];
    for (let y = Math.floor(img.height / 4); y < Math.floor((3 * img.height) / 4); y += 2) {
      for (let x = i * bw + 16; x < (i + 1) * bw - 16; x += 2) {
        const px = pixel(img, x, y);
        const off = Math.max(...px.map((v, c) => Math.abs(v - bar.rgb[c]!)));
        if (off > worst) { worst = off; got = px; }
      }
    }
    if (worst > tol) out.push({ bar: bar.name, want: bar.rgb, got, off: worst });
  });
  return out;
}

/** R′G′B′ of limited-range BT.709 Y′CbCr, rounded and clamped to 0..255. */
export function rgb709(y: number, cb: number, cr: number): [number, number, number] {
  const c = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  const Y = (255 / 219) * (y - 16); const U = (255 / 224) * (cb - 128); const V = (255 / 224) * (cr - 128);
  return [c(Y + 1.5748 * V), c(Y - 0.187324 * U - 0.468124 * V), c(Y + 1.8556 * U)];
}
/** The RGB of pixel (x, y) of an I420 frame of width w, height h, chroma by its 2 × 2 block. */
export function i420Rgb(frame: Buffer, w: number, h: number, x: number, y: number): [number, number, number] {
  const cw = w / 2; const ys = w * h; const cs = cw * (h / 2);
  const ci = (y >> 1) * cw + (x >> 1);
  return rgb709(frame[y * w + x]!, frame[ys + ci]!, frame[ys + cs + ci]!);
}

// ---------------------------------------------------------------------------------------------------
// The evidence store: deep-show's (by hash, split by its first two hex digits), and deep-canvas-render's `store`, a
// folder whose files are named by their whole hash.

export function putEvidence(evidence: string, bytes: Buffer): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export function putStore(store: string, bytes: Buffer): string {
  const h = sha256(bytes);
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, h), bytes);
  return h;
}
const storedEvidence = (evidence: string, h: string): string => join(evidence, h.slice(0, 2), h.slice(2));
/** The evidence store's file for `h`, when it holds one whose bytes hash to it. */
export function existsEvidence(evidence: string, h: string): string | null {
  const path = storedEvidence(evidence, h);
  return existsSync(path) && sha256(readFileSync(path)) === h ? path : null;
}

export const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #499 acceptance tests.' };

// ---------------------------------------------------------------------------------------------------
// Documents (README: Documents)

export const LAYER = 'main';
const LAYERS: JsonObject = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } };
export interface Frames { start?: string; in?: number; rate?: [number, number] }
/** An image@1 item whose asset is a video, drawn into `box` (u), with its video frames' fields. */
export function videoItem(id: string, asset: string, box: [number, number, number, number], frames: Frames = {}, params: JsonObject = {}, order = `b${id}`): JsonObject {
  const f: JsonObject = { start: frames.start ?? '0s', in: frames.in ?? 0, rate: frames.rate ?? [1, 1] };
  return { id, kind: 'image@1', layer: LAYER, name: `Recording ${id}`, order, params: { asset, box, fit: 'fill', alt: `The #499 suite's recording ${id}`, frames: f, ...params } };
}
export function rect(id: string, box: [number, number, number, number], role: string, order = `a${id}`): JsonObject {
  return { id, kind: 'rect@1', layer: LAYER, name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } } };
}
export function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', layer: LAYER, name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
/** A document of `profile` ("board" or "film"), its items by ID, its assets by name. */
export function documentOf(id: string, profile: 'board' | 'film', size: [number, number], items: JsonObject[], assets: JsonObject, extra: JsonObject = {}, transport: JsonObject = { span: '10s', frame_rate: [30, 1] }): JsonObject {
  return {
    format: 1, id, profile, title: `#499 ${id}`, description: `The #499 video acceptance tests' document ${id}.`, size, layers: LAYERS, transport,
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), assets, ...(profile === 'film' ? { camera: 'cam' } : {}), ...extra,
  };
}
export const asset = (sha: string, more: JsonObject = {}): JsonObject => ({ sha256: sha, license: LICENSE, ...more });

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test: deep-show)

const ulid = (n: number): string => `01JB499V${String(n).padStart(18, '0')}`;
export const DOC = { a: ulid(1), b: ulid(2), c: ulid(3) } as const;
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
/** A scenario: the evidence store, your shell's process tree, one panel, the documents, the plant when given. */
export function scenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  const docs: JsonObject = {};
  for (const id of Object.values(DOC)) docs[id] = { panel: 'main' };
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs, ...(planted ? { planted } : {}), calls };
}
/** `deep show` of a whole document from your shell; the hub stamps the writer layer, so the payload has none. */
export function present(doc: string, document: JsonObject): JsonObject {
  const payload = clone(document);
  delete payload['layers'];
  for (const item of Object.values(isObject(payload['items']) ? payload['items'] : {})) if (isObject(item)) delete item['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc, document: payload, include: ['issues'] };
}
export const evalCall = (doc: string, t: number, opts: { pixels?: boolean; film?: boolean } = {}): JsonObject =>
  ({ call: 'eval', doc, t, ...(opts.pixels ? { pixels: true } : {}), ...(opts.film ? { film: true } : {}) });
export const determinismCall = (doc: string, atTimes: number[]): JsonObject => ({ call: 'determinism', doc, display_hz: 144, at_times: atTimes });
export const mediaProxy = (path: string, gop: 1 | 10, scale: number): JsonObject => ({ call: 'media_proxy', path, gop, scale });

/** `deep-show run`: exit 0, one answer line, ok, one reply per call. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(run.error === undefined, `${what}: deep-show run finished (${run.error?.message ?? ''})`).toBe(true);
  expect(run.status, `${what}: deep-show run exits 0; stdout: ${(run.stdout ?? '').slice(0, 800)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}; got ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return replies;
}
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}
export function evaluated(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
  return reply;
}

/** The frame a video image item shows, from a reply's `video` block: its source frame and the SHA-256 of its decoded
 * planes (README: `video`). */
export interface Shown { frame: number; planes: string }
export function shownOf(holder: JsonObject, item: string, what: string): Shown {
  const v = obj(obj(holder['video'], `${what}: video (the video image items' frames)`)[item], `${what}: video.${item}`);
  const planes = str(v['planes'], `${what}: video.${item}.planes`);
  expect(/^[0-9a-f]{64}$/.test(planes), `${what}: video.${item}.planes is a lower-case SHA-256, got ${planes}`).toBe(true);
  return { frame: int(v['frame'], `${what}: video.${item}.frame`), planes };
}
/** `determinism`'s frames, each side's video frame for `item`. */
export function compared(reply: JsonObject, item: string, what: string): { t: number; play: Shown; seek: Shown }[] {
  expect(reply['outcome'], `${what} is compared: ${show(reply)}`).toBe('compared');
  return arr(reply['frames'], `${what}: frames`).map((f, i) => {
    const o = obj(f, `${what}: frames[${i}]`);
    const t = int(o['t'], `${what}: frames[${i}].t`);
    return { t, play: shownOf(obj(o['play'], `${what}: frames[${i}].play`), item, `${what} play to ${secs(t)}`), seek: shownOf(obj(o['seek'], `${what}: frames[${i}].seek`), item, `${what} seek to ${secs(t)}`) };
  });
}

/** An `eval` reply's one snapshot, read as a picture from the evidence store by its SHA-256. */
export function snapshotPicture(evidence: string, reply: JsonObject, what: string): Image {
  const list = arr(evaluated(reply, what)['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what}: one snapshot`).toBe(1);
  const s = obj(list[0], `${what}: snapshots[0]`);
  const h = str(s['sha256'], `${what}: snapshots[0].sha256`);
  const path = storedEvidence(evidence, h);
  expect(existsSync(path), `${what}: the snapshot ${h} is in the evidence store`).toBe(true);
  const file = readFileSync(path);
  expect(sha256(file), `${what}: the stored snapshot hashes to its name`).toBe(h);
  return decodePng(file);
}

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace; #421's reader as #493's suite has it)

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
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * channels + k]!;
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
export function pixel(img: Image, x: number, y: number): [number, number, number] {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
}

// ---------------------------------------------------------------------------------------------------
// deep-canvas-render (README: The surface under test: deep-canvas-render)

/** The look the live view resolves roles through (#391's form), as #1487's suite has it. */
export const LOOK: JsonObject = {
  light: { ground: [250, 250, 248], ink: [28, 28, 30], muted: [120, 120, 128], accent: [40, 90, 200], live: [200, 120, 40] },
};
/** One JSON line per input line, in order, exit 0. */
export function renderLines(bin: string, sub: 'render' | 'idle', inputs: JsonValue[], timeoutMs = 1_800_000): JsonObject[] {
  const run = spawnSync(bin, [sub], { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  expect(run.error === undefined, `deep-canvas-render ${sub} finished (${run.error?.message ?? ''})`).toBe(true);
  expect(run.status, `deep-canvas-render ${sub} exits 0; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `deep-canvas-render ${sub}: one output line per input line`).toBe(inputs.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `deep-canvas-render ${sub}: answer ${i}`));
}
/** The live view needs GPUI's Metal renderer: off macOS, or when the binary says so, the reading can't be had. */
export function liveViewProblem(answer: JsonObject | null): string | null {
  if (process.platform !== 'darwin') return `the live view draws with GPUI's offscreen Metal renderer, macOS only; this is ${process.platform}`;
  if (answer && answer['ok'] === false && answer['code'] === 'unsupported_platform') return 'deep-canvas-render answers unsupported_platform';
  return null;
}

export type Rect = [number, number, number, number];
export interface ShownFrame { at_ms: number; t: number; frame: number; planes: string | null }
export interface Player { shown: ShownFrame[]; decodes: { at_ms: number; frame: number }[] }
/** One `idle` run's answer (README: `idle`): #854's frames and wakeups, with this suite's players, views and allocations. */
export interface IdleRun {
  opened: number; seconds: number; wakeups: number;
  drawn: { frame: number; at_ms: number; allocs: number }[];
  players: Map<string, Player>;
  views: { rect: number[]; from_ms: number; to_ms: number; frames: number; wakeups: number }[];
}
export function idleRun(a: JsonObject, what: string): IdleRun {
  expect(a['ok'], `${what} refused: ${JSON.stringify(a).slice(0, 1500)}`).toBe(true);
  const players = new Map<string, Player>();
  for (const [id, v] of Object.entries(obj(a['players'], `${what}: players`))) {
    const p = obj(v, `${what}: players.${id}`);
    players.set(id, {
      shown: arr(p['shown'], `${what}: players.${id}.shown`).map((x, i) => {
        const o = obj(x, `${what}: players.${id}.shown[${i}]`);
        const planes = o['planes'] === null || o['planes'] === undefined ? null : str(o['planes'], `${what}: players.${id}.shown[${i}].planes`);
        return { at_ms: num(o['at_ms'], 'at_ms'), t: int(o['t'], `${what}: players.${id}.shown[${i}].t`), frame: int(o['frame'], `${what}: players.${id}.shown[${i}].frame`), planes };
      }),
      decodes: arr(p['decodes'], `${what}: players.${id}.decodes`).map((x, i) => {
        const o = obj(x, `${what}: players.${id}.decodes[${i}]`);
        return { at_ms: num(o['at_ms'], 'at_ms'), frame: int(o['frame'], `${what}: players.${id}.decodes[${i}].frame`) };
      }),
    });
  }
  return {
    opened: num(a['opened_frames'], `${what}: opened_frames`), seconds: num(a['seconds'], `${what}: seconds`), wakeups: num(a['wakeups'], `${what}: wakeups`),
    drawn: arr(a['drawn'], `${what}: drawn`).map((d, k) => {
      const x = obj(d, `${what}: drawn[${k}]`);
      return { frame: int(x['frame'], 'frame'), at_ms: num(x['at_ms'], 'at_ms'), allocs: int(x['allocs'], `${what}: drawn[${k}].allocs`) };
    }),
    players,
    views: arr(a['views'], `${what}: views`).map((v, k) => {
      const x = obj(v, `${what}: views[${k}]`);
      return { rect: arr(x['rect'], 'rect').map((n) => num(n, 'rect')), from_ms: num(x['from_ms'], 'from_ms'), to_ms: num(x['to_ms'], 'to_ms'), frames: int(x['frames'], `${what}: views[${k}].frames`), wakeups: num(x['wakeups'], `${what}: views[${k}].wakeups`) };
    }),
  };
}
/** A warm-up run and five runs of the same `idle` line in one process, or why the live view can't run here. */
export function idleRuns(bin: string, line: JsonObject, what: string): IdleRun[] | string {
  const pre = liveViewProblem(null);
  if (pre) return pre;
  const answers = renderLines(bin, 'idle', Array.from({ length: 6 }, (): JsonValue => line));
  const problem = liveViewProblem(answers[0]!);
  if (problem) return problem;
  return answers.slice(1).map((a, r) => idleRun(a, `${what} run ${r + 1}`));
}
/** #854's rule over five runs of a reading with a limit: PASS when all five pass, FAIL when all five fail (unless the
 * machine was loaded past its cores, then INCONCLUSIVE), else INCONCLUSIVE. Off a reference Mac: INCONCLUSIVE. */
export function judgeFive(failures: (string | null)[], reading: string): void {
  const problem = referenceMacProblem();
  if (problem) inconclusive(`reading only (${problem}): ${reading}; ${machineReading()}`);
  if (failures.every((f) => f === null)) return;
  if (failures.every((f) => f !== null)) {
    if (loadShare() > 1) inconclusive(`all five runs failed under load: ${reading}; ${machineReading()}`);
    expect.fail(`FAIL: ${failures.map((f, i) => `run ${i + 1}: ${f}`).join('; ')}`);
  }
  inconclusive(`the five runs disagree: ${failures.map((f, i) => `run ${i + 1}: ${f ?? 'pass'}`).join('; ')}`);
}

// The reference-Mac gate (#854's): timings and wakeups are judged only on a reference Mac.
const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
/** Why this machine can't judge a timing or a wakeup count, or null on a reference Mac. */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  return null;
}
/** The 1-minute load average over the core count: above 1, a timing that failed may be the machine's, not the code's. */
export const loadShare = (): number => loadavg()[0]! / cpus().length;
export function machineReading(): string {
  const read = (cmd: string, ...args: string[]): string => { try { return sh(cmd, ...args).replace(/\s+/g, ' '); } catch { return 'unknown'; } };
  return `power: ${read('pmset', '-g', 'batt').split(';')[0]}; ${/lowpowermode\s+\d/.exec(read('pmset', '-g'))?.[0] ?? 'lowpowermode unknown'}; load: ${loadavg().map((l) => l.toFixed(2)).join(' ')} on ${cpus().length} cores`;
}
