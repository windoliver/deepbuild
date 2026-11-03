// Test-side tools for the #160 acceptance tests: the `deep-canvas-render` binary (#391's JSON-lines CLI, with
// #373's `raster` and `geometry`, and this suite's `path`), built once per file; the documents the tests send;
// a PNG reader; the f64 geometry the expected values come from (Bézier sampling, arc length, Hausdorff distance,
// 2×3 matrices); and the reference-Mac gate with the design's judge for timing results (as #387's and #489's
// suites). Nothing here stands in for marks2d: every value a test compares comes from the binary, every
// expected value from the issue's text computed here in f64.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/160 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** #391's proof surface, extended by #373 and here (README: The surface under test). */
export const RENDER_BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-canvas-render.exe' : 'deep-canvas-render');
export const RENDER_BIN_NAME = 'deep-canvas-render';
/** Every `it` passes this timeout: a first build of the binary can take many minutes. */
export const TIMEOUT = 1_800_000;

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}

export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** The items map of a document. */
export function items(doc: JsonObject): JsonObject {
  return obj(doc['items'], 'doc.items');
}

/** One item's params. */
export function paramsOf(doc: JsonObject, id: string): JsonObject {
  return obj(obj(items(doc)[id], `doc.items.${id}`)['params'], `doc.items.${id}.params`);
}

/** Every number anywhere in a JSON value (the numbers an issue carries, for "naming" a count). */
export function numbersIn(value: JsonValue | undefined): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') return [...value.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)].map((m) => Number(m[0]));
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (isObject(value)) return Object.values(value).flatMap(numbersIn);
  return [];
}

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}

/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Documents as the tests write them (README: Documents): #373's envelope, one writer layer `main`.

export function figure(id: string, size: [number, number], list: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#160 ${id}`, description: `The #160 acceptance tests' document ${id}.`, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(list.map((i) => [String(i['id']), i])), ...extra,
  };
}

/** An item in the writer layer `main`. */
export function item(id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject {
  return { id, kind, layer: 'main', name: `Item ${id}`, order, params, ...extra };
}

/** A path@1 from an SVG `d`, stroked in `role` at `width` u unless `params` says otherwise. */
export function pathItem(id: string, order: string, d: string, params: JsonObject = {}, extra: JsonObject = {}): JsonObject {
  return item(id, 'path@1', order, { d, paint: { stroke: { role: 'ink', width: 4 } }, ...params }, extra);
}

/** A keyed f32 channel (#391's, as #221's and #489's suites write them): `[seconds, value]` keys, linear by default. */
export function keyed(target: string, keys: [number, number][], interp: JsonValue = 'linear', extra: JsonObject = {}): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: `${t}s`, value: v, interp }])), ...extra };
}

/** An enum channel: each key holds its label until the next (Frame and group: draw order). */
export function enumChannel(target: string, keys: [number, string][]): JsonObject {
  return { target, type: 'enum', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: `${t}s`, value: v }])) };
}

/** A per-point column (the mark set's column form): f32 values, little-endian, base64. */
export function f32Column(values: number[], len = values.length): JsonObject {
  return { dtype: 'f32', len, data: Buffer.from(new Float32Array(values).buffer).toString('base64') };
}

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

export function buildBinary(name: string): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
}

/** Builds the binary once per file and fails every test of the file when it can't be built. */
export function useRenderBinary(): void {
  let error = '';
  beforeAll(() => { error = buildBinary(RENDER_BIN_NAME); }, TIMEOUT);
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

/** A line that must be refused with `code` (`{"ok": false, "code": code, ...}`). */
export function expectRefused(subcommand: string, input: JsonValue | string, code: string, why: string): JsonObject {
  const out = one(subcommand, input);
  expect(out['ok'], `${RENDER_BIN_NAME} ${subcommand}: ${why}, so it is refused: ${show(out)}`).toBe(false);
  expect(out['code'], `${RENDER_BIN_NAME} ${subcommand}: ${why}: the refusal's code`).toBe(code);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The look: this suite's role map (#391's form, no status map), so every color is set here.

export const LOOK: JsonObject = {
  light: {
    ground: [255, 255, 255], ink: [0, 0, 0],
    body: [40, 90, 160], hand: [230, 160, 30], rim: [200, 30, 30],
    dot: [30, 150, 60], line: [120, 40, 160], petal: [220, 80, 120], hub: [90, 90, 90],
  },
};

export type Rgb = [number, number, number];
export const WHITE: Rgb = [255, 255, 255];

/** A look role's color in this suite's role map. */
export function role(name: string): Rgb {
  const v = arr(obj(LOOK['light'], 'LOOK.light')[name], `LOOK.light.${name}`);
  return v.map((c, i) => num(c, `LOOK.light.${name}[${i}]`)) as Rgb;
}

// ---------------------------------------------------------------------------------------------------
// The check

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }

/** `check` over a document with a look: whether it passes, and its issues. */
export function check(doc: JsonObject, look: JsonValue = LOOK): { ok: boolean; issues: Issue[] } {
  const out = one('check', { doc, look });
  expect(typeof out['ok'], `check answers ok: ${show(out)}`).toBe('boolean');
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
export function expectClean(doc: JsonObject, what: string, look: JsonValue = LOOK): void {
  const result = check(doc, look);
  const errors = errorsOf(result);
  expect(errors.map((e) => `${e.code} ${e.ids.join(',')} ${e.path}`), `${what}: the check raises no error`).toEqual([]);
  expect(result.ok, `${what}: the check passes`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The raster (#373's, unchanged but for this suite's planted value)

/** Scratch folders for PNGs, deleted after the file's tests. */
export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-160-${prefix}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export interface Drawn { report: JsonObject; image: Image }

let rasters = 0;
/** A `raster` request for `doc` at `t` flicks, writing under `dir`. */
export function rasterInput(dir: string, doc: JsonObject, t = 0, extra: JsonObject = {}): JsonObject {
  rasters += 1;
  return { out: join(dir, `r${process.pid}-${rasters}.png`), doc, look: LOOK, t, ...extra };
}

/** Reads a raster's answer and its PNG; the answer must be accepted and the PNG the document's size. */
export function readRaster(input: JsonObject, out: JsonValue | undefined, what: string): Drawn {
  const report = obj(out, `raster ${what}: the answer`);
  expect(report['ok'], `raster ${what} refused: ${show(report)}`).toBe(true);
  const size = arr(obj(input['doc'], 'doc')['size'], 'doc.size').map((v) => num(v, 'doc.size'));
  const image = readPng(String(input['out']));
  expect([image.width, image.height], `raster ${what}: the PNG is the document's size`).toEqual(size);
  return { report, image };
}

/** One document drawn by `raster` in a process of its own. */
export function raster(dir: string, doc: JsonObject, what: string, t = 0, extra: JsonObject = {}): Drawn {
  const input = rasterInput(dir, doc, t, extra);
  return readRaster(input, batch('raster', [input])[0], what);
}

/** The document drawn at each of `times`, in order, by one process (a play). */
export function rasterPlay(dir: string, doc: JsonObject, times: number[], what: string, extra: JsonObject = {}): Drawn[] {
  const inputs = times.map((t) => rasterInput(dir, doc, t, extra));
  const outs = batch('raster', inputs);
  return inputs.map((input, i) => readRaster(input, outs[i], `${what} at ${times[i]} flicks`));
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render path` (README: The surface under test)

export interface Subpath { closed: boolean; verbs: string[]; points: [number, number][] }
export interface Copy { transform: number[]; opacity: number; t: number }
export interface End { kind: string; tip: [number, number]; angle: number; length: number; width: number }
export interface PathFrame {
  t: number; subpaths: Subpath[]; segments: number; declared: number; tessellation: string; rebuilt: boolean;
  copies: Copy[] | undefined; ends: Record<string, End> | undefined; anchors: JsonObject | undefined;
  columns: Record<string, number[]> | undefined; buildMs: number | undefined; raw: JsonObject;
}

export interface PathLine { doc: JsonObject; item: string; times?: number[]; anchors?: string[]; timing?: boolean; planted?: string }
const pathInput = (l: PathLine): JsonObject => {
  const out: JsonObject = { doc: l.doc, item: l.item, look: LOOK };
  if (l.times !== undefined) out['times'] = l.times;
  if (l.anchors !== undefined) out['anchors'] = l.anchors;
  if (l.timing !== undefined) out['timing'] = l.timing;
  if (l.planted !== undefined) out['planted'] = l.planted;
  return out;
};

export function subpathsOf(value: JsonValue | undefined, what: string): Subpath[] {
  return arr(value, `${what}: subpaths`).map((s, i) => {
    const sp = obj(s, `${what}: subpaths[${i}]`);
    return {
      closed: sp['closed'] === true,
      verbs: arr(sp['verbs'], `${what}: subpaths[${i}].verbs`).map(String),
      points: arr(sp['points'], `${what}: subpaths[${i}].points`).map((p, k) => {
        const xy = arr(p, `${what}: subpaths[${i}].points[${k}]`);
        return [num(xy[0], `points[${k}][0]`), num(xy[1], `points[${k}][1]`)] as [number, number];
      }),
    };
  });
}

function endOf(v: JsonValue | undefined, what: string): End {
  const e = obj(v, what);
  const tip = arr(e['tip'], `${what}.tip`);
  return {
    kind: String(e['kind']), tip: [num(tip[0], `${what}.tip[0]`), num(tip[1], `${what}.tip[1]`)],
    angle: num(e['angle'], `${what}.angle`), length: num(e['length'], `${what}.length`), width: num(e['width'], `${what}.width`),
  };
}

/** One answer of `path`, accepted, with one frame per time. */
export function pathAccepted(answer: JsonValue | undefined, times: readonly number[], what: string): PathFrame[] {
  const a = obj(answer, `path ${what}: the answer`);
  expect(a['ok'], `path ${what} is accepted: ${show(a)}`).toBe(true);
  const frames = arr(a['frames'], `path ${what}: frames`).map((v, i): PathFrame => {
    const f = obj(v, `path ${what}: frames[${i}]`);
    const at = `path ${what}: frames[${i}]`;
    return {
      t: num(f['t'], `${at}.t`),
      subpaths: subpathsOf(f['subpaths'], at),
      segments: num(f['segments'], `${at}.segments`),
      declared: num(f['declared'], `${at}.declared`),
      tessellation: String(f['tessellation']),
      rebuilt: f['rebuilt'] === true,
      copies: f['copies'] === undefined ? undefined : arr(f['copies'], `${at}.copies`).map((c, k) => {
        const co = obj(c, `${at}.copies[${k}]`);
        return {
          transform: arr(co['transform'], `${at}.copies[${k}].transform`).map((x, j) => num(x, `${at}.copies[${k}].transform[${j}]`)),
          opacity: num(co['opacity'], `${at}.copies[${k}].opacity`), t: num(co['t'], `${at}.copies[${k}].t`),
        };
      }),
      ends: f['ends'] === undefined ? undefined : Object.fromEntries(Object.entries(obj(f['ends'], `${at}.ends`)).map(([k, e]) => [k, endOf(e, `${at}.ends.${k}`)])),
      anchors: f['anchors'] === undefined ? undefined : obj(f['anchors'], `${at}.anchors`),
      columns: f['columns'] === undefined ? undefined : Object.fromEntries(Object.entries(obj(f['columns'], `${at}.columns`)).map(([k, c]) => [k, arr(c, `${at}.columns.${k}`).map((x, j) => num(x, `${at}.columns.${k}[${j}]`))])),
      buildMs: f['build_ms'] === undefined ? undefined : num(f['build_ms'], `${at}.build_ms`),
      raw: f,
    };
  });
  expect(frames.map((f) => f.t), `path ${what}: one frame per time, in order`).toEqual([...times]);
  return frames;
}

/** `path` lines in one process, each accepted. */
export function pathAll(lines: PathLine[], what: string): PathFrame[][] {
  const outs = batch('path', lines.map(pathInput));
  return outs.map((o, i) => pathAccepted(o, lines[i]!.times ?? [0], `${what} (line ${i})`));
}

/** One `path` line in a process of its own, accepted. */
export function pathFrames(line: PathLine, what: string): PathFrame[] {
  return pathAll([line], what)[0]!;
}

/** One `path` frame at one time (0 by default). */
export function pathAt(doc: JsonObject, id: string, what: string, t = 0, extra: Partial<PathLine> = {}): PathFrame {
  return pathFrames({ doc, item: id, times: [t], ...extra }, what)[0]!;
}

/** A `path` line's raw answer (for refusals). */
export function pathRaw(line: PathLine): JsonObject {
  return obj(batch('path', [pathInput(line)])[0], 'path: the answer');
}

// ---------------------------------------------------------------------------------------------------
// Geometry in f64: sampling sub-paths, arc length, distances.

export type Pt = [number, number];
export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A sub-path's segments, each as its control polygon (2 points for a line, 3 for a quad, 4 for a cubic); Z adds its closing line. */
export function segmentsOf(sp: Subpath): Pt[][] {
  const out: Pt[][] = [];
  let at = 0;
  let cur: Pt | null = null; let start: Pt | null = null;
  for (const v of sp.verbs) {
    if (v === 'M') { cur = sp.points[at]!; start = cur; at += 1; continue; }
    if (cur === null) throw Error('a sub-path that does not start with M');
    if (v === 'L') { const p = sp.points[at]!; out.push([cur, p]); cur = p; at += 1; } else if (v === 'Q') { const a = sp.points[at]!; const p = sp.points[at + 1]!; out.push([cur, a, p]); cur = p; at += 2; } else if (v === 'C') { const a = sp.points[at]!; const b = sp.points[at + 1]!; const p = sp.points[at + 2]!; out.push([cur, a, b, p]); cur = p; at += 3; } else if (v === 'Z') { if (start && dist(cur, start) > 1e-9) out.push([cur, start]); cur = start; }
  }
  return out;
}

/** The README's segment count of sub-paths: every L, Q and C, and every Z whose closing line has length. */
export const segmentCount = (sps: Subpath[]): number => sps.reduce((n, sp) => n + segmentsOf(sp).length, 0);

/** A point on a segment's Bézier at parameter u. */
export function bezier(seg: Pt[], u: number): Pt {
  let pts = seg.map((p) => [p[0], p[1]] as Pt);
  while (pts.length > 1) pts = pts.slice(1).map((p, i) => [pts[i]![0] + (p[0] - pts[i]![0]) * u, pts[i]![1] + (p[1] - pts[i]![1]) * u] as Pt);
  return pts[0]!;
}

/** A sub-path flattened: each segment cut into `n` equal parameter steps (lines into one). */
export function flatten(sp: Subpath, n = 256): Pt[] {
  const segs = segmentsOf(sp);
  if (segs.length === 0) return sp.points.slice(0, 1);
  const out: Pt[] = [segs[0]![0]!];
  for (const s of segs) {
    const steps = s.length === 2 ? 1 : n;
    for (let k = 1; k <= steps; k++) out.push(bezier(s, k / steps));
  }
  return out;
}

export const polylineLength = (pts: Pt[]): number => pts.slice(1).reduce((s, p, i) => s + dist(pts[i]!, p), 0);

/** The point a distance `s` along a polyline. */
export function pointAtLength(pts: Pt[], s: number): Pt {
  let left = s;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1]!, pts[i]!);
    if (left <= d || i === pts.length - 1) {
      const f = d === 0 ? 0 : Math.min(1, left / d);
      return [pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * f, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * f];
    }
    left -= d;
  }
  return pts[pts.length - 1]!;
}

/** `count` points evenly spaced by arc length along a polyline, both ends included. */
export const sampleByLength = (pts: Pt[], count: number): Pt[] => {
  const L = polylineLength(pts);
  return Array.from({ length: count }, (_, j) => pointAtLength(pts, (L * j) / (count - 1)));
};

function pointSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}

/** The distance from a point to the nearest of some polylines. */
export function toPolylines(p: Pt, lines: Pt[][]): number {
  let best = Infinity;
  for (const l of lines) for (let i = 1; i < l.length; i++) best = Math.min(best, pointSegment(p, l[i - 1]!, l[i]!));
  return best;
}

/** Points along polylines, at most `step` u apart (the polylines' vertices included). */
export function densify(lines: Pt[][], step = 0.25): Pt[] {
  const out: Pt[] = [];
  for (const l of lines) {
    if (l.length) out.push(l[0]!);
    for (let i = 1; i < l.length; i++) {
      const n = Math.max(1, Math.ceil(dist(l[i - 1]!, l[i]!) / step));
      for (let k = 1; k <= n; k++) out.push([l[i - 1]![0] + ((l[i]![0] - l[i - 1]![0]) * k) / n, l[i - 1]![1] + ((l[i]![1] - l[i - 1]![1]) * k) / n]);
    }
  }
  return out;
}

/** The Hausdorff distance between two sets of polylines (each direction, sampled every 0.25 u), and where it is largest. */
export function hausdorff(a: Pt[][], b: Pt[][]): { d: number; at: Pt; side: string } {
  let worst = { d: 0, at: [0, 0] as Pt, side: '' };
  for (const [from, to, side] of [[a, b, 'output to reference'], [b, a, 'reference to output']] as const) {
    for (const p of densify(from)) {
      const d = toPolylines(p, to);
      if (d > worst.d) worst = { d, at: p, side };
    }
  }
  return worst;
}

/** The on-curve points of a sub-path (M, L, and each Q's and C's end), a last point that repeats the first dropped. */
export function vertices(sp: Subpath): Pt[] {
  const out: Pt[] = [];
  let at = 0;
  for (const v of sp.verbs) {
    const n = v === 'M' || v === 'L' ? 1 : v === 'Q' ? 2 : v === 'C' ? 3 : 0;
    if (n > 0) { out.push(sp.points[at + n - 1]!); at += n; }
  }
  if (out.length > 1 && dist(out[0]!, out[out.length - 1]!) < 1e-9) out.pop();
  return out;
}

/** A tangent's direction in degrees, atan2(dy, dx) in document u (y down), as the README's angles are. */
export const angleOf = (dx: number, dy: number): number => (Math.atan2(dy, dx) * 180) / Math.PI;
/** The difference of two angles in degrees, in (−180, 180]. */
export const angleDiff = (a: number, b: number): number => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; };

// ---------------------------------------------------------------------------------------------------
// 2×3 matrices [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (SVG's order).

export type M23 = [number, number, number, number, number, number];
export const IDENTITY: M23 = [1, 0, 0, 1, 0, 0];
/** m ∘ n: n first, then m. */
export const mul = (m: M23, n: M23): M23 => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m: M23, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
export function power(m: M23, k: number): M23 { let out: M23 = IDENTITY; for (let i = 0; i < k; i++) out = mul(m, out); return out; }
/**
 * The repeater's one-copy transform from its `at` (Units and axes: subtract the pivot, scale, rotate, add the
 * position; the tests' pivot is 0), turning by `sense` × rot (the design doesn't say which way degrees turn).
 */
export function repeaterStep(pos: Pt, rotDeg: number, scale: Pt, sense: 1 | -1): M23 {
  const r = (sense * rotDeg * Math.PI) / 180;
  const c = Math.cos(r); const s = Math.sin(r);
  return [c * scale[0], s * scale[0], -s * scale[1], c * scale[1], pos[0], pos[1]];
}
/** A matrix's rotation in degrees, atan2(b, a). */
export const rotationOf = (m: number[]): number => (Math.atan2(m[1]!, m[0]!) * 180) / Math.PI;

// ---------------------------------------------------------------------------------------------------
// PNG: a reader for what the raster writes (8-bit RGB or RGBA, no interlace), node built-ins only.

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

/** Ink's coverage of a pixel drawn in ink (black) over the white ground: (255 − red) ÷ 255. */
export const inkCoverage = (image: Image, x: number, y: number): number => (255 - pixel(image, x, y)[0]) / 255;

export const same = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The largest channel difference between two colors. */
export const colorError = (a: Rgb, b: readonly number[]): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!)));

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
export function inked(image: Image, ground: Rgb = WHITE, x0 = 0, y0 = 0, x1 = image.width, y1 = image.height): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!same(pixel(image, x, y), ground)) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/387 and 489).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine can't give a timing verdict, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
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
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
