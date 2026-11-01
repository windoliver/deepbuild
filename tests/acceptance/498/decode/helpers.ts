// Test-side tools for the #498 decode-worker acceptance tests (criteria 2, 3, 6, 7 and 8): `deep-show` built once per
// file and driven by one JSON scenario on stdin (`deep-show run`, #393's convention); the calls this suite adds and
// parsers for their replies; exact rationals; fixtures made at test time by pinned recipes (node alone, or ffmpeg, which
// only ever makes fixtures and references); the FATE samples fetched on first use into a cache outside the repository;
// and a local TCP listener standing for a host a file points at. Nothing here stands in for the decode worker, its
// probe, its decoders, its caps or the encode tool: each is read from what `deep-show` answers or writes.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/498/decode is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
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
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)}`).toBe('boolean');
  return value as boolean;
}

// ---------------------------------------------------------------------------------------------------
// Exact rationals (README: Times). A time is `[num, den]`, two whole numbers, den > 0; compared as integers, never
// as floats.

export type Rat = { n: bigint; d: bigint };
export function rat(value: JsonValue | undefined, what: string): Rat {
  const a = arr(value, `${what} (an exact rational [num, den])`);
  expect(a.length, `${what} is [num, den], got ${JSON.stringify(value)}`).toBe(2);
  const n = int(a[0], `${what}'s numerator`);
  const d = int(a[1], `${what}'s denominator`);
  expect(d > 0, `${what}'s denominator is positive, got ${d}`).toBe(true);
  return { n: BigInt(n), d: BigInt(d) };
}
export const R = (n: number | bigint, d: number | bigint = 1): Rat => ({ n: BigInt(n), d: BigInt(d) });
export const ratEq = (a: Rat, b: Rat): boolean => a.n * b.d === b.n * a.d;
export const showRat = (r: Rat): string => `${r.n}/${r.d}`;
/** A decimal as printed by ffprobe (`0.000000`, `-0.046440`) as an exact rational. */
export function decimalRat(text: string): Rat {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new Error(`not a decimal: ${text}`);
  const frac = m[3] ?? '';
  const n = BigInt(`${m[2]}${frac}`) * (m[1] === '-' ? -1n : 1n);
  return { n, d: 10n ** BigInt(frac.length) };
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of target/debug, as #105's suite does; a
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
    dir = mkdtempSync(join(tmpdir(), 'deep-498-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh folder per call, deleted after the test. */
export function useTemp(tag: string): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), `deep-498-${tag}-`));
    made.push(d);
    return d;
  };
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and runs (README: The surface under test)

export type Planted =
  | 'skips_caps' | 'follows_urls' | 'decodes_in_app'
  | 'ignores_edit_lists' | 'keeps_priming'
  | 'encodes_in_decode_worker'
  | 'probe_rounds_to_flicks'
  | 'assumes_bt601';

export interface Caps { max_bytes?: number; max_duration?: number; max_pixels?: number }
export interface World { evidence: string; caps?: Caps; planted?: Planted }

export function scenario(w: World, calls: JsonObject[]): JsonObject {
  return {
    evidence: w.evidence,
    ...(w.caps ? { decode_caps: w.caps as JsonObject } : {}),
    ...(w.planted ? { planted: w.planted } : {}),
    calls,
  };
}

export interface Ran { pid: number; status: number | null; signal: string | null; stdout: string; stderr: string }
/** One run of `deep-show run` on one scenario line; a run that hangs is stopped by spawnSync's own timeout, which
 * signals only this child. `pid` is the run's own process: the app side, never the decode worker or the encode tool. */
export function runRaw(bin: string, s: JsonObject, timeoutMs = 900_000): Ran {
  const run = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify(s)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`deep-show run did not finish within ${timeoutMs} ms`);
  return { pid: run.pid ?? -1, status: run.status, signal: run.signal, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

const SURFACE = 'the scenario\'s `decode_caps` and `planted` fields and the `media_import`, `media_decode`, `media_proxy`, `media_export` and `workers` calls, README: The surface under test';

/** `deep-show run`: exit 0, one line out, answered ok with one reply per call, in call order. */
export function runShow(bin: string, w: World, calls: JsonObject[], what: string): { replies: JsonObject[]; pid: number; stderr: string } {
  const s = scenario(w, calls);
  const r = runRaw(bin, s);
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 800)}; stderr: ${r.stderr.slice(-2000)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${w.planted ? `, planted ${w.planted}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return { replies, pid: r.pid, stderr: r.stderr };
}

// ---------------------------------------------------------------------------------------------------
// Calls (README: Calls and replies)

export const mediaImport = (path: string): JsonObject => ({ call: 'media_import', path });
export const mediaDecode = (path: string, out: string, opts: { format?: 'yuv' | 'bgra'; video_frames?: number } = {}): JsonObject =>
  ({ call: 'media_decode', path, out, ...(opts.format ? { format: opts.format } : {}), ...(opts.video_frames !== undefined ? { video_frames: opts.video_frames } : {}) });
export const mediaProxy = (path: string, gop: 1 | 10, scale: number): JsonObject => ({ call: 'media_proxy', path, gop, scale });
export const mediaExport = (source: string, out: string): JsonObject => ({ call: 'media_export', source, out, video: { codec: 'h264' } });
export const workersCall = (): JsonObject => ({ call: 'workers' });

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Refusal { code: string; cap: string | null; limit: number | null; url: string | null }
/** The refusal in a reply, or null when the reply isn't one. */
export function refusalOf(reply: JsonObject, what: string): Refusal | null {
  if (!('refused' in reply)) return null;
  const r = obj(reply['refused'], `${what}: refused`);
  const code = str(r['code'], `${what}: refused.code`);
  return {
    code,
    cap: code === 'over_cap' ? str(r['cap'], `${what}: refused.cap (the cap it names)`) : null,
    limit: code === 'over_cap' ? num(r['limit'], `${what}: refused.limit (the cap's value)`) : null,
    url: code === 'external_reference' ? str(r['url'], `${what}: refused.url (the URL the file points at)`) : null,
  };
}

export const workerPid = (reply: JsonObject, what: string): number => int(obj(reply['worker'], `${what}: worker`)['pid'], `${what}: worker.pid`);

export interface Color { primaries: string; transfer: string; matrix: string; range: string; assumed: string[] }
export interface Stream {
  index: number; type: string; time_base: Rat; frame_rate: Rat | 'variable' | null; size: [number, number] | null;
  color: Color | null; pts: JsonValue[] | null;
}
export interface Asset { sha256: string; kind: string; streams: Stream[]; worker: number }

/** `media_import`'s admitted asset (README: Calls and replies); a refusal fails here, naming it. */
export function assetOf(reply: JsonObject, what: string): Asset {
  const refused = refusalOf(reply, what);
  expect(refused, `${what}: admitted, not refused (${JSON.stringify(reply['refused'])})`).toBeNull();
  const a = obj(reply['asset'], `${what}: asset`);
  const probe = obj(a['probe'], `${what}: asset.probe`);
  const streams = arr(probe['streams'], `${what}: asset.probe.streams`).map((v, i): Stream => {
    const s = obj(v, `${what}: probe.streams[${i}]`);
    const type = str(s['type'], `${what}: probe.streams[${i}].type`);
    const fr = s['frame_rate'];
    const video = type === 'video';
    return {
      index: int(s['index'], `${what}: probe.streams[${i}].index`),
      type,
      time_base: rat(s['time_base'], `${what}: probe.streams[${i}].time_base`),
      frame_rate: !video ? null : fr === 'variable' ? 'variable' : rat(fr, `${what}: probe.streams[${i}].frame_rate (a rational or "variable")`),
      size: video || type === 'image' ? sizeOf(s['size'], `${what}: probe.streams[${i}].size`) : null,
      color: video || type === 'image' ? colorOf(s['color'], `${what}: probe.streams[${i}].color`) : null,
      pts: video ? arr(s['pts'], `${what}: probe.streams[${i}].pts (every frame's presentation time)`) : null,
    };
  });
  return { sha256: str(a['sha256'], `${what}: asset.sha256`), kind: str(a['kind'], `${what}: asset.kind`), streams, worker: workerPid(reply, what) };
}

function sizeOf(v: JsonValue | undefined, what: string): [number, number] {
  const a = arr(v, what);
  expect(a.length, `${what} is [w, h]`).toBe(2);
  return [int(a[0], `${what}[0]`), int(a[1], `${what}[1]`)];
}
function colorOf(v: JsonValue | undefined, what: string): Color {
  const c = obj(v, what);
  return {
    primaries: str(c['primaries'], `${what}.primaries`), transfer: str(c['transfer'], `${what}.transfer`),
    matrix: str(c['matrix'], `${what}.matrix`), range: str(c['range'], `${what}.range`),
    assumed: arr(c['assumed'], `${what}.assumed`).map((x, i) => str(x, `${what}.assumed[${i}]`)),
  };
}

export function videoStream(a: Asset, what: string): Stream {
  const v = a.streams.filter((s) => s.type === 'video');
  expect(v.length, `${what}: the probe has one video stream`).toBe(1);
  return v[0]!;
}

export interface DecodedVideo { index: number; size: [number, number]; frames: { pts: Rat; file: string }[] }
export interface DecodedAudio { index: number; sample_rate: number; channels: number; first: Rat; samples: number; file: string }
export interface Decoded { worker: number; video: DecodedVideo[]; audio: DecodedAudio[]; images: DecodedVideo[] }

/** `media_decode`'s output (README: Calls and replies); a refusal fails here, naming it. Files are under `out`. */
export function decodedOf(reply: JsonObject, out: string, what: string): Decoded {
  const refused = refusalOf(reply, what);
  expect(refused, `${what}: decoded, not refused (${JSON.stringify(reply['refused'])})`).toBeNull();
  const d = obj(reply['decoded'], `${what}: decoded`);
  const res: Decoded = { worker: workerPid(d, `${what}: decoded`), video: [], audio: [], images: [] };
  arr(d['streams'], `${what}: decoded.streams`).forEach((v, i) => {
    const s = obj(v, `${what}: decoded.streams[${i}]`);
    const type = str(s['type'], `${what}: decoded.streams[${i}].type`);
    const index = int(s['index'], `${what}: decoded.streams[${i}].index`);
    if (type === 'audio') {
      res.audio.push({
        index, sample_rate: int(s['sample_rate'], `${what}: decoded.streams[${i}].sample_rate`), channels: int(s['channels'], `${what}: decoded.streams[${i}].channels`),
        first: rat(s['first'], `${what}: decoded.streams[${i}].first (the first kept sample's presentation time)`),
        samples: int(s['samples'], `${what}: decoded.streams[${i}].samples`), file: join(out, str(s['file'], `${what}: decoded.streams[${i}].file`)),
      });
    } else {
      const entry: DecodedVideo = {
        index, size: sizeOf(s['size'], `${what}: decoded.streams[${i}].size`),
        frames: arr(s['frames'], `${what}: decoded.streams[${i}].frames`).map((f, k) => {
          const fo = obj(f, `${what}: decoded.streams[${i}].frames[${k}]`);
          return { pts: rat(fo['pts'], `${what}: decoded.streams[${i}].frames[${k}].pts`), file: join(out, str(fo['file'], `${what}: decoded.streams[${i}].frames[${k}].file`)) };
        }),
      };
      (type === 'image' ? res.images : res.video).push(entry);
    }
  });
  return res;
}

export interface Job { op: string; file: string | null }
export interface Worker { pid: number; role: string; jobs: Job[] }
/** `workers`: every helper process this run started, with every job it ran. */
export function workersOf(reply: JsonObject, what: string): Worker[] {
  return arr(reply['workers'], `${what}: workers`).map((v, i) => {
    const w = obj(v, `${what}: workers[${i}]`);
    return {
      pid: int(w['pid'], `${what}: workers[${i}].pid`), role: str(w['role'], `${what}: workers[${i}].role`),
      jobs: arr(w['jobs'], `${what}: workers[${i}].jobs`).map((j, k) => {
        const jo = obj(j, `${what}: workers[${i}].jobs[${k}]`);
        return { op: str(jo['op'], `${what}: workers[${i}].jobs[${k}].op`), file: jo['file'] === undefined || jo['file'] === null ? null : str(jo['file'], `${what}: workers[${i}].jobs[${k}].file`) };
      }),
    };
  });
}
export const describeWorker = (w: Worker): string => `process ${w.pid} (${w.role}; jobs: ${w.jobs.map((j) => j.op).join(', ') || 'none'})`;

// ---------------------------------------------------------------------------------------------------
// Files

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const md5 = (b: Uint8Array): string => createHash('md5').update(b).digest('hex');
export const sha256File = (path: string): string => sha256(readFileSync(path));
/** Little-endian f32 samples from bytes, copied so any offset reads. */
export const f32 = (b: Buffer): Float32Array => new Float32Array(new Uint8Array(b).buffer, 0, Math.floor(b.length / 4));

/** Top-level ISO BMFF boxes: type and size, and whether they add up to the file. */
export function topBoxes(b: Buffer): { boxes: { type: string; start: number; size: number }[]; whole: boolean } {
  const boxes: { type: string; start: number; size: number }[] = [];
  let off = 0;
  while (off + 8 <= b.length) {
    let size = b.readUInt32BE(off);
    const type = b.toString('latin1', off + 4, off + 8);
    if (size === 1) size = Number(b.readBigUInt64BE(off + 8));
    else if (size === 0) size = b.length - off;
    if (size < 8) break;
    boxes.push({ type, start: off, size });
    off += size;
  }
  return { boxes, whole: off === b.length };
}

// ---------------------------------------------------------------------------------------------------
// Fixtures made by node alone: WAV and PNG

/** A 16-bit mono PCM WAV of `seconds` of a 440 Hz tone at `rate`. */
export function wav(seconds: number, rate = 8000): Buffer {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** An 8-bit RGB PNG of w × h, a gradient. */
export function png(w: number, h: number): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb) >>> 0);
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255) / Math.max(1, w - 1); raw[o + 1] = (y * 255) / Math.max(1, h - 1); raw[o + 2] = 128; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------------
// Fixtures made by ffmpeg (README: Fixtures). ffmpeg only makes fixtures and references; when it is missing, a test
// that needs it fails `BLOCKED:` with the unblock line.

function findTool(name: 'ffmpeg' | 'ffprobe'): string | null {
  const env = name === 'ffmpeg' ? process.env['DEEP_FFMPEG'] : process.env['DEEP_FFPROBE'];
  const candidates = [env, name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].filter((c): c is string => !!c);
  for (const c of candidates) {
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}
let tools: { ffmpeg: string; ffprobe: string } | null | undefined;
/** ffmpeg and ffprobe with libx264 and the setts filter, or the test fails `BLOCKED:`. */
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
  if (!tools) expect.fail('BLOCKED: these fixtures are made by ffmpeg (libx264 and the setts bitstream filter, FFmpeg 4.4 or later) with ffprobe; none was found on PATH, /opt/homebrew/bin or DEEP_FFMPEG/DEEP_FFPROBE. Unblock: brew install ffmpeg');
  return tools;
}
export function ffmpeg(args: string[], input?: Buffer): Buffer {
  const t = ffmpegTools();
  return execFileSync(t.ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : { stdio: ['ignore', 'pipe', 'pipe'] }) });
}
export function ffprobeJson(args: string[]): JsonObject {
  const t = ffmpegTools();
  return JSON.parse(execFileSync(t.ffprobe, ['-v', 'error', '-of', 'json', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })) as JsonObject;
}

/** The video stream's presentation times as ffprobe reads them, in its time base, and that time base. Used only to
 * check a fixture came out as its recipe says. */
export function probeFixture(path: string): { tb: string; pts: number[]; color: JsonObject; width: number; height: number } {
  const s = obj(arr(ffprobeJson(['-select_streams', 'v:0', '-show_entries', 'stream=time_base,width,height,color_range,color_space,color_transfer,color_primaries', path])['streams'], 'ffprobe streams')[0], 'ffprobe stream');
  const frames = arr(ffprobeJson(['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=pts', path])['frames'], 'ffprobe frames');
  return {
    tb: str(s['time_base'], 'ffprobe time_base'), width: int(s['width'], 'ffprobe width'), height: int(s['height'], 'ffprobe height'), color: s,
    pts: frames.map((f, i) => int(obj(f, `ffprobe frame ${i}`)['pts'], `ffprobe frame ${i} pts`)).sort((a, b) => a - b),
  };
}

/** Criterion 7's first fixture: 60 frames at 30 fps in an MP4 whose video time base is 1/15360, frame k presented at
 * (512k + 1)/15360 s (a composition offset of one tick, no edit list), so no frame's time is a whole number of flicks. */
export function cfr30(path: string): void {
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-frames:v', '60', '-c:v', 'libx264', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p',
    '-enc_time_base', '1/15360', '-bsf:v', 'setts=pts=PTS+1', '-video_track_timescale', '15360', '-use_editlist', '0', path]);
}
export const CFR30_PTS = Array.from({ length: 60 }, (_, k) => 512 * k + 1);

/** Criterion 7's second fixture: a screen recording in a MOV at time base 1/600, nominally 60 fps (10 ticks a frame),
 * 20 frames, whose frame 10 lasts three nominal frames (30 ticks). */
export function screenVfr(path: string): void {
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=60', '-frames:v', '20', '-c:v', 'libx264', '-bf', '0', '-g', '60', '-pix_fmt', 'yuv420p',
    '-bsf:v', 'setts=ts=if(gt(N\\,10)\\,PTS+2\\,PTS)', '-video_track_timescale', '600', '-use_editlist', '0', path]);
}
export const VFR_PTS = Array.from({ length: 20 }, (_, k) => (k <= 10 ? 10 * k : 10 * k + 20));

/** An AAC-LC M4A of `seconds` of a 440 Hz tone. */
export function m4a(path: string, seconds: number): void {
  ffmpeg(['-y', '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`, '-c:a', 'aac', '-b:a', '96k', path]);
}

// 75% colour bars (README: Fixtures, criterion 8): eight bars left to right, each W/8 wide.
export const BARS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'white', rgb: [191, 191, 191] }, { name: 'yellow', rgb: [191, 191, 0] }, { name: 'cyan', rgb: [0, 191, 191] }, { name: 'green', rgb: [0, 191, 0] },
  { name: 'magenta', rgb: [191, 0, 191] }, { name: 'red', rgb: [191, 0, 0] }, { name: 'blue', rgb: [0, 0, 191] }, { name: 'black', rgb: [0, 0, 0] },
];
/** One frame of the bars as limited-range Y'CbCr 4:2:0 planes (I420), converted by the test with the given matrix. */
export function barsI420(w: number, h: number, matrix: 'bt709' | 'bt601'): Buffer {
  const k = matrix === 'bt709' ? { r: 0.2126, b: 0.0722 } : { r: 0.299, b: 0.114 };
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
/** Three frames of the bars in H.264 (libx264, QP 10, no B-frames) in an MP4; untagged unless `tag709`, which writes
 * BT.709 primaries, transfer and matrix and limited range in the stream and the container. */
export function barsMp4(path: string, w: number, h: number, matrix: 'bt709' | 'bt601', tag709 = false): void {
  const f = barsI420(w, h, matrix);
  // setparams only labels the frames (no conversion), so the encoder writes the tags.
  const tags = tag709 ? ['-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'] : [];
  ffmpeg(['-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${w}x${h}`, '-r', '30', '-i', '-', '-c:v', 'libx264', '-qp', '10', '-bf', '0', '-pix_fmt', 'yuv420p', ...tags, path], Buffer.concat([f, f, f]));
}

/** What is wrong with BGRA8 `bytes` of a w × h frame of the bars against the reference RGB: per bar, the worst channel
 * error over its interior (16 px from each side of the bar, the middle half of the rows), when over `tol` code values. */
export function barsErrors(bytes: Buffer, w: number, h: number, tol: number): { bar: string; want: number[]; got: number[]; off: number }[] {
  const out: { bar: string; want: number[]; got: number[]; off: number }[] = [];
  const bw = w / 8;
  BARS.forEach((bar, i) => {
    let worst = 0; let got: number[] = [];
    for (let y = Math.floor(h / 4); y < Math.floor((3 * h) / 4); y += 2) {
      for (let x = i * bw + 16; x < (i + 1) * bw - 16; x += 2) {
        const o = (y * w + x) * 4;
        const px = [bytes[o + 2]!, bytes[o + 1]!, bytes[o]!]; // BGRA → RGB
        const off = Math.max(...px.map((v, c) => Math.abs(v - bar.rgb[c]!)));
        if (off > worst) { worst = off; got = px; }
      }
    }
    if (worst > tol) out.push({ bar: bar.name, want: bar.rgb, got, off: worst });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Files that point at a URL (criterion 2)

/** An HLS playlist whose one segment is at `url`. */
export function hlsPlaylist(url: string): string {
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.0,\n${url}\n#EXT-X-ENDLIST\n`;
}

/** A QuickTime movie whose video track's data reference is an external `url ` entry pointing at `url` (flags 0: the
 * media is not in this file). Made from a one-second movie ffmpeg writes with its `mdat` before its `moov`, by
 * rewriting the track's `dref` and the sizes of the boxes holding it; the chunk offsets still point into the `mdat`. */
export function movWithUrlDataRef(path: string, url: string): void {
  const tmp = `${path}.src.mov`;
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=30', '-frames:v', '30', '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p', tmp]);
  const src = readFileSync(tmp);
  rmSync(tmp, { force: true });
  const top = topBoxes(src);
  const order = top.boxes.map((b) => b.type);
  expect(order.indexOf('mdat') >= 0 && order.indexOf('mdat') < order.indexOf('moov'), `fixture: ffmpeg wrote mdat before moov (${order.join(', ')})`).toBe(true);
  const urlBox = (): Buffer => {
    const body = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(url, 'latin1'), Buffer.from([0])]);
    const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write('url ', 4, 'latin1');
    return Buffer.concat([h, body]);
  };
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'dinf']);
  let replaced = 0;
  const rewrite = (b: Buffer, path: string[]): Buffer => {
    const out: Buffer[] = [];
    let off = 0;
    while (off + 8 <= b.length) {
      const size = b.readUInt32BE(off);
      const type = b.toString('latin1', off + 4, off + 8);
      const body = b.subarray(off + 8, off + size);
      let nb: Buffer;
      if (type === 'dref' && path.includes('minf')) {
        const entries = Buffer.concat([body.subarray(0, 4), Buffer.from([0, 0, 0, 1]), urlBox()]);
        nb = entries; replaced++;
      } else if (CONTAINERS.has(type)) nb = rewrite(body, [...path, type]);
      else nb = body;
      const h = Buffer.alloc(8); h.writeUInt32BE(8 + nb.length); h.write(type, 4, 'latin1');
      out.push(h, nb);
      off += size;
    }
    return Buffer.concat(out);
  };
  const moov = top.boxes.find((b) => b.type === 'moov')!;
  const before = src.subarray(0, moov.start);
  const after = src.subarray(moov.start + moov.size);
  const newMoov = rewrite(src.subarray(moov.start, moov.start + moov.size), []);
  expect(replaced, 'fixture: the movie\'s one track has one dref to rewrite').toBe(1);
  writeFileSync(path, Buffer.concat([before, newMoov, after]));
}

/**
 * A local TCP listener standing for a host a file points at: a child process of the test on an ephemeral port of
 * 127.0.0.1, stopped by its PID. Every connection it accepts appends `connect` to its log, and the first line of what
 * the peer sends, if any, `data <line>`.
 */
export class Listener {
  private child: ChildProcess | null = null;
  constructor(readonly log: string) {}
  async start(): Promise<number> {
    const code = `const fs=require('fs');const s=require('net').createServer((c)=>{fs.appendFileSync(${JSON.stringify(this.log)},'connect\\n');c.once('data',(d)=>{fs.appendFileSync(${JSON.stringify(this.log)},'data '+String(d).split('\\r\\n')[0]+'\\n')});c.on('error',()=>{});setTimeout(()=>c.destroy(),2000)});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
    this.child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
    return new Promise((resolve, reject) => {
      this.child!.stdout!.once('data', (d: Buffer) => resolve(Number(String(d).trim())));
      this.child!.once('error', reject);
    });
  }
  lines(): string[] { return existsSync(this.log) ? readFileSync(this.log, 'utf8').split('\n').filter(Boolean) : []; }
  clear(): void { rmSync(this.log, { force: true }); }
  stop(): void { if (this.child?.pid) process.kill(this.child.pid); this.child = null; }
}
export const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------
// FATE (criterion 3): the samples fetched on first use into a cache outside the repository, and the reference
// outputs vendored under fixtures/fate.

export interface FateSample { ref: string; mak_line: number; sample: string; sha256: string; bytes: number; check: 'first_frame' | 'first_time' | 'first_video_and_audio_times' | 'start_time' | 'priming' }
export const FATE = JSON.parse(readFileSync(join(FIXTURES, 'fate', 'samples.json'), 'utf8')) as { commit: string; suite: string; samples: FateSample[] };

/** The cache the samples are fetched into: `DEEP_FATE_SAMPLES`, else the user's cache folder. Never in the checkout. */
export function fateCache(): string {
  const env = process.env['DEEP_FATE_SAMPLES'];
  if (env) return env;
  return process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'deepbuild', 'fate-suite') : join(homedir(), '.cache', 'deepbuild', 'fate-suite');
}

/** Each sample's path in the cache, fetched first when missing; a sample that can't be fetched or doesn't hash to its
 * pin makes the whole set unavailable, with the reason. */
export async function fetchFate(): Promise<{ paths: Map<string, string>; problem: string | null }> {
  const root = fateCache();
  const paths = new Map<string, string>();
  for (const s of FATE.samples) {
    const p = join(root, s.sample);
    if (!existsSync(p)) {
      let body: Buffer;
      try {
        const r = await fetch(`${FATE.suite}${s.sample}`, { signal: AbortSignal.timeout(120_000) });
        if (!r.ok) return { paths, problem: `${FATE.suite}${s.sample} answered HTTP ${r.status}` };
        body = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        return { paths, problem: `${FATE.suite}${s.sample} could not be fetched (${(e as Error).message})` };
      }
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(`${p}.part`, body);
      renameSync(`${p}.part`, p);
    }
    const got = sha256File(p);
    if (got !== s.sha256) return { paths, problem: `${p} hashes to ${got}, not the pinned ${s.sha256}; delete it to fetch it again` };
    paths.set(s.ref, p);
  }
  return { paths, problem: null };
}

/** A framemd5 reference: per stream, its time base, media type and dimensions, and its first frame line. */
export interface FrameMd5 { streams: Map<number, { tb: Rat; type: string; dims: [number, number] | null; first: { pts: bigint; size: number; hash: string } | null }> }
export function readFrameMd5(ref: string): FrameMd5 {
  const text = readFileSync(join(FIXTURES, 'fate', ref), 'utf8');
  const streams: FrameMd5['streams'] = new Map();
  const at = (i: number) => { if (!streams.has(i)) streams.set(i, { tb: R(0), type: '', dims: null, first: null }); return streams.get(i)!; };
  for (const line of text.split('\n')) {
    let m = /^#tb (\d+): (\d+)\/(\d+)$/.exec(line);
    if (m) { at(Number(m[1])).tb = R(BigInt(m[2]!), BigInt(m[3]!)); continue; }
    m = /^#media_type (\d+): (\w+)$/.exec(line);
    if (m) { at(Number(m[1])).type = m[2]!; continue; }
    m = /^#dimensions (\d+): (\d+)x(\d+)$/.exec(line);
    if (m) { at(Number(m[1])).dims = [Number(m[2]), Number(m[3])]; continue; }
    m = /^\s*(\d+),\s*(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+),\s*([0-9a-f]{32})$/.exec(line);
    if (m) { const s = at(Number(m[1])); if (!s.first) s.first = { pts: BigInt(m[3]!), size: Number(m[5]), hash: m[6]! }; }
  }
  return { streams };
}
/** `ffprobe -show_entries stream=start_time`'s reference: the start time as an exact rational. */
export function readStartTime(ref: string): Rat {
  const m = /^start_time=(-?[\d.]+)$/m.exec(readFileSync(join(FIXTURES, 'fate', ref), 'utf8'));
  if (!m) throw new Error(`${ref} has no start_time line`);
  return decimalRat(m[1]!);
}
/** `ffprobe -show_packets -print_format compact`'s reference: the time base (from the packets' pts against pts_time),
 * and the first packet's pts and the samples it skips. */
export function readPriming(ref: string): { tb: Rat; firstPts: bigint; skip: bigint } {
  const lines = readFileSync(join(FIXTURES, 'fate', ref), 'utf8').split('\n').filter((l) => l.startsWith('packet|'));
  const field = (l: string, k: string): string | null => { for (const p of l.split('|')) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i) === k) return p.slice(i + 1); } return null; };
  const last = lines[lines.length - 1]!;
  const lastPts = Number(field(last, 'pts'));
  const den = Math.round(lastPts / Number(field(last, 'pts_time')));
  for (const l of lines) {
    const p = Number(field(l, 'pts')); const t = Number(field(l, 'pts_time'));
    if (Math.abs(p / den - t) > 1e-6) throw new Error(`${ref}: pts ${p} and pts_time ${t} disagree with time base 1/${den}`);
  }
  const first = lines[0]!;
  return { tb: R(1, den), firstPts: BigInt(field(first, 'pts')!), skip: BigInt(field(first, 'side_datum/skip_samples:skip_samples') ?? '0') };
}
