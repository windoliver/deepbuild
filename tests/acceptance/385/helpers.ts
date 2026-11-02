// Test-side tools for the #385 acceptance tests: the binaries built once per Cargo feature set and copied out under
// their own names (#377's and #140's pattern), driven by JSON lines; the fixtures this suite draws, built here so every
// expected value sits next to the document it comes from; PNG reading; the perceptual oracle the design says is
// reviewed test code (interior pixels, coverage and centroids, after #140's); the W3C Compositing and Blending
// formulas in f64; OKLab; the machine gates; and the budget judge. Nothing here stands in for a renderer under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/385 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 800)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file per feature set, copied out of target/debug under its own name.

export interface Build { bin: string; features?: string[] }
const key = (b: Build): string => `${b.bin}${b.features?.length ? `+${b.features.join(',')}` : ''}`;
const cargoArgs = (b: Build): string[] => ['build', '--locked', '--bin', b.bin, ...(b.features?.length ? ['--features', b.features.join(',')] : [])];
export const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };

function cargoBuild(b: Build): string {
  const args = cargoArgs(b);
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: CARGO_ENV });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Builds { bin: (b: Build) => string }

/** Builds every listed binary once before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-385-bins-'));
    for (const b of builds) {
      if (made.has(key(b))) continue;
      const error = cargoBuild(b);
      const bin = join(dir, key(b).replace(/[^A-Za-z0-9_-]/g, '_'));
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', b.bin), bin);
      made.set(key(b), { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build): string {
      const entry = made.get(key(b));
      if (!entry) throw Error(`the file didn't list the build ${key(b)} in useBuilds`);
      expect(entry.error, `the binary builds: cargo ${cargoArgs(b).join(' ')}`).toBe('');
      return entry.bin;
    },
  };
}

export const RENDER: Build = { bin: 'deep-canvas-render' };
export const DEEP_GPU: Build = { bin: 'deep-gpu' };
/** README: `--spike-record <file>` and nothing else; no shipped build has it. */
export const DEEP_GPU_SPIKE: Build = { bin: 'deep-gpu', features: ['test-spike'] };

// ---------------------------------------------------------------------------------------------------
// Running a binary: JSON lines in, one JSON line out per line in.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, {
    cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024,
    timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** Every input line answered, in order, exit 0: the answers. */
export function answers(bin: string, args: string[], inputs: JsonValue[], timeoutMs?: number): JsonObject[] {
  const s = start(bin, args, inputs, timeoutMs);
  const shown = `${bin.split('/').pop()} ${args.join(' ')}`;
  expect(s.timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-2000)}`).toBe(0);
  expect(s.lines.length, `${shown}: one output line per input line; stdout: ${s.stdout.slice(0, 1500)}`).toBe(inputs.length);
  return s.lines.map((l, i) => obj(l, `${shown}: answer ${i}`));
}

/** One answer that must be `ok: true`. */
export function ok(answer: JsonObject, what: string): JsonObject {
  expect(answer['ok'], `${what} answered ok: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  return answer;
}

/** A fresh temporary folder per test, deleted after it. */
export function useDir(prefix = 'deep-385-'): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), prefix)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// deep-canvas-render: `raster` (Vello CPU goldens) and `render` (GPUI's frame path)

let lines = 0;
/** A `raster` (or `render`) line for `doc`, writing a PNG under `dir`. */
export function drawLine(dir: string, doc: JsonObject, look: JsonValue, extra: JsonObject = {}): JsonObject {
  lines += 1;
  return { out: join(dir, `d${lines}.png`), doc, look, ...extra };
}

export interface Drawn { report: JsonObject; image: Image }

/** Reads a drawing's answer and its PNG; the answer must be accepted and the PNG the document's size. */
export function readDrawn(line: JsonObject, answer: JsonObject, what: string): Drawn {
  ok(answer, what);
  const size = arr(obj(line['doc'], 'doc')['size'], 'doc.size').map((v) => num(v, 'doc.size'));
  const image = decodePng(readFileSync(str(line['out'], 'out')));
  expect([image.width, image.height], `${what}: the PNG is the document's size`).toEqual(size);
  return { report: answer, image };
}

/** Lines drawn by one process of `deep-canvas-render <command>`, each read back. */
export function drawAll(bin: string, command: 'raster' | 'render', lines: JsonObject[], what: string): Drawn[] {
  const out = answers(bin, [command], lines);
  return out.map((a, i) => readDrawn(lines[i]!, a, `${command} ${what} [${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// deep-gpu run: a scenario of calls (README: the calls this suite adds)

export function gpuReplies(bin: string, out: string, calls: JsonObject[], args: string[] = [], timeoutMs?: number): JsonObject[] {
  const [answer] = answers(bin, ['run', ...args], [{ out, calls }], timeoutMs);
  const replies = arr(ok(answer!, `deep-gpu run ${args.join(' ')}`)['replies'], 'replies');
  expect(replies.length, 'one reply per call').toBe(calls.length);
  return replies.map((r, i) => obj(r, `reply ${i} (${String(calls[i]!['call'])})`));
}

/** A file the binary wrote into `out`, named by its SHA-256, checked against its name. */
export function outFile(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what}: its hash`);
  expect(h, `${what} is a SHA-256`).toMatch(SHA);
  const path = join(out, `${h}.${ext}`);
  expect(existsSync(path), `${what}: ${h}.${ext} is in the out folder`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the file hashes to its name`).toBe(h);
  return bytes;
}
export const outPng = (out: string, hash: JsonValue | undefined, what: string): Image => decodePng(outFile(out, hash, 'png', what));

export type Renderer = 'gpui' | 'gpu_layer' | 'vello_cpu';
export interface Side { image: Image; runs: Map<string, Image> }
export interface LayerReading { layer: string; dim: string; path: JsonValue; edges: Segment[]; drawn: Partial<Record<Renderer, Side | JsonObject>> }

/** A `layers` call (README). */
export const layersCall = (doc: JsonObject, look: JsonValue, by: Renderer[], extra: JsonObject = {}): JsonObject => ({ call: 'layers', doc, look, by, ...extra });

/** Reads a `layers` reply: per writer layer its edges, its draw path and each renderer's image and runs (or its refusal). */
export function readLayers(out: string, reply: JsonObject, what: string): Map<string, LayerReading> {
  const layers = new Map<string, LayerReading>();
  for (const [i, v] of arr(reply['layers'], `${what}: layers`).entries()) {
    const l = obj(v, `${what}: layers[${i}]`);
    const name = str(l['layer'], `${what}: layers[${i}].layer`);
    const drawn: LayerReading['drawn'] = {};
    const sides = obj(l['drawn'], `${what}/${name}: drawn`);
    for (const [r, sv] of Object.entries(sides)) {
      const s = obj(sv, `${what}/${name}: drawn.${r}`);
      if (s['ok'] === false) { drawn[r as Renderer] = s; continue; }
      const runs = new Map<string, Image>();
      for (const [k, rv] of arr(s['runs'] ?? [], `${what}/${name}: drawn.${r}.runs`).entries()) {
        const run = obj(rv, `${what}/${name}: drawn.${r}.runs[${k}]`);
        runs.set(`${str(run['id'], 'run id')}:${str(run['kind'], 'run kind')}`, outPng(out, run['png'], `${what}/${name}/${r}: run ${String(run['id'])}`));
      }
      drawn[r as Renderer] = { image: outPng(out, s['png'], `${what}/${name}: ${r}'s layer`), runs };
    }
    const edges = l['edges'] === undefined ? [] : JSON.parse(outFile(out, l['edges'], 'json', `${what}/${name}: edges`).toString('utf8')) as Segment[];
    layers.set(name, { layer: name, dim: String(l['dim']), path: l['path'] ?? null, edges, drawn });
  }
  return layers;
}
export function sideOf(reading: LayerReading | undefined, r: Renderer, what: string): Side {
  expect(reading, `${what}: the layer is in the reply`).toBeDefined();
  const s = reading!.drawn[r];
  expect(s, `${what}: ${r} drew the layer (asked in by)`).toBeDefined();
  expect('image' in s!, `${what}: ${r} drew the layer, not refused it: ${JSON.stringify(s).slice(0, 600)}`).toBe(true);
  return s as Side;
}

// ---------------------------------------------------------------------------------------------------
// Cargo.lock: the versions a renderer's name is checked against

export function lockedVersions(name: string): string[] {
  const lock = readFileSync(join(REPO, 'Cargo.lock'), 'utf8');
  return [...lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)].filter((m) => m[1] === name).map((m) => m[2]!);
}

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace)

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
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
export type Rgba = [number, number, number, number];
export const px = (im: Image, x: number, y: number): Rgba => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
};
/** The largest per-channel difference between two pixels. */
export const diff = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

/** The blank guard's measure (design: luma at most 0.06 over at least 98% of the pixels, Rec. 709 weights). */
export function isBlank(image: Image): boolean {
  let dark = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = image.rgba[o + 3]! / 255;
    const luma = a * (0.2126 * image.rgba[o]! + 0.7152 * image.rgba[o + 1]! + 0.0722 * image.rgba[o + 2]!) / 255;
    if (luma <= 0.06) dark++;
  }
  return dark >= 0.98 * n;
}

/** Compares two images pixel by pixel: the share within `codes` per channel, and the worst pixel. */
export function within(a: Image, b: Image, codes: number, mask?: (x: number, y: number) => boolean): { n: number; share: number; worst: { x: number; y: number; diff: number; a: Rgba; b: Rgba } | null } {
  expect([a.width, a.height], 'the two images are the same size').toEqual([b.width, b.height]);
  let n = 0; let good = 0; let worst: { x: number; y: number; diff: number; a: Rgba; b: Rgba } | null = null;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    if (mask && !mask(x, y)) continue;
    n++;
    const pa = px(a, x, y); const pb = px(b, x, y);
    const d = diff(pa, pb);
    if (d <= codes) good++;
    if (!worst || d > worst.diff) worst = { x, y, diff: d, a: pa, b: pb };
  }
  return { n, share: n ? good / n : 0, worst };
}

// ---------------------------------------------------------------------------------------------------
// The perceptual oracle (criterion 1; design: "Images from two renderers compare through one perceptual oracle,
// written as reviewed test code"), as #140's suite reads it. Edges are segments [x0, y0, x1, y1] in device px.

export type Segment = [number, number, number, number];

/** Pixels whose centre lies farther than `d` device px from every segment: the interior. */
export function interiorMask(width: number, height: number, edges: Segment[], d = 1.5): Uint8Array {
  const near = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of edges) {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - d - 1)); const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + d + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - d - 1)); const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + d + 1));
    const dx = x1 - x0; const dy = y1 - y0; const len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cx = x + 0.5; const cy = y + 0.5;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / len2));
        const ex = x0 + t * dx - cx; const ey = y0 + t * dy - cy;
        if (ex * ex + ey * ey <= d * d) near[y * width + x] = 1;
      }
    }
  }
  const interior = new Uint8Array(width * height);
  for (let i = 0; i < interior.length; i++) interior[i] = near[i] ? 0 : 1;
  return interior;
}

/** A coverage mask's summed coverage (alpha ÷ 255) and its coverage centroid in device px (pixel centres). */
export function coverage(mask: Image): { sum: number; cx: number; cy: number } {
  let sum = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const a = mask.rgba[(y * mask.width + x) * 4 + 3]! / 255;
    sum += a; sx += a * (x + 0.5); sy += a * (y + 0.5);
  }
  return { sum, cx: sum ? sx / sum : NaN, cy: sum ? sy / sum : NaN };
}

/**
 * Criterion 1's oracle over one 2D writer layer: the blank guard first; then GPUI against the GPU layer on the
 * interior pixels (farther than 1.5 device px from every edge the layer draws), within one 8-bit code value on 99.9%;
 * then each glyph run and stroke, per item, on each live side against Vello CPU: summed coverage within 2%, coverage
 * centroid within 0.1 device px. Every problem is a sentence naming what differs.
 */
export function layerParityProblems(name: string, reading: LayerReading, want: { glyphs: string[]; strokes: string[] }): string[] {
  const p: string[] = [];
  const g = sideOf(reading, 'gpui', `${name}: GPUI`);
  const l = sideOf(reading, 'gpu_layer', `${name}: the GPU layer`);
  const v = sideOf(reading, 'vello_cpu', `${name}: Vello CPU`);
  for (const [who, s] of [['GPUI', g], ['the GPU layer', l], ['Vello CPU', v]] as const) {
    if (isBlank(s.image)) p.push(`BLOCKED: ${name}: the layer drawn by ${who} is blank (the blank guard voids the comparison)`);
  }
  if (p.length) return p;
  if (g.image.width !== l.image.width || g.image.height !== l.image.height) return [`${name}: the layer is ${g.image.width} × ${g.image.height} by GPUI and ${l.image.width} × ${l.image.height} by the GPU layer`];
  if (reading.edges.length === 0) p.push(`${name}: the layer lists no edges`);
  const interior = interiorMask(g.image.width, g.image.height, reading.edges, 1.5);
  const r = within(g.image, l.image, 1, (x, y) => interior[y * g.image.width + x] === 1);
  if (r.n === 0) p.push(`${name}: no interior pixel to compare`);
  else if (r.share < 0.999) p.push(`${name}: interior pixels: ${(r.share * 100).toFixed(3)}% of ${r.n} within one code value between GPUI and the GPU layer, under 99.9%; worst at (${r.worst?.x}, ${r.worst?.y}), ${r.worst?.diff} codes (${JSON.stringify(r.worst?.a)} against ${JSON.stringify(r.worst?.b)})`);
  const items = [...want.glyphs.map((id) => `${id}:glyphs`), ...want.strokes.map((id) => `${id}:stroke`)];
  for (const k of v.runs.keys()) if (!items.includes(k)) items.push(k);
  for (const k of items) {
    const ref = v.runs.get(k);
    if (!ref) { p.push(`${name}: item ${k} is not drawn by Vello CPU`); continue; }
    const cv = coverage(ref);
    if (!(cv.sum > 0)) { p.push(`${name}: item ${k} covers nothing in Vello CPU`); continue; }
    for (const [who, s] of [['GPUI', g], ['the GPU layer', l]] as const) {
      const mine = s.runs.get(k);
      if (!mine) { p.push(`${name}: item ${k} is not drawn alone by ${who}`); continue; }
      const c = coverage(mine);
      if (!(Math.abs(c.sum - cv.sum) <= 0.02 * cv.sum)) p.push(`${name}: item ${k}: summed coverage ${c.sum.toFixed(2)} by ${who} against ${cv.sum.toFixed(2)} by Vello CPU, more than 2% apart`);
      const off = Math.hypot(c.cx - cv.cx, c.cy - cv.cy);
      if (!(off <= 0.1)) p.push(`${name}: item ${k}: coverage centroid (${c.cx.toFixed(3)}, ${c.cy.toFixed(3)}) by ${who} against (${cv.cx.toFixed(3)}, ${cv.cy.toFixed(3)}) by Vello CPU, ${off.toFixed(3)} device px apart`);
    }
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Color: the sRGB curve, OKLab (Ottosson), as the design's conventions name them

export const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toEncoded = (l: number): number => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
type V3 = [number, number, number];
export function linearToOklab([r, g, b]: V3): V3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklabToLinear([L, a, b]: V3): V3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

// ---------------------------------------------------------------------------------------------------
// The W3C Compositing and Blending Level 1 formulas, and Porter and Duff's plus (add, W3C's lighter), in f64.

export const MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color_dodge', 'color_burn', 'hard_light', 'soft_light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'add'] as const;
export type Mode = (typeof MODES)[number];
/** Vello GPU against the Vello CPU goldens: one code value, six for color dodge, two for color burn (the issue; Vello's mix suite's GPU tolerances). */
export const GPU_CODES: Record<Mode, number> = Object.fromEntries(MODES.map((m) => [m, m === 'color_dodge' ? 6 : m === 'color_burn' ? 2 : 1])) as Record<Mode, number>;

function separable(mode: Mode, cb: number, cs: number): number {
  const multiply = (b: number, s: number): number => b * s;
  const screen = (b: number, s: number): number => b + s - b * s;
  const hardLight = (b: number, s: number): number => (s <= 0.5 ? multiply(b, 2 * s) : screen(b, 2 * s - 1));
  switch (mode) {
    case 'normal': return cs;
    case 'multiply': return multiply(cb, cs);
    case 'screen': return screen(cb, cs);
    case 'overlay': return hardLight(cs, cb);
    case 'darken': return Math.min(cb, cs);
    case 'lighten': return Math.max(cb, cs);
    case 'color_dodge': return cb === 0 ? 0 : cs === 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 'color_burn': return cb === 1 ? 1 : cs === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 'hard_light': return hardLight(cb, cs);
    case 'soft_light': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 'difference': return Math.abs(cb - cs);
    case 'exclusion': return cb + cs - 2 * cb * cs;
    default: throw Error(`${mode} is not separable`);
  }
}
const lum = (c: V3): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: V3): V3 {
  const l = lum(c); const n = Math.min(...c); const x = Math.max(...c);
  let out = c.map((v) => v) as V3;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as V3;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as V3;
  return out;
}
const setLum = (c: V3, l: number): V3 => { const d = l - lum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); };
const sat = (c: V3): number => Math.max(...c) - Math.min(...c);
function setSat(c: V3, s: number): V3 {
  const idx = [0, 1, 2].sort((a, b) => c[a]! - c[b]!);
  const [lo, mid, hi] = idx as [number, number, number];
  const out: V3 = [0, 0, 0];
  const [cl, cm, ch] = [c[lo]!, c[mid]!, c[hi]!];
  if (ch > cl) { out[mid] = ((cm - cl) * s) / (ch - cl); out[hi] = s; }
  return out;
}
function blendRgb(mode: Mode, cb: V3, cs: V3): V3 {
  switch (mode) {
    case 'hue': return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation': return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color': return setLum(cs, lum(cb));
    case 'luminosity': return setLum(cb, lum(cs));
    default: return [0, 1, 2].map((i) => separable(mode, cb[i]!, cs[i]!)) as V3;
  }
}

/**
 * One pixel blended: `b` the backdrop and `s` the source as 8-bit premultiplied RGBA (what the renderer composites),
 * the result premultiplied in 0..1 (f64). W3C: co = cs(1 − αb) + cb(1 − αs) + αs·αb·B(Cb, Cs), αo = αs + αb(1 − αs);
 * add (Porter and Duff's plus): co = min(1, cs + cb), αo = min(1, αs + αb).
 */
export function blendPixel(mode: Mode, b: readonly number[], s: readonly number[]): Rgba {
  const ab = b[3]! / 255; const as = s[3]! / 255;
  const cb = [b[0]! / 255, b[1]! / 255, b[2]! / 255] as V3;
  const cs = [s[0]! / 255, s[1]! / 255, s[2]! / 255] as V3;
  if (mode === 'add') return [Math.min(1, cs[0] + cb[0]), Math.min(1, cs[1] + cb[1]), Math.min(1, cs[2] + cb[2]), Math.min(1, as + ab)];
  if (as === 0) return [cb[0], cb[1], cb[2], ab];
  const ao = as + ab * (1 - as);
  if (ab === 0) return [cs[0], cs[1], cs[2], ao];
  const Cb = cb.map((v) => Math.min(1, v / ab)) as V3;
  const Cs = cs.map((v) => Math.min(1, v / as)) as V3;
  const B = blendRgb(mode, Cb, Cs);
  return [0, 1, 2].map((i) => cs[i]! * (1 - ab) + cb[i]! * (1 - as) + as * ab * B[i]!).concat(ao) as Rgba;
}
/** Premultiplied source-over, 0..1 premultiplied in and out. */
export const over = (s: readonly number[], d: readonly number[]): Rgba => [0, 1, 2, 3].map((i) => s[i]! + d[i]! * (1 - s[3]!)) as Rgba;
/** A premultiplied 0..1 pixel as the straight 8-bit RGBA a PNG holds. */
export function straight8(p: readonly number[]): Rgba {
  const a = p[3]!;
  const c = (v: number): number => Math.round(Math.max(0, Math.min(1, a > 0 ? v / a : 0)) * 255);
  return [c(p[0]!), c(p[1]!), c(p[2]!), Math.round(a * 255)];
}
export const premul8To01 = (p: readonly number[]): Rgba => [p[0]! / 255, p[1]! / 255, p[2]! / 255, p[3]! / 255];

// ---------------------------------------------------------------------------------------------------
// The machine: macOS with Metal, the reference Mac (#377's gate), load, and the design's budget judge

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

/** Fails the test as INCONCLUSIVE (never a pass, never a skip), with the reason and any readings. */
export function inconclusive(reason: string, readings: string[] = []): never {
  expect.fail(`INCONCLUSIVE: ${reason}${readings.length ? `\n${readings.slice(0, 40).join('\n')}` : ''}`);
}
/** The GPU and GPUI parts need macOS (Metal; GPUI's offscreen Metal renderer). Anywhere else they are INCONCLUSIVE. */
export function needsMac(): void {
  if (process.platform !== 'darwin') inconclusive(`this part needs macOS with Metal (GPUI's offscreen Metal renderer and the GPU layer's wgpu device); platform ${process.platform}`);
}
/** Null on a fit reference Mac (Low Power Mode off, thermal state nominal); else why not. */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** Null when the machine is quiet enough for a timing reading; else the load (1-minute average above half the cores). */
export function loadProblem(): string | null {
  const [one] = loadavg();
  const cores = availableParallelism();
  return one! > cores / 2 ? `the machine is loaded: 1-minute load average ${one!.toFixed(1)} on ${cores} cores` : null;
}
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
const marginOf = (runs: number[]): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
/** The design's judge over five runs' readings: PASS when every run is within the limit; FAIL when every run is over it by more than the margin (the larger of 5% and the spread); else INCONCLUSIVE. */
export function judge(runs: number[], limit: number): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  if (runs.every((r) => r <= limit)) return 'PASS';
  const margin = marginOf(runs);
  return runs.every((r) => r > limit * (1 + margin)) ? 'FAIL' : 'INCONCLUSIVE';
}

// ---------------------------------------------------------------------------------------------------
// Looks. Pixel tests draw with this suite's role map (#391's form, no status map), so every color is set here.

export const LOOK: JsonObject = {
  light: {
    ground: [255, 255, 255], ink: [24, 26, 31], panel: [214, 218, 224], accent: [26, 163, 200],
    'g.a': [40, 70, 160], 'g.b': [236, 210, 120],
    black: [0, 0, 0], grey51: [51, 51, 51],
    'ramp.0': [0, 0, 0], 'ramp.1': [200, 120, 40], 'ramp.2': [255, 255, 255],
    blue: [0, 0, 255], magenta: [255, 0, 255], red: [255, 0, 0], yellow: [255, 255, 0], lime: [0, 255, 0],
    plate: [90, 160, 110],
    back: [51, 128, 200], src: [51, 26, 100],
    disc: [24, 64, 160],
  },
};
/** The writer layers' header every fixture uses: one layer `main` by agent-a unless it says otherwise. */
const MAIN = { main: { writer: 'agent-a', title: 'Main', order: 'a1' } };
const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });

/**
 * Criterion 1's 2D writer layer, one GPUI draws exactly (solid fills, a two-stop linear gradient through the exact
 * mode, a circle, a glyph run, a stroke): 320 × 200. The panel fill covers the layer, so a fill shifted two codes
 * reaches far more than 0.1% of its interior.
 */
export function writerDoc(): JsonObject {
  return {
    format: 1, id: 'writer-385', profile: 'figure', title: 'One 2D writer layer', description: 'A panel, a two-stop gradient band, a disc, a title and a stroked rule in one writer layer.', size: [320, 200],
    layers: MAIN,
    items: {
      panel: item('panel', 'rect@1', 'a0', { box: [0, 0, 320, 200], paint: { fill: { role: 'panel' } } }),
      band: item('band', 'rect@1', 'a1', { box: [16, 128, 288, 56], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'g.a' }, { at: 1, role: 'g.b' }] } } } }),
      dot: item('dot', 'circle@1', 'a2', { center: [262, 64], r: 30, paint: { fill: { role: 'accent' } } }),
      title: item('title', 'text@1', 'a3', { text: 'Parity, by GPUI and the GPU layer', font: 'body', size: 16, box: { w: 230, h: 24 } }, { at: { pos: [16, 16, 0] } }),
      rule: item('rule', 'path@1', 'a4', { d: 'M 16 104 C 80 72 160 132 304 98', paint: { stroke: { role: 'ink', width: 2 } } }),
    },
  };
}
export const WRITER_RUNS = { glyphs: ['title'], strokes: ['rule'] };

/** The vertical source ramp of Vello's mix scene (blue, magenta, red, yellow, lime at alpha 0.86), as group content. */
const SOURCE_STOPS: JsonValue = ['blue', 'magenta', 'red', 'yellow', 'lime'].map((role, i) => ({ at: i / 4, role, opacity: 0.86 }));
/** The source rect inside a 256 × 128 figure: inset, so the backdrop alone shows around it. */
export const SOURCE_BOX: [number, number, number, number] = [16, 8, 224, 112];

/**
 * Criterion 2's figure, after Vello's mix scene: a horizontal ramp (black, orange, white) over the whole 256 × 128
 * layer, and a group in `mode` holding a rect filled with the vertical five-stop source ramp at alpha 0.86.
 * With `group: false` the group and its rect are left out (the backdrop alone).
 */
export function blendDoc(mode: Mode, opts: { group?: boolean } = {}): JsonObject {
  const items: JsonObject = {
    ramp: item('ramp', 'rect@1', 'a0', { box: [0, 0, 256, 128], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'ramp.0' }, { at: 0.5, role: 'ramp.1' }, { at: 1, role: 'ramp.2' }] } } } }),
  };
  if (opts.group !== false) {
    items['mix'] = item('mix', 'group@1', 'a1', { blend: mode });
    items['src'] = item('src', 'rect@1', 'a2', { box: SOURCE_BOX, paint: { fill: { gradient: { kind: 'linear', from: [0.5, 0], to: [0.5, 1], stops: SOURCE_STOPS } } } }, { parent: 'mix' });
  }
  return { format: 1, id: `blend-${mode}`, profile: 'figure', title: `A group in ${mode}`, description: 'A group blended over a ramp.', size: [256, 128], layers: MAIN, items };
}

/**
 * Criterion 2's other writer: layer `under` (agent-b, drawn first) holds a plate over the whole figure; layer `main`
 * holds the ramp on the left half only and the group (multiply) across both halves. On the right half the group's own
 * layer drew nothing before it, so it blends with nothing there; the plate is another writer's.
 */
export function acrossDoc(opts: { group?: boolean } = {}): JsonObject {
  const doc = blendDoc('multiply', opts);
  doc['id'] = 'blend-across';
  doc['layers'] = { under: { writer: 'agent-b', title: 'Under', order: 'a0' }, ...MAIN };
  obj(obj(doc['items'], 'items')['ramp'], 'ramp')['params'] = { box: [0, 0, 128, 128], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'ramp.0' }, { at: 1, role: 'ramp.1' }] } } } };
  obj(doc['items'], 'items')['plate'] = { id: 'plate', kind: 'rect@1', layer: 'under', name: 'plate', order: 'a0', params: { box: [0, 0, 256, 128], paint: { fill: { role: 'plate' } } } };
  return doc;
}

/** The status binding's source and the state the tests pin it to (the clean look's pass color, #007429). */
export const GATE = 'verdict:01JB3850000000000000000001';
export const STATES: JsonObject = { [GATE]: 'pass' };
/** The status figure's gate (a status mark bound to a verdict) and the card's slot, both under the multiply group. */
export const GATE_BOX: [number, number, number, number] = [40, 40, 120, 32];
export const CARD_RECT: [number, number, number, number] = [200, 24, 200, 120];
/**
 * Criterion 2's status and card figure, in the shipped clean look: 420 × 180, a two-stop ramp (ink to raised), a
 * status mark `gate`, and a multiply group whose accent rect covers the gate and the card's slot.
 */
export function statusDoc(opts: { group?: boolean; blend?: Mode } = {}): JsonObject {
  const items: JsonObject = {
    ramp: item('ramp', 'rect@1', 'a0', { box: [0, 0, 420, 180], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'raised' }, { at: 1, role: 'muted' }] } } } }),
    gate: item('gate', 'rect@1', 'a1', { box: GATE_BOX }),
  };
  if (opts.group !== false) {
    items['mix'] = item('mix', 'group@1', 'a2', { blend: opts.blend ?? 'multiply' });
    items['wash'] = item('wash', 'rect@1', 'a3', { box: [20, 16, 390, 150], paint: { fill: { role: 'accent' } } }, { parent: 'mix' });
  }
  return {
    format: 1, id: 'blend-status', profile: 'board', title: 'A multiply group over a status mark', description: 'A multiply group over a status mark and under the card.', size: [420, 180],
    layers: MAIN, status_bindings: { 'gate-state': { target: 'items/gate/params/paint/fill', source: GATE } }, items,
  };
}
export const CARD: JsonObject = { ask: 'ask:01JB7A0000000000000000385', question: 'Ship the blend modes?', options: [{ id: 'ship', label: 'Ship it' }, { id: 'hold', label: 'Not yet' }], rect: CARD_RECT };

/** Criterion 3's figure: a horizontal OKLab gradient from black to grey 51 over the whole 257 × 64 figure; column 128's centre is t = 0.5. */
export function oklabDoc(): JsonObject {
  return {
    format: 1, id: 'oklab-385', profile: 'figure', title: 'Black to grey 51', description: 'A two-stop OKLab gradient from black to sRGB 0.2.', size: [257, 64],
    layers: MAIN,
    items: { ramp: item('ramp', 'rect@1', 'a0', { box: [0, 0, 257, 64], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'black' }, { at: 1, role: 'grey51' }] } } } }) },
  };
}

/** Criterion 5's layers, each needing what GPUI can't draw: one Vello GPU draws, or one that waits for its mask layers. */
export function gateDoc(kind: 'rounded' | 'opacity' | 'multistop' | 'alpha' | 'luminance' | 'feather'): { doc: JsonObject; item: string } {
  const back = item('back', 'rect@1', 'a0', { box: [0, 0, 240, 160], paint: { fill: { role: 'panel' } } });
  const fill = (role: string): JsonObject => ({ fill: { role } });
  let items: JsonObject; let named: string;
  switch (kind) {
    case 'rounded': // a frame's rounded overflow mask: a mask by shape
      named = 'card';
      items = { back, card: item('card', 'frame@1', 'a1', { box: [20, 20, 200, 120], radius: 40, overflow: 'mask', paint: fill('accent') }), over: item('over', 'rect@1', 'a2', { box: [0, 60, 240, 40], paint: fill('ink') }, { parent: 'card' }) };
      break;
    case 'opacity': // isolated group opacity over overlapping children
      named = 'veil';
      items = { back, veil: item('veil', 'group@1', 'a1', { opacity: 0.5 }), va: item('va', 'rect@1', 'a2', { box: [30, 30, 120, 70], paint: fill('ink') }, { parent: 'veil' }), vb: item('vb', 'rect@1', 'a3', { box: [90, 60, 120, 70], paint: fill('accent') }, { parent: 'veil' }) };
      break;
    case 'multistop': // a gradient past R1's two stops
      named = 'ramp';
      items = { back, ramp: item('ramp', 'rect@1', 'a1', { box: [20, 20, 200, 120], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'ramp.0' }, { at: 0.5, role: 'ramp.1' }, { at: 1, role: 'ramp.2' }] } } } }) };
      break;
    case 'alpha': case 'luminance': case 'feather':
      named = 'cut';
      items = {
        back,
        cut: item('cut', 'mask@1', 'a1', kind === 'feather'
          ? { shape: 'rect', box: [40, 30, 160, 100], feather: 6, applies_to: 'children' }
          : { shape: 'rect', box: [40, 30, 160, 100], mode: kind, paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'black' }, { at: 1, role: 'ground' }] } } }, applies_to: 'children' }),
        under: item('under', 'rect@1', 'a2', { box: [0, 0, 240, 160], paint: fill('ink') }, { parent: 'cut' }),
      };
      break;
  }
  return { doc: { format: 1, id: `gate-${kind}`, profile: 'figure', title: `Vello GPU gate: ${kind}`, description: `A layer with ${kind}.`, size: [240, 160], layers: MAIN, items }, item: named };
}

/** The spike's figure: 1936 × 1584 (the GPU layer's handoff size), a layer of Vello GPU features. */
export function spikeDoc(): JsonObject {
  const fill = (role: string): JsonObject => ({ fill: { role } });
  return {
    format: 1, id: 'spike-385', profile: 'figure', title: 'The Vello GPU spike', description: 'A rounded mask, an isolated group at half opacity and a three-stop gradient over the GPU layer\'s handoff size.', size: [1936, 1584],
    layers: MAIN,
    items: {
      back: item('back', 'rect@1', 'a0', { box: [0, 0, 1936, 1584], paint: fill('panel') }),
      card: item('card', 'frame@1', 'a1', { box: [100, 100, 800, 600], radius: 120, overflow: 'mask', paint: fill('accent') }),
      over: item('over', 'rect@1', 'a2', { box: [0, 300, 1936, 200], paint: fill('ink') }, { parent: 'card' }),
      veil: item('veil', 'group@1', 'a3', { opacity: 0.5 }),
      va: item('va', 'rect@1', 'a4', { box: [1000, 100, 600, 500], paint: fill('ink') }, { parent: 'veil' }),
      vb: item('vb', 'rect@1', 'a5', { box: [1300, 350, 600, 500], paint: fill('accent') }, { parent: 'veil' }),
      ramp: item('ramp', 'rect@1', 'a6', { box: [100, 900, 1736, 600], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'ramp.0' }, { at: 0.5, role: 'ramp.1' }, { at: 1, role: 'ramp.2' }] } } } }),
    },
  };
}

/**
 * Criterion 6's figure, 2D or 3D: a backdrop plate `back`, and a multiply group `tint` around the title: its plate
 * `plate` (role src) and the title text on it. With `three`, the same layer also holds a camera, a sun and a box,
 * which makes it a 3D writer layer. 240 × 160.
 */
export const TITLE_PLATE: [number, number, number, number] = [20, 20, 200, 80];
export const TITLE_TEXT: [number, number, number, number] = [28, 72, 184, 24];
export function titleDoc(three: boolean): JsonObject {
  const items: JsonObject = {
    back: item('back', 'rect@1', 'a1', { box: [0, 0, 240, 160], paint: { fill: { role: 'back' } } }),
    tint: item('tint', 'group@1', 'a2', { blend: 'multiply' }),
    plate: item('plate', 'rect@1', 'a3', { box: TITLE_PLATE, paint: { fill: { role: 'src' } } }, { parent: 'tint' }),
    title: item('title', 'text@1', 'a4', { text: 'Title', font: 'body', size: 16, box: { w: TITLE_TEXT[2], h: TITLE_TEXT[3] } }, { parent: 'tint', at: { pos: [TITLE_TEXT[0], TITLE_TEXT[1], 0] } }),
  };
  const doc: JsonObject = { format: 1, id: three ? 'title-3d' : 'title-2d', profile: three ? 'scene' : 'figure', title: 'A multiply group around a title', description: three ? 'A box, and a multiply group around a title, in one writer layer.' : 'A multiply group around a title.', size: [240, 160], layers: MAIN, items };
  if (three) {
    doc['camera'] = 'cam';
    doc['requires'] = { modules: { scene3d: '^1' } };
    Object.assign(items, {
      cam: item('cam', 'camera@1', 'a0', { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 25, distance: 6 }, fov: 40, near: 0.1 }),
      cube: item('cube', 'mark.box@1', 'a5', { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, { at: { pos: [1.5, -0.8, 0] } }),
      sun: item('sun', 'light.sun@1', 'a6', { illuminance: Math.PI, shadow: false, angle: 0.53 }, { at: { rot: [-55, -40, 0] } }),
    });
  }
  return doc;
}

/**
 * Criterion 8's figure: eight sectors of role `disc` that tile a disc of radius 100 centred on (120.5, 120.5), in a
 * group over a white rect and the white ground, 241 × 241. Every shared edge runs from the centre to the rim at k × 45°; the centre sits on a pixel
 * centre, so each edge cuts pixels in two. Each sector moves out along its bisector by channels and back: 0 at t = 0,
 * 8 u at 1 s, 0 at 2 s, linear.
 */
export const SECTOR_CENTER: [number, number] = [120.5, 120.5];
export const SECTOR_R = 100;
export const FLICKS = 705_600_000;
export function sectorsDoc(): JsonObject {
  const [cx, cy] = SECTOR_CENTER;
  // The white ground is the layer's own first item too, so a layer drawn alone is opaque.
  const items: JsonObject = { paper: item('paper', 'rect@1', 'a0', { box: [0, 0, 241, 241], paint: { fill: { role: 'ground' } } }), wheel: item('wheel', 'group@1', 'a1', {}) };
  const channels: JsonObject = {};
  const f = (v: number): string => (Math.round(v * 1e6) / 1e6).toString();
  for (let k = 0; k < 8; k++) {
    const a0 = (k * Math.PI) / 4; const a1 = ((k + 1) * Math.PI) / 4;
    const p = (a: number): [number, number] => [cx + SECTOR_R * Math.cos(a), cy + SECTOR_R * Math.sin(a)];
    const h = (4 / 3) * Math.tan((a1 - a0) / 4) * SECTOR_R; // one cubic per 45° arc
    const [x0, y0] = p(a0); const [x1, y1] = p(a1);
    const c1 = [x0 - h * Math.sin(a0), y0 + h * Math.cos(a0)]; const c2 = [x1 + h * Math.sin(a1), y1 - h * Math.cos(a1)];
    const id = `s${k}`;
    items[id] = item(id, 'path@1', `b${k}`, {
      d: `M ${f(cx)} ${f(cy)} L ${f(x0)} ${f(y0)} C ${f(c1[0]!)} ${f(c1[1]!)} ${f(c2[0]!)} ${f(c2[1]!)} ${f(x1)} ${f(y1)} Z`,
      paint: { fill: { role: 'disc' } },
    }, { parent: 'wheel', at: { pos: [0, 0, 0] } });
    const mid = (a0 + a1) / 2;
    for (const [axis, d] of [[0, Math.cos(mid)], [1, Math.sin(mid)]] as const) {
      channels[`${id}-${axis}`] = { target: `items/${id}/at/pos/${axis}`, type: 'f32', keys: {
        k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '1s', value: 8 * d, interp: 'linear' }, k2: { t: '2s', value: 0, interp: 'linear' },
      } };
    }
  }
  return {
    format: 1, id: 'sectors-385', profile: 'figure', title: 'Eight sectors of a disc', description: 'Eight sectors of one color tile a disc over white, and move apart and back.', size: [241, 241],
    transport: { span: '2s' }, layers: MAIN, channels, items,
  };
}
/** The shared edge between sector k − 1 and sector k (k mod 8): its name and its segment from the centre to the rim. */
export function sectorEdges(): { name: string; seg: Segment }[] {
  const [cx, cy] = SECTOR_CENTER;
  return [...Array(8).keys()].map((k) => {
    const a = (k * Math.PI) / 4;
    return { name: `s${(k + 7) % 8}|s${k}`, seg: [cx, cy, cx + SECTOR_R * Math.cos(a), cy + SECTOR_R * Math.sin(a)] as Segment };
  });
}
/**
 * Every pixel on the shared edges (its centre within 0.75 px of an edge, and more than 2 px inside the rim) against the
 * disc's color: per edge the worst pixel, how many are past one code value, and the most any channel is lighter.
 */
export function seamProblems(image: Image, what: string): { problems: string[]; lightest: number; counted: number } {
  const disc = LOOK['light'] as JsonObject;
  const want = (disc['disc'] as number[]);
  const [cx, cy] = SECTOR_CENTER;
  const problems: string[] = [];
  let lightest = 0; let counted = 0;
  for (const { name, seg: [x0, y0, x1, y1] } of sectorEdges()) {
    let bad = 0; let worst: { x: number; y: number; d: number; p: Rgba } | null = null;
    const dx = x1 - x0; const dy = y1 - y0; const len2 = dx * dx + dy * dy;
    for (let y = Math.floor(Math.min(y0, y1) - 2); y <= Math.ceil(Math.max(y0, y1) + 2); y++) for (let x = Math.floor(Math.min(x0, x1) - 2); x <= Math.ceil(Math.max(x0, x1) + 2); x++) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const pxc = x + 0.5; const pyc = y + 0.5;
      if (Math.hypot(pxc - cx, pyc - cy) > SECTOR_R - 2) continue;
      const t = Math.max(0, Math.min(1, ((pxc - x0) * dx + (pyc - y0) * dy) / len2));
      if (Math.hypot(x0 + t * dx - pxc, y0 + t * dy - pyc) > 0.75) continue;
      counted++;
      const p = px(image, x, y);
      const d = diff(p.slice(0, 3), want);
      lightest = Math.max(lightest, ...p.slice(0, 3).map((v, i) => v - want[i]!));
      if (d > 1) bad++;
      if (!worst || d > worst.d) worst = { x, y, d, p };
    }
    if (bad) problems.push(`${what}: edge ${name}: ${bad} pixels more than one code value from the disc's color ${JSON.stringify(want)}; worst (${worst!.x}, ${worst!.y}) ${JSON.stringify(worst!.p)}, ${worst!.d} codes`);
  }
  return { problems, lightest, counted };
}
/** Whether a frame shows the sectors apart: white between them on a shared edge's bisector half way out. */
export function sectorsApart(image: Image): boolean {
  const [cx, cy] = SECTOR_CENTER;
  return [0, 2, 4, 6].some((k) => {
    const a = (k * Math.PI) / 4; const x = Math.floor(cx + 50 * Math.cos(a)); const y = Math.floor(cy + 50 * Math.sin(a));
    return px(image, x, y)[0] > 200;
  });
}

// ---------------------------------------------------------------------------------------------------
// The spike record (README: The spike and the Vello GPU gate)

/** A synthetic spike record for the test-spike build: five runs of 300 frames at `ms` each, a little spread. */
export function spikeRecord(ms: number): JsonObject {
  const runs = [...Array(5).keys()].map((r) => ({ handoff_ms: [...Array(300).keys()].map((i) => Math.round((ms * (0.9 + 0.1 * ((i * 7 + r * 3) % 11) / 10)) * 1e4) / 1e4) }));
  return { spike: 'vello_gpu_2d_handoff', renderer: { name: 'vello_gpu', version: lockedVersions('vello_gpu')[0] ?? '0.3.0' }, machine: { model: 'test', chip: 'test' }, size: [1936, 1584], budget_ms: 1, runs };
}
/** What a spike record says, judged here from its frames: each run's p95 against 1 ms. */
export function spikeVerdict(record: JsonObject, what: string): { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; p95s: number[]; problems: string[] } {
  const problems: string[] = [];
  const runs = arr(record['runs'], `${what}: runs`).map((r, i) => arr(obj(r, `${what}: runs[${i}]`)['handoff_ms'], `${what}: runs[${i}].handoff_ms`).map((v) => num(v, 'handoff_ms')));
  if (runs.length < 5) problems.push(`${what}: ${runs.length} runs, not five`);
  for (const [i, r] of runs.entries()) if (r.length < 300) problems.push(`${what}: run ${i} has ${r.length} frames, under 300`);
  const p95s = runs.map(p95);
  return { verdict: runs.length ? judge(p95s, 1) : 'INCONCLUSIVE', p95s, problems };
}

/** The extra startup arguments of a test-spike build (README). */
export const spikeArgs = (file: string): string[] => ['--spike-record', file];
export const fixturePath = (rel: string): string => join(FIXTURES, rel);
