// Test-side tools for #1175's suite: `deep-canvas-render` (#391's binary, with #373's `raster` and #398's `vector@1`
// import) built once per file and driven by JSON lines; a document holding one `vector@1` item, the image store its SVG
// is read from and a look whose roles hold exactly the SVG's own colors; the pinned headless Chrome, checked by version;
// PNG reading and writing; and the measures AC1 names, read from pixels. Nothing here stands in for the import under
// test. Adapted from tests/acceptance/398/elements-helpers.ts and tests/acceptance/1174/helpers.ts (same repo).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1175 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const RENDER_BIN_NAME = 'deep-canvas-render';
export const RENDER_BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${RENDER_BIN_NAME}.exe` : RENDER_BIN_NAME);

/** AC2's wrong program: an importer that drops `<marker>` and reports it only as a warning (README: The surface). */
export const PLANTED_DROPS_MARKER = 'import_drops_marker';

export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

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

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };

function buildBinary(): string {
  const run = spawnSync('cargo', ['build', '--locked', '-p', 'deep-marks-render', '--bin', RENDER_BIN_NAME], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: CARGO_ENV });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${RENDER_BIN_NAME} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the binary once per file and fails every test of the file when it can't be built. */
export function useRenderBinary(): void {
  let error = '';
  beforeAll(() => { error = buildBinary(); }, 1_800_000);
  beforeEach(() => { expect(error, `the binary builds: ${RENDER_BIN_NAME}`).toBe(''); });
}

/** One line into one run of `deep-canvas-render <subcommand>`; its one answer. */
export function one(subcommand: string, input: JsonValue): JsonObject {
  const run = spawnSync(RENDER_BIN, [subcommand], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const name = `${RENDER_BIN_NAME} ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  return obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
}

/** A scratch folder, deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-1175-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The document: one vector@1 item `art` whose viewBox is drawn onto [pos, size] in u, every SVG color mapped to a
// look role holding exactly that CSS color, over a white ground (the ground Chrome is given too).

export const GROUND: Rgb = [255, 255, 255];

/** The CSS named colors the fixtures could use (CSS Color 4). */
const NAMED: Record<string, Rgb> = { black: [0, 0, 0], white: [255, 255, 255] };

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
export const hexOf = (c: Rgb): string => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
export const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

export function cssColor(value: string): Rgb | null {
  const v = value.trim().toLowerCase();
  if (v in NAMED) return NAMED[v]!;
  if (/^#[0-9a-f]{6}$/.test(v)) return hex(v);
  if (/^#[0-9a-f]{3}$/.test(v)) return [1, 2, 3].map((i) => parseInt(v[i]! + v[i]!, 16)) as Rgb;
  return null;
}

/**
 * Every color an SVG writes, in attributes and in CSS declarations (style attributes and style blocks), as written.
 * A value that is neither a keyword below, a `url(…)` nor a color the table knows throws, so none goes unmapped by
 * mistake. Black is always there: SVG's initial fill, and what `currentColor` is with no `color` set.
 */
export function svgColors(svg: string): Map<string, Rgb> {
  const found = new Map<string, Rgb>([['black', NAMED.black!]]);
  const props = '(?:fill|stroke|stop-color|flood-color|lighting-color|color)';
  const patterns = [new RegExp(`\\s${props}\\s*=\\s*"([^"]*)"`, 'g'), new RegExp(`(?:^|[\\s;{"'])${props}\\s*:\\s*([^;}"']+)`, 'g')];
  for (const re of patterns) {
    for (const m of svg.matchAll(re)) {
      const value = m[1]!.trim();
      if (['none', 'currentcolor'].includes(value.toLowerCase()) || value.startsWith('url(')) continue;
      const rgb = cssColor(value);
      if (!rgb) throw Error(`the SVG writes a color the test's table doesn't know: ${JSON.stringify(value)}`);
      found.set(value, rgb);
    }
  }
  return found;
}

export const roleOf = (c: Rgb): string => `svg.${hexOf(c).slice(1)}`;

export interface VectorDoc { doc: JsonObject; look: JsonObject; store: string; svg: Buffer; size: [number, number] }

/**
 * A board of `size` u holding one vector@1 item `art` at the origin, its viewBox drawn onto [0, 0, size]. `colors` maps
 * each color as the SVG writes it, as lowercase #rrggbb and (for MathJax's output) `currentColor` to the role of that
 * color, and the look's light theme draws each role in exactly that color over a white ground.
 */
export function vectorDoc(dir: string, svg: Buffer, opts: { id: string; title: string; alt: string; size: [number, number] }): VectorDoc {
  const store = mkdtempSync(join(dir, 'store-'));
  const src = sha256(svg);
  writeFileSync(join(store, src), svg);
  const colors: JsonObject = { currentColor: roleOf(NAMED.black!) };
  const light: JsonObject = { ground: [...GROUND], ink: [0, 0, 0] };
  for (const [written, rgb] of svgColors(svg.toString('utf8'))) {
    colors[written] = roleOf(rgb);
    colors[hexOf(rgb)] = roleOf(rgb);
    light[roleOf(rgb)] = [...rgb];
  }
  const doc: JsonObject = {
    format: 1, id: opts.id, profile: 'board', title: opts.title,
    description: `One SVG imported as a vector@1 item (${opts.alt}).`.slice(0, 400),
    size: [...opts.size],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      art: {
        id: 'art', kind: 'vector@1', layer: 'main', name: opts.title, order: 'a00',
        at: { pos: [0, 0, 0] },
        params: { src, size: [...opts.size], colors, alt: opts.alt },
      },
    },
  };
  return { doc, look: { light }, store, svg, size: opts.size };
}

export const ELEMENTS_SVG = readFileSync(join(FIXTURES, 'elements.svg'));
export const MATHJAX_SVG = readFileSync(join(FIXTURES, 'mathjax-clip.svg'));

/** elements.svg at its own size: its 240 × 160 viewBox drawn at scale 1 onto a 240 × 160 board. */
export const elementsDoc = (dir: string): VectorDoc => vectorDoc(dir, ELEMENTS_SVG, { id: 'v1175-elements', title: 'Five elements', alt: 'clipPath, mask, pattern, marker and style', size: [240, 160] });
/** The MathJax formula with a clip: its 470 × 90 viewBox drawn at scale 2 onto a 940 × 180 board. */
export const mathjaxDoc = (dir: string): VectorDoc => vectorDoc(dir, MATHJAX_SVG, { id: 'v1175-mathjax', title: 'Formula with a clip', alt: 'x + 1 = 1 + x', size: [940, 180] });

// ---------------------------------------------------------------------------------------------------
// The check and the raster.

export interface Checked { ok: boolean; issues: JsonObject[]; raw: JsonObject }

/** `check {doc, look, store, planted?, accepted?}`. */
export function check(v: VectorDoc, extra: { planted?: string; accepted?: JsonValue } = {}): Checked {
  const input: JsonObject = { doc: v.doc, look: v.look, store: v.store };
  if (extra.planted !== undefined) input['planted'] = extra.planted;
  if (extra.accepted !== undefined) input['accepted'] = extra.accepted;
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

let rasters = 0;
/** `raster {out, doc, look, store, t: 0, planted?}`: the answer, and the PNG when it was drawn. */
export function raster(dir: string, v: VectorDoc, planted?: string): { report: JsonObject; image: Image | null } {
  rasters += 1;
  const input: JsonObject = { out: join(dir, `r${rasters}.png`), doc: v.doc, look: v.look, store: v.store, t: 0 };
  if (planted !== undefined) input['planted'] = planted;
  const report = one('raster', input);
  if (report['ok'] !== true) return { report, image: null };
  const image = readPng(String(input['out']));
  expect([image.width, image.height], 'the raster\'s PNG is the document\'s size').toEqual(v.size);
  return { report, image };
}

/** A raster that must be drawn. */
export function drawn(dir: string, v: VectorDoc, what: string, planted?: string): Image {
  const { report, image } = raster(dir, v, planted);
  expect(report['ok'], `raster ${what}: the SVG imports and draws: ${JSON.stringify(report).slice(0, 2000)}`).toBe(true);
  return image!;
}

// ---------------------------------------------------------------------------------------------------
// The pinned headless Chrome (README: Chrome).

export const CHROME_VERSION = '156.0.8078.4';
export const CHROME = process.env['DEEP1175_CHROME'] ?? join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell');

/** BLOCKED unless the pinned Chrome for Testing is there at its pinned version. */
export function requireChrome(): void {
  if (!existsSync(CHROME)) blocked(`the pinned headless Chrome (Chrome for Testing ${CHROME_VERSION}) is missing at ${CHROME} (set DEEP1175_CHROME); the comparison has no reference without it`);
  const run = spawnSync(CHROME, ['--version'], { encoding: 'utf8', timeout: 60_000 });
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  const version = /(\d+\.\d+\.\d+\.\d+)/.exec(said)?.[1];
  if (run.status !== 0 || version !== CHROME_VERSION) blocked(`${CHROME} is not the pinned Chrome for Testing ${CHROME_VERSION}: --version says ${JSON.stringify(said.slice(0, 300))}${run.error ? ` (${run.error.message})` : ''}`);
}

/** Chrome's render of the SVG bytes at width × height CSS px, scale factor 1, sRGB, on the white ground. */
export function chromeRender(dir: string, svg: Buffer, [width, height]: [number, number], name: string): Image {
  requireChrome();
  const work = mkdtempSync(join(dir, `chrome-${name}-`));
  const file = join(work, `${name}.svg`);
  writeFileSync(file, svg);
  const shot = join(work, `${name}.png`);
  const run = spawnSync(CHROME, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars',
    `--default-background-color=${hexOf(GROUND).slice(1)}ff`, `--window-size=${width},${height}`,
    `--user-data-dir=${join(work, 'profile')}`, `--screenshot=${shot}`, pathToFileURL(file).href,
  ], { encoding: 'utf8', timeout: 120_000 });
  if (!existsSync(shot)) blocked(`the pinned Chrome wrote no screenshot of ${name} (exit ${run.status}): ${(run.stderr ?? '').slice(-1500)}`);
  const image = readPng(shot);
  expect([image.width, image.height], `Chrome's screenshot of ${name} is ${width} × ${height}`).toEqual([width, height]);
  return image;
}

// ---------------------------------------------------------------------------------------------------
// PNG: 8-bit RGB / RGBA / gray / gray-alpha, no interlace; written as 8-bit RGB, no filter, zlib level 9.

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
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!channels || interlace !== 0 || depth !== 8) throw Error(`PNG color type ${color}, depth ${depth}, interlace ${interlace} is not one this reader takes`);
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels <= 2) {
        const g = line[x * channels]!;
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = channels === 2 ? line[x * channels + 1]! : 255;
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

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  let c = 0xffffffff;
  for (const b of [...head.subarray(4), ...body]) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** The image composited over the ground, as an 8-bit RGB PNG: no filter, zlib level 9, so equal pixels give equal bytes. */
export function encodePng(image: Image): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(image.width, 0); ihdr.writeUInt32BE(image.height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const p = pixel(image, x, y); const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = p[0]; raw[r + 1] = p[1]; raw[r + 2] = p[2];
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

/** Images left to right on a grey strip, each drawn `zoom` × `zoom` per pixel (nearest). */
export function sideBySide(images: Image[], zoom = 1, gap = 8): Image {
  const width = images.reduce((s, im) => s + im.width * zoom, 0) + gap * (images.length + 1);
  const height = Math.max(...images.map((im) => im.height * zoom)) + 2 * gap;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([128, 128, 128, 255], i);
  let left = gap;
  for (const im of images) {
    for (let y = 0; y < im.height * zoom; y++) for (let x = 0; x < im.width * zoom; x++) {
      rgba.set([...pixel(im, Math.floor(x / zoom), Math.floor(y / zoom)), 255], ((gap + y) * width + left + x) * 4);
    }
    left += im.width * zoom + gap;
  }
  return { width, height, rgba };
}

/** The pixel (column x, row y), composited over the white ground: RGB 0..255. */
export function pixel(image: Image, x: number, y: number): Rgb {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw Error(`(${x}, ${y}) is outside the ${image.width} × ${image.height} image`);
  const o = (y * image.width + x) * 4;
  const a = image.rgba[o + 3]! / 255;
  return [0, 1, 2].map((k) => Math.round(image.rgba[o + k]! * a + GROUND[k]! * (1 - a))) as Rgb;
}
export const codeDistance = (a: Rgb, b: Rgb): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!)));

/** Pixels other than the ground, beyond 2 codes. */
export function inked(image: Image): number {
  let n = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (codeDistance(pixel(image, x, y), GROUND) > 2) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------
// The measures AC1 names, read from pixels in SVG units (elements.svg is drawn at scale 1 from the origin, so pixel
// column x covers [x, x + 1) u). Each answers [] when it holds, else sentences naming the element.

/** How far a pixel has gone from the ground toward `color`, 0..1 (least squares over R, G and B). */
export function coverage(image: Image, x: number, y: number, color: Rgb): number {
  const p = pixel(image, x, y);
  let num = 0; let den = 0;
  for (let k = 0; k < 3; k++) { const d = GROUND[k]! - color[k]!; num += (GROUND[k]! - p[k]!) * d; den += d * d; }
  return Math.max(0, Math.min(1, num / den));
}

/**
 * Where one straight edge crosses a run of pixels, from coverage: the run [b - 5, b + 5) along x (row y) or along y
 * (column x) holds one edge, ground to color (`rising`) or color to ground. The coverage summed over the run is the
 * length of color in it, so the edge sits at b + 5 − sum (rising) or b − 5 + sum (falling). Exact for an edge that
 * crosses the run once, at any sub-pixel position.
 */
export function edgeAt(image: Image, color: Rgb, along: 'x' | 'y', fixed: number, b: number, rising: boolean): number {
  let sum = 0;
  for (let i = b - 5; i < b + 5; i++) sum += along === 'x' ? coverage(image, i, fixed, color) : coverage(image, fixed, i, color);
  return rising ? b + 5 - sum : b - 5 + sum;
}

const near = (got: number, want: number, tol: number): boolean => Math.abs(got - want) <= tol;
const f2 = (n: number): string => n.toFixed(2);

export const CLIP_COLOR = hex('#1e7b34');
export const MASK_COLOR = hex('#2050c0');
export const PATTERN_COLOR = hex('#c03020');
export const MARKER_COLOR = hex('#7a2a90');
export const STYLE_COLOR = hex('#208080');
export const STYLE_ATTRIBUTE_COLOR = hex('#e0a000');

/**
 * `<clipPath>`: the rect 10..70 filled #1e7b34 is clipped by the rect 20..40, so its color's edges lie at 20 and 40
 * on both axes within 0.5 u (read on the rows and columns 23, 30 and 37), and every pixel of [5, 75)² wholly outside
 * [19, 41)² is the ground within 2 codes.
 */
export function clipProblems(image: Image): string[] {
  const out: string[] = [];
  for (const at of [23, 30, 37]) {
    for (const [along, b, rising] of [['x', 20, true], ['x', 40, false], ['y', 20, true], ['y', 40, false]] as const) {
      const e = edgeAt(image, CLIP_COLOR, along, at, b, rising);
      if (!near(e, b, 0.5)) out.push(`<clipPath>: the clipped rect's ${rising ? 'leading' : 'trailing'} edge along ${along} at ${along === 'x' ? 'row' : 'column'} ${at} is at ${f2(e)} u, where its clip's edge is ${b} (within 0.5 u)`);
    }
  }
  for (let y = 5; y < 75; y++) for (let x = 5; x < 75; x++) {
    if (x >= 19 && x < 41 && y >= 19 && y < 41) continue;
    const p = pixel(image, x, y);
    if (codeDistance(p, GROUND) > 2) { out.push(`<clipPath>: the pixel (${x}, ${y}), outside the clip, reads ${JSON.stringify(p)}, not the ground: the clipped rect draws outside its clip`); break; }
  }
  return out;
}

/**
 * `<mask>`: the rect 90..150 × 10..70 filled #2050c0 under a mask whose luminance is 1 (white) over 90..120 and 0
 * (black) over 120..150, so its alpha is 1 then 0: every pixel of [91, 119) × [11, 69) is the color and every pixel of
 * [121, 149) × [11, 69) the ground, each within 2 codes (alpha × color over the ground, alpha = luminance).
 */
export function maskProblems(image: Image): string[] {
  const out: string[] = [];
  for (const [x0, x1, luminance] of [[91, 119, 1], [121, 149, 0]] as const) {
    const want = [0, 1, 2].map((k) => Math.round(luminance * MASK_COLOR[k]! + (1 - luminance) * GROUND[k]!)) as Rgb;
    let bad = 0; let first = '';
    for (let y = 11; y < 69; y++) for (let x = x0; x < x1; x++) {
      const p = pixel(image, x, y);
      if (codeDistance(p, want) > 2) { bad++; if (!first) first = `(${x}, ${y}) reads ${JSON.stringify(p)}`; }
    }
    if (bad) out.push(`<mask>: where the mask's luminance is ${luminance}, the masked rect's alpha should be ${luminance} (the pixel ${JSON.stringify(want)} within 2 codes), but ${bad} pixels aren't; first ${first}`);
  }
  return out;
}

/**
 * `<pattern>`: the rect 180..220 × 20..60 is filled by a 20 × 20 user-space tile from (0, 0) whose top-left 10 × 10 is
 * #c03020, so its color's edges lie at x = 180, 190, 200, 210 (rows 25, 45) and y = 20, 30, 40, 50 (columns 185,
 * 205), each within 0.5 u, and the cells between are the ground (the falling and rising edges bound them).
 */
export function patternProblems(image: Image): string[] {
  const out: string[] = [];
  for (const [along, fixed] of [['x', 25], ['x', 45], ['y', 185], ['y', 205]] as const) {
    const start = along === 'x' ? 180 : 20;
    for (const [i, rising] of [[0, true], [1, false], [2, true], [3, false]] as const) {
      const b = start + 10 * i;
      const e = edgeAt(image, PATTERN_COLOR, along, fixed, b, rising);
      if (!near(e, b, 0.5)) out.push(`<pattern>: the tile's ${rising ? 'leading' : 'trailing'} edge along ${along} at ${along === 'x' ? 'row' : 'column'} ${fixed} is at ${f2(e)} u, where 20-unit tiles from (0, 0) put it at ${b} (within 0.5 u)`);
    }
  }
  return out;
}

/** The least-squares slope of points [t, v]. */
function slope(points: [number, number][]): number {
  const n = points.length;
  const mt = points.reduce((s, p) => s + p[0], 0) / n; const mv = points.reduce((s, p) => s + p[1], 0) / n;
  let num = 0; let den = 0;
  for (const [t, v] of points) { num += (t - mt) * (v - mv); den += (t - mt) * (t - mt); }
  return num / den;
}

/**
 * `<marker>`: the path runs from (20, 120) to (80, 120), so its tangent at its end is 0°; its marker-end is a 12 × 12
 * #7a2a90 square, refX and refY 6, user-space units, orient 0. Its four edges are read on the square's middle rows and
 * columns (the left edge skips rows 118..121, where the line meets it): each edge's turn, from its slope, must be the
 * tangent's within 1° (a square's turn read modulo 90°), and its middle, from the four edges, (80, 120) within 0.5 u.
 */
export function markerProblems(image: Image): string[] {
  const out: string[] = [];
  const cols = [76, 77, 78, 79, 80, 81, 82, 83, 84];
  const top = cols.map((x) => [x + 0.5, edgeAt(image, MARKER_COLOR, 'y', x, 114, true)] as [number, number]);
  const bottom = cols.map((x) => [x + 0.5, edgeAt(image, MARKER_COLOR, 'y', x, 126, false)] as [number, number]);
  const right = [116, 117, 118, 119, 120, 121, 122, 123, 124].map((y) => [y + 0.5, edgeAt(image, MARKER_COLOR, 'x', y, 86, false)] as [number, number]);
  const left = [115, 116, 117, 122, 123, 124].map((y) => [y + 0.5, edgeAt(image, MARKER_COLOR, 'x', y, 74, true)] as [number, number]);
  const deg = (r: number): number => (r * 180) / Math.PI;
  const turns: [string, number][] = [
    ['top', deg(Math.atan(slope(top)))], ['bottom', deg(Math.atan(slope(bottom)))],
    ['right', -deg(Math.atan(slope(right)))], ['left', -deg(Math.atan(slope(left)))],
  ];
  const tangent = 0;
  for (const [edge, turn] of turns) {
    if (!Number.isFinite(turn) || Math.abs(turn - tangent) > 1) out.push(`<marker>: the marker's ${edge} edge is turned ${Number.isFinite(turn) ? f2(turn) : String(turn)}°, where the line's tangent at its end is ${tangent}° (within 1°)`);
  }
  const mean = (ps: [number, number][]): number => ps.reduce((s, p) => s + p[1], 0) / ps.length;
  const cx = (mean(left) + mean(right)) / 2; const cy = (mean(top) + mean(bottom)) / 2;
  const sides = { left: mean(left), right: mean(right), top: mean(top), bottom: mean(bottom) };
  if (!near(cx, 80, 0.5) || !near(cy, 120, 0.5) || !near(sides.right - sides.left, 12, 1) || !near(sides.bottom - sides.top, 12, 1)) {
    out.push(`<marker>: the marker's edges (left ${f2(sides.left)}, right ${f2(sides.right)}, top ${f2(sides.top)}, bottom ${f2(sides.bottom)} u) don't make the 12 × 12 marker centred on the line's end (80, 120) within 0.5 u`);
  }
  return out;
}

/**
 * `<style>`: the block's `.tinted { fill: #208080; }` beats the rect's presentation attribute fill="#e0a000", so every
 * pixel of the rect's inside, [141, 179) × [101, 139), is teal #208080 within 2 codes.
 */
export function styleProblems(image: Image): string[] {
  let bad = 0; let first = '';
  for (let y = 101; y < 139; y++) for (let x = 141; x < 179; x++) {
    const p = pixel(image, x, y);
    if (codeDistance(p, STYLE_COLOR) > 2) { bad++; if (!first) first = `(${x}, ${y}) reads ${JSON.stringify(p)}${codeDistance(p, STYLE_ATTRIBUTE_COLOR) <= 2 ? ', the presentation attribute\'s orange' : ''}`; }
  }
  return bad ? [`<style>: the styled rect should be teal ${JSON.stringify(STYLE_COLOR)} (the class rule beats fill="#e0a000"), but ${bad} of its 1444 inside pixels aren't; first ${first}`] : [];
}

export const MEASURES = { clipPath: clipProblems, mask: maskProblems, pattern: patternProblems, marker: markerProblems, style: styleProblems } as const;

/** The share of pixels whose every channel lies within `codes` of the other image's, both over the ground. */
export function shareWithin(a: Image, b: Image, codes: number): number {
  expect([a.width, a.height], 'the two renders are the same size').toEqual([b.width, b.height]);
  let ok = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (codeDistance(pixel(a, x, y), pixel(b, x, y)) <= codes) ok++;
  return ok / (a.width * a.height);
}
