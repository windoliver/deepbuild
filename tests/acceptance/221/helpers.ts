// Shared helpers for #221's acceptance tests (placement by relation): the `deep-canvas-render` binary driven by
// JSON lines (#391's convention) for `check`, `geometry` and `raster`; `deep-show run` built with the r2 build set
// for `registries` (#200's deep://registries listing), the seal's startup refusal, `deep_show` and `determinism`
// (#488's seek-against-play comparison); the documents under fixtures/ with their SVGs put in a store by sha256;
// the tight box of an outline measured on its curves (the oracle page's port of ManimGX's TestBox); and a PNG
// reader. Every expected value is computed here or in the tests from the fixtures' own numbers and the issue's,
// never read from the implementation. Nothing here stands in for the relation solver, the check or the seal.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/221 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const RENDER_NAME = 'deep-canvas-render';
export const RENDER_BIN = join(TARGET, 'debug', exe(RENDER_NAME));
export const SHOW_NAME = 'deep-show';
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

/** Every `it` in this suite passes this timeout: the first exec of a fresh binary on macOS alone can take seconds. */
export const TIMEOUT = 1_800_000;

// ---------------------------------------------------------------------------------------------------
// The issue's numbers.

/** "within 0.5 px": at zoom 1, one u is one logical pixel (Units and axes), so 0.5 u. */
export const PX = 0.5;
/** The port's tolerance for a box read against the tight box of the same outline (ManimGX asserts 1e-9; f32 fields hold ~1e-4 at 1,000 u). */
export const EXACT = 0.01;
/** The document envelope's `safe` default (Document envelope: `safe: f32, u = 24`). */
export const SAFE = 24;
/** The box points, a closed list (Item and kind: relations). */
export const BOX_POINTS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'c'] as const;
export type BoxPoint = (typeof BOX_POINTS)[number];

// ---------------------------------------------------------------------------------------------------
// Time: flicks (1/705,600,000 s), as #391's surface reads them.

export const FLICKS = 705_600_000;
/** `n` times spread evenly over [0, span] flicks, both ends included, each a whole flick. */
export function evenTimes(spanFlicks: number, n: number): number[] {
  return Array.from({ length: n }, (_, k) => Math.round((k * spanFlicks) / (n - 1)));
}
/** A seeded generator (mulberry32), so a failing run replays: the same seed gives the same times. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A linear key track as the fixtures write it: `[seconds, value]` pairs, the last key held after it. */
export type Track = [number, number][];
export function trackAt(track: Track, tFlicks: number): number {
  const s = tFlicks / FLICKS;
  if (s <= track[0]![0]) return track[0]![1];
  for (let i = 1; i < track.length; i++) {
    const [s1, v1] = track[i]!;
    const [s0, v0] = track[i - 1]!;
    if (s < s1) return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0);
  }
  return track[track.length - 1]![1];
}
/** A fixture channel's keys as a Track (its keys are linear and written in seconds, "4s"). */
export function trackOf(doc: JsonObject, channel: string): Track {
  const ch = obj(obj(doc['channels'], 'channels')[channel], `channel ${channel}`);
  return Object.values(obj(ch['keys'], `${channel}.keys`)).map((k) => {
    const key = obj(k, `${channel} key`);
    expect(key['interp'], `${channel}: the fixture's keys are linear`).toBe('linear');
    return [Number(String(key['t']).replace(/s$/, '')), num(key['value'], `${channel} value`)] as [number, number];
  }).sort((a, b) => a[0] - b[0]);
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
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (a name such as an entry's or an item's). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// deep-canvas-render: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
}

/** Builds `deep-canvas-render` once per file and fails every test of the file when it can't be built. */
export function useRenderBinary(): void {
  let error = '';
  beforeAll(() => { error = cargo(['build', '--locked', '--bin', RENDER_NAME]); }, 3_600_000);
  beforeEach(() => { expect(error, `the binary builds: ${RENDER_NAME}`).toBe(''); });
}

/** Pipes every input line into one run (one process) of `deep-canvas-render <subcommand>`. */
export function batch(subcommand: string, inputs: JsonValue[]): JsonObject[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(RENDER_BIN, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const name = `${RENDER_NAME} ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line, i) => obj(JSON.parse(line) as JsonValue, `${name}: answer ${i}`));
}

// ---------------------------------------------------------------------------------------------------
// Scratch folders, the store (a directory whose files are named by the sha256 of their bytes, #373's and #398's)
// and the fixtures' documents.

export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-221-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Puts a fixture file in the store and answers its sha256. */
export function put(store: string, fixture: string): string {
  const bytes = readFileSync(join(FIXTURES, fixture));
  const sha = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(store, sha), bytes);
  return sha;
}

/**
 * A fixture document (fixtures/<name>), with every `vector@1` item's `src` written `@<file>.svg` replaced by
 * that SVG's sha256 in `store` (a document names an SVG only by its hash; the request names the store).
 */
export function loadDoc(name: string, store?: string): JsonObject {
  const doc = obj(JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as JsonValue, name);
  for (const item of Object.values(obj(doc['items'], `${name}: items`))) {
    const params = obj(item, `${name}: item`)['params'];
    if (isObject(params) && typeof params['src'] === 'string' && params['src'].startsWith('@')) {
      if (!store) throw Error(`${name} holds a vector item; load it with a store`);
      params['src'] = put(store, params['src'].slice(1));
    }
  }
  return doc;
}
export const itemOf = (doc: JsonObject, id: string): JsonObject => obj(obj(doc['items'], 'items')[id], `item ${id}`);

// ---------------------------------------------------------------------------------------------------
// Looks: #391's role map form (no status map).

export type Rgb = [number, number, number];
export const LOOK: { light: Record<string, Rgb> } = {
  light: { ground: [255, 255, 255], ink: [0, 0, 0], accent: [30, 90, 200], muted: [220, 220, 220] },
};

// ---------------------------------------------------------------------------------------------------
// The check (#373's `check`): `{ok, issues: [{check, code, severity, ids, path, actual, what, fix}], notices}`.

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export function issuesOf(out: JsonObject, what: string): Issue[] {
  return arr(out['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const raw = obj(v, `${what}: issues[${i}]`);
    return { code: String(raw['code']), severity: String(raw['severity']), path: String(raw['path']), ids: Array.isArray(raw['ids']) ? raw['ids'].map(String) : [], raw };
  });
}
export function checkAll(docs: JsonObject[], store: string): { ok: boolean; issues: Issue[]; raw: JsonObject }[] {
  return batch('check', docs.map((doc) => ({ doc, look: LOOK as unknown as JsonObject, store }))).map((out, i) => {
    expect(typeof out['ok'], `check ${String(docs[i]!['id'])} answers ok: ${show(out)}`).toBe('boolean');
    return { ok: out['ok'] === true, issues: issuesOf(out, `check ${String(docs[i]!['id'])}`), raw: out };
  });
}
export const errorsOf = (r: { issues: Issue[] }): Issue[] => r.issues.filter((i) => i.severity === 'error');
export const listIssues = (issues: Issue[]): string[] => issues.map((e) => `${e.severity} ${e.code} [${e.ids.join(',')}] ${e.path}`);

/** Each document passes the check with no error. */
export function expectClean(docs: JsonObject[], store: string): void {
  checkAll(docs, store).forEach((r, i) => {
    expect(listIssues(errorsOf(r)), `${String(docs[i]!['id'])}: the check raises no error`).toEqual([]);
    expect(r.ok, `${String(docs[i]!['id'])}: the check passes`).toBe(true);
  });
}

// ---------------------------------------------------------------------------------------------------
// The geometry (#373's `geometry`, #398's parts) at a time, with the item's evaluated box and its box points
// (README: The surface under test).

export type Pt = [number, number];
export type Box = [number, number, number, number];
export interface Subpath { closed: boolean; verbs: string[]; points: Pt[] }
export interface Part { id: string; box: Box; subpaths: Subpath[] }
export interface Geo { t: number; box: Box; points: Record<BoxPoint, Pt>; subpaths: Subpath[]; parts: Part[]; raw: JsonObject }

function pt(value: JsonValue | undefined, what: string): Pt {
  const xy = arr(value, what);
  expect(xy.length, `${what} is [x, y]`).toBe(2);
  return [num(xy[0], `${what}[0]`), num(xy[1], `${what}[1]`)];
}
function boxOf(value: JsonValue | undefined, what: string): Box {
  const b = arr(value, what).map((v, k) => num(v, `${what}[${k}]`));
  expect(b.length, `${what} is [x, y, w, h]`).toBe(4);
  return b as Box;
}
function subpathsOf(value: JsonValue | undefined, what: string): Subpath[] {
  return arr(value ?? [], what).map((s, i) => {
    const sp = obj(s, `${what}[${i}]`);
    return {
      closed: sp['closed'] === true,
      verbs: arr(sp['verbs'], `${what}[${i}].verbs`).map(String),
      points: arr(sp['points'], `${what}[${i}].points`).map((p, k) => pt(p, `${what}[${i}].points[${k}]`)),
    };
  });
}

/** One `geometry` answer, read: refused answers fail the test with the refusal. */
export function readGeo(out: JsonObject, t: number, what: string): Geo {
  expect(out['ok'], `geometry of ${what} at ${t} flicks refused: ${show(out)}`).toBe(true);
  const p = obj(out['points'], `geometry ${what}: points (the nine box points)`);
  const points = Object.fromEntries(BOX_POINTS.map((name) => [name, pt(p[name], `geometry ${what}: points.${name}`)])) as Record<BoxPoint, Pt>;
  const parts = Array.isArray(out['parts'])
    ? out['parts'].map((v, i) => {
      const o = obj(v, `geometry ${what}: parts[${i}]`);
      return { id: str(o['id'], `parts[${i}].id`), box: boxOf(o['box'], `parts[${i}].box`), subpaths: subpathsOf(o['subpaths'], `parts[${i}].subpaths`) };
    })
    : [];
  return { t, box: boxOf(out['box'], `geometry ${what}: box`), points, subpaths: subpathsOf(out['subpaths'], `geometry ${what}: subpaths`), parts, raw: out };
}

/** `geometry` of `item` in `doc` at each of `times`, by one process. */
export function geometryAt(doc: JsonObject, item: string, store: string, times: number[]): Geo[] {
  const outs = batch('geometry', times.map((t) => ({ doc, item, store, t })));
  return outs.map((out, i) => readGeo(out, times[i]!, `${item} in ${String(doc['id'])}`));
}
/** `geometry` of `item` in each of `docs` at t = 0, by one process. */
export function geometryOf(docs: JsonObject[], item: string, store: string): Geo[] {
  const outs = batch('geometry', docs.map((doc) => ({ doc, item, store, t: 0 })));
  return outs.map((out, i) => readGeo(out, 0, `${item} in ${String(docs[i]!['id'])}`));
}

// ---------------------------------------------------------------------------------------------------
// Boxes and box points (y down, origin top left: n is the top side, s the bottom, sw the lower left).

export const x1 = (b: Box): number => b[0] + b[2];
export const y1 = (b: Box): number => b[1] + b[3];
export const cx = (b: Box): number => b[0] + b[2] / 2;
export const cy = (b: Box): number => b[1] + b[3] / 2;
export function pointOf(b: Box, name: BoxPoint): Pt {
  const x = name.includes('w') ? b[0] : name.includes('e') ? x1(b) : cx(b);
  const y = name.startsWith('n') ? b[1] : name.startsWith('s') ? y1(b) : cy(b);
  return [x, y];
}
export function union(boxes: Box[]): Box {
  const xa = Math.min(...boxes.map((b) => b[0])); const ya = Math.min(...boxes.map((b) => b[1]));
  const xb = Math.max(...boxes.map(x1)); const yb = Math.max(...boxes.map(y1));
  return [xa, ya, xb - xa, yb - ya];
}
export const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
export const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(3));
export const fmtBox = (b: Box): string => `[${b.map(fmt).join(', ')}]`;

/** The box and each box point agree with `want` within `tol`; each failure names the item, the time and the point. */
export function boxFailures(g: Geo, want: Box, tol: number, what: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < 4; k++) if (!near(g.box[k]!, want[k]!, tol)) { out.push(`${what} at ${g.t} flicks: box ${fmtBox(g.box)}, want ${fmtBox(want)} within ${tol}`); break; }
  for (const name of BOX_POINTS) {
    const [px, py] = pointOf(want, name);
    const [gx, gy] = g.points[name];
    if (!near(gx, px, tol) || !near(gy, py, tol)) out.push(`${what} at ${g.t} flicks: #${name} is (${fmt(gx)}, ${fmt(gy)}), want (${fmt(px)}, ${fmt(py)}) within ${tol}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The tight box of an outline measured on its curves: the extremes of each segment, found at the roots of its
// derivative, never its control points (the oracle page's port of ManimGX's TestBox, `oracles.curve_box`).

/** Roots in (0, 1) of a·t² + b·t + c. */
function unitRoots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b].filter((t) => t > 0 && t < 1);
  const d = b * b - 4 * a * c;
  if (d < 0) return [];
  const s = Math.sqrt(d);
  return [(-b + s) / (2 * a), (-b - s) / (2 * a)].filter((t) => t > 0 && t < 1);
}
/** The extremes along one axis of a segment from p0 through its controls: its ends and the roots of its derivative. */
function extremes(p: number[]): number[] {
  const out = [p[0]!, p[p.length - 1]!];
  if (p.length === 3) {
    // Quadratic: B'(t) ∝ (p0 − 2p1 + p2)t + (p1 − p0).
    const a = p[0]! - 2 * p[1]! + p[2]!;
    if (Math.abs(a) > 1e-12) {
      const t = (p[0]! - p[1]!) / a;
      if (t > 0 && t < 1) out.push((1 - t) ** 2 * p[0]! + 2 * (1 - t) * t * p[1]! + t * t * p[2]!);
    }
  } else if (p.length === 4) {
    const [a0, a1, a2, a3] = p as [number, number, number, number];
    // B'(t)/3 = (−a0 + 3a1 − 3a2 + a3)t² + 2(a0 − 2a1 + a2)t + (a1 − a0).
    for (const t of unitRoots(-a0 + 3 * a1 - 3 * a2 + a3, 2 * (a0 - 2 * a1 + a2), a1 - a0)) {
      const u = 1 - t;
      out.push(u ** 3 * a0 + 3 * u * u * t * a1 + 3 * u * t * t * a2 + t ** 3 * a3);
    }
  }
  return out;
}
/** The tight box of sub-paths in #373's form (one point per M and L, two per Q, three per C, none for Z). */
export function tightBox(subpaths: Subpath[]): Box {
  const xs: number[] = []; const ys: number[] = [];
  for (const sp of subpaths) {
    let at = 0; let cur: Pt = [0, 0]; let start: Pt = [0, 0];
    for (const verb of sp.verbs) {
      const n = { M: 1, L: 1, Q: 2, C: 3, Z: 0 }[verb as 'M'];
      if (n === undefined) throw Error(`unknown verb ${verb}`);
      const pts = sp.points.slice(at, at + n);
      at += n;
      if (verb === 'M') { cur = pts[0]!; start = cur; xs.push(cur[0]); ys.push(cur[1]); continue; }
      if (verb === 'Z') { cur = start; continue; }
      const seg = [cur, ...pts];
      xs.push(...extremes(seg.map((q) => q[0])));
      ys.push(...extremes(seg.map((q) => q[1])));
      cur = pts[pts.length - 1]!;
    }
  }
  expect(xs.length, 'the outline has points to measure').toBeGreaterThan(0);
  const xa = Math.min(...xs); const ya = Math.min(...ys);
  return [xa, ya, Math.max(...xs) - xa, Math.max(...ys) - ya];
}
/** The tight box of a vector item's whole outline: the union of its parts' tight boxes (TestBox: a group's box joins its members' boxes). */
export function partsBox(g: Geo, what: string): Box {
  expect(g.parts.length, `${what}: geometry lists the formula's parts`).toBeGreaterThan(0);
  return union(g.parts.map((p) => tightBox(p.subpaths)));
}

// ---------------------------------------------------------------------------------------------------
// The raster (#373's `raster`: Vello CPU at scale 1, the PNG of the document's size at `t`) and a PNG reader
// (8-bit RGB or RGBA, no interlace), node built-ins only.

export interface Image { width: number; height: number; rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
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
  const channels = color === 2 ? 3 : color === 6 ? 4 : 0;
  if (!channels || depth !== 8 || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}: not read`);
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const v = filter === 0 ? line[i]! : filter === 1 ? line[i]! + a : filter === 2 ? line[i]! + b : filter === 3 ? line[i]! + ((a + b) >> 1) : filter === 4 ? line[i]! + paeth(a, b, c) : NaN;
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

let rasters = 0;
/** Each document drawn at t = 0 by one process. */
export function rasterAll(dir: string, docs: JsonObject[], store: string): Image[] {
  const inputs = docs.map((doc) => { rasters += 1; return { out: join(dir, `r${rasters}.png`), doc, look: LOOK as unknown as JsonObject, store, t: 0 }; });
  return batch('raster', inputs).map((out, i) => {
    expect(out['ok'], `raster ${String(docs[i]!['id'])} refused: ${show(out)}`).toBe(true);
    const image = decodePng(readFileSync(inputs[i]!.out));
    expect([image.width, image.height], `raster ${String(docs[i]!['id'])}: the PNG is the document's size`).toEqual(arr(docs[i]!['size'], 'size'));
    return image;
  });
}
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** Ink of the look's `ink` role (black, antialiased over the white ground: gray, r = g = b, darker than 200). */
export const isInk = (c: Rgb): boolean => c[0] === c[1] && c[1] === c[2] && c[0] < 200;
/** Ink of the look's `accent` role ([30, 90, 200], antialiased over white: blue well above red). */
export const isAccent = (c: Rgb): boolean => c[2] - c[0] > 40;
/** The pixel box [x0, y0, x1, y1) of pixels inside `window` for which `f` holds, or null. */
export function inkBox(image: Image, f: (c: Rgb) => boolean, window: Box): [number, number, number, number] | null {
  let xa = Infinity; let ya = Infinity; let xb = -Infinity; let yb = -Infinity;
  const [wx, wy, ww, wh] = window;
  for (let y = Math.max(0, Math.floor(wy)); y < Math.min(image.height, Math.ceil(wy + wh)); y++) {
    for (let x = Math.max(0, Math.floor(wx)); x < Math.min(image.width, Math.ceil(wx + ww)); x++) {
      if (!f(pixel(image, x, y))) continue;
      xa = Math.min(xa, x); ya = Math.min(ya, y); xb = Math.max(xb, x + 1); yb = Math.max(yb, y + 1);
    }
  }
  return Number.isFinite(xa) ? [xa, ya, xb, yb] : null;
}
/**
 * Render-back's boxes agree with the pixels: the item's ink, looked for within `margin` px around its reported
 * box, exists and lies inside that box within 1 px (antialiasing). Fails a box that isn't where the item draws.
 */
export function inkInsideFailures(image: Image, f: (c: Rgb) => boolean, box: Box, what: string, margin = 8): string[] {
  const window: Box = [box[0] - margin, box[1] - margin, box[2] + 2 * margin, box[3] + 2 * margin];
  const ink = inkBox(image, f, window);
  if (!ink) return [`${what}: no ink drawn in or near its box ${fmtBox(box)}`];
  if (ink[0] < box[0] - 1 || ink[1] < box[1] - 1 || ink[2] > x1(box) + 1 || ink[3] > y1(box) + 1) {
    return [`${what}: its ink spans [${ink.join(', ')}) but its box is ${fmtBox(box)}: the box is not where it draws`];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------
// deep-show: built with the r2 build set (marks2d, motion, text, look and the rest), as #200's and #488's suites
// build it, and driven by `deep-show run` with one scenario line.

export interface ShowBuild { bin: () => string }
/** Builds `deep-show --no-default-features --features r2` once per file, copied out under its own name. */
export function useShowBuild(): ShowBuild {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-221-bins-'));
    error = cargo(['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', 'r2']);
    if (error === '') { bin = join(dir, `${SHOW_NAME}-r2`); copyFileSync(join(TARGET, 'debug', exe(SHOW_NAME)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { bin: () => { expect(error, `the binary builds: ${SHOW_NAME} with features r2`).toBe(''); return bin; } };
}

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = TIMEOUT): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-221-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: placement by relation', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
/** The scenario's one document, in its own visible panel. */
export const DOC_A = '01JB221D0000000000000000001';

export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC_A]: { panel: 'main' } },
    calls,
  };
}

/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [sc]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** An agent's deep_show call: a whole revision of `document` (#393), its issues included in the reply. */
export const deepShow = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC_A, document, include: ['issues'] });
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}

// The seal (#305's startup refusal line, #200's `registry`/`entries`/`rules` fields) and deep://registries.

export interface Refusal { reason: string; registry: string | undefined; entries: JsonValue[]; raw: JsonObject }
export function refusalOf(s: Started): Refusal | string {
  if (s.status !== 2) return `the startup exited ${s.status} (${s.signal ?? 'no signal'}), not 2 with the seal's refusal; stdout: ${s.stdout.slice(0, 600)}`;
  if (s.lines.length !== 1 || !isObject(s.lines[0])) return `the refusal is not one JSON line: ${s.stdout.slice(0, 600)}`;
  const raw = s.lines[0];
  if (raw['ok'] !== false || raw['code'] !== 'seal_refused') return `the line is not the seal's refusal: ${show(raw)}`;
  return { reason: String(raw['reason'] ?? ''), registry: typeof raw['registry'] === 'string' ? raw['registry'] : undefined, entries: Array.isArray(raw['entries']) ? raw['entries'] : [], raw };
}
/** One startup and a `registry` call: whether the seal took the set (exit 0) or refused it (exit 2, one line). */
export function startup(bin: string, planted?: string): Started {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  return s;
}

export interface KitResult { verdict: string; rules: { rule: string; verdict: string; message: string }[]; raw: JsonObject }
export function kitResult(v: JsonValue | undefined, what: string): KitResult {
  const o = obj(v, what);
  const rules = arr(o['rules'] ?? [], `${what}.rules`).map((r, i) => {
    const ro = obj(r, `${what}.rules[${i}]`);
    return { rule: str(ro['rule'], `${what}.rules[${i}].rule`), verdict: str(ro['verdict'], `${what}.rules[${i}].verdict`), message: typeof ro['message'] === 'string' ? ro['message'] : '' };
  });
  return { verdict: str(o['verdict'], `${what}.verdict`), rules, raw: o };
}
export interface Entry { name: string; origin: string; module: string | undefined; since: string; digest: string; kit: KitResult; raw: JsonObject }
export interface Planted { name: string; result: KitResult; raw: JsonObject }
export interface Listed { name: string; owner: string; fill: string[]; kit: { rule: string; message: string }[]; planted: Planted[]; entries: Entry[]; raw: JsonObject }

/** The registry `name` in a `registries` reply (#200: `{"uri": "deep://registries/<core version>", "registries": [Listed]}`). */
export function theRegistry(reply: JsonObject, name: string): Listed {
  expect(str(reply['uri'], 'registries: uri'), 'registries: published at deep://registries/<core version>').toMatch(/^deep:\/\/registries\/.+/);
  const all = arr(reply['registries'], 'registries: registries').map((v, i) => obj(v, `registries[${i}]`));
  const o = all.find((x) => x['kind'] === 'registry' && x['name'] === name);
  expect(o, `deep://registries lists the registry ${name}; it lists ${all.map((x) => String(x['name'])).join(', ') || 'nothing'}`).toBeDefined();
  const at = `deep://registries ${name}`;
  return {
    name,
    owner: str(o!['owner'], `${at}.owner`),
    fill: arr(o!['fill'], `${at}.fill`).map((f, i) => str(f, `${at}.fill[${i}]`)),
    kit: arr(o!['kit'], `${at}.kit`).map((r, i) => { const ro = obj(r, `${at}.kit[${i}]`); return { rule: str(ro['rule'], `${at}.kit[${i}].rule`), message: str(ro['message'], `${at}.kit[${i}].message`) }; }),
    planted: arr(o!['planted'], `${at}.planted`).map((p, i) => { const po = obj(p, `${at}.planted[${i}]`); return { name: str(po['name'], `${at}.planted[${i}].name`), result: kitResult(po['result'], `${at}.planted[${i}].result`), raw: po }; }),
    entries: arr(o!['entries'], `${at}.entries`).map((e, i) => {
      const eo = obj(e, `${at}.entries[${i}]`);
      return {
        name: str(eo['name'], `${at}.entries[${i}].name`), origin: str(eo['origin'], `${at}.entries[${i}].origin`),
        module: typeof eo['module'] === 'string' ? eo['module'] : undefined, since: str(eo['since'], `${at}.entries[${i}].since`),
        digest: str(eo['digest'], `${at}.entries[${i}].digest`), kit: kitResult(eo['kit'], `${at}.entries[${i}].kit`), raw: eo,
      };
    }),
    raw: o!,
  };
}

// Seek against play (#488's `determinism`: play is every display frame from the start before t, then t, in one
// session; seek is a cold jump from a second later; each side's canonical render and its nodes' results).

export interface Side { pixels: string; results: Map<string, { module: string; item: string | null; result: string }> }
export interface Compared { t: number; play: Side; seek: Side }
function side(value: JsonValue | undefined, what: string): Side {
  const o = obj(value, what);
  const pixels = str(o['pixels'], `${what}: pixels`);
  expect(pixels, `${what}: pixels is a SHA-256 of the canonical render's PNG`).toMatch(/^[0-9a-f]{64}$/);
  const results = new Map<string, { module: string; item: string | null; result: string }>();
  for (const [i, n] of arr(o['nodes'], `${what}: nodes`).entries()) {
    const node = obj(n, `${what}: nodes[${i}]`);
    const item = node['item'] === null || node['item'] === undefined ? null : str(node['item'], `${what}: nodes[${i}].item`);
    results.set(`${str(node['operator'], `${what}: nodes[${i}].operator`)}@${item ?? '(document)'}`, { module: str(node['module'], `${what}: nodes[${i}].module`), item, result: str(node['result'], `${what}: nodes[${i}].result`) });
  }
  return { pixels, results };
}
export function determinism(reply: JsonObject, what: string): Compared[] {
  expect(reply['outcome'], `${what} compared: ${show(reply)}`).toBe('compared');
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: num(f['t'], `${what}: frames[${i}].t`), play: side(f['play'], `${what}: frames[${i}].play`), seek: side(f['seek'], `${what}: frames[${i}].seek`) };
  });
}
