// Shared helpers for #398's acceptance tests: the `deep-canvas-render` binary driven by JSON lines (#391's
// convention), the store an SVG is read from by its sha256, documents holding `vector@1` items, the check, the
// raster and the geometry, a PNG reader, and the perceptual oracle as reviewed test code. Every expected value
// is computed here or in the tests from the fixtures' own numbers, never read from the implementation.
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

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/398 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const RENDER_BIN_NAME = 'deep-canvas-render';
export const RENDER_BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${RENDER_BIN_NAME}.exe` : RENDER_BIN_NAME);

// ---------------------------------------------------------------------------------------------------
// Time: flicks (1/705,600,000 s), as #391's surface reads them. Every time the tests use is a whole flick.

export const FLICKS_PER_SECOND = 705_600_000;
/** `num / den` seconds in flicks; fails the test unless that is a whole number of flicks. */
export function flicks(num: number, den = 1): number {
  const f = (num * FLICKS_PER_SECOND) / den;
  if (!Number.isInteger(f)) throw Error(`${num}/${den} s is not a whole number of flicks`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// JSON

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

export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * True when `value` names `name` as data: some string in it, at any depth, outside the keys `what` and `fix`
 * (an agent branches on data, never on message text), that is `name` or holds it as a whole word
 * (`clipPath`, `<clipPath>`, `clipPath#clip1` and `svg/defs/clipPath[0]` all name `clipPath`; `clipPathX` doesn't).
 */
export function namesAsData(value: JsonValue | undefined, name: string): boolean {
  const word = new RegExp(`(^|[^A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`);
  const walk = (v: JsonValue | undefined): boolean => {
    if (typeof v === 'string') return word.test(v);
    if (Array.isArray(v)) return v.some(walk);
    if (isObject(v)) return Object.entries(v).some(([k, x]) => k !== 'what' && k !== 'fix' && walk(x));
    return false;
  };
  return walk(value);
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

// ---------------------------------------------------------------------------------------------------
// Scratch folders and the store: a directory whose files are named by the sha256 of their bytes (#373's store;
// a document names an SVG only by `src: sha256`, the request names the directory).

export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-398-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The bytes of a fixture (a path under fixtures/). */
export function fixtureBytes(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

/** Puts bytes in the store and answers their sha256. */
export function putBytes(store: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  writeFileSync(join(store, sha), bytes);
  return sha;
}

/** Puts a fixture in the store and answers its sha256. */
export function put(store: string, fixture: string): string {
  return putBytes(store, fixtureBytes(fixture));
}

// ---------------------------------------------------------------------------------------------------
// Looks: #391's role map form (no status map), so every color is set here.

export type Rgb = [number, number, number];

export const LOOK: { light: Record<string, Rgb> } = {
  light: {
    ground: [255, 255, 255], ink: [0, 0, 0], accent: [30, 90, 200], op: [204, 0, 0], term: [51, 102, 204],
    'c.red': [204, 0, 0], 'c.green': [0, 170, 0], 'c.blue': [0, 0, 204],
    // resvg's named colors, as CSS defines them, so its reviewed PNGs are this look's pixels.
    'rv.green': [0, 128, 0], 'rv.black': [0, 0, 0], 'rv.red': [255, 0, 0], 'rv.blue': [0, 0, 255], 'rv.white': [255, 255, 255],
    'rv.grey': [128, 128, 128], 'rv.darkblue': [0, 0, 139],
  },
};

export const role = (name: string): Rgb => {
  const c = LOOK.light[name];
  if (!c) throw Error(`no role ${name} in LOOK`);
  return c;
};

// ---------------------------------------------------------------------------------------------------
// Documents: the design's envelope (#391's and #373's form) with `vector@1` items.

export interface VectorSpec {
  src: string;
  size: [number, number];
  colors: Record<string, string>;
  alt?: string;
  parts?: string[];
  write_on?: JsonObject;
  pos?: [number, number];
  order?: string;
}

export function vectorItem(id: string, spec: VectorSpec): JsonObject {
  const params: JsonObject = { src: spec.src, size: spec.size, colors: spec.colors, alt: spec.alt ?? id };
  if (spec.parts) params['parts'] = spec.parts;
  if (spec.write_on) params['write_on'] = spec.write_on;
  const item: JsonObject = { id, kind: 'vector@1', layer: 'main', name: id, order: spec.order ?? 'a0', params };
  if (spec.pos) item['at'] = { pos: [spec.pos[0], spec.pos[1], 0] };
  return item;
}

export function vectorDoc(id: string, size: [number, number], items: JsonObject[], channels?: JsonObject): JsonObject {
  const doc: JsonObject = {
    format: 1, id, profile: 'figure', title: id, description: `Issue #398 acceptance fixture ${id}.`, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
  if (channels) doc['channels'] = channels;
  return doc;
}

/** A hold-only role channel on a part (the design's `enum` channel type: enum, bool and string hold only). */
export function roleChannel(target: string, keys: [number, string][]): JsonObject {
  return { target, type: 'enum', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: `${t}s`, value: v, interp: 'hold' }])) };
}

/** A linear f32 channel. */
export function f32Channel(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: `${t}s`, value: v, interp: 'linear' }])) };
}

/**
 * A resvg pair's SVG (fixtures/resvg/<name>.svg) as a document of one vector item `svg` drawn at its reviewed PNG's
 * 300 × 300 (a 200 × 200 viewBox at 1.5×), with `colors` mapping each color the file names to a role holding
 * CSS's value for it, so a correct import draws the PNG's pixels.
 */
export function resvgDoc(store: string, name: string, colors: Record<string, string>): JsonObject {
  const id = `resvg-${name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
  return vectorDoc(id, [300, 300], [vectorItem('svg', { src: put(store, `resvg/${name}.svg`), size: [300, 300], colors })]);
}

// ---------------------------------------------------------------------------------------------------
// The check.

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }

export function check(doc: JsonObject, store: string, extra: JsonObject = {}): { ok: boolean; issues: Issue[] } {
  const out = one('check', { doc, look: LOOK as unknown as JsonObject, store, ...extra });
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

export const errorsOf = (r: { issues: Issue[] }): Issue[] => r.issues.filter((i) => i.severity === 'error');
export const listIssues = (issues: Issue[]): string[] => issues.map((e) => `${e.severity} ${e.code} [${e.ids.join(',')}] ${e.path}`);

/** A document the check passes with no error. */
export function expectClean(doc: JsonObject, store: string, what: string): { ok: boolean; issues: Issue[] } {
  const result = check(doc, store);
  expect(listIssues(errorsOf(result)), `${what}: the check raises no error`).toEqual([]);
  expect(result.ok, `${what}: the check passes`).toBe(true);
  return result;
}

// ---------------------------------------------------------------------------------------------------
// The raster: Vello CPU at scale 1 (#373's `raster`), at a time in flicks.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

let rasters = 0;
export function rasterInput(dir: string, doc: JsonObject, store: string, t = 0, extra: JsonObject = {}): JsonObject {
  rasters += 1;
  return { out: join(dir, `r${rasters}.png`), doc, look: LOOK as unknown as JsonObject, store, t, ...extra };
}

export function readRaster(input: JsonObject, out: JsonValue | undefined, what: string): Image {
  const report = obj(out, `raster ${what}: the answer`);
  expect(report['ok'], `raster ${what} refused: ${JSON.stringify(report).slice(0, 2000)}`).toBe(true);
  const size = arr(obj(input['doc'], 'doc')['size'], 'doc.size').map((v) => num(v, 'doc.size'));
  const image = decodePng(readFileSync(String(input['out'])));
  expect([image.width, image.height], `raster ${what}: the PNG is the document's size`).toEqual(size);
  return image;
}

/** One document drawn at `t`. */
export function raster(dir: string, doc: JsonObject, store: string, t: number, what: string, extra: JsonObject = {}): Image {
  const input = rasterInput(dir, doc, store, t, extra);
  return readRaster(input, batch('raster', [input])[0], what);
}

/** One document drawn at several times by one process. */
export function rasterAt(dir: string, doc: JsonObject, store: string, times: number[], what: string, extra: JsonObject = {}): Image[] {
  const inputs = times.map((t) => rasterInput(dir, doc, store, t, extra));
  const outs = batch('raster', inputs);
  return inputs.map((input, i) => readRaster(input, outs[i], `${what} at ${times[i]! / FLICKS_PER_SECOND} s`));
}

/** A raster line that must be refused with `code`. */
export function expectRasterRefused(dir: string, doc: JsonObject, store: string, code: string, why: string): JsonObject {
  const out = one('raster', rasterInput(dir, doc, store));
  expect(out['ok'], `raster: ${why}, so it is refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(false);
  expect(out['code'], `raster: ${why}: the refusal's code`).toBe(code);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The geometry: #373's `geometry`, with a vector item's parts.

export type Pt = [number, number];
export interface Subpath { closed: boolean; verbs: string[]; points: Pt[] }
export interface Part { id: string; box: [number, number, number, number]; subpaths: Subpath[]; raw: JsonObject }

function subpathsOf(value: JsonValue | undefined, what: string): Subpath[] {
  return arr(value, what).map((s, i) => {
    const sp = obj(s, `${what}[${i}]`);
    return {
      closed: sp['closed'] === true,
      verbs: arr(sp['verbs'], `${what}[${i}].verbs`).map(String),
      points: arr(sp['points'], `${what}[${i}].points`).map((p, k) => {
        const xy = arr(p, `${what}[${i}].points[${k}]`);
        return [num(xy[0], `points[${k}][0]`), num(xy[1], `points[${k}][1]`)] as Pt;
      }),
    };
  });
}

/** `geometry` of a vector item: its parts, each with its read-only box and its outline in document u. */
export function parts(doc: JsonObject, item: string, store: string, extra: JsonObject = {}): Map<string, Part> {
  const out = one('geometry', { doc, item, store, ...extra });
  expect(out['ok'], `geometry of ${item} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const list = arr(out['parts'], `geometry ${item}: parts`);
  const found = new Map<string, Part>();
  list.forEach((v, i) => {
    const p = obj(v, `geometry ${item}: parts[${i}]`);
    expect(typeof p['id'], `parts[${i}].id is a string`).toBe('string');
    expect('source' in p, `parts[${i}] (${String(p['id'])}) carries its read-only source (a string, or null when the import doesn't know it)`).toBe(true);
    const box = arr(p['box'], `parts[${i}].box`).map((b, k) => num(b, `parts[${i}].box[${k}]`));
    expect(box.length, `parts[${i}].box is [x, y, w, h]`).toBe(4);
    const id = String(p['id']);
    expect(found.has(id), `part ${id} is listed once`).toBe(false);
    found.set(id, { id, box: box as [number, number, number, number], subpaths: subpathsOf(p['subpaths'], `parts[${i}].subpaths`), raw: p });
  });
  return found;
}

export function part(map: Map<string, Part>, id: string): Part {
  const p = map.get(id);
  expect(p, `the import has the part ${id} (parts: ${[...map.keys()].join(', ')})`).toBeDefined();
  return p!;
}

/** Points along a subpath, its curves sampled at `steps` per segment and its lines every `step` u. */
export function flatten(sp: Subpath, steps = 64, step = 0.25): Pt[] {
  const out: Pt[] = [];
  let k = 0;
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  const line = (a: Pt, b: Pt): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = 1; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  };
  for (const v of sp.verbs) {
    if (v === 'M') { cur = sp.points[k++]!; start = cur; out.push(cur); }
    else if (v === 'L') { const b = sp.points[k++]!; line(cur, b); cur = b; }
    else if (v === 'Q') {
      const c = sp.points[k++]!; const b = sp.points[k++]!;
      for (let i = 1; i <= steps; i++) { const t = i / steps; const u = 1 - t; out.push([u * u * cur[0] + 2 * u * t * c[0] + t * t * b[0], u * u * cur[1] + 2 * u * t * c[1] + t * t * b[1]]); }
      cur = b;
    } else if (v === 'C') {
      const c1 = sp.points[k++]!; const c2 = sp.points[k++]!; const b = sp.points[k++]!;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps; const u = 1 - t;
        out.push([u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
      }
      cur = b;
    } else if (v === 'Z') { line(cur, start); cur = start; }
    else throw Error(`unknown verb ${v}`);
  }
  return out;
}

/** The bounding box [x, y, w, h] of points. */
export function bounds(points: Pt[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs); const y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

export const boxError = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

// ---------------------------------------------------------------------------------------------------
// PNG: 8-bit RGB/RGBA from our raster, and resvg's reviewed PNGs (palette at 1, 2, 4 or 8 bits with tRNS, and
// gray with alpha); node built-ins only.

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
  let palette: Buffer = Buffer.alloc(0); let trns: Buffer = Buffer.alloc(0);
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!channels || interlace !== 0 || ![1, 2, 4, 8].includes(depth) || (depth < 8 && color !== 0 && color !== 3)) {
    throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}: not read`);
  }
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
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = previous[i]!;
      const c = i >= bpp ? previous[i - bpp]! : 0;
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
    const sample = (x: number, ch: number): number => {
      if (depth === 8) return line[x * channels + ch]!;
      const bit = x * depth;
      return (line[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    };
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (color === 3) {
        const i = sample(x, 0);
        rgba[o] = palette[i * 3]!; rgba[o + 1] = palette[i * 3 + 1]!; rgba[o + 2] = palette[i * 3 + 2]!;
        rgba[o + 3] = i < trns.length ? trns[i]! : 255;
      } else if (color === 0 || color === 4) {
        const g = depth === 8 ? sample(x, 0) : Math.round((sample(x, 0) * 255) / ((1 << depth) - 1));
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = color === 4 ? sample(x, 1) : 255;
      } else {
        rgba[o] = sample(x, 0); rgba[o + 1] = sample(x, 1); rgba[o + 2] = sample(x, 2); rgba[o + 3] = color === 6 ? sample(x, 3) : 255;
      }
    }
    previous = line;
  }
  return { width, height, rgba };
}

/** An image composited over an opaque background (resvg's PNGs are transparent where nothing draws). */
export function over(image: Image, bg: Rgb): Image {
  const rgba = new Uint8Array(image.rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = image.rgba[i + 3]! / 255;
    for (let k = 0; k < 3; k++) rgba[i + k] = Math.round(image.rgba[i + k]! * a + bg[k]! * (1 - a));
    rgba[i + 3] = 255;
  }
  return { width: image.width, height: image.height, rgba };
}

/** A resvg pair's reviewed PNG, composited over the ground. */
export function reviewed(name: string): Image {
  return over(decodePng(fixtureBytes(`resvg/${name}.png`)), LOOK.light['ground']!);
}

// ---------------------------------------------------------------------------------------------------
// Pixels

/** The pixel whose square holds the point (x, y) in u (zoom 1). */
export function pixel(image: Image, x: number, y: number): Rgb {
  const px = Math.floor(x); const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) throw Error(`(${x}, ${y}) is outside the ${image.width} × ${image.height} image`);
  const o = (py * image.width + px) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}

export const codeDiff = (a: readonly number[], b: readonly number[]): number => Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!));
export const same = (a: Rgb, b: Rgb): boolean => codeDiff(a, b) === 0;

/** Pixels in the integer rectangle [x0, x1) × [y0, y1) for which `f` holds. */
export function countWhere(image: Image, x0: number, y0: number, x1: number, y1: number, f: (c: Rgb, x: number, y: number) => boolean): number {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) if (f(pixel(image, x, y), x, y)) n++;
  return n;
}

/** The first pixel in [x0, x1) × [y0, y1) that differs between two images of one size, or null. */
export function firstDifferenceIn(a: Image, b: Image, x0: number, y0: number, x1: number, y1: number, skip?: (x: number, y: number) => boolean): string | null {
  for (let y = Math.max(0, y0); y < Math.min(a.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(a.width, x1); x++) {
    if (skip && skip(x, y)) continue;
    const p = pixel(a, x, y); const q = pixel(b, x, y);
    if (!same(p, q)) return `pixel (${x}, ${y}) reads ${JSON.stringify(p)} and ${JSON.stringify(q)}`;
  }
  return null;
}

/** The tight box [x0, y0, x1, y1) of pixels for which `f` holds, or null when none does. */
export function pixelBox(image: Image, f: (c: Rgb) => boolean): [number, number, number, number] | null {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (!f(pixel(image, x, y))) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

// ---------------------------------------------------------------------------------------------------
// The perceptual oracle for 2D, as reviewed test code (design: "Images from two renderers compare through one
// perceptual oracle"; a 2D writer layer's interior pixels, farther than 1.5 device px from every edge it draws,
// within one code value on 99.9%; a blank guard runs first and voids the comparison), as #140's and #385's
// suites read it.

/** film.blank's measure (luma at most 0.06 over at least 98% of the pixels, Rec. 709 weights): a black frame. */
export function isBlack(image: Image): boolean {
  let dark = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const luma = (0.2126 * image.rgba[o]! + 0.7152 * image.rgba[o + 1]! + 0.0722 * image.rgba[o + 2]!) / 255;
    if (luma <= 0.06) dark++;
  }
  return dark >= 0.98 * n;
}

/** A frame that draws nothing over its ground: fewer than 64 pixels differ from its most common color. */
export function isBlank(image: Image): boolean {
  const counts = new Map<number, number>();
  for (let i = 0; i < image.rgba.length; i += 4) {
    const k = (image.rgba[i]! << 16) | (image.rgba[i + 1]! << 8) | image.rgba[i + 2]!;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const most = Math.max(...counts.values());
  return image.width * image.height - most < 64;
}

export type Segment = [number, number, number, number];

/** Pixels whose centre lies farther than `d` px from every segment: the interior (1 = compared). */
export function interiorMask(width: number, height: number, edges: Segment[], d = 1.5): Uint8Array {
  const near = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of edges) {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - d - 1)); const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + d + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - d - 1)); const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + d + 1));
    const dx = x1 - x0; const dy = y1 - y0; const len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const cx = x + 0.5; const cy = y + 0.5;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / len2));
      const ex = x0 + t * dx - cx; const ey = y0 + t * dy - cy;
      if (ex * ex + ey * ey <= d * d) near[y * width + x] = 1;
    }
  }
  const interior = new Uint8Array(width * height);
  for (let i = 0; i < interior.length; i++) interior[i] = near[i] ? 0 : 1;
  return interior;
}

/** The interior of a reference image itself: pixels whose (2r+1)² neighbourhood is one color (r = 2: farther than 1.5 px from every edge it draws). */
export function uniformMask(image: Image, r = 2): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const c = pixel(image, x, y);
    let ok = true;
    for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r && ok; dx++) {
      const xx = x + dx; const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= image.width || yy >= image.height) continue;
      if (!same(pixel(image, xx, yy), c)) ok = false;
    }
    mask[y * image.width + x] = ok ? 1 : 0;
  }
  return mask;
}

/**
 * The perceptual oracle: the blank guard on both sides first (a black or blank frame makes the comparison
 * BLOCKED and voids its numbers), then the interior pixels within one code value on at least 99.9%. Answers the
 * problems, each a sentence; none means the frames match.
 */
export function perceptualProblems(name: string, actual: Image, reference: Image, interior: Uint8Array): string[] {
  const p: string[] = [];
  for (const [who, img] of [['ours', actual], ['the reference', reference]] as const) {
    if (isBlack(img)) p.push(`BLOCKED: ${name}: ${who} is black (the blank guard voids the comparison)`);
    else if (isBlank(img)) p.push(`BLOCKED: ${name}: ${who} draws nothing over its ground (the blank guard voids the comparison)`);
  }
  if (p.length) return p;
  if (actual.width !== reference.width || actual.height !== reference.height) return [`${name}: ours is ${actual.width} × ${actual.height}, the reference ${reference.width} × ${reference.height}`];
  let n = 0; let good = 0; let worst: { x: number; y: number; d: number; a: Rgb; b: Rgb } | null = null;
  for (let y = 0; y < actual.height; y++) for (let x = 0; x < actual.width; x++) {
    if (!interior[y * actual.width + x]) continue;
    n++;
    const a = pixel(actual, x, y); const b = pixel(reference, x, y);
    const d = codeDiff(a, b);
    if (d <= 1) good++;
    if (!worst || d > worst.d) worst = { x, y, d, a, b };
  }
  if (n === 0) return [`${name}: no interior pixel to compare`];
  if (good / n < 0.999) {
    p.push(`${name}: interior pixels: ${((good / n) * 100).toFixed(3)}% of ${n} within one code value of the reference, under 99.9%; worst at (${worst?.x}, ${worst?.y}), ${worst?.d} codes (ours ${JSON.stringify(worst?.a)}, the reference ${JSON.stringify(worst?.b)})`);
  }
  return p;
}

/** An image of one color. */
export function solid(width: number, height: number, c: Rgb): Image {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255; }
  return { width, height, rgba };
}

export function paint(image: Image, f: (x: number, y: number) => Rgb | null): void {
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const c = f(x + 0.5, y + 0.5);
    if (!c) continue;
    const o = (y * image.width + x) * 4;
    image.rgba[o] = c[0]; image.rgba[o + 1] = c[1]; image.rgba[o + 2] = c[2];
  }
}
