// Test-side tools for #398's criterion 6 (elements.test.ts): `deep-canvas-render` (#391's binary, with #373's
// `raster` and `geometry`) built once and driven by JSON lines; documents holding one `vector@1` item and the image
// store its SVG is read from; reading an issue that names an element; PNG reading (resvg's palette PNGs and the
// raster's own); pixel probes; outline sampling for the rounded rect; and the perceptual oracle the design names
// (a blank guard, then FLIP pooled as the mean over the subject, with structure, crushed-black and color guards and
// silhouette IoU), written here as reviewed test code. Nothing here stands in for the import under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/398 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const RENDER_BIN_NAME = 'deep-canvas-render';
export const RENDER_BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${RENDER_BIN_NAME}.exe` : RENDER_BIN_NAME);

/** The planted importer the criterion names: it ignores `<clipPath>` and raises no issue for it. */
export const PLANTED = 'import_skips_clip_path';

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

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

function buildBinary(): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', RENDER_BIN_NAME], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${RENDER_BIN_NAME} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the binary once per file and fails every test of the file when it can't be built. */
export function useRenderBinary(): void {
  let error = '';
  beforeAll(() => { error = buildBinary(); }, 900_000);
  beforeEach(() => { expect(error, `the binary builds: ${RENDER_BIN_NAME}`).toBe(''); });
}

/** Pipes every input line into one run of `deep-canvas-render <subcommand>`. */
export function batch(subcommand: string, inputs: JsonValue[]): JsonValue[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(RENDER_BIN, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const name = `${RENDER_BIN_NAME} ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}
export function one(subcommand: string, input: JsonValue): JsonObject {
  return obj(batch(subcommand, [input])[0], `${RENDER_BIN_NAME} ${subcommand}: the answer`);
}

/** A scratch folder, deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-398-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// The image store and the document: one vector@1 item whose viewBox is drawn uniformly scaled onto
// [pos.x, pos.y, w, h], every SVG color mapped to a look role of the same sRGB value.

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Writes the SVG into a fresh store folder under `dir`, named by its sha256, and answers both. */
export function storeSvg(dir: string, svg: Buffer): { store: string; src: string } {
  const store = mkdtempSync(join(dir, 'store-'));
  const src = sha256(svg);
  writeFileSync(join(store, src), svg);
  return { store, src };
}

/** The CSS named colors the fixtures use, as sRGB codes (CSS Color 4, named colors). */
const NAMED: Record<string, Rgb> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  gray: [128, 128, 128], grey: [128, 128, 128], lightgray: [211, 211, 211], darkblue: [0, 0, 139],
};

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
export const hexOf = (c: Rgb): string => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;

/** A CSS color as the fixtures write it (a name, #rgb or #rrggbb), or null when it isn't a plain color. */
export function cssColor(value: string): Rgb | null {
  const v = value.trim().toLowerCase();
  if (v in NAMED) return NAMED[v]!;
  if (/^#[0-9a-f]{6}$/.test(v)) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb;
  if (/^#[0-9a-f]{3}$/.test(v)) return [1, 2, 3].map((i) => parseInt(v[i]! + v[i]!, 16)) as Rgb;
  return null;
}

const SKIP = new Set(['none', 'transparent', 'currentcolor', 'inherit', 'initial', 'unset']);

/**
 * Every color an SVG writes, in attributes (`fill="green"`) and in CSS declarations (style attributes and style
 * blocks, `fill: green`), as written. A value that is neither a skipped keyword, a `url(…)` reference nor a color
 * the table above knows throws, so no color goes unmapped by mistake. Black is always added: it is SVG's initial
 * fill, which an element with no fill draws in.
 */
export function svgColors(svg: string): Map<string, Rgb> {
  const found = new Map<string, Rgb>([['black', NAMED.black!]]);
  const props = '(?:fill|stroke|stop-color|flood-color|lighting-color|color)';
  const patterns = [new RegExp(`\\s${props}\\s*=\\s*"([^"]*)"`, 'g'), new RegExp(`\\s${props}\\s*=\\s*'([^']*)'`, 'g'), new RegExp(`(?:^|[\\s;{"'])${props}\\s*:\\s*([^;}"']+)`, 'g')];
  for (const re of patterns) {
    for (const m of svg.matchAll(re)) {
      const value = m[1]!.replace(/!important/i, '').trim();
      if (SKIP.has(value.toLowerCase()) || value.startsWith('url(')) continue;
      const rgb = cssColor(value);
      if (!rgb) throw Error(`the SVG writes a color the test's table doesn't know: ${JSON.stringify(value)}`);
      found.set(value, rgb);
    }
  }
  return found;
}

/** The role a color maps to, and its look entry. */
export const roleOf = (c: Rgb): string => `svg.${hexOf(c).slice(1)}`;

/**
 * `colors` for a vector@1 item (each color as the SVG writes it, and as lowercase #rrggbb, both to the same role) and
 * the look role map that draws each role in the color's own sRGB value over a white ground.
 */
export function colorsAndLook(colors: Map<string, Rgb>): { colors: JsonObject; look: JsonObject } {
  const map: JsonObject = {};
  const light: JsonObject = { ground: [255, 255, 255], ink: [0, 0, 0] };
  for (const [written, rgb] of colors) {
    map[written] = roleOf(rgb);
    map[hexOf(rgb)] = roleOf(rgb);
    light[roleOf(rgb)] = [...rgb];
  }
  return { colors: map, look: { light } };
}

export interface VectorDoc { doc: JsonObject; look: JsonObject; store: string; src: string }

/**
 * A board holding one vector@1 item `art` on one writer layer: the SVG drawn onto [pos, size] in u, in a document of
 * `docSize` u. Every ID follows the ID grammar and the envelope has every required field, so the base's core check
 * passes it (only the marks2d module's `module_missing` stands in the way there).
 */
export function vectorDoc(dir: string, svg: Buffer, opts: { id: string; title: string; alt: string; docSize: [number, number]; pos: [number, number]; size: [number, number] }): VectorDoc {
  const { store, src } = storeSvg(dir, svg);
  const { colors, look } = colorsAndLook(svgColors(svg.toString('utf8')));
  const doc: JsonObject = {
    format: 1, id: opts.id, profile: 'board', title: opts.title,
    description: `One SVG imported as a vector@1 item (${opts.alt}).`.slice(0, 400),
    size: [...opts.docSize],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      art: {
        id: 'art', kind: 'vector@1', layer: 'main', name: opts.title, order: 'a00',
        at: { pos: [opts.pos[0], opts.pos[1], 0] },
        params: { src, size: [...opts.size], colors, alt: opts.alt },
      },
    },
  };
  return { doc, look, store, src };
}

// ---------------------------------------------------------------------------------------------------
// The check, the raster and the geometry.

export interface Checked { ok: boolean; issues: JsonObject[]; raw: JsonObject }

/** `check {doc, look?, store?, planted?}`. */
export function check(v: { doc: JsonObject; look?: JsonObject; store?: string }, planted?: string): Checked {
  const input: JsonObject = { doc: v.doc };
  if (v.look) input['look'] = v.look;
  if (v.store) input['store'] = v.store;
  if (planted) input['planted'] = planted;
  const out = one('check', input);
  expect(typeof out['ok'], `check answers ok: ${JSON.stringify(out).slice(0, 2000)}`).toBe('boolean');
  const issues = arr(out['issues'], 'check: issues').map((v2, i) => obj(v2, `check: issues[${i}]`));
  return { ok: out['ok'] === true, issues, raw: out };
}

/** True when `value` holds the string `s` at any depth, leaving out the values of the keys `what` and `fix`. */
export function holdsName(value: JsonValue | undefined, s: string): boolean {
  if (value === s) return true;
  if (Array.isArray(value)) return value.some((v) => holdsName(v, s));
  if (isObject(value)) return Object.entries(value).some(([k, v]) => k !== 'what' && k !== 'fix' && holdsName(v, s));
  return false;
}

/** The issues that name the element `<tag>` (any severity: an element named only in a warning still imports). */
export const issuesNaming = (c: Checked, tag: string): JsonObject[] => c.issues.filter((i) => holdsName(i, tag));

export interface Drawn { report: JsonObject; image: Image }

let rasters = 0;
/** `raster {out, doc, look, store, t: 0, planted?}`: the answer, and the PNG when it was drawn. */
export function raster(dir: string, v: VectorDoc, planted?: string): { report: JsonObject; image: Image | null } {
  rasters += 1;
  const input: JsonObject = { out: join(dir, `r${rasters}.png`), doc: v.doc, look: v.look, store: v.store, t: 0 };
  if (planted) input['planted'] = planted;
  const report = one('raster', input);
  if (report['ok'] !== true) return { report, image: null };
  const image = readPng(String(input['out']));
  const size = arr(v.doc['size'], 'doc.size').map((n) => num(n, 'doc.size'));
  expect([image.width, image.height], 'the raster\'s PNG is the document\'s size').toEqual(size);
  return { report, image };
}

/** A raster that must be drawn. */
export function drawn(dir: string, v: VectorDoc, what: string, planted?: string): Drawn {
  const { report, image } = raster(dir, v, planted);
  expect(report['ok'], `raster ${what}: the SVG imports and draws: ${JSON.stringify(report).slice(0, 2000)}`).toBe(true);
  return { report, image: image! };
}

export interface Subpath { closed: boolean; verbs: string[]; points: [number, number][] }
export interface Part { id: string; box: number[]; subpaths: Subpath[]; raw: JsonObject }

/** `geometry {doc, item, store}`: one part per SVG element with an id, each with its box and subpaths in u. */
export function geometryParts(v: VectorDoc, item: string): Part[] {
  const out = one('geometry', { doc: v.doc, item, store: v.store });
  expect(out['ok'], `geometry of ${item} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  return arr(out['parts'], `geometry ${item}: parts`).map((p, i) => {
    const part = obj(p, `parts[${i}]`);
    expect(typeof part['id'], `parts[${i}].id is a string`).toBe('string');
    return {
      id: String(part['id']), raw: part,
      box: arr(part['box'], `parts[${i}].box`).map((n, k) => num(n, `parts[${i}].box[${k}]`)),
      subpaths: arr(part['subpaths'], `parts[${i}].subpaths`).map((s, j) => {
        const sp = obj(s, `parts[${i}].subpaths[${j}]`);
        return {
          closed: sp['closed'] === true,
          verbs: arr(sp['verbs'], `subpaths[${j}].verbs`).map(String),
          points: arr(sp['points'], `subpaths[${j}].points`).map((q, k) => {
            const xy = arr(q, `subpaths[${j}].points[${k}]`);
            return [num(xy[0], `points[${k}][0]`), num(xy[1], `points[${k}][1]`)] as [number, number];
          }),
        };
      }),
    };
  });
}

/**
 * Points along a subpath in #373's form (M, L, Q, C, Z; Q holds 2 points, C 3), each segment sampled `n` times.
 * A verb this reader doesn't know throws.
 */
export function sample(sp: Subpath, n = 64): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  let cur: [number, number] = [NaN, NaN];
  let start: [number, number] = [NaN, NaN];
  const take = (k: number): [number, number][] => { const p = sp.points.slice(at, at + k); at += k; if (p.length !== k) throw Error(`subpath ends inside a segment: ${JSON.stringify(sp)}`); return p; };
  const line = (a: [number, number], b: [number, number]): void => { for (let i = 1; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]); };
  for (const verb of sp.verbs) {
    if (verb === 'M') { cur = take(1)[0]!; start = cur; out.push(cur); } else if (verb === 'L') { const [b] = take(1); line(cur, b!); cur = b!; } else if (verb === 'Q') {
      const [c, b] = take(2);
      for (let i = 1; i <= n; i++) { const t = i / n; const u = 1 - t; out.push([u * u * cur[0] + 2 * u * t * c![0] + t * t * b![0], u * u * cur[1] + 2 * u * t * c![1] + t * t * b![1]]); }
      cur = b!;
    } else if (verb === 'C') {
      const [c1, c2, b] = take(3);
      for (let i = 1; i <= n; i++) {
        const t = i / n; const u = 1 - t;
        out.push([u * u * u * cur[0] + 3 * u * u * t * c1![0] + 3 * u * t * t * c2![0] + t * t * t * b![0], u * u * u * cur[1] + 3 * u * u * t * c1![1] + 3 * u * t * t * c2![1] + t * t * t * b![1]]);
      }
      cur = b!;
    } else if (verb === 'Z') { line(cur, start); cur = start; } else throw Error(`subpath verb ${verb} is not one of #373's M, L, Q, C, Z`);
  }
  return out;
}

/** The signed distance from p to the boundary of the rounded rect [x, y, w, h] with corner radius r (Quilez). */
export function roundedRectDistance(p: [number, number], [x, y, w, h]: [number, number, number, number], r: number): number {
  const qx = Math.abs(p[0] - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(p[1] - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Points along the rounded rect's boundary: each corner's arc and each side, `n` points per piece. */
export function roundedRectBoundary([x, y, w, h]: [number, number, number, number], r: number, n = 50): [number, number][] {
  const out: [number, number][] = [];
  const corners: [number, number, number][] = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= n; i++) { const a = a0 + (Math.PI / 2) * (i / n); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([x + r + t * (w - 2 * r), y], [x + r + t * (w - 2 * r), y + h], [x, y + r + t * (h - 2 * r)], [x + w, y + r + t * (h - 2 * r)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// PNG: 8-bit RGB / RGBA / gray / gray-alpha and palette PNGs of 1, 2, 4 or 8 bits with tRNS, no interlace.

export interface Image { width: number; height: number; /** RGBA, row-major, straight alpha. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  let palette: Buffer | null = null; let trns: Buffer | null = null;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!channels || interlace !== 0 || (color === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8)) throw Error(`PNG color type ${color}, depth ${depth}, interlace ${interlace} is not one this reader takes`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0; const b = previous[i]!; const c = i >= bpp ? previous[i - bpp]! : 0;
      const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (color === 3) {
        const bit = x * depth;
        const index = (line[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        rgba[o] = palette![index * 3]!; rgba[o + 1] = palette![index * 3 + 1]!; rgba[o + 2] = palette![index * 3 + 2]!;
        rgba[o + 3] = trns && index < trns.length ? trns[index]! : 255;
      } else if (color === 0 || color === 4) {
        const g = line[x * channels]!;
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = color === 4 ? line[x * channels + 1]! : 255;
      } else {
        rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
        rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
      }
    }
    previous = line;
  }
  return { width, height, rgba };
}
export const readPng = (path: string): Image => decodePng(readFileSync(path));

/** An image composited over white (straight alpha, in sRGB-encoded values, as 2D layers composite): RGB 0..255. */
export function overWhite(image: Image): Float64Array {
  const out = new Float64Array(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i++) {
    const a = image.rgba[i * 4 + 3]! / 255;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = image.rgba[i * 4 + k]! * a + 255 * (1 - a);
  }
  return out;
}

/** The pixel whose square holds the point (x, y) in u (zoom 1), composited over white. */
export function pixel(image: Image, x: number, y: number): Rgb {
  const px = Math.floor(x); const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) throw Error(`(${x}, ${y}) is outside the ${image.width} × ${image.height} image`);
  const o = (py * image.width + px) * 4;
  const a = image.rgba[o + 3]! / 255;
  return [0, 1, 2].map((k) => Math.round(image.rgba[o + k]! * a + 255 * (1 - a))) as Rgb;
}
export const codeDistance = (a: Rgb, b: Rgb): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!)));

/** Writes an RGB 0..255 buffer (as overWhite returns) back as an Image, for the oracle's planted twins. */
export function imageOf(width: number, height: number, rgb: Float64Array): Image {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(rgb[i * 3 + k]!); rgba[i * 4 + 3] = 255; }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// The perceptual oracle (technical design, the parity suite: "Images from two renderers compare through one
// perceptual oracle, written as reviewed test code. A blank guard runs first … The final frame is held to FLIP,
// pooled as the mean over the subject in a studio fixture …, and to guards FLIP alone can't game: structure
// (GMSD) …, a share of crushed blacks no more than 0.05 above the reference frame's, mean color difference
// (ΔE2000, with exposure removed) … and each fixture's floor for silhouette IoU").
//
// FLIP is LDR-FLIP (Andersson et al., "FLIP: A Difference Evaluator for Alternating Images", HPG 2020, and NVIDIA's
// reference flip.py), at its default 67 pixels per degree. These tests have no blessed baselines (a first blessing
// is your decision), so each number is held to the ceiling below against the upstream PNG itself, the expected value
// set outside the implementation; README: The perceptual oracle, says where each ceiling comes from.

export const ORACLE = {
  /** The blank guard (film.blank's measure): luma at most 0.06 over at least 98% of the pixels. */
  blankLuma: 0.06, blankShare: 0.98,
  /** FLIP's mean over the subject (pixels either image draws, by the silhouette below). */
  flipMean: 0.08,
  /** GMSD over the frame (0: the same structure). */
  gmsd: 0.05,
  /** Crushed blacks (Rec. 709 luma ≤ 0.02): our share no more than 0.05 above the reference's. */
  crushedLuma: 0.02, crushedOver: 0.05,
  /** Mean ΔE2000 over the frame, our exposure matched to the reference's mean luminance. */
  deltaE2000: 0.75,
  /** Silhouette: a pixel at least half of the way from the white ground to black in some channel; IoU floor. */
  silhouetteDelta: 0.5 * 255, iou: 0.95,
} as const;

const PPD = 0.7 * (3840 / 0.7) * (Math.PI / 180);

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Separable 2D filter with replicated borders: rows by `kx`, then columns by `ky` (each centred). */
function filter2(src: Float64Array, w: number, h: number, kx: Float64Array, ky: Float64Array): Float64Array {
  const rx = (kx.length - 1) / 2; const ry = (ky.length - 1) / 2;
  const tmp = new Float64Array(w * h); const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -rx; i <= rx; i++) s += kx[i + rx]! * src[y * w + Math.min(w - 1, Math.max(0, x + i))]!;
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -ry; i <= ry; i++) s += ky[i + ry]! * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]!;
    out[y * w + x] = s;
  }
  return out;
}

// sRGB (D65) linear RGB ↔ XYZ.
const M = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
const MI = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];
const WHITE = [M[0]! + M[1]! + M[2]!, M[3]! + M[4]! + M[5]!, M[6]! + M[7]! + M[8]!];
const mul = (m: number[], v: [number, number, number]): [number, number, number] => [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]];

function labOfXyz([X, Y, Z]: [number, number, number]): [number, number, number] {
  const d = 6 / 29;
  const f = (t: number): number => (t > d ** 3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29);
  const fx = f(X / WHITE[0]!); const fy = f(Y / WHITE[1]!); const fz = f(Z / WHITE[2]!);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const huntLab = (lin: [number, number, number]): [number, number, number] => { const [L, a, b] = labOfXyz(mul(M, lin)); return [L, 0.01 * L * a, 0.01 * L * b]; };
const hyab = (p: [number, number, number], q: [number, number, number]): number => Math.abs(p[0] - q[0]) + Math.hypot(p[1] - q[1], p[2] - q[2]);

/** One image's YCxCz planes (from sRGB 0..255 composited over white). */
function ycxcz(rgb: Float64Array, n: number): [Float64Array, Float64Array, Float64Array] {
  const Y = new Float64Array(n); const Cx = new Float64Array(n); const Cz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [X, YY, Z] = mul(M, [toLinear(rgb[i * 3]! / 255), toLinear(rgb[i * 3 + 1]! / 255), toLinear(rgb[i * 3 + 2]! / 255)]);
    const xn = X / WHITE[0]!; const yn = YY / WHITE[1]!; const zn = Z / WHITE[2]!;
    Y[i] = 116 * yn - 16; Cx[i] = 500 * (xn - yn); Cz[i] = 200 * (yn - zn);
  }
  return [Y, Cx, Cz];
}

/** The CSF filters of FLIP's color pipeline: [a1, b1, a2, b2] for the achromatic, red-green and blue-yellow channels. */
const CSF: [number, number, number, number][] = [[1, 0.0047, 0, 1e-5], [1, 0.0053, 0, 1e-5], [34.1, 0.04, 13.5, 0.025]];
function csfFilter(plane: Float64Array, w: number, h: number, [a1, b1, a2, b2]: [number, number, number, number]): Float64Array {
  const r = Math.ceil(3 * Math.sqrt(0.04 / (2 * Math.PI ** 2)) * PPD);
  const g = (b: number): Float64Array => Float64Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp((-(Math.PI ** 2) * ((i - r) / PPD) ** 2) / b));
  const g1 = g(b1); const g2 = g(b2);
  const w1 = a1 * Math.sqrt(Math.PI / b1); const w2 = a2 * Math.sqrt(Math.PI / b2);
  const s1 = g1.reduce((s, v) => s + v, 0); const s2 = g2.reduce((s, v) => s + v, 0);
  const total = w1 * s1 * s1 + w2 * s2 * s2;
  const f1 = filter2(plane, w, h, g1, g1);
  if (a2 === 0) return f1.map((v) => (w1 * v) / total);
  const f2 = filter2(plane, w, h, g2, g2);
  return f1.map((v, i) => (w1 * v + w2 * f2[i]!) / total);
}

/** FLIP's edge and point feature magnitudes over normalised luminance. */
function features(y: Float64Array, w: number, h: number): { edge: Float64Array; point: Float64Array } {
  const sd = 0.5 * 0.082 * PPD; const r = Math.ceil(3 * sd);
  const g = Float64Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sd * sd)));
  const gs = g.reduce((s, v) => s + v, 0);
  const norm = (k: Float64Array): Float64Array => {
    let pos = 0; let neg = 0;
    for (const v of k) { if (v > 0) pos += v; else neg -= v; }
    return k.map((v) => (v > 0 ? v / pos : v / neg));
  };
  const edgeK = norm(g.map((v, i) => -(i - r) * v));
  const pointK = norm(g.map((v, i) => (((i - r) ** 2) / (sd * sd) - 1) * v));
  const gy = g.map((v) => v / gs);
  const mag = (k: Float64Array): Float64Array => { const fx = filter2(y, w, h, k, gy); const fy = filter2(y, w, h, gy, k); return fx.map((v, i) => Math.hypot(v, fy[i]!)); };
  return { edge: mag(edgeK), point: mag(pointK) };
}

/** LDR-FLIP's per-pixel error map between a reference and a test image (sRGB 0..255 over white). */
export function flipMap(ref: Float64Array, test: Float64Array, w: number, h: number): Float64Array {
  const n = w * h;
  const prep = (rgb: Float64Array): { lab: Float64Array; y: Float64Array } => {
    const [Y, Cx, Cz] = ycxcz(rgb, n);
    const fY = csfFilter(Y, w, h, CSF[0]!); const fCx = csfFilter(Cx, w, h, CSF[1]!); const fCz = csfFilter(Cz, w, h, CSF[2]!);
    const lab = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const yy = (WHITE[1]! * (fY[i]! + 16)) / 116;
      const X = WHITE[0]! * (fCx[i]! / 500 + yy / WHITE[1]!); const Z = WHITE[2]! * (yy / WHITE[1]! - fCz[i]! / 200);
      const lin = mul(MI, [X, yy, Z]).map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
      const [L, a, b] = huntLab(lin);
      lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b;
    }
    return { lab, y: Y.map((v) => (v + 16) / 116) };
  };
  const r = prep(ref); const t = prep(test);
  const qc = 0.7; const qf = 0.5; const pc = 0.4; const pt = 0.95;
  const cmax = hyab(huntLab([0, 1, 0]), huntLab([0, 0, 1])) ** qc;
  const fr = features(r.y, w, h); const ft = features(t.y, w, h);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = hyab([r.lab[i * 3]!, r.lab[i * 3 + 1]!, r.lab[i * 3 + 2]!], [t.lab[i * 3]!, t.lab[i * 3 + 1]!, t.lab[i * 3 + 2]!]) ** qc;
    const dc = p < pc * cmax ? (pt / (pc * cmax)) * p : pt + ((p - pc * cmax) / (cmax - pc * cmax)) * (1 - pt);
    const df = (Math.max(Math.abs(fr.edge[i]! - ft.edge[i]!), Math.abs(fr.point[i]! - ft.point[i]!)) / Math.SQRT2) ** qf;
    out[i] = dc ** (1 - df);
  }
  return out;
}

/** GMSD (Xue et al., 2014): luminance averaged 2 × 2 and halved, Prewitt gradients, c = 170, the deviation of GMS. */
export function gmsd(ref: Float64Array, test: Float64Array, w: number, h: number): number {
  const lum = (rgb: Float64Array): Float64Array => Float64Array.from({ length: w * h }, (_, i) => 0.299 * rgb[i * 3]! + 0.587 * rgb[i * 3 + 1]! + 0.114 * rgb[i * 3 + 2]!);
  const W = Math.floor(w / 2); const H = Math.floor(h / 2);
  const down = (l: Float64Array): Float64Array => Float64Array.from({ length: W * H }, (_, i) => { const x = (i % W) * 2; const y = Math.floor(i / W) * 2; return (l[y * w + x]! + l[y * w + x + 1]! + l[(y + 1) * w + x]! + l[(y + 1) * w + x + 1]!) / 4; });
  const gm = (l: Float64Array): Float64Array => {
    const third = Float64Array.from([1 / 3, 1 / 3, 1 / 3]); const diff = Float64Array.from([1, 0, -1]);
    const gx = filter2(l, W, H, diff, third); const gy = filter2(l, W, H, third, diff);
    return gx.map((v, i) => Math.hypot(v, gy[i]!));
  };
  const a = gm(down(lum(ref))); const b = gm(down(lum(test)));
  const c = 170;
  const gms = a.map((v, i) => (2 * v * b[i]! + c) / (v * v + b[i]! * b[i]! + c));
  const mean = gms.reduce((s, v) => s + v, 0) / gms.length;
  return Math.sqrt(gms.reduce((s, v) => s + (v - mean) ** 2, 0) / gms.length);
}

/** CIEDE2000 between two CIELab colors (Sharma, Wu and Dalal's formulation). */
export function ciede2000([L1, a1, b1]: [number, number, number], [L2, a2, b2]: [number, number, number]): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1); const C2 = Math.hypot(a2, b2); const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1; const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1); const Cp2 = Math.hypot(ap2, b2);
  const hp = (b: number, a: number): number => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1 = hp(b1, ap1); const h2 = hp(b2, ap2);
  const dL = L2 - L1; const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2; const Cpm = (Cp1 + Cp2) / 2;
  let hm = h1 + h2;
  if (Cp1 * Cp2 !== 0) { if (Math.abs(h1 - h2) <= 180) hm = (h1 + h2) / 2; else hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2; }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm; const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** Mean ΔE2000 over the frame, with the test image's linear exposure scaled to the reference's mean luminance. */
export function meanDeltaE2000(ref: Float64Array, test: Float64Array, n: number): number {
  const lin = (rgb: Float64Array): Float64Array => rgb.map((v) => toLinear(v / 255));
  const lr = lin(ref); const lt = lin(test);
  const meanY = (l: Float64Array): number => { let s = 0; for (let i = 0; i < n; i++) s += 0.2126 * l[i * 3]! + 0.7152 * l[i * 3 + 1]! + 0.0722 * l[i * 3 + 2]!; return s / n; };
  const k = meanY(lt) > 0 ? meanY(lr) / meanY(lt) : 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = labOfXyz(mul(M, [lr[i * 3]!, lr[i * 3 + 1]!, lr[i * 3 + 2]!]));
    const q = labOfXyz(mul(M, [Math.min(1, lt[i * 3]! * k), Math.min(1, lt[i * 3 + 1]! * k), Math.min(1, lt[i * 3 + 2]! * k)]));
    sum += ciede2000(p, q);
  }
  return sum / n;
}

const luma709 = (rgb: Float64Array, i: number): number => (0.2126 * rgb[i * 3]! + 0.7152 * rgb[i * 3 + 1]! + 0.0722 * rgb[i * 3 + 2]!) / 255;
const silhouette = (rgb: Float64Array, n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (Math.max(255 - rgb[i * 3]!, 255 - rgb[i * 3 + 1]!, 255 - rgb[i * 3 + 2]!) >= ORACLE.silhouetteDelta ? 1 : 0));

export interface Verdict { problems: string[]; blocked: boolean; numbers: Record<string, number> }

/**
 * The oracle over a reference PNG and our PNG of one size. Its problems are sentences; an empty list passes. A
 * blank or black frame on either side is `BLOCKED:` and voids every other number.
 */
export function perceptual(reference: Image, ours: Image, what: string): Verdict {
  if (reference.width !== ours.width || reference.height !== ours.height) return { problems: [`${what}: the reference is ${reference.width} × ${reference.height} and ours ${ours.width} × ${ours.height}`], blocked: false, numbers: {} };
  const w = reference.width; const h = reference.height; const n = w * h;
  const ref = overWhite(reference); const test = overWhite(ours);
  const blankShare = (rgb: Float64Array): number => { let d = 0; for (let i = 0; i < n; i++) if (luma709(rgb, i) <= ORACLE.blankLuma) d++; return d / n; };
  for (const [who, rgb] of [['the reference', ref], ['ours', test]] as const) {
    const share = blankShare(rgb);
    if (share >= ORACLE.blankShare) return { problems: [`BLOCKED: ${what}: ${who} is blank or black (${(share * 100).toFixed(1)}% of its pixels at luma ≤ ${ORACLE.blankLuma}), which voids the comparison`], blocked: true, numbers: {} };
  }
  const sr = silhouette(ref, n); const st = silhouette(test, n);
  let inter = 0; let union = 0;
  for (let i = 0; i < n; i++) { if (sr[i] && st[i]) inter++; if (sr[i] || st[i]) union++; }
  const iou = union === 0 ? 1 : inter / union;
  const map = flipMap(ref, test, w, h);
  let flipSum = 0;
  for (let i = 0; i < n; i++) if (sr[i] || st[i]) flipSum += map[i]!;
  const flip = union === 0 ? 0 : flipSum / union;
  const structure = gmsd(ref, test, w, h);
  const crushed = (rgb: Float64Array): number => { let d = 0; for (let i = 0; i < n; i++) if (luma709(rgb, i) <= ORACLE.crushedLuma) d++; return d / n; };
  const crushedRef = crushed(ref); const crushedOurs = crushed(test);
  const dE = meanDeltaE2000(ref, test, n);
  const problems: string[] = [];
  if (!(flip <= ORACLE.flipMean)) problems.push(`${what}: FLIP's mean over the subject is ${flip.toFixed(4)}, over ${ORACLE.flipMean}`);
  if (!(structure <= ORACLE.gmsd)) problems.push(`${what}: GMSD is ${structure.toFixed(4)}, over ${ORACLE.gmsd}`);
  if (!(crushedOurs <= crushedRef + ORACLE.crushedOver)) problems.push(`${what}: ${(crushedOurs * 100).toFixed(2)}% of our pixels are crushed black against the reference's ${(crushedRef * 100).toFixed(2)}%`);
  if (!(dE <= ORACLE.deltaE2000)) problems.push(`${what}: mean ΔE2000 with exposure removed is ${dE.toFixed(3)}, over ${ORACLE.deltaE2000}`);
  if (!(iou >= ORACLE.iou)) problems.push(`${what}: silhouette IoU is ${iou.toFixed(4)}, under ${ORACLE.iou}`);
  return { problems, blocked: false, numbers: { flip, gmsd: structure, crushedRef, crushedOurs, deltaE2000: dE, iou } };
}

/** The oracle's planted-mismatch twins of a reference: its subject erased to the ground, and the frame moved 4 px. */
export function plantedMismatches(reference: Image): { name: string; image: Image }[] {
  const w = reference.width; const h = reference.height;
  const rgb = overWhite(reference);
  const erased = new Float64Array(rgb.length).fill(255);
  const moved = new Float64Array(rgb.length).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x - 4; const sy = y - 4;
    if (sx >= 0 && sy >= 0) for (let k = 0; k < 3; k++) moved[(y * w + x) * 3 + k] = rgb[(sy * w + sx) * 3 + k]!;
  }
  return [{ name: 'the subject erased to the ground', image: imageOf(w, h, erased) }, { name: 'the frame moved 4 px right and down', image: imageOf(w, h, moved) }];
}
