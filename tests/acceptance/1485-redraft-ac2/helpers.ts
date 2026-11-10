// Test-side tools for the blind redraft of #1485 AC2, copied from tests/acceptance/1485/helpers.ts (the build, the
// JSON-line driver of `deep-canvas-render`, the flat store, PNGs written in code and read back, the look). Nothing here
// stands in for a decoder, a cap or a renderer.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Box = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root: tests/acceptance/1485-redraft-ac2 is three levels down. */
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
export const short = (value: JsonValue | undefined, n = 600): string => JSON.stringify(value)?.slice(0, n) ?? 'undefined';
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// PNG, written with node's zlib and read back (8-bit RGB or RGBA, no interlace).

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
// The store. `deep-canvas-render`'s `store` is a flat folder whose files are named by their sha256.

/** A scratch folder, deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-1485-redraft-ac2-${prefix}-`));
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

// ---------------------------------------------------------------------------------------------------
// The build: built once, the binary copied out of target/ (so another build can't replace it mid-run), and each test
// that needs it fails with cargo's error when it didn't build. `cargo` comes from PATH.

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

/** Builds once before the file's tests and returns a getter: the copied binary's path, or a failed test naming cargo's error. */
export function useBuild(args: string[], name: string, profile: 'debug' | 'release'): () => string {
  let dir = '';
  let error = 'not built here';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `deep-1485-redraft-ac2-bin-`));
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

// ---------------------------------------------------------------------------------------------------
// The look, as `deep-canvas-render` reads it (#391's role map).

/** The ground: a blue no picture in this suite is drawn in. */
export const GROUND: Rgb = [60, 120, 200];
export const LOOK: JsonObject = { light: { ground: GROUND, ink: [0, 0, 0] } };

// ---------------------------------------------------------------------------------------------------
// Where a test can't be judged: it skips with a reason starting INCONCLUSIVE, never passing.

export function onlyOnMacos(ctx: TestContext, what: string): void {
  if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE: ${what} draws with GPUI's offscreen Metal renderer, macOS only; this is ${process.platform}`);
}

/** Skips as INCONCLUSIVE when a GPUI subcommand answers unsupported_platform. */
export function skipUnsupported(ctx: TestContext, answer: JsonObject, what: string): void {
  if (answer['ok'] === false && answer['code'] === 'unsupported_platform') ctx.skip(`INCONCLUSIVE: ${what} answers unsupported_platform here`);
}
