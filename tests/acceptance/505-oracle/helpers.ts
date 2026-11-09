// Test-side tools for the #505 Oracle-lane acceptance tests: the two binaries the #505 suite's surface names
// (`deep-canvas-render check | raster | geometry`, and `deep-show run`'s `fn` call, #490's), each built once per file;
// the documents the tests send; what the binaries answer, read strictly; a PNG reader for the graphest reference plots
// and our frames; and distances on a grid index. Nothing here stands in for our code: every value a test compares
// comes from a binary, every expected value from an upstream case, an upstream reference file or an upstream formula
// re-expressed in the test that uses it.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/505-oracle is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
/** Every `it` passes this timeout: a first build of a binary on the shared Mac can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its tests' names. */
export const AC = {
  1: 'AC1 #505.968d0296',
  3: 'AC3 #505.5e6d3319',
  4: 'AC4 #505.00692b98',
  6: 'AC6 #505.80c4ff9d',
  7: 'AC7 #505.6af13a53',
} as const;

/** A fixture under fixtures/, parsed. */
export const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;

// ---------------------------------------------------------------------------------------------------
// Time and JSON

export const FLICKS = 705_600_000;
/** Seconds to whole flicks. */
export const fl = (s: number): number => Math.round(s * FLICKS);

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
/** No failures; the message lists the first of them and how many there are. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.length} failures:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it drives once, in beforeAll, copied out under its own name, so a later build
// can't change it under a running file; a test that uses a build that failed fails with cargo's error.

const CARGO_ENV: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status === 0) return '';
  return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating/.test(l)).join('\n').slice(0, 4000)}`;
}
function useBuild(name: string, args: string[]): () => string {
  let dir = ''; let error = ''; let path = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-505-oracle-bin-'));
    error = cargo(args);
    if (error === '') { path = join(dir, exe(name)); copyFileSync(join(targetDir(), 'debug', exe(name)), path); }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo ${args.join(' ')}`).toBe(''); return path; };
}
/** `cargo build --locked --bin deep-canvas-render`, once per file. */
export const useRender = (): (() => string) => useBuild('deep-canvas-render', ['build', '--locked', '--bin', 'deep-canvas-render']);
/** `cargo build --locked --bin deep-show --no-default-features --features core`, once per file (#490's `fn` call). */
export const useShowCore = (): (() => string) => useBuild('deep-show', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'core']);

/** A fresh temporary folder per test, deleted after it. */
export function useTemp(prefix: string): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), `deep-505-oracle-${prefix}-`)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** One run of `deep-canvas-render <subcommand>`: exit 0, one parsed line out per line in. */
export function lines(bin: string, subcommand: string, inputs: JsonValue[]): JsonObject[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-canvas-render ${subcommand}: ${run.error.message}`);
  expect(run.status, `deep-canvas-render ${subcommand} exits 0: ${run.stderr.slice(0, 2000)}`).toBe(0);
  const out = run.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `deep-canvas-render ${subcommand}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `deep-canvas-render ${subcommand}: answer ${i}`));
}

// ---------------------------------------------------------------------------------------------------
// Documents: #167's envelope as the #505 suite writes it (its README: Documents), and #373's role map.

export type Rgb = [number, number, number];
export const GROUND: Rgb = [255, 255, 255];
export const INK: Rgb = [0, 0, 0];
/** A look with ground and ink, and any further roles. */
export const look = (roles: Record<string, Rgb> = {}): JsonObject => ({ light: { ground: GROUND, ink: INK, ...roles } as unknown as JsonObject });

export const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ id, kind, layer: 'main', name: id, order, params, ...extra });
/** A linear scale with its domain as written (`nice: false`), so a position is the plain map. */
export const scale = (id: string, order: string, domain: [number, number], range: [number, number]): JsonObject =>
  item(id, 'scale@1', order, { type: 'linear', domain, range, nice: false });
export function document(id: string, title: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title, description: `${title}, for the #505 Oracle-lane acceptance tests.`, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, transport: { span: '2s' },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A channel keyed linearly from `from` at 0 s to `to` at `span` s. */
export const ramp = (target: string, from: number, to: number, span: number): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: `${span}s`, value: to, interp: 'linear' } } });
export const stroke = (role: string, width = 1): JsonObject => ({ stroke: { role, width } });

// ---------------------------------------------------------------------------------------------------
// The check (the #505 README: `check`): issues, notices and `curves`.

export interface Issue { code: string; severity: string; ids: string[] }
export interface Checked { ok: boolean; errors: Issue[]; notices: JsonObject[]; raw: JsonObject }
export function check(bin: string, doc: JsonObject, theLook: JsonObject, what: string): Checked {
  const raw = lines(bin, 'check', [{ doc, look: theLook }])[0]!;
  const issues = arr(raw['issues'] ?? [], `check ${what}: issues`).map((v, i) => {
    const o = obj(v, `check ${what}: issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), ids: arr(o['ids'] ?? [], 'ids').map(String) };
  });
  const notices = arr(raw['notices'] ?? [], `check ${what}: notices`).map((v, i) => obj(v, `check ${what}: notices[${i}]`));
  return { ok: raw['ok'] === true, errors: issues.filter((i) => i.severity === 'error'), notices, raw };
}
/** The document passes the check: `ok`, no error issue. */
export function passes(bin: string, doc: JsonObject, theLook: JsonObject, what: string): Checked {
  const c = check(bin, doc, theLook, what);
  expect(c.errors, `${what} passes the check: ${show(c.raw)}`).toEqual([]);
  expect(c.ok, `${what}: the check answers ok`).toBe(true);
  return c;
}
/** `curves[item]` of a check: the x ranges whose 0.5 px bound held, and those drawn as estimates. */
export function curvesOf(c: Checked, itemId: string, what: string): { bound: [number, number][]; estimate: [number, number][] } {
  const entry = obj(obj(c.raw['curves'], `${what}: the check's curves`)[itemId], `${what}: curves.${itemId}`);
  const ranges = (key: string): [number, number][] => arr(entry[key], `${what}: curves.${itemId}.${key}`).map((r, i) => pair(r, `${what}: curves.${itemId}.${key}[${i}]`));
  return { bound: ranges('bound'), estimate: ranges('estimate') };
}

// ---------------------------------------------------------------------------------------------------
// The geometry of a function path (the #505 README: `geometry`)

export type Pt = [number, number];
export interface Subpath { closed: boolean; points: Pt[] }
export interface FnGeometry {
  subpaths: Subpath[];
  notices: JsonObject[];
  area: { value: number; lo: number; hi: number } | null;
  colorAt: [number, number, number][];
  cells: number | null;
  raw: JsonObject;
}
export const pair = (v: JsonValue | undefined, what: string): [number, number] => {
  const p = arr(v, what);
  expect(p.length, `${what} has two numbers`).toBe(2);
  return [num(p[0], `${what}[0]`), num(p[1], `${what}[1]`)];
};
export function fnGeometry(answer: JsonObject, what: string): FnGeometry {
  expect(answer['ok'], `${what}: geometry answers: ${show(answer)}`).toBe(true);
  let area: FnGeometry['area'] = null;
  if (answer['area'] !== undefined) {
    const a = obj(answer['area'], `${what}: area`);
    area = { value: num(a['value'], `${what}: area.value`), lo: num(a['lo'], `${what}: area.lo`), hi: num(a['hi'], `${what}: area.hi`) };
  }
  return {
    subpaths: arr(answer['subpaths'], `${what}: subpaths`).map((s, i) => {
      const sp = obj(s, `${what}: subpaths[${i}]`);
      return { closed: sp['closed'] === true, points: arr(sp['points'], `${what}: subpaths[${i}].points`).map((p, k) => pair(p, `${what}: subpaths[${i}].points[${k}]`)) };
    }),
    notices: arr(answer['notices'] ?? [], `${what}: notices`).map((n, i) => obj(n, `${what}: notices[${i}]`)),
    area,
    colorAt: answer['color_at'] === undefined ? [] : arr(answer['color_at'], `${what}: color_at`).map((c, i) => {
      const lab = arr(c, `${what}: color_at[${i}]`);
      return [num(lab[0], 'L'), num(lab[1], 'a'), num(lab[2], 'b')];
    }),
    cells: answer['cells'] === undefined ? null : num(answer['cells'], `${what}: cells`),
    raw: answer,
  };
}
/** `geometry` of one item, one line per request, in order, in one process. */
export const fnAt = (bin: string, doc: JsonObject, itemId: string, requests: JsonObject[], what: string): FnGeometry[] =>
  lines(bin, 'geometry', requests.map((r) => ({ doc, item: itemId, look: look(), t: 0, ...r }))).map((a, i) => fnGeometry(a, `${what} (${i})`));
/** The estimate notices: `code: "estimate"`, naming the item. */
export const estimates = (notices: readonly JsonObject[], itemId: string): JsonObject[] =>
  notices.filter((n) => n['code'] === 'estimate' && Array.isArray(n['ids']) && n['ids'].includes(itemId));

// ---------------------------------------------------------------------------------------------------
// The raster (#373's `raster`) and PNG reading (the PNG specification: 8-bit RGB or RGBA, no interlace)

export interface Image { width: number; height: number; rgba: Uint8Array }
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
export function readPng(path: string): Image {
  const file = readFileSync(path);
  let width = 0; let height = 0; let color = 0; let depth = 0; let interlace = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < file.length;) {
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
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
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
  const o = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
export const same = (a: Rgb, b: Rgb): boolean => a.every((v, i) => v === b[i]);
/** Pixels in the box [x0, x1) × [y0, y1) that differ from `c`. */
export function countOff(image: Image, [x0, y0, x1, y1]: [number, number, number, number], c: Rgb): number {
  let n = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) if (!same(pixel(image, x, y), c)) n++;
  return n;
}
/** Puts bytes in a `deep-canvas-render` store (#373's: a folder of files named by their SHA-256) and answers the name. */
export function putStore(store: string, bytes: Buffer): string {
  const name = sha256(bytes);
  writeFileSync(join(store, name), bytes);
  return name;
}
/** `raster` of `doc` at each request (`{t, store?}`), one PNG each, read back. */
export function rasterAt(bin: string, doc: JsonObject, requests: JsonObject[], dir: string, name: string): Image[] {
  const outs = requests.map((_, i) => join(dir, `${name}-${i}.png`));
  const answers = lines(bin, 'raster', requests.map((r, i) => ({ out: outs[i]!, doc, look: look(), t: 0, ...r })));
  return answers.map((answer, i) => {
    expect(answer['ok'], `raster ${name} (${i}) draws: ${show(answer)}`).toBe(true);
    return readPng(outs[i]!);
  });
}

// ---------------------------------------------------------------------------------------------------
// Distances in document u, on a grid index so the reference plots' thousands of pixels stay cheap to compare.

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export type Box = [number, number, number, number];
/** The distance from a point to a closed box [x0, y0, x1, y1] (0 inside). */
export const pointBox = (p: Pt, [x0, y0, x1, y1]: Box): number => Math.hypot(p[0] - clamp(p[0], x0, x1), p[1] - clamp(p[1], y0, y1));
function pointSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
/** Whether segment a–b meets the box (Liang–Barsky clipping). */
function segmentMeetsBox(a: Pt, b: Pt, [x0, y0, x1, y1]: Box): boolean {
  let t0 = 0; let t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  for (const [p, q] of [[-d[0]!, a[0] - x0], [d[0]!, x1 - a[0]], [-d[1]!, a[1] - y0], [d[1]!, y1 - a[1]]] as [number, number][]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
/** The distance between a segment and a closed box. */
export function segmentBox(a: Pt, b: Pt, box: Box): number {
  if (segmentMeetsBox(a, b, box)) return 0;
  const [x0, y0, x1, y1] = box;
  return Math.min(pointBox(a, box), pointBox(b, box), ...([[x0, y0], [x0, y1], [x1, y0], [x1, y1]] as Pt[]).map((c) => pointSegment(c, a, b)));
}
/** The drawn line's segments (a closed sub-path with its closing one), bucketed on a 1 u grid. */
export class Drawn {
  private readonly cells = new Map<string, [Pt, Pt][]>();
  constructor(subpaths: readonly Subpath[]) {
    for (const s of subpaths) {
      const pts = s.points;
      const segs: [Pt, Pt][] = pts.length === 1 ? [[pts[0]!, pts[0]!]] : pts.slice(1).map((p, i) => [pts[i]!, p]);
      if (s.closed && pts.length > 1) segs.push([pts[pts.length - 1]!, pts[0]!]);
      for (const [a, b] of segs) {
        for (let gx = Math.floor(Math.min(a[0], b[0])); gx <= Math.floor(Math.max(a[0], b[0])); gx++) {
          for (let gy = Math.floor(Math.min(a[1], b[1])); gy <= Math.floor(Math.max(a[1], b[1])); gy++) {
            const k = `${gx},${gy}`;
            const list = this.cells.get(k);
            if (list) list.push([a, b]); else this.cells.set(k, [[a, b]]);
          }
        }
      }
    }
  }
  /** The distance from a box to the drawn line, or Infinity past `reach` u. */
  toBox(box: Box, reach: number): number {
    let best = Infinity;
    for (let gx = Math.floor(box[0] - reach); gx <= Math.floor(box[2] + reach); gx++) {
      for (let gy = Math.floor(box[1] - reach); gy <= Math.floor(box[3] + reach); gy++) {
        for (const [a, b] of this.cells.get(`${gx},${gy}`) ?? []) best = Math.min(best, segmentBox(a, b, box));
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------------------------------
// The graphest reference plots: a pixel is black where graphest could not exclude a solution, white where it proved
// none (both kinds are the reference's; the README says how the four files were checked against their closed forms).

export interface Reference { width: number; height: number; black: (c: number, r: number) => boolean; blacks: [number, number][] }
export function reference(name: string): Reference {
  const image = readPng(join(FIXTURES, 'graphest', name));
  const black = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < image.width && r < image.height && same(pixel(image, c, r), INK);
  const blacks: [number, number][] = [];
  for (let r = 0; r < image.height; r++) for (let c = 0; c < image.width; c++) if (black(c, r)) blacks.push([c, r]);
  return { width: image.width, height: image.height, black, blacks };
}
/** Pixel (c, r) of a reference drawn at `k` reference pixels per u: its box in u. */
export const pixelBox = (c: number, r: number, k: number): Box => [c / k, r / k, (c + 1) / k, (r + 1) / k];
/** Whether a point in u lies within `tol` u of a black reference pixel, drawn at `k` reference pixels per u. */
export function nearBlack(ref: Reference, p: Pt, k: number, tol: number): boolean {
  for (let c = Math.floor((p[0] - tol) * k); c <= Math.floor((p[0] + tol) * k); c++) {
    for (let r = Math.floor((p[1] - tol) * k); r <= Math.floor((p[1] + tol) * k); r++) {
      if (ref.black(c, r) && pointBox(p, pixelBox(c, r, k)) <= tol) return true;
    }
  }
  return false;
}
