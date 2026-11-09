// Test-side tools for the #1479 acceptance tests: `deep-canvas-render` built once per file and copied out under its
// own name (#385's pattern), driven by JSON lines (`render`: GPUI's frame path, the app's; `raster`: Vello CPU, as
// snapshots draw); the documents these tests draw, built here so every expected value sits next to the document it
// comes from; PNG reading; and the oracle, written as reviewed test code as the design asks: #385's first criterion's
// per-glyph-run coverage and centroid, and each glyph's own share of it. Nothing here stands in for a renderer.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1479 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

// ---------------------------------------------------------------------------------------------------
// The issue's numbers (README: Readings)

/** The threshold above which text draws as paths from the shaper's outlines, in device px a em (the design's 64). */
export const THRESHOLD = 64;
/** #385's first criterion: each glyph run's summed coverage within 2% of Vello CPU's ... */
export const COVERAGE_SHARE = 0.02;
/** ... and its coverage centroid within 0.1 device px. Also criterion 3's bound on the centroid's move. */
export const CENTROID_PX = 0.1;

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

// ---------------------------------------------------------------------------------------------------
// The build: `deep-canvas-render`, once per file, copied out of target/debug under its own name.

export const RENDER_BIN = 'deep-canvas-render';
const CARGO_ARGS = ['build', '--locked', '--bin', RENDER_BIN];
export const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };

/** Builds the binary once before the file's tests; a test that uses it after a failed build fails with cargo's error. */
export function useRender(): () => string {
  let dir = '';
  let bin = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1479-bins-'));
    const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: CARGO_ENV });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else {
      bin = join(dir, RENDER_BIN);
      copyFileSync(join(REPO, 'target', 'debug', RENDER_BIN), bin);
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return bin;
  };
}

/** A fresh temporary folder per test, deleted after it. */
export function useDir(prefix = 'deep-1479-'): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), prefix)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running `deep-canvas-render <command>`: JSON lines in, one JSON line out per line in, exit 0.

/** One process of `deep-canvas-render <command>` over `inputs`: every line answered, in order, exit 0. */
export function answers(bin: string, command: 'render' | 'raster', inputs: JsonObject[], timeoutMs = 3_000_000): JsonObject[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, [command], {
    cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  const shown = `deep-canvas-render ${command}`;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${shown}: ${run.error.message}`);
  expect(timedOut, `${shown} finished within ${timeoutMs} ms`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${shown} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${shown}: one output line per input line; stdout: ${stdout.slice(0, 1500)}`).toBe(inputs.length);
  return lines.map((l, i) => {
    let v: JsonValue;
    try { v = JSON.parse(l) as JsonValue; } catch { v = l; }
    return obj(v, `${shown}: answer ${i}`);
  });
}

/** GPUI's frame path draws only on macOS (its offscreen Metal renderer); anywhere else the test is INCONCLUSIVE. */
export function needsMac(): void {
  if (process.platform !== 'darwin') expect.fail(`INCONCLUSIVE: GPUI's frame path needs macOS with Metal; platform ${process.platform}; this is not a pass`);
}
/** An answer of `unsupported_platform` is INCONCLUSIVE, never a pass. */
export function notUnsupported(answer: JsonObject, what: string): void {
  if (answer['ok'] === false && answer['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} answers unsupported_platform; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The documents: one text item, white ink on a black ground, so a pixel's red channel ÷ 255 is the text's coverage
// there (2D writer layers composite in sRGB-encoded space; white over black at coverage a is 255·a in every channel).

/** A role map as `deep-canvas-render` takes a look (#391): every color these tests draw is set here. */
export const LOOK: JsonObject = { light: { ground: [0, 0, 0], ink: [255, 255, 255] } };

/**
 * Glyphs whose ink stays inside their own advance (positive side bearings, no kerning pair between them, in the
 * body face), so each glyph's coverage can be read in the band its pen positions bound, and a missing glyph is the
 * band left dark.
 */
export const WORD = 'HIMN';

export interface TextDoc { doc: JsonObject; item: string }

/** A document of `size` u holding one text@1 item `item` showing `text` at `em` u, its box's corner at `pos` u. */
export function textDoc(id: string, text: string, em: number, size: [number, number], pos: [number, number] = [8, 4]): TextDoc {
  const item = 'label';
  return {
    item,
    doc: {
      format: 1, id, profile: 'figure', title: `Text at ${em} u`, description: `One text item showing ${text} at ${em} u in ink on the ground.`, size,
      layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } },
      items: {
        [item]: { id: item, kind: 'text@1', layer: 'main', name: item, order: 'a0', params: { text, font: 'body', size: em, paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] } },
      },
    },
  };
}

/** Criterion 1's label: 300 u, at scale 2 (600 device px a em). */
export const LABEL_EM = 300;
export const LABEL_SCALE = 2;
export const labelDoc = (): TextDoc => textDoc('label-1479', WORD, LABEL_EM, [920, 420]);

/** Criterion 2's title: 40 u, zoomed from 1× to 16× (640 device px a em at the end). */
export const TITLE_EM = 40;
export const titleDoc = (): TextDoc => textDoc('title-1479', WORD, TITLE_EM, [128, 60], [4, 2]);
/** The zoom of frame `k` of `n`: geometric from 1× to 16×, so each frame grows by the same factor. */
export const zoomAt = (k: number, n: number): number => 16 ** (k / (n - 1));

let lines = 0;
/** A `render` (GPUI) or `raster` (Vello CPU) line drawing `doc` at view zoom `zoom`, its PNG under `dir`. */
export function drawLine(dir: string, doc: JsonObject, zoom: number, extra: JsonObject = {}): JsonObject {
  lines += 1;
  return { out: join(dir, `d${lines}.png`), doc, look: LOOK, view: { zoom, theme: 'light' }, ...extra };
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

// ---------------------------------------------------------------------------------------------------
// A drawn frame: its answer, its picture, and (from Vello CPU's `raster`) the text's glyphs.

/** A glyph of the run as `raster` reports it (#381's `texts`): its pen position in document u is its `transform`'s
 * translation, and its band runs one `advance` on from there. */
export interface Glyph { index: number; id: number; grapheme: number; pen: number; advance: number }
export interface Frame { answer: JsonObject; image: Image }

/** Reads one drawn line: the answer accepted and its PNG the document's size at the zoom, in device px. */
export function readFrame(line: JsonObject, answer: JsonObject, what: string): Frame {
  notUnsupported(answer, what);
  expect(answer['ok'], `${what} answered ok: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
  const out = String(line['out']);
  expect(existsSync(out), `${what}: the PNG was written`).toBe(true);
  const image = decodePng(readFileSync(out));
  const size = arr(obj(line['doc'], 'doc')['size'], 'doc.size').map((v) => num(v, 'doc.size'));
  const zoom = num(obj(line['view'], 'view')['zoom'], 'view.zoom');
  const near = Math.abs(image.width - size[0]! * zoom) <= 1 && Math.abs(image.height - size[1]! * zoom) <= 1;
  expect(near, `${what}: the PNG is the document's size at zoom ${zoom} in device px (within a pixel), got ${image.width} × ${image.height}`).toBe(true);
  return { answer, image };
}

/** The text item's glyphs as `raster` reports them (`texts.<item>.glyphs`, in document u). */
export function glyphsOf(answer: JsonObject, item: string, what: string): Glyph[] {
  const t = obj(obj(answer['texts'], `${what}: texts`)[item], `${what}: texts.${item}`);
  return arr(t['glyphs'], `${what}: texts.${item}.glyphs`).map((g, index) => {
    const o = obj(g, `${what}: glyph ${index}`);
    const m = arr(o['transform'], `${what}: glyph ${index}'s transform`).map((v) => num(v, 'transform'));
    return { index, id: num(o['id'], 'glyph id'), grapheme: num(o['grapheme'], 'glyph grapheme'), pen: m[4]!, advance: num(o['advance'], 'glyph advance') };
  });
}

// ---------------------------------------------------------------------------------------------------
// Coverage (#385's first criterion, as #140's oracle reads it): a pixel's coverage is its red channel ÷ 255 here
// (white ink on a black ground); summed over pixels, and its centroid weighted by pixel centres, in device px.

export interface Cover { sum: number; cx: number; cy: number }

/** Coverage summed over the columns [x0, x1) of `image` (all of it by default), and its centroid. */
export function coverage(image: Image, x0 = 0, x1 = image.width): Cover {
  let sum = 0; let sx = 0; let sy = 0;
  const a = Math.max(0, Math.floor(x0)); const b = Math.min(image.width, Math.ceil(x1));
  for (let y = 0; y < image.height; y++) for (let x = a; x < b; x++) {
    const c = image.rgba[(y * image.width + x) * 4]! / 255;
    sum += c; sx += c * (x + 0.5); sy += c * (y + 0.5);
  }
  return { sum, cx: sum ? sx / sum : NaN, cy: sum ? sy / sum : NaN };
}

/** The device-px column band a glyph's ink lies in at `zoom`: from its pen position one advance on. */
export const band = (g: Glyph, zoom: number): [number, number] => [g.pen * zoom, (g.pen + g.advance) * zoom];

const show = (s: string, i: number): string => JSON.stringify([...s][i] ?? '?');

/**
 * Each glyph of the text drawn by GPUI against Vello CPU's at the same zoom: a glyph whose band holds under half of
 * Vello CPU's coverage there is missing (README: Readings), named by its index, its grapheme and its glyph ID.
 */
export function missingGlyphs(text: string, gpui: Image, vello: Image, glyphs: Glyph[], zoom: number, what: string): string[] {
  const p: string[] = [];
  for (const g of glyphs) {
    const i = g.index;
    const [x0, x1] = band(g, zoom);
    const want = coverage(vello, x0, x1).sum;
    if (!(want > 0)) { p.push(`${what}: glyph ${i} ${show(text, g.grapheme)} (id ${g.id}) covers nothing in Vello CPU's snapshot`); continue; }
    const got = coverage(gpui, x0, x1).sum;
    if (!(got >= 0.5 * want)) p.push(`${what}: glyph ${i} ${show(text, g.grapheme)} (id ${g.id}) is missing: coverage ${got.toFixed(1)} by GPUI against ${want.toFixed(1)} by Vello CPU in its band [${x0.toFixed(1)}, ${x1.toFixed(1)}) device px`);
  }
  return p;
}

/** #385's first criterion for the glyph run: summed coverage within 2% of Vello CPU's, centroid within 0.1 device px. */
export function runProblems(item: string, gpui: Image, vello: Image, what: string): string[] {
  const p: string[] = [];
  const v = coverage(vello);
  const g = coverage(gpui);
  if (!(v.sum > 0)) return [`${what}: item ${item}:glyphs covers nothing in Vello CPU's snapshot`];
  if (!(Math.abs(g.sum - v.sum) <= COVERAGE_SHARE * v.sum)) p.push(`${what}: item ${item}:glyphs: summed coverage ${g.sum.toFixed(2)} by GPUI against ${v.sum.toFixed(2)} by Vello CPU, more than 2% apart`);
  const off = Math.hypot(g.cx - v.cx, g.cy - v.cy);
  if (!(off <= CENTROID_PX)) p.push(`${what}: item ${item}:glyphs: coverage centroid (${g.cx.toFixed(3)}, ${g.cy.toFixed(3)}) by GPUI against (${v.cx.toFixed(3)}, ${v.cy.toFixed(3)}) by Vello CPU, ${off.toFixed(3)} device px apart`);
  return p;
}

/** The frame report's count of glyphs the canvas's atlas rasterized drawing the line (README: `rasterized`). */
export function rasterized(value: JsonValue | undefined, what: string): number {
  const n = num(value, `${what}: the frame report's rasterized`);
  expect(Number.isInteger(n) && n >= 0, `${what}: rasterized is a count, got ${n}`).toBe(true);
  return n;
}
