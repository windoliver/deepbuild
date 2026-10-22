import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/392 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** #391's proof surface, extended here: `check`, `look`, `render` and `frames`. */
export const RENDER_BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-canvas-render.exe' : 'deep-canvas-render');
export const RENDER_BIN_NAME = 'deep-canvas-render';

// ---------------------------------------------------------------------------------------------------
// Time: flicks, 1/705,600,000 s.

export const FLICKS_PER_SECOND = 705_600_000;
export function sec(seconds: number): number {
  const flicks = Math.round(seconds * FLICKS_PER_SECOND);
  if (Math.abs(flicks - seconds * FLICKS_PER_SECOND) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return flicks;
}
/** One vsync at 60 Hz: 11,760,000 flicks. */
export const VSYNC_60 = FLICKS_PER_SECOND / 60;
export const seconds = (flicks: number): string => `${(flicks / FLICKS_PER_SECOND).toFixed(4)} s`;

// ---------------------------------------------------------------------------------------------------
// The nine states of the status map, in the look's order (canvas primitives: Status binding; Look).

export const STATES = ['pass', 'fail', 'invalid', 'blocked', 'inconclusive', 'running', 'needs_you', 'stale', 'idle'] as const;
export type State = (typeof STATES)[number];

// ---------------------------------------------------------------------------------------------------
// Fixtures and JSON

export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}

export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  return value as JsonObject;
}

export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  return value as JsonValue[];
}

export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value, `${what} is a number, got ${JSON.stringify(value)}`).toBe('number');
  return value as number;
}

export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)}`).toBe('string');
  return value as string;
}

/** A box `[x, y, w, h]` in pixels at scale 1. */
export type Box = [number, number, number, number];
export function box(value: JsonValue | undefined, what: string): Box {
  const list = arr(value, what);
  expect(list.length, `${what} is [x, y, w, h]`).toBe(4);
  const b = list.map((v, i) => num(v, `${what}[${i}]`)) as Box;
  expect(b[2] > 0 && b[3] > 0, `${what} has a positive size: ${JSON.stringify(b)}`).toBe(true);
  return b;
}

export type Rgb = [number, number, number];
export function rgb(value: JsonValue | undefined, what: string): Rgb {
  const list = arr(value, what);
  expect(list.length, `${what} is [r, g, b]`).toBe(3);
  const c = list.map((v, i) => num(v, `${what}[${i}]`)) as Rgb;
  expect(c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `${what} is sRGB-encoded 0–255: ${JSON.stringify(c)}`).toBe(true);
  return c;
}

/** JSON text with every object's keys sorted. */
export function canonical(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

export function buildBinary(name: string): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the binary once per file and fails every test of the file when it can't be built. */
export function useRenderBinary(): void {
  let error = '';
  beforeAll(() => { error = buildBinary(RENDER_BIN_NAME); }, 900_000);
  beforeEach(() => { expect(error, `the binary builds: ${RENDER_BIN_NAME}`).toBe(''); });
}

/** Pipes every input line into one run of `deep-canvas-render <subcommand>`; one parsed value per line. */
export function batch(subcommand: string, inputs: (JsonValue | string)[]): JsonValue[] {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const run = spawnSync(RENDER_BIN, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const name = `${RENDER_BIN_NAME} ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}

export function one(subcommand: string, input: JsonValue | string): JsonObject {
  return obj(batch(subcommand, [input])[0], `${RENDER_BIN_NAME} ${subcommand}: the answer`);
}

/** Fails with an INCONCLUSIVE message off macOS: the view is drawn with GPUI's offscreen Metal renderer. */
export function requireMacos(): void {
  expect(process.platform, 'INCONCLUSIVE: the view is drawn with GPUI\'s offscreen Metal renderer, macOS only; this is not a pass').toBe('darwin');
}

/** One GPU line: INCONCLUSIVE off macOS or on `unsupported_platform`; otherwise the raw answer. */
export function gpu(subcommand: string, input: JsonValue): JsonObject {
  requireMacos();
  const out = one(subcommand, input);
  if (out['ok'] !== true && out['code'] === 'unsupported_platform') {
    expect.fail(`INCONCLUSIVE: ${RENDER_BIN_NAME} ${subcommand} reports unsupported_platform; this is not a pass`);
  }
  return out;
}

/** One GPU line that must be accepted. */
export function drawn(subcommand: string, input: JsonValue): JsonObject {
  const out = gpu(subcommand, input);
  expect(out['ok'], `${RENDER_BIN_NAME} ${subcommand} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The shipped clean pipeline look, as `look` resolves it.

let cleanLook: JsonObject | null = null;
export function clean(): JsonObject {
  if (cleanLook === null) {
    const out = one('look', { look: 'clean' });
    expect(out['ok'], `look "clean" is the shipped clean pipeline look: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
    cleanLook = obj(out['look'], 'look "clean": look');
  }
  return clone(cleanLook);
}

/** The look's glyph for each state (`status_treatment.glyph`). */
export function glyphs(look: JsonObject): Record<State, string> {
  const treatment = obj(look['status_treatment'], 'look.status_treatment');
  const map = obj(treatment['glyph'], 'look.status_treatment.glyph');
  const out = {} as Record<State, string>;
  for (const s of STATES) out[s] = str(map[s], `look.status_treatment.glyph.${s}`);
  return out;
}

/** The look with state `b` given state `a`'s glyph: a planted look the status guard must refuse. */
export function sharedGlyphLook(a: State, b: State): JsonObject {
  const look = clean();
  const map = obj(obj(look['status_treatment'], 'status_treatment')['glyph'], 'status_treatment.glyph');
  map[b] = map[a]!;
  return look;
}

// ---------------------------------------------------------------------------------------------------
// PNG: a reader for what the render writes (8-bit RGB or RGBA, no interlace), node built-ins only.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Image {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!file.subarray(0, 8).equals(signature)) throw Error('not a PNG');
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

export function readPng(path: string): Image { return decodePng(readFileSync(path)); }

export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}

export const same = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Every whole pixel whose center lies inside `b` (a pixel (x, y) covers [x, x + 1) × [y, y + 1)). */
export function pixelsIn(image: Image, b: Box, inset = 0): [number, number][] {
  const out: [number, number][] = [];
  const x0 = Math.max(0, Math.ceil(b[0] + inset - 0.5)); const x1 = Math.min(image.width - 1, Math.floor(b[0] + b[2] - inset - 0.5));
  const y0 = Math.max(0, Math.ceil(b[1] + inset - 0.5)); const y1 = Math.min(image.height - 1, Math.floor(b[1] + b[3] - inset - 0.5));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

export const inside = (b: Box, x: number, y: number, grow = 0): boolean =>
  x + 0.5 >= b[0] - grow && x + 0.5 <= b[0] + b[2] + grow && y + 0.5 >= b[1] - grow && y + 0.5 <= b[1] + b[3] + grow;

/** The band of pixels `from` to `to` pixels outside `b` (a ring around it), clipped to the image. */
export function ring(image: Image, b: Box, from: number, to: number): [number, number][] {
  return pixelsIn(image, [b[0] - to, b[1] - to, b[2] + 2 * to, b[3] + 2 * to]).filter(([x, y]) => !inside(b, x, y, from - 1));
}

/** The most common color among `points` (ties: the first seen). */
export function mode(image: Image, points: [number, number][]): Rgb {
  const counts = new Map<number, number>();
  let best = -1; let bestKey = 0;
  for (const [x, y] of points) {
    const c = pixel(image, x, y);
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > best) { best = n; bestKey = key; }
  }
  if (best < 0) throw Error('mode of no pixels');
  return [(bestKey >> 16) & 255, (bestKey >> 8) & 255, bestKey & 255];
}

// ---------------------------------------------------------------------------------------------------
// Color: the sRGB curve, WCAG 2.x relative luminance and contrast, Ottosson's OKLab, and Machado,
// Oliveira and Fernandes 2009's color-vision simulation at full severity.

export function toLinear(code: number): number {
  const c = code / 255;
  // WCAG 2.x's threshold is 0.03928, the sRGB standard's 0.04045; no 8-bit code lies between them.
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function toCode(linear: number): number {
  const l = Math.min(1, Math.max(0, linear));
  const c = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

/** WCAG 2.x relative luminance of an sRGB-encoded color. */
export function luminance(c: Rgb): number {
  return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
}

/** WCAG 2.x contrast ratio, (L1 + 0.05) / (L2 + 0.05) with L1 the lighter. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** OKLab (Björn Ottosson's published matrices) of an sRGB-encoded color. */
export function oklab(c: Rgb): [number, number, number] {
  const r = toLinear(c[0]); const g = toLinear(c[1]); const b = toLinear(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function deltaEOk(a: Rgb, b: Rgb): number {
  const p = oklab(a); const q = oklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export const chroma = (c: Rgb): number => { const [, a, b] = oklab(c); return Math.hypot(a, b); };

export type Deficiency = 'protanopia' | 'deuteranopia' | 'tritanopia';
export const DEFICIENCIES: Deficiency[] = ['protanopia', 'deuteranopia', 'tritanopia'];

/** Machado, Oliveira and Fernandes 2009, severity 1.0, applied in linear light (as colorspacious and DaltonLens do). */
const MACHADO: Record<Deficiency, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

export function simulate(c: Rgb, d: Deficiency): Rgb {
  const lin = [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];
  const m = MACHADO[d];
  return m.map((row) => toCode(row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!)) as Rgb;
}
