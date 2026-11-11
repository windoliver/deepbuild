// Test-side tools for the #1485 acceptance tests (README: The surface under test): the builds, `deep-canvas-render`
// driven by JSON lines, the stores pictures are read from, PNGs written in code and read back, the OS's peak resident
// memory of one run, the moving picture AC4 and AC5 draw, and the reference-Mac judge AC3's frame times go through.
// Nothing here stands in for a decoder, a cap, a cache, the Vello GPU renderer or the app's panel.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Box = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root: tests/acceptance/1485 is three levels down. */
export const REPO = join(HERE, '..', '..', '..');

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
/** A count: a whole number at or above 0. */
export function count(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isInteger(value) && value >= 0, `${what} is a count (a whole number ≥ 0), got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export const short = (value: JsonValue | undefined, n = 600): string => JSON.stringify(value)?.slice(0, n) ?? 'undefined';
export const mb = (bytes: number): string => (bytes / 1e6).toFixed(1);
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// PNG, written with node's zlib and read back (8-bit RGB or RGBA, no interlace; #674's reader).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}
/** A PNG whose IHDR says `width` × `height` at `depth` bits, color type `color`, and whose one IDAT is `idat`. */
function pngOf(width: number, height: number, depth: number, color: number, idat: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = color; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** An opaque 8-bit RGBA PNG of one color. One flat color compresses well, so a big picture is a small file. */
export function flatPng(width: number, height: number, rgb: Rgb): Buffer {
  const stride = 1 + width * 4;
  const row = Buffer.alloc(stride);
  for (let x = 0; x < width; x++) row.set([rgb[0], rgb[1], rgb[2], 255], 1 + x * 4);
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * stride);
  return pngOf(width, height, 8, 6, deflateSync(raw, { level: 9 }));
}

/**
 * A 1-bit grayscale PNG of `width` × `height`, every pixel black, its one IDAT a whole zlib stream of the first `rows`
 * rows (every row by default). With every row it decodes whole; with fewer, its header still says `width` × `height`.
 */
export function blackBits(width: number, height: number, rows = height): Buffer {
  const stride = 1 + Math.ceil(width / 8);
  return pngOf(width, height, 1, 0, deflateSync(Buffer.alloc(stride * rows), { level: 9, memLevel: 9 }));
}

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}

export function pixel(image: Image, x: number, y: number): Rgb {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw Error(`(${x}, ${y}) is outside the ${image.width} × ${image.height} image`);
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** Whether two colors are within `tolerance` code values in every channel. */
export const near = (a: Rgb, b: Rgb, tolerance = 3): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

// ---------------------------------------------------------------------------------------------------
// Stores. `deep-canvas-render`'s `store` is a flat folder whose files are named by their sha256; the app's evidence
// store keeps a file at `<dir>/<sha[0..2]>/<sha[2..]>`, as the canvas panel reads it.

/** A scratch folder, deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-1485-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes `bytes` into the flat store `dir` under its sha256; returns the hash. */
export function put(dir: string, bytes: Uint8Array): string {
  const hash = sha256(bytes);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, hash), bytes);
  return hash;
}

/** Writes `bytes` into the evidence store `dir` as the canvas panel reads it; returns the hash. */
export function putEvidence(dir: string, bytes: Uint8Array): string {
  const hash = sha256(bytes);
  mkdirSync(join(dir, hash.slice(0, 2)), { recursive: true });
  writeFileSync(join(dir, hash.slice(0, 2), hash.slice(2)), bytes);
  return hash;
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once, copies the binary out of target/ (so a sibling file's build can't
// replace it mid-run) and fails each test that needs a build that failed, with cargo's error. `cargo` comes from PATH.

const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};

function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const said = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading|Finished/.test(l)).join('\n');
  return `cargo ${args.join(' ')} failed:\n${said.slice(0, 4000)}`;
}

export const RENDER_BUILD = ['build', '--locked', '--bin', 'deep-canvas-render'];
/** AC3's app: the shipped app's binary in a build with the `canvas-fixture` feature, in release, as the app ships. */
export const APP_BUILD = ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'canvas-fixture'];

/**
 * Builds once before the file's tests (only where `when` holds) and returns a getter: the copied binary's path, or a
 * failed test naming cargo's error.
 */
export function useBuild(args: string[], name: string, profile: 'debug' | 'release', when: () => boolean = () => true): () => string {
  let dir = '';
  let error = 'not built here';
  beforeAll(() => {
    if (!when()) return;
    dir = mkdtempSync(join(tmpdir(), `deep-1485-bin-`));
    error = cargo(args);
    if (error === '') copyFileSync(join(REPO, 'target', profile, name), join(dir, name));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, `it builds: cargo ${args.join(' ')}`).toBe('');
    return join(dir, name);
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render <subcommand>`: one JSON line in per request, one out per line, in order.

export function batch(bin: string, subcommand: string, inputs: JsonValue[], timeoutMs = 600_000): JsonValue[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const name = `deep-canvas-render ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}

export function one(bin: string, subcommand: string, input: JsonValue, timeoutMs?: number): JsonObject {
  return obj(batch(bin, subcommand, [input], timeoutMs)[0], `deep-canvas-render ${subcommand}: the answer`);
}

/** One request answered by a fresh process, and that process's peak resident memory as the OS counts it. */
export interface Measured { answer: JsonObject; peak: number | null; why: string }

/**
 * Runs `<bin> <subcommand>` on one line under `/usr/bin/time` (`-l` on macOS, which reports bytes; GNU `-v`
 * elsewhere, which reports kbytes) and reads the OS's maximum resident set size of the process. `peak` is null, with
 * the reason, where the OS reading can't be had.
 */
export function measured(bin: string, subcommand: string, input: JsonValue): Measured {
  const time = '/usr/bin/time';
  const flag = process.platform === 'darwin' ? '-l' : '-v';
  if (!existsSync(time)) {
    return { answer: one(bin, subcommand, input), peak: null, why: `${time} isn't on this machine, so the process's peak resident memory can't be read` };
  }
  const run = spawnSync(time, [flag, bin, subcommand], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  const name = `deep-canvas-render ${subcommand} under ${time} ${flag}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr.slice(-4000)}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line for the one input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  const bytes = /(\d+)\s+maximum resident set size/.exec(run.stderr);
  const kbytes = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(run.stderr);
  const peak = bytes ? Number(bytes[1]) : kbytes ? Number(kbytes[1]) * 1024 : null;
  return { answer, peak, why: peak === null ? `${time} ${flag} printed no maximum resident set size: ${run.stderr.slice(-600)}` : '' };
}

// ---------------------------------------------------------------------------------------------------
// The look and the documents, as `deep-canvas-render` reads them (#391's role map; #674's image items).

/** The ground: a blue no picture in this suite is drawn in. */
export const GROUND: Rgb = [60, 120, 200];
export const LOOK: JsonObject = { light: { ground: GROUND, ink: [0, 0, 0] } };

export interface ImageSpec {
  id: string;
  asset: string;
  box: Box;
  sampling?: string;
  /** The item's `adjust` (Item and kind); one that changes a color moves the item's layer to Vello GPU. */
  adjust?: JsonObject;
  at?: JsonObject;
}

/** A board of `size` u with one writer layer holding `images`, in order, each `fit: fill` into its box. */
export function board(size: [number, number], images: ImageSpec[], extra: JsonObject = {}): JsonObject {
  const items: JsonObject = {};
  images.forEach((spec, i) => {
    items[spec.id] = {
      id: spec.id, kind: 'image@1', layer: 'main', name: spec.id, order: `a${i}`,
      params: { asset: spec.asset, box: spec.box, fit: 'fill', alt: 'A picture for the image@1 decode test', ...(spec.sampling === undefined ? {} : { sampling: spec.sampling }) },
      ...(spec.adjust === undefined ? {} : { adjust: spec.adjust }),
      ...(spec.at === undefined ? {} : { at: spec.at }),
    };
  });
  return {
    format: 1, id: 'image-1485', profile: 'board', title: 'Pictures', description: 'Images decoded once, inside the 64 MB budget.', size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items, ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------
// Where a test can't be judged: it skips with a reason starting INCONCLUSIVE, never passing.

export function onlyOnMacos(ctx: TestContext, what: string): void {
  if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE: ${what} draws with GPUI's offscreen Metal renderer, macOS only; this is ${process.platform}`);
}

/** Skips as INCONCLUSIVE when a GPUI subcommand answers unsupported_platform. */
export function skipUnsupported(ctx: TestContext, answer: JsonObject, what: string): void {
  if (answer['ok'] === false && answer['code'] === 'unsupported_platform') ctx.skip(`INCONCLUSIVE: ${what} answers unsupported_platform here`);
}

// ---------------------------------------------------------------------------------------------------
// AC4 and AC5's moving picture: one image whose item `adjust` inverts its colors, so its writer layer is one GPUI
// can't draw and draws on Vello GPU (#385), moved 1 u further each frame by a channel, so every one of 60 vsyncs at
// 60 Hz presents a frame and draws the layer again. Read through `deep-canvas-render frames` (#391's frame clock).

export const MOVING_VSYNCS = 60;
/** The picture: 64 × 64 px of one color; inverted, it draws in the other. */
export const MOVING_COLOR: Rgb = [200, 40, 40];
export const MOVING_INVERTED: Rgb = [55, 215, 215];
const MOVING_BOX: Box = [10, 30, 40, 40];

export function movingDoc(asset: string): JsonObject {
  return board([160, 100], [{ id: 'photo', asset, box: MOVING_BOX, sampling: 'linear', adjust: { invert: true }, at: { pos: [0, 0, 0] } }], {
    transport: { span: '1s' },
    channels: {
      slide: {
        target: 'items/photo/at/pos/0', type: 'f32',
        keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '1s', value: 60, interp: 'linear' } },
      },
    },
  });
}

/** One vsync of `frames`, with the counts this suite reads (README: `frames`, per vsync). */
export interface CountedVsync { presented: boolean; reads: number; decodes: number; uploads: number }
export interface Moving { vsyncs: CountedVsync[]; last: Image }

/**
 * `frames` over the moving picture: 60 vsyncs at 60 Hz, the frame on screen at the last vsync written as a PNG. Every
 * vsync must present (the picture moves each frame) and the last frame must show the picture, inverted, where it has
 * moved to and not where it started, so a count is read off frames that really drew it.
 */
export function moving(bin: string, dir: string, asset: string, planted?: string): Moving {
  const what = `frames over the moving picture${planted ? `, planted ${planted}` : ''}`;
  const out = join(dir, `last-${planted ?? 'honest'}.png`);
  const answer = one(bin, 'frames', {
    doc: movingDoc(asset), look: LOOK, view: { zoom: 1 }, vsyncs: MOVING_VSYNCS, store: dir,
    captures: [{ vsync: MOVING_VSYNCS - 1, out }], ...(planted ? { planted } : {}),
  });
  expect(answer['ok'], `${what} refused: ${short(answer, 2000)}`).toBe(true);
  const raw = arr(answer['vsyncs'], `${what}: vsyncs`);
  expect(raw.length, `${what}: one record per vsync`).toBe(MOVING_VSYNCS);
  const vsyncs = raw.map((v, k) => {
    const r = obj(v, `${what}: vsyncs[${k}]`);
    const images = obj(r['images'], `${what}: vsyncs[${k}].images (README: frames, per vsync)`);
    return {
      presented: r['presented'] === true,
      reads: count(images['reads'], `${what}: vsyncs[${k}].images.reads`),
      decodes: count(images['decodes'], `${what}: vsyncs[${k}].images.decodes`),
      uploads: count(images['uploads'], `${what}: vsyncs[${k}].images.uploads`),
    };
  });
  const idle = vsyncs.map((v, k) => (v.presented ? -1 : k)).filter((k) => k >= 0);
  expect(idle, `${what}: the picture moves every frame, so every vsync presents one; these didn't`).toEqual([]);
  const last = decodePng(readFileSync(out));
  const moved = MOVING_VSYNCS - 1;
  const at = [MOVING_BOX[0] + moved + MOVING_BOX[2] / 2, MOVING_BOX[1] + MOVING_BOX[3] / 2] as const;
  const left = [MOVING_BOX[0] + 10, MOVING_BOX[1] + MOVING_BOX[3] / 2] as const;
  expect(near(pixel(last, at[0], at[1]), MOVING_INVERTED), `${what}: the last frame shows the picture inverted at (${at[0]}, ${at[1]}), where it has moved; it reads ${JSON.stringify(pixel(last, at[0], at[1]))}`).toBe(true);
  expect(near(pixel(last, left[0], left[1]), GROUND), `${what}: the last frame shows the ground at (${left[0]}, ${left[1]}), where the picture started; it reads ${JSON.stringify(pixel(last, left[0], left[1]))}`).toBe(true);
  return { vsyncs, last };
}

export const total = (vsyncs: readonly CountedVsync[], field: 'reads' | 'decodes' | 'uploads'): number => vsyncs.reduce((n, v) => n + v[field], 0);
/** The vsyncs that counted `field`, as `k: n`. */
export const where = (vsyncs: readonly CountedVsync[], field: 'reads' | 'decodes' | 'uploads'): string =>
  vsyncs.map((v, k) => (v[field] > 0 ? `${k}: ${v[field]}` : '')).filter((s) => s !== '').slice(0, 12).join(', ') || 'none';

// ---------------------------------------------------------------------------------------------------
// The reference Macs and the judge of a timing limit (docs/technical-design.md: Every task carries its own budgets, The
// reference Macs; the rule scripts/benchmark.mjs's judgeLimit holds, copied here). A frame-time limit counts only on a
// reference Mac on mains power, Low Power Mode off, thermal state nominal, unloaded; anywhere else it is a reading.

const REFERENCE_MACS = [
  { name: 'Mac15,7 (M3 Pro, 36 GB)', model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 },
  { name: 'Mac15,12 (M3, 16 GB)', model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 },
  { name: 'Mac17,10 (M5 Max, 64 GB)', model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30 },
];

export interface Machine {
  model: string | null; chip: string | null; memoryBytes: number | null;
  power: 'ac' | 'battery' | null; lowPowerMode: boolean | null; thermalState: string | null; macosBuild: string | null;
}

/** The machine a result ran under; a field it can't report is null, so the result is a reading. */
export function machine(): Machine {
  const read = (command: string, ...args: string[]): string | null => {
    const r = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const memory = Number(read('sysctl', '-n', 'hw.memsize'));
  const source = read('pmset', '-g', 'ps') ?? '';
  const objc = (expr: string): string | null => read('osascript', '-l', 'JavaScript', '-e', `ObjC.import("Foundation"); $.NSProcessInfo.processInfo.${expr}`);
  const lowPower = /^\s*lowpowermode\s+([01])\s*$/m.exec(read('pmset', '-g') ?? '')?.[1] ?? ({ true: '1', false: '0' } as Record<string, string>)[objc('isLowPowerModeEnabled') ?? ''];
  const thermal = Number(objc('thermalState'));
  return {
    model: read('sysctl', '-n', 'hw.model') || null,
    chip: read('sysctl', '-n', 'machdep.cpu.brand_string') || null,
    memoryBytes: Number.isSafeInteger(memory) && memory > 0 ? memory : null,
    power: /'AC Power'/.test(source) ? 'ac' : /'Battery Power'/.test(source) ? 'battery' : null,
    lowPowerMode: lowPower === undefined ? null : lowPower === '1',
    thermalState: ['nominal', 'fair', 'serious', 'critical'][thermal] ?? null,
    macosBuild: read('sw_vers', '-buildVersion') || null,
  };
}

export interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; limit: number; runs: number[]; margin?: number; reason?: string }

/**
 * Five runs after warm-up against `limit`: PASS when all five are within it, FAIL when all five are over it by more
 * than the margin (the larger of 5% and the runs' spread, as fractions of the limit), INCONCLUSIVE otherwise, and
 * INCONCLUSIVE off the reference Macs, off mains power, in Low Power Mode, at a thermal state past nominal, or when
 * the one-minute load at a run's start or end is above the core count or unread.
 */
export function judgeLimit(limit: number, runs: number[], m: Machine, loads: { start: number; end: number }[]): Verdict {
  if (runs.length !== 5 || runs.some((r) => !Number.isFinite(r) || r < 0)) return { status: 'BLOCKED', limit, runs, reason: `a limit is judged on five readings taken after warm-up, got ${JSON.stringify(runs)}` };
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const off: string[] = [];
  if (!REFERENCE_MACS.some((r) => r.model === m.model && r.chip === m.chip && r.memoryBytes === m.memoryBytes)) {
    off.push(`${m.model} / ${m.chip} / ${m.memoryBytes === null ? '?' : Math.round(m.memoryBytes / 2 ** 30)} GiB is none of ${REFERENCE_MACS.map((r) => r.name).join(', ')}`);
  }
  if (m.power !== 'ac') off.push(`power is ${m.power}, not mains`);
  if (m.lowPowerMode !== false) off.push(`Low Power Mode is ${m.lowPowerMode}`);
  if (m.thermalState !== 'nominal') off.push(`thermal state is ${m.thermalState}`);
  if (!m.macosBuild) off.push('the macOS build is missing');
  const cores = availableParallelism();
  const readings = loads.flatMap((l) => [l.start, l.end]);
  if (loads.length !== runs.length || readings.some((l) => !Number.isFinite(l) || l < 0)) off.push(`the load at each run's start and end can't be read: ${JSON.stringify(loads)}`);
  else if (readings.some((l) => l > cores)) off.push(`load ${Math.max(...readings).toFixed(1)} at a run's start or end is above the ${cores} cores`);
  if (off.length) return { status: 'INCONCLUSIVE', limit, runs, margin, reason: `a reading, not a budget result: ${off.join('; ')}` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', limit, runs, margin };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', limit, runs, margin, reason: `all five runs are over ${limit} by more than the ${(margin * 100).toFixed(1)}% margin` };
  return { status: 'INCONCLUSIVE', limit, runs, margin, reason: `the five runs are neither all within ${limit} nor all over it by more than the ${(margin * 100).toFixed(1)}% margin` };
}

/** The nearest-rank percentile `p` (0..1) of `values`. */
export function percentile(values: readonly number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]!;
}
