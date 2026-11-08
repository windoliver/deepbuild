// Test-side tools for the #496 acceptance tests: the `deep-canvas-render` binary (#391's JSON-lines CLI, its `raster`
// and `check` as #392, #373, #381 and #417 left them), built once per file; the documents the tests send; the glyphs,
// coverage and shaping count `raster` reports (README: The surface under test); and the small geometry the expected
// values come from. Nothing here stands in for the text module: every value a test compares comes from the binary, and
// every expected value from the issue's text, computed here, or from the Lottie sidecar (lottie-reference.mjs).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/496 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const RENDER_NAME = 'deep-canvas-render';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build of `deep-canvas-render` can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #496.c9814144',
  2: 'AC2 #496.7f7f12df',
  3: 'AC3 #496.0e4aa65f',
  4: 'AC4 #496.2552ca08',
  5: 'AC5 #496.16281962',
  6: 'AC6 #496.dc1c7447',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** One frame at 60 fps, in flicks. */
export const FRAME_60 = FLICKS / 60;
/** Every 60 fps frame from 0 to `seconds`, both ends included when `seconds` is on the grid. */
export const frames60 = (seconds: number): number[] => Array.from({ length: Math.floor(fl(seconds) / FRAME_60) + 1 }, (_, k) => k * FRAME_60);
/** A seeded generator (mulberry32), so a failing run replays. */
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
/** `list` in a seeded order. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const rand = seeded(seed); const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
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
export function int(value: JsonValue | undefined, what: string): number {
  expect(Number.isInteger(value), `${what} is an integer, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (an ID, a name). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** A fixture from fixtures/, as JSON. */
export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The build: each file builds deep-canvas-render once, in beforeAll, copied out under its own name, with a folder for
// the PNGs `raster` writes; a test that uses a build that failed fails with cargo's error.

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n').slice(-6000)}`;
}

export interface Built { bin: () => string; out: () => string }
/** `cargo build --locked --bin deep-canvas-render`, once per file. */
export function useRender(): Built {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-496-render-'));
    error = cargo(['build', '--locked', '--bin', RENDER_NAME]);
    if (error === '') { bin = join(dir, exe(RENDER_NAME)); copyFileSync(join(TARGET, 'debug', exe(RENDER_NAME)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return {
    bin: () => { expect(error, `the binary builds: cargo build --locked --bin ${RENDER_NAME}`).toBe(''); return bin; },
    out: () => dir,
  };
}

/** `deep-canvas-render <command>` over `lines` in one process: one answer per line, in order; it exits 0. */
export function run(bin: string, command: string, lines: JsonObject[]): JsonObject[] {
  const text = lines.map((l) => JSON.stringify(l)).join('\n');
  const r = spawnSync(bin, [command], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.error?.message ?? '', `${RENDER_NAME} ${command} ran within its timeout`).toBe('');
  expect(r.status, `${RENDER_NAME} ${command} exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${RENDER_NAME} ${command}: one output line per input line`).toBe(lines.length);
  return out.map((l, i) => {
    let v: JsonValue;
    try { v = JSON.parse(l) as JsonValue; } catch { throw Error(`${RENDER_NAME} ${command}: line ${i + 1} of its output is not JSON: ${l.slice(0, 300)}`); }
    return obj(v, `${RENDER_NAME} ${command}: answer ${i + 1}`);
  });
}

/** The look every test draws in: the shipped clean look, by ID (#392). */
export const LOOK = 'clean';

export interface Frame { t: number; planted?: string }
/** `raster` of `doc` at each frame's t, in one process, in order (a play when the times rise frame by frame). */
export function raster(b: Built, doc: JsonObject, frames: Frame[]): JsonObject[] {
  const png = join(b.out(), 'frame.png');
  return run(b.bin(), 'raster', frames.map((f) => ({ out: png, doc, look: LOOK, t: f.t, ...(f.planted ? { planted: f.planted } : {}) })));
}
/** `raster` answers that drew, each one checked `ok`. */
export function drawn(answers: JsonObject[], what: string): JsonObject[] {
  answers.forEach((a, i) => expect(a['ok'], `${what}: raster line ${i + 1} draws the document: ${show(a)}`).toBe(true));
  return answers;
}

// ---------------------------------------------------------------------------------------------------
// What `raster` answers for a text item (README: The surface under test)

/** A glyph outline command, in u, in the glyph's own frame: pen origin on the baseline, x along the advance, y down. */
export type Cmd = [string, ...number[]];
export interface Glyph {
  id: number; grapheme: number; x: number; y: number; advance: number;
  /** [a, b, c, d, e, f]: the glyph's own frame to the document, (x, y) ↦ (a·x + c·y + e, b·x + d·y + f). */
  transform: number[];
  outline: Cmd[];
  /** [x, y, w, h] in document u, the rect the glyph is clipped to; null when it isn't clipped. */
  clip: number[] | null;
}
export interface Text { shown: string; glyphs: Glyph[]; coverage: number[][] | undefined; raw: JsonObject }

function glyphOf(v: JsonValue | undefined, what: string): Glyph {
  const g = obj(v, what);
  const transform = arr(g['transform'], `${what}.transform`).map((n, i) => num(n, `${what}.transform[${i}]`));
  expect(transform.length, `${what}.transform has six numbers`).toBe(6);
  const outline = arr(g['outline'], `${what}.outline`).map((c, i): Cmd => {
    const parts = arr(c, `${what}.outline[${i}]`);
    const verb = parts[0];
    expect(typeof verb === 'string' && ['M', 'L', 'Q', 'C', 'Z'].includes(verb), `${what}.outline[${i}] starts with M, L, Q, C or Z: ${show(c)}`).toBe(true);
    return [verb as string, ...parts.slice(1).map((n, j) => num(n, `${what}.outline[${i}][${j + 1}]`))];
  });
  let clip: number[] | null = null;
  if (g['clip'] !== null && g['clip'] !== undefined) {
    clip = arr(g['clip'], `${what}.clip`).map((n, i) => num(n, `${what}.clip[${i}]`));
    expect(clip.length, `${what}.clip is [x, y, w, h]`).toBe(4);
  }
  return {
    id: int(g['id'], `${what}.id`), grapheme: int(g['grapheme'], `${what}.grapheme`), x: num(g['x'], `${what}.x`), y: num(g['y'], `${what}.y`),
    advance: num(g['advance'], `${what}.advance`), transform, outline, clip,
  };
}

/** `texts.<item>` of a raster answer: what it shows, its glyphs with the fields #496 adds, its animators' coverage. */
export function textOf(answer: JsonObject, item: string, what: string): Text {
  const t = obj(obj(answer['texts'], `${what}: texts`)[item], `${what}: texts.${item}`);
  const glyphs = arr(t['glyphs'], `${what}: texts.${item}.glyphs`).map((g, i) => glyphOf(g, `${what}: texts.${item}.glyphs[${i}]`));
  const coverage = t['coverage'] === undefined ? undefined
    : arr(t['coverage'], `${what}: texts.${item}.coverage`).map((a, i) => arr(a, `${what}: texts.${item}.coverage[${i}]`).map((n, j) => num(n, `${what}: texts.${item}.coverage[${i}][${j}]`)));
  return { shown: typeof t['shown'] === 'string' ? t['shown'] : '', glyphs, coverage, raw: t };
}
/** One animator's coverage, required. */
export function coverageOf(text: Text, animator: number, what: string): number[] {
  expect(text.coverage, `${what}: texts reports coverage`).toBeDefined();
  return arr(text.coverage![animator] as JsonValue, `${what}: coverage[${animator}]`).map((n) => n as number);
}

// ---------------------------------------------------------------------------------------------------
// Geometry

/** A point of the glyph's own frame in the document. */
export const apply = (t: number[], p: [number, number]): [number, number] => [t[0]! * p[0] + t[2]! * p[1] + t[4]!, t[1]! * p[0] + t[3]! * p[1] + t[5]!];
/** The glyph's advance midpoint on its baseline, in the document (the grapheme's centre, as on_curve places it). */
export const centreOf = (g: Glyph): [number, number] => apply(g.transform, [g.advance / 2, 0]);
/** The direction the glyph's baseline runs, in degrees, (−180, 180]. */
export const angleOf = (g: Glyph): number => (Math.atan2(g.transform[1]!, g.transform[0]!) * 180) / Math.PI;
/** The difference of two angles in degrees, folded into [0, 180]. */
export const angleGap = (a: number, b: number): number => { const d = (((a - b) % 360) + 360) % 360; return Math.min(d, 360 - d); };
/** A circle of radius r about the origin as an SVG `d`: eight cubics, starting at (r, 0), angle increasing (clockwise on screen, y down). */
export function circleD(r: number): string {
  const n = 8; const step = (2 * Math.PI) / n; const k = (4 / 3) * Math.tan(step / 4);
  const p = (a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];
  const f = (v: number): string => (Math.abs(v) < 1e-12 ? '0' : v.toFixed(9));
  let d = `M ${f(r)} 0`;
  for (let i = 0; i < n; i++) {
    const a0 = i * step; const a1 = (i + 1) * step;
    const [x0, y0] = p(a0); const [x1, y1] = p(a1);
    const c1: [number, number] = [x0 - k * r * Math.sin(a0), y0 + k * r * Math.cos(a0)];
    const c2: [number, number] = [x1 + k * r * Math.sin(a1), y1 - k * r * Math.cos(a1)];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(x1)} ${f(y1)}`;
  }
  return `${d} Z`;
}
/** Where two outlines differ by more than `tol` u: a different command, or a coordinate. */
export function outlineGap(a: Cmd[], b: Cmd[], tol: number): string | null {
  if (a.length !== b.length) return `${a.length} commands, not ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!; const y = b[i]!;
    if (x[0] !== y[0] || x.length !== y.length) return `command ${i} is ${x[0]}, not ${y[0]}`;
    for (let j = 1; j < x.length; j++) if (Math.abs((x[j] as number) - (y[j] as number)) > tol) return `command ${i} (${x[0]}) coordinate ${j} is ${x[j]}, not ${y[j]}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Documents

const LAYERS: JsonObject = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
/** A film of `items`, its frame `size`, at 60 fps over `span`, with `extra` sections (channels, drivers, data, …). */
export function film(id: string, items: JsonObject[], extra: JsonObject = {}, span = '6s', size: number[] = [720, 360]): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#496 ${id}`, description: `The #496 acceptance tests' document ${id}.`, size, layers: LAYERS,
    transport: { span, frame_rate: '60/1' }, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A text@1 item at `pos`. */
export const textItem = (id: string, params: JsonObject, pos: number[] | null = [16, 16], order = 'a1'): JsonObject => ({
  id, kind: 'text@1', layer: 'main', name: id, order, ...(pos ? { at: { pos: [pos[0]!, pos[1]!, 0] } } : {}), params,
});
export type KeyList = [seconds: number, value: JsonValue, interp?: JsonValue][];
/** A channel's keys, IDs in time order; a key with no interp of its own is linear. */
export function keys(list: KeyList): JsonObject {
  return Object.fromEntries(list.map(([t, value, interp], i) => [`k${String(i).padStart(2, '0')}`, { t: `${t}s`, value, interp: interp ?? 'linear' }]));
}
export const channel = (target: string, list: KeyList, extra: JsonObject = {}): JsonObject => ({ target, type: 'f32', keys: keys(list), ...extra });
