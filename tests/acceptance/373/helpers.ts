import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/373 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** #391's proof surface, extended by #392 and here: `raster` and `geometry` are added, `check` and `look` read. */
export const RENDER_BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-canvas-render.exe' : 'deep-canvas-render');
export const RENDER_BIN_NAME = 'deep-canvas-render';

// ---------------------------------------------------------------------------------------------------
// Fixtures and JSON

/** A parity fixture: a document under fixtures/parity/2d/. */
export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', 'parity', '2d', name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
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

/** The items map of a document. */
export function items(doc: JsonObject): JsonObject {
  return obj(doc['items'], 'doc.items');
}

/** One item of a document. */
export function itemOf(doc: JsonObject, id: string): JsonObject {
  return obj(items(doc)[id], `doc.items.${id}`);
}

/** One item's params. */
export function paramsOf(doc: JsonObject, id: string): JsonObject {
  return obj(itemOf(doc, id)['params'], `doc.items.${id}.params`);
}

/** True when `value` holds the string `s` anywhere (a key's value, a list's element), at any depth. */
export function holdsString(value: JsonValue | undefined, s: string): boolean {
  if (value === s) return true;
  if (Array.isArray(value)) return value.some((v) => holdsString(v, s));
  if (isObject(value)) return Object.values(value).some((v) => holdsString(v, s));
  return false;
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

/** Pipes every input line into one run (one process) of `deep-canvas-render <subcommand>`. */
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

/** A line that must be refused with `code` (`{"ok": false, "code": code}`). */
export function expectRefused(subcommand: string, input: JsonValue | string, code: string, why: string): JsonObject {
  const out = one(subcommand, input);
  expect(out['ok'], `${RENDER_BIN_NAME} ${subcommand}: ${why}, so it is refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(false);
  expect(out['code'], `${RENDER_BIN_NAME} ${subcommand}: ${why}: the refusal's code`).toBe(code);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Looks. Pixel tests draw with this suite's role map (#391's form, no status map), so every color is
// set here; the status tests draw with the shipped clean look, by ID, whose status map the base holds.

export const LOOK: JsonObject = {
  light: {
    ground: [255, 255, 255], ink: [0, 0, 0],
    'grad.a': [20, 60, 220], 'grad.b': [240, 240, 230], 'grad.c': [210, 40, 20],
    'rad.from': [60, 80, 130], 'rad.to': [200, 180, 120],
    'star.a': [40, 90, 160], 'star.b': [180, 60, 20],
    'frame.bg': [230, 230, 240], gray128: [128, 128, 128],
    g30: [30, 30, 30], g60: [60, 60, 60], g100: [100, 100, 100], g128: [128, 128, 128], g160: [160, 160, 160], g180: [180, 180, 180],
    c1: [40, 90, 160], c2: [180, 60, 20],
    'm.point': [200, 40, 40], 'm.rule': [40, 120, 40], 'm.rect': [40, 40, 200], 'm.bar': [160, 100, 20], 'm.path': [120, 20, 140],
    'm.area': [20, 130, 130], 'm.symbol': [90, 90, 20], 'm.text': [30, 30, 90],
  },
};

/** The status binding's source in the clean-look fixtures, and the state the tests pin it to. */
export const GATE = 'verdict:01JB3730000000000000000001';
export const STATES: JsonObject = { [GATE]: 'pass' };

export type Rgb = [number, number, number];

/** A color as the base's look@1 writes it (`"#rrggbb"`), or as `[r, g, b]`. */
export function colorOf(value: JsonValue | undefined, what: string): Rgb {
  if (typeof value === 'string') {
    expect(/^#[0-9a-fA-F]{6}$/.test(value), `${what} is #rrggbb, got ${value}`).toBe(true);
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
  }
  const list = arr(value, what);
  expect(list.length, `${what} is [r, g, b]`).toBe(3);
  return list.map((v, i) => num(v, `${what}[${i}]`)) as Rgb;
}

let cleanLook: JsonObject | null = null;
/** The shipped clean look, as `look` resolves it. */
export function clean(): JsonObject {
  if (cleanLook === null) {
    const out = one('look', { look: 'clean' });
    expect(out['ok'], `look "clean" is the shipped clean pipeline look: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
    cleanLook = obj(out['look'], 'look "clean": look');
  }
  return clone(cleanLook);
}

/** The clean look's status colors and its `min_distance` (0.10 by default). */
export function cleanStatus(): { colors: Record<string, Rgb>; min: number } {
  const look = clean();
  const map = obj(look['status'], 'look.status');
  const colors: Record<string, Rgb> = {};
  for (const [state, c] of Object.entries(map)) colors[state] = colorOf(c, `look.status.${state}`);
  const min = typeof look['min_distance'] === 'number' ? look['min_distance'] : 0.1;
  return { colors, min };
}

/** A role of the clean look in its light theme (`roles` → `palette`). */
export function cleanRole(role: string): Rgb {
  const look = clean();
  const name = obj(look['roles'], 'look.roles')[role];
  expect(typeof name, `look.roles.${role} names a palette entry`).toBe('string');
  return colorOf(obj(look['palette'], 'look.palette')[name as string], `look.palette.${String(name)}`);
}

// ---------------------------------------------------------------------------------------------------
// The check, the raster and the geometry.

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }

/** `check` over a document with a look: whether it passes, and its issues. */
export function check(doc: JsonObject, look: JsonValue): { ok: boolean; issues: Issue[] } {
  const out = one('check', { doc, look });
  expect(typeof out['ok'], `check answers ok: ${JSON.stringify(out).slice(0, 2000)}`).toBe('boolean');
  const issues = arr(out['issues'], 'check: issues').map((v, i) => {
    const raw = obj(v, `check: issues[${i}]`);
    return {
      code: String(raw['code']), severity: String(raw['severity']), path: String(raw['path']),
      ids: arr(raw['ids'], `check: issues[${i}].ids`).map(String), raw,
    };
  });
  return { ok: out['ok'] === true, issues };
}

/** The errors of a check. */
export const errorsOf = (result: { issues: Issue[] }): Issue[] => result.issues.filter((i) => i.severity === 'error');

/** A document the check passes with no error. */
export function expectClean(doc: JsonObject, look: JsonValue, what: string): void {
  const result = check(doc, look);
  const errors = errorsOf(result);
  expect(errors.map((e) => `${e.code} ${e.ids.join(',')} ${e.path}`), `${what}: the check raises no error`).toEqual([]);
  expect(result.ok, `${what}: the check passes`).toBe(true);
}

/** Scratch folders for PNGs and the image store, deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-373-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The image store: the fixture's swatch PNG, named by its sha256, in a scratch folder. */
export function imageStore(dir: string): string {
  const source = join(HERE, 'fixtures', 'assets', 'swatch.png');
  const sha = createHash('sha256').update(readFileSync(source)).digest('hex');
  copyFileSync(source, join(dir, sha));
  return dir;
}

export interface Drawn { report: JsonObject; image: Image }

let rasters = 0;
/** A `raster` request for `doc` (with the store and pinned states), writing under `dir`. */
export function rasterInput(dir: string, doc: JsonObject, look: JsonValue, extra: JsonObject = {}): JsonObject {
  rasters += 1;
  return { out: join(dir, `r${rasters}.png`), doc, look, store: imageStore(dir), states: STATES, ...extra };
}

/** Reads a raster's answer and its PNG; the answer must be accepted and the PNG the document's size. */
export function readRaster(input: JsonObject, out: JsonValue | undefined, what: string): Drawn {
  const report = obj(out, `raster ${what}: the answer`);
  expect(report['ok'], `raster ${what} refused: ${JSON.stringify(report).slice(0, 2000)}`).toBe(true);
  const size = arr(obj(input['doc'], 'doc')['size'], 'doc.size').map((v) => num(v, 'doc.size'));
  const image = readPng(String(input['out']));
  expect([image.width, image.height], `raster ${what}: the PNG is the document's size`).toEqual(size);
  expect([report['width'], report['height']], `raster ${what}: the answer reports the PNG's size`).toEqual(size);
  return { report, image };
}

/** One document drawn by `raster` in a process of its own. */
export function raster(dir: string, doc: JsonObject, look: JsonValue, what: string, extra: JsonObject = {}): Drawn {
  const input = rasterInput(dir, doc, look, extra);
  return readRaster(input, batch('raster', [input])[0], what);
}

/** The same document drawn twice by one process, as two lines. */
export function rasterTwiceInOneProcess(dir: string, doc: JsonObject, look: JsonValue, what: string): [Drawn, Drawn] {
  const a = rasterInput(dir, doc, look);
  const b = rasterInput(dir, doc, look);
  const [ra, rb] = batch('raster', [a, b]);
  return [readRaster(a, ra, `${what} (first line)`), readRaster(b, rb, `${what} (second line)`)];
}

export interface Subpath { closed: boolean; verbs: string[]; points: [number, number][] }

/** `geometry` of one item: its outline's subpaths in document u. */
export function geometry(doc: JsonObject, item: string): Subpath[] {
  const out = one('geometry', { doc, item });
  expect(out['ok'], `geometry of ${item} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  return arr(out['subpaths'], `geometry ${item}: subpaths`).map((s, i) => {
    const sp = obj(s, `geometry ${item}: subpaths[${i}]`);
    return {
      closed: sp['closed'] === true,
      verbs: arr(sp['verbs'], `subpaths[${i}].verbs`).map(String),
      points: arr(sp['points'], `subpaths[${i}].points`).map((p, k) => {
        const xy = arr(p, `subpaths[${i}].points[${k}]`);
        return [num(xy[0], `points[${k}][0]`), num(xy[1], `points[${k}][1]`)] as [number, number];
      }),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// PNG: a reader for what the raster writes (8-bit RGB or RGBA, no interlace), node built-ins only, as
// #391's and #392's tests read theirs.

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

/** The pixel whose square holds the point (x, y) in u (zoom 1, scale 1). */
export function pixel(image: Image, x: number, y: number): Rgb {
  const px = Math.floor(x); const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) throw Error(`(${x}, ${y}) is outside the ${image.width} × ${image.height} image`);
  const o = (py * image.width + px) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}

export const same = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** null when the two images are equal byte for byte (RGBA), else the first pixel that differs. */
export function firstDifference(a: Image, b: Image): string | null {
  if (a.width !== b.width || a.height !== b.height) return `the sizes differ: ${a.width} × ${a.height} and ${b.width} × ${b.height}`;
  for (let i = 0; i < a.rgba.length; i++) {
    if (a.rgba[i] !== b.rgba[i]) {
      const p = i >> 2; const x = p % a.width; const y = (p - x) / a.width;
      return `pixel (${x}, ${y}) reads ${JSON.stringify([...a.rgba.subarray(p * 4, p * 4 + 4)])} and ${JSON.stringify([...b.rgba.subarray(p * 4, p * 4 + 4)])}`;
    }
  }
  return null;
}

/** The pixels in [x0, x1) × [y0, y1) that are not `ground`. */
export function inked(image: Image, ground: Rgb, x0 = 0, y0 = 0, x1 = image.width, y1 = image.height): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!same(pixel(image, x, y), ground)) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------
// Color, computed in f64 from published formulas, never from the implementation: the sRGB transfer
// function (IEC 61966-2-1) and OKLab (Björn Ottosson, "A perceptual color space for image
// processing", 2020: the M1 and M2 matrices as published there).

export const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toEncoded = (l: number): number => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

export type Lab = [number, number, number];

export function linearToOklab([r, g, b]: [number, number, number]): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** An sRGB-encoded 0–255 color's OKLab. */
export const oklabOf = (c: Rgb): Lab => linearToOklab([toLinear(c[0] / 255), toLinear(c[1] / 255), toLinear(c[2] / 255)]);

/** An OKLab color as sRGB-encoded 0–255 values, unrounded. */
export const codesOf = (lab: Lab): [number, number, number] => oklabToLinear(lab).map((l) => 255 * toEncoded(Math.min(1, Math.max(0, l)))) as [number, number, number];

export const deltaE = (p: Lab, q: Lab): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

export interface Stop { at: number; color: Rgb }

/** A gradient's color at t (padded to [0, 1]): interpolated in OKLab between its stops, unrounded codes. */
export function oklabRamp(stops: Stop[], t: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && u > stops[i + 1]!.at) i++;
  const a = stops[i]!; const b = stops[i + 1]!;
  const f = b.at === a.at ? 0 : (u - a.at) / (b.at - a.at);
  const A = oklabOf(a.color); const B = oklabOf(b.color);
  return codesOf([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f]);
}

/** The same stops mixed in sRGB-encoded space: the wrong ramp the tests prove they reject. */
export function encodedRamp(stops: Stop[], t: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && u > stops[i + 1]!.at) i++;
  const a = stops[i]!; const b = stops[i + 1]!;
  const f = (u - a.at) / (b.at - a.at);
  return [0, 1, 2].map((k) => a.color[k]! + (b.color[k]! - a.color[k]!) * f) as [number, number, number];
}

/** A look role's color in this suite's role map. */
export function lookRole(role: string): Rgb {
  return colorOf(obj(LOOK['light'], 'LOOK.light')[role], `LOOK.light.${role}`);
}

/** The largest channel difference between a drawn pixel and an expected unrounded color. */
export const codeError = (actual: Rgb, expected: [number, number, number]): number =>
  Math.max(...[0, 1, 2].map((k) => Math.abs(actual[k]! - expected[k]!)));
