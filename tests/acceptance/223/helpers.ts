// Test-side tools for the #223 acceptance tests (README: The surface under test): the binaries, built once per file
// (`deep-canvas-render` debug and release, `deep-show` on the full set and on the full set without the data module
// with the test canvas module `test.swirl`); the JSON-lines calls each answers; the documents the criteria describe,
// generated here; the plane's coordinates and the analytic images the expected values come from, in f64; a PNG
// reader and an animated-PNG writer for the taste call's recording; and the reference-Mac gate with the design's
// judge for timing results (as #160's suite). Nothing here stands in for the warp: every value a test compares comes
// from a binary, every expected value from the issue's text computed here. Parts are copied from the #160, #222,
// #226 and #524 suites' helpers, since suites don't import each other.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/223 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes this timeout: a first build of a binary takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/**
 * Each criterion's ID: `#223.` and the first 8 hex digits of SHA-256 of its text as the issue's `- [ ]` line holds
 * it, trimmed, whitespace collapsed (scripts/proof-change.mjs, criterionId).
 */
export const AC = {
  1: 'AC1 #223.532d1014',
  2: 'AC2 #223.48c2501c',
  3: 'AC3 #223.9d800d51',
  4: 'AC4 #223.bd85dee7',
  5: 'AC5 #223.3a3308e4',
  6: 'AC6 #223.bc85d7ee',
  7: 'AC7 #223.955a0bbf',
  8: 'AC8 #223.7ab209fd',
  9: 'AC9 #223.85ce0afe',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v === 'string', `${what} is a string, got ${brief(v)}`).toBe(true);
  return v as string;
}
/** Whether a value's JSON text holds `needle` (an ID, a name). */
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A judge that must fail on a wrong program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the wrong program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** A number shown short: 1, 0.9, -0.5. */
export const short = (x: number): string => String(Number(x.toFixed(4)));

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick)

export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
export const showTime = (f: number): string => `${f / FLICKS} s (${f} flicks)`;
/** A time as a reply writes it, in exact flicks: an integer is flicks, `"<decimal>s"` is seconds; else null. */
export function flicksOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?s$/.exec(v.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  const scaled = BigInt(`${m[2]!}${frac}`) * BigInt(FLICKS);
  const den = 10n ** BigInt(frac.length);
  if (scaled % den !== 0n) return null;
  const f = Number(scaled / den);
  return m[1] === '-' ? -f : f;
}
/** A seeded generator in [0, 1) (mulberry32), seeded from a text by FNV-1a, so every run draws the same values. */
export function random(seedText: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 0x01000193) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `n` distinct whole-flick times drawn from [from, to] by `seedText`'s generator, ascending. */
export function randomTimes(seedText: string, n: number, from: number, to: number): number[] {
  const next = random(seedText);
  const out = new Set<number>();
  while (out.size < n) out.add(from + Math.floor(next() * (to - from + 1)));
  return [...out].sort((x, y) => x - y);
}
/** The same list in an order drawn by `seedText` (Fisher–Yates). */
export function shuffled<T>(seedText: string, list: readonly T[]): T[] {
  const next = random(seedText);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Builds (README: Run). Each binary is built once per file and copied out of the target folder right after its build,
// since the two deep-show builds share one output path.

export type Bin = 'render' | 'render-release' | 'show' | 'show-swirl';
const CARGO: Record<Bin, { bin: string; args: string[]; release: boolean }> = {
  render: { bin: 'deep-canvas-render', args: [], release: false },
  'render-release': { bin: 'deep-canvas-render', args: [], release: true },
  show: { bin: 'deep-show', args: ['--no-default-features', '--features', 'full'], release: false },
  // The full set without the data module (#489's test feature) and with this suite's test canvas module (README).
  'show-swirl': { bin: 'deep-show', args: ['--no-default-features', '--features', 'full,test-leave-out-data,test-swirl'], release: false },
};
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
export const cargoArgs = (bin: Bin): string[] => ['build', '--locked', ...(CARGO[bin].release ? ['--release'] : []), '--bin', CARGO[bin].bin, ...CARGO[bin].args];

/** Builds `bin` and copies it into `dir`: its path, or cargo's error. */
export function buildInto(bin: Bin, dir: string): { path: string; error: string } {
  const args = cargoArgs(bin);
  const rustup = '/opt/homebrew/opt/rustup/bin';
  const env = {
    ...process.env,
    PATH: existsSync(rustup) ? `${rustup}${delimiter}${process.env['PATH'] ?? ''}` : (process.env['PATH'] ?? ''),
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const path = join(dir, bin);
  copyFileSync(join(targetDir(), CARGO[bin].release ? 'release' : 'debug', CARGO[bin].bin), path);
  return { path, error: '' };
}

/**
 * Builds `bins` once, in order, before the file's tests; a test whose binary didn't build fails with cargo's error.
 * `lazy` bins are built on first use instead (the release build, only on a machine that can judge a timing).
 */
export function useBins(bins: readonly Bin[], lazy: readonly Bin[] = []): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-223-bin-'));
    for (const b of bins) made.set(b, buildInto(b, dir));
  }, 4 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin: Bin): string => {
    if (!made.has(bin) && lazy.includes(bin)) made.set(bin, buildInto(bin, dir));
    const m = made.get(bin);
    expect(m, `${bin} was built before the tests`).toBeDefined();
    expect(m!.error, `the binary builds: cargo ${cargoArgs(bin).join(' ')}`).toBe('');
    return m!.path;
  };
}

/** Fresh folders for a test (evidence stores, PNGs), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-223-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render <subcommand>`: JSON lines in, one JSON line out per line, in order, exit 0 (#391's convention).

export function batch(bin: string, subcommand: string, inputs: JsonValue[]): JsonValue[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const r = spawnSync(bin, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024 });
  const name = `deep-canvas-render ${subcommand}`;
  expect(r.error?.message ?? '', `${name} started`).toBe('');
  expect(r.status, `${name} exits 0 (${r.signal ?? 'no signal'}): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}

/** This suite's role map (#391's form), so every color is set here: black ink on a white ground. */
export const LOOK: JsonObject = { light: { ground: [255, 255, 255], ink: [0, 0, 0] } };

/** A figure (#373's envelope, one writer layer `main`); `extra` adds `transport`, `channels` and the rest. */
export function figure(id: string, size: [number, number], list: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `Warp fixture ${id}`, description: `The warp acceptance suite's document ${id}.`, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(list.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** An item in the writer layer `main`. */
export function item(id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject {
  return { id, kind, layer: 'main', name: `Item ${id}`, order, params, ...extra };
}
/** A path@1 from an SVG `d`, stroked in ink at `width` u. */
export function pathItem(id: string, order: string, d: string, width = 2, params: JsonObject = {}, extra: JsonObject = {}): JsonObject {
  return item(id, 'path@1', order, { d, paint: { stroke: { role: 'ink', width } }, ...params }, extra);
}
/** A path@1 drawn by the path fn's grid form (Path `path@1`: function), stroked in ink. */
export function gridItem(id: string, order: string, x: [number, number, number], y: [number, number, number], width = 1, extra: JsonObject = {}): JsonObject {
  return item(id, 'path@1', order, { fn: { grid: { x, y } }, paint: { stroke: { role: 'ink', width } } }, extra);
}
/** A group@1 carrying `warp` (Frame and group: warp); with no warp, the same group plain. */
export function warpGroup(id: string, warp: JsonObject | null, order = 'a0'): JsonObject {
  return item(id, 'group@1', order, warp ? { warp } : {});
}
/** A keyed f32 channel: `[seconds, value]` keys, linear. */
export function keyed(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, v], i) => [`k${i}`, { t: `${t}s`, value: v, interp: 'linear' }])) };
}
/** A document as your shell sends it to `deep show` (#393): a film, no `id`, no `layers`, no item's `layer`. */
export function shellFilm(doc: JsonObject): JsonObject {
  const { id: _id, layers: _layers, items, ...rest } = doc;
  const out: JsonObject = {};
  for (const [key, it] of Object.entries(obj(items, 'items'))) {
    const { layer: _layer, ...kept } = obj(it, `items.${key}`);
    out[key] = kept;
  }
  return { ...rest, profile: 'film', items: out };
}

// ---------------------------------------------------------------------------------------------------
// The plane (Frame and group: warp): a point's coordinates are its offset from `origin` in units of `unit`, y up
// unless `y: down`. The suite's default plane is centred on an 800 × 600 figure.

export type Pt = [number, number];
export interface Plane { origin: Pt; unit: number; y: 'up' | 'down' }
export const PLANE: Plane = { origin: [400, 300], unit: 100, y: 'up' };
export const planeJson = (p: Plane): JsonObject => ({ origin: [...p.origin], unit: p.unit, y: p.y });
/** A screen point (document u) in the plane's coordinates. */
export const toPlane = (p: Plane, s: Pt): Pt => [(s[0] - p.origin[0]) / p.unit, (p.y === 'up' ? p.origin[1] - s[1] : s[1] - p.origin[1]) / p.unit];
/** A plane point on screen (document u). */
export const toScreen = (p: Plane, q: Pt): Pt => [p.origin[0] + q[0] * p.unit, p.y === 'up' ? p.origin[1] - q[1] * p.unit : p.origin[1] + q[1] * p.unit];
/** A map of the plane, carried to the screen. */
export const onScreen = (p: Plane, f: (q: Pt) => Pt) => (s: Pt): Pt => toScreen(p, f(toPlane(p, s)));

// Complex numbers as pairs (The closed function list: Complex, as vec2).
export const cmul = (a: Pt, b: Pt): Pt => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const cexp = (a: Pt): Pt => [Math.exp(a[0]) * Math.cos(a[1]), Math.exp(a[0]) * Math.sin(a[1])];
/** A 2 × 2 matrix [[a, b], [c, d]] applied to a point: (a x + b y, c x + d y). */
export const mat = (m: number[][], q: Pt): Pt => [m[0]![0]! * q[0] + m[0]![1]! * q[1], m[1]![0]! * q[0] + m[1]![1]! * q[1]];
/** The linear warp's matrix at mix u: (1 − u)I + uM. */
export const mixed = (m: number[][], u: number): number[][] => [[1 - u + u * m[0]![0]!, u * m[0]![1]!], [u * m[1]![0]!, 1 - u + u * m[1]![1]!]];

// ---------------------------------------------------------------------------------------------------
// The check (`deep-canvas-render check {doc, look}`)

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export function check(bin: string, doc: JsonObject): { ok: boolean; issues: Issue[] } {
  const out = obj(batch(bin, 'check', [{ doc, look: LOOK }])[0], 'check: the answer');
  expect(typeof out['ok'], `check answers ok: ${brief(out)}`).toBe('boolean');
  const issues = arr(out['issues'] ?? [], 'check: issues').map((v, i) => {
    const raw = obj(v, `check: issues[${i}]`);
    return { code: String(raw['code']), severity: String(raw['severity']), path: String(raw['path']), ids: Array.isArray(raw['ids']) ? raw['ids'].map(String) : [], raw };
  });
  return { ok: out['ok'] === true, issues };
}
/** A document the check passes with no error. */
export function expectClean(bin: string, doc: JsonObject, what: string): void {
  const result = check(bin, doc);
  const errors = result.issues.filter((i) => i.severity === 'error');
  expect(errors.map((e) => `${e.code} ${e.ids.join(',')} ${e.path} ${brief(e.raw['what'] ?? null, 200)}`), `${what}: the check raises no error`).toEqual([]);
  expect(result.ok, `${what}: the check passes`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render path` (#160's line; README: The surface under test, for what this suite adds)

export interface Subpath { closed: boolean; verbs: string[]; points: Pt[] }
export interface End { kind: string; tip: Pt; angle: number; length: number; width: number; outline: Pt[] | null }
export interface PathFrame {
  t: number; subpaths: Subpath[]; segments: number; tessellation: string;
  ends: Record<string, End> | undefined; warpPoints: number | undefined; warpMs: number | undefined; raw: JsonObject;
}
export interface PathLine { doc: JsonObject; item: string; times?: number[]; timing?: boolean; planted?: string }
const pathInput = (l: PathLine): JsonObject => ({
  doc: l.doc, item: l.item, look: LOOK,
  ...(l.times !== undefined ? { times: l.times } : {}), ...(l.timing !== undefined ? { timing: l.timing } : {}), ...(l.planted !== undefined ? { planted: l.planted } : {}),
});
const pt = (v: JsonValue | undefined, what: string): Pt => { const a = arr(v, what); return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`)]; };

export function subpathsOf(value: JsonValue | undefined, what: string): Subpath[] {
  return arr(value, `${what}: subpaths`).map((s, i) => {
    const sp = obj(s, `${what}: subpaths[${i}]`);
    return {
      closed: sp['closed'] === true,
      verbs: arr(sp['verbs'], `${what}: subpaths[${i}].verbs`).map(String),
      points: arr(sp['points'], `${what}: subpaths[${i}].points`).map((p, k) => pt(p, `${what}: subpaths[${i}].points[${k}]`)),
    };
  });
}
function endOf(v: JsonValue | undefined, what: string): End {
  const e = obj(v, what);
  return {
    kind: String(e['kind']), tip: pt(e['tip'], `${what}.tip`), angle: num(e['angle'], `${what}.angle`),
    length: num(e['length'], `${what}.length`), width: num(e['width'], `${what}.width`),
    outline: Array.isArray(e['outline']) ? e['outline'].map((p, k) => pt(p, `${what}.outline[${k}]`)) : null,
  };
}
/** One answer of `path`, accepted, with one frame per time. */
export function pathAccepted(answer: JsonValue | undefined, times: readonly number[], what: string): PathFrame[] {
  const a = obj(answer, `path ${what}: the answer`);
  expect(a['ok'], `path ${what} is accepted: ${brief(a)}`).toBe(true);
  const frames = arr(a['frames'], `path ${what}: frames`).map((v, i): PathFrame => {
    const f = obj(v, `path ${what}: frames[${i}]`);
    const at = `path ${what}: frames[${i}]`;
    return {
      t: num(f['t'], `${at}.t`), subpaths: subpathsOf(f['subpaths'], at), segments: num(f['segments'], `${at}.segments`),
      tessellation: String(f['tessellation']),
      ends: f['ends'] === undefined ? undefined : Object.fromEntries(Object.entries(obj(f['ends'], `${at}.ends`)).map(([k, e]) => [k, endOf(e, `${at}.ends.${k}`)])),
      warpPoints: f['warp_points'] === undefined ? undefined : num(f['warp_points'], `${at}.warp_points`),
      warpMs: f['warp_ms'] === undefined ? undefined : num(f['warp_ms'], `${at}.warp_ms`),
      raw: f,
    };
  });
  expect(frames.map((f) => f.t), `path ${what}: one frame per time, in order`).toEqual([...times]);
  return frames;
}
/** `path` lines in one process, each accepted. */
export function pathAll(bin: string, lines: PathLine[], what: string): PathFrame[][] {
  const outs = batch(bin, 'path', lines.map(pathInput));
  return outs.map((o, i) => pathAccepted(o, lines[i]!.times ?? [0], `${what} (line ${i})`));
}
/** `path` lines in one process, each accepted: each line's first frame. */
export function firstFrames(bin: string, lines: PathLine[], what: string): PathFrame[] {
  return pathAll(bin, lines, what).map((f) => f[0]!);
}
/** One `path` frame at one time (0 by default), in a process of its own. */
export function pathAt(bin: string, doc: JsonObject, id: string, what: string, t = 0, planted?: string): PathFrame {
  return pathAll(bin, [{ doc, item: id, times: [t], ...(planted ? { planted } : {}) }], what)[0]![0]!;
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render raster` (#373's): the document drawn by Vello CPU at t, written as a PNG.

let rasters = 0;
export function rasterInput(dir: string, doc: JsonObject, t = 0): JsonObject {
  rasters += 1;
  return { out: join(dir, `r${process.pid}-${rasters}.png`), doc, look: LOOK, t };
}
/** The document drawn at each of `times` by one process: each PNG's path, its answer accepted. */
export function rasterPlay(bin: string, dir: string, doc: JsonObject, times: number[], what: string): string[] {
  const inputs = times.map((t) => rasterInput(dir, doc, t));
  const outs = batch(bin, 'raster', inputs);
  return inputs.map((input, i) => {
    const report = obj(outs[i], `raster ${what} at ${times[i]}: the answer`);
    expect(report['ok'], `raster ${what} at ${showTime(times[i]!)} refused: ${brief(report)}`).toBe(true);
    const file = String(input['out']);
    expect(existsSync(file), `raster ${what}: the PNG is written`).toBe(true);
    return file;
  });
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB223D', n);
/** The first-party pack of cue verbs (#222). */
export interface Pack { id: string; version: string; dir: string }
export const VERBS_PACK: Pack = { id: 'deepbuild/verbs', version: '1.0.0', dir: join(REPO, 'packs', 'verbs-1.0.0') };
export const VERBS_AT = `${VERBS_PACK.id}@${VERBS_PACK.version}`;

/** A scenario: your shell's process tree, one panel, every document a call names on it, the packs, the planted program. */
export function scenario(evidence: string, calls: JsonObject[], extra: { packs?: readonly Pack[]; planted?: string } = {}): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  return {
    evidence,
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: warps', process: { pid: 4100, start: 1_000 } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs,
    ...(extra.packs ? { packs: extra.packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}),
    ...(extra.planted ? { planted: extra.planted } : {}),
    calls,
  };
}
/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, 'deep-show run finished within its timeout').toBe(false);
  expect(r.error?.message ?? '', 'deep-show run started').toBe('');
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line').toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(out['ok'], `deep-show run accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies').map((x, i) => obj(x, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return replies;
}
/** One startup with a `registry` call: the modules the build's seal took (exit 0). */
export function sealed(bin: string, what: string): string[] {
  const reply = run(bin, scenario(tmpdir(), [{ call: 'registry' }]))[0]!;
  return arr(reply['modules'], `${what}: registry modules`).map((m) => str(m, `${what}: a module`));
}
/** `deep show` of a whole document from your shell. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
export const errorsOf = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
/**
 * Why a `deep show` reply isn't a presented document with no error, and no item of `kinds` skipped as a kind the
 * build doesn't know; empty when it is.
 */
export function notPresented(reply: JsonObject, kinds: readonly string[] = []): string[] {
  const notices = [...(Array.isArray(reply['notices']) ? reply['notices'] : []), ...(Array.isArray(reply['issues']) ? reply['issues'] : [])].filter(isObject);
  return [
    ...(reply['outcome'] === 'presented' ? [] : [`the outcome is ${brief(reply['outcome'])}: ${brief(reply, 1500)}`]),
    ...errorsOf(reply).map((i) => `the check raises an error: ${brief(i, 600)}`),
    ...notices.filter((n) => n['code'] === 'unknown_kind' && kinds.some((k) => mentions(n, k))).map((n) => `an item is skipped as an unknown kind: ${brief(n, 600)}`),
  ];
}
export function presented(reply: JsonObject, what: string, kinds: readonly string[] = []): void {
  none(notPresented(reply, kinds), `${what} is presented`);
}
/** #387's `eval` at `t` flicks; `paths` its item paths' values (#1918), `hash` the evaluated-data hash (#222), `clean` a fresh evaluation. */
export const evalAt = (doc: string, t: number, o: { paths?: string[]; hash?: boolean; clean?: boolean } = {}): JsonObject =>
  ({ call: 'eval', doc, t, ...(o.paths ? { paths: o.paths } : {}), ...(o.hash ? { data_hash: true } : {}), ...(o.clean ? { clean: true } : {}) });
function evaluated(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
}
export function valuesOf(reply: JsonObject, what: string): JsonObject {
  evaluated(reply, what);
  return obj(reply['values'], `${what}: values`);
}
export function dataHashOf(reply: JsonObject, what: string): string {
  evaluated(reply, what);
  const h = reply['data_hash'];
  expect(typeof h === 'string' && /^[0-9a-f]{32,}$/.test(h), `${what}: data_hash is a hex digest, got ${brief(h)}`).toBe(true);
  return h as string;
}
/** deep-show's `path` at t (README: what this suite adds): the item's drawn sub-paths, flattened, each a list of points. */
export const showPathCall = (doc: string, itemId: string, t: number): JsonObject => ({ call: 'path', doc, item: itemId, t });
export function showSubpaths(reply: JsonObject, what: string): Pt[][] {
  expect(reply['outcome'] === undefined || reply['outcome'] !== 'refused', `${what}: deep-show path answers the drawn path, not a refusal: ${brief(reply, 800)}`).toBe(true);
  return arr(reply['subpaths'], `${what}: subpaths`).map((s, i) => arr(s, `${what}: subpaths[${i}]`).map((p, k) => pt(p, `${what}: subpaths[${i}][${k}]`)));
}
/** One registry row of `registries` (deep://registries, #200). */
export function registryRow(reply: JsonObject, name: string): JsonObject {
  const rows = arr(reply['registries'], 'registries: registries').filter(isObject).filter((r) => r['name'] === name && r['kind'] !== 'slot');
  expect(rows.length, `deep://registries lists the registry ${name}`).toBe(1);
  return rows[0]!;
}
export interface KitResult { verdict: string; rules: { rule: string; verdict: string; message: string }[]; raw: JsonObject }
export function kitOf(v: JsonValue | undefined, what: string): KitResult {
  const o = obj(v, what);
  const rules = (Array.isArray(o['rules']) ? o['rules'] : []).filter(isObject).map((r) => ({ rule: String(r['rule']), verdict: String(r['verdict']), message: typeof r['message'] === 'string' ? r['message'] : '' }));
  return { verdict: String(o['verdict']), rules, raw: o };
}
/** The cue kit's five rules (#222). */
export const KIT_RULES = ['same_bytes', 'targets_only', 'inside_span', 'end_state', 'back_to_base'] as const;

// ---------------------------------------------------------------------------------------------------
// Geometry in f64

export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const sub2 = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
/** A direction's angle in degrees, atan2(dy, dx) in document u (y down), as #160's `ends` angles are. */
export const angleOf = (d: Pt): number => (Math.atan2(d[1], d[0]) * 180) / Math.PI;
export const angleDiff = (a: number, b: number): number => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; };

/** A sub-path's segments, each its control polygon (2 points for a line, 3 a quad, 4 a cubic); Z adds its closing line. */
export function segmentsOf(sp: Subpath): Pt[][] {
  const out: Pt[][] = [];
  let at = 0;
  let cur: Pt | null = null; let start: Pt | null = null;
  for (const v of sp.verbs) {
    if (v === 'M') { cur = sp.points[at]!; start = cur; at += 1; continue; }
    if (cur === null) throw Error('a sub-path that does not start with M');
    const n = v === 'L' ? 1 : v === 'Q' ? 2 : v === 'C' ? 3 : 0;
    if (n > 0) { const pts = sp.points.slice(at, at + n); out.push([cur, ...pts]); cur = pts[pts.length - 1]!; at += n; } else if (v === 'Z' && start) { if (dist(cur, start) > 1e-9) out.push([cur, start]); cur = start; }
  }
  return out;
}
/** A point on a segment's Bézier at parameter u. */
export function bezier(seg: Pt[], u: number): Pt {
  let pts = seg.map((p) => [p[0], p[1]] as Pt);
  while (pts.length > 1) pts = pts.slice(1).map((p, i) => [pts[i]![0] + (p[0] - pts[i]![0]) * u, pts[i]![1] + (p[1] - pts[i]![1]) * u] as Pt);
  return pts[0]!;
}
/** A sub-path flattened: each curved segment cut into `n` equal parameter steps, lines kept whole. */
export function flatten(sp: Subpath, n = 32): Pt[] {
  const segs = segmentsOf(sp);
  if (segs.length === 0) return sp.points.slice(0, 1);
  const out: Pt[] = [segs[0]![0]!];
  for (const s of segs) { const steps = s.length === 2 ? 1 : n; for (let k = 1; k <= steps; k++) out.push(bezier(s, k / steps)); }
  return out;
}
/** The on-curve points of a sub-path (M, L, and each Q's and C's end). */
export function vertices(sp: Subpath): Pt[] {
  const out: Pt[] = [];
  let at = 0;
  for (const v of sp.verbs) { const n = v === 'M' || v === 'L' ? 1 : v === 'Q' ? 2 : v === 'C' ? 3 : 0; if (n > 0) { out.push(sp.points[at + n - 1]!); at += n; } }
  return out;
}
/** `n` points along a straight line from `a` to `b`, both ends included. */
export const along = (a: Pt, b: Pt, n: number): Pt[] => Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / (n - 1), a[1] + ((b[1] - a[1]) * k) / (n - 1)] as Pt);

function pointSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}
/** The distance from a point to a polyline, by brute force. */
export function toPolyline(p: Pt, line: Pt[]): number {
  if (line.length === 1) return dist(p, line[0]!);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, pointSegment(p, line[i - 1]!, line[i]!));
  return best;
}
/**
 * Polylines indexed on a grid of `cell` u: `near(p)` is the distance to the nearest of them when it is at most `cell`,
 * else Infinity (nothing within `cell`), so a test asking "within 0.5 u" reads it exactly and a far point as far.
 */
export class Near {
  private readonly cells = new Map<string, [Pt, Pt][]>();
  private readonly cell: number;
  constructor(lines: Pt[][], cell = 2) {
    this.cell = cell;
    for (const l of lines) {
      if (l.length === 1) this.add(l[0]!, l[0]!);
      for (let i = 1; i < l.length; i++) this.add(l[i - 1]!, l[i]!);
    }
  }
  private add(a: Pt, b: Pt): void {
    const c = this.cell;
    for (let x = Math.floor(Math.min(a[0], b[0]) / c); x <= Math.floor(Math.max(a[0], b[0]) / c); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1]) / c); y <= Math.floor(Math.max(a[1], b[1]) / c); y++) {
        const k = `${x},${y}`;
        const list = this.cells.get(k);
        if (list) list.push([a, b]); else this.cells.set(k, [[a, b]]);
      }
    }
  }
  near(p: Pt): number {
    const cx = Math.floor(p[0] / this.cell); const cy = Math.floor(p[1] / this.cell);
    let best = Infinity;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (const [a, b] of this.cells.get(`${x},${y}`) ?? []) best = Math.min(best, pointSegment(p, a, b));
    return best <= this.cell ? best : Infinity;
  }
}
/** The largest distance from any of `points` to `index`, and where (Infinity: farther than the index's cell). */
export function farthest(points: Pt[], index: Near): { d: number; at: Pt } {
  let worst = { d: 0, at: points[0] ?? ([0, 0] as Pt) };
  for (const p of points) { const d = index.near(p); if (d > worst.d) worst = { d, at: p }; }
  return worst;
}
/** Points along polylines at most `step` u apart (vertices included). */
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
/** Both ways between two sets of polylines: each point of either (sampled every 0.25 u) within `tol` u of the other. */
export function bothWays(drawn: Pt[][], want: Pt[][], tol: number, what: string): string[] {
  const failures: string[] = [];
  const show = (d: number): string => (Number.isFinite(d) ? `${d.toFixed(3)} u` : 'more than 2 u');
  const a = farthest(densify(drawn), new Near(want));
  if (a.d > tol) failures.push(`${what}: the drawn path strays ${show(a.d)} from the expected image, at (${a.at.map(short).join(', ')})`);
  const b = farthest(densify(want), new Near(drawn));
  if (b.d > tol) failures.push(`${what}: the expected image lies ${show(b.d)} from the drawn path, at (${b.at.map(short).join(', ')})`);
  return failures;
}
/** Where two polylines cross first, with the directions of the two segments that cross; null when they don't. */
export function crossing(a: Pt[], b: Pt[]): { at: Pt; da: Pt; db: Pt } | null {
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!; const r = sub2(a[i]!, p);
    for (let j = 1; j < b.length; j++) {
      const q = b[j - 1]!; const s = sub2(b[j]!, q);
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-15) continue;
      const qp = sub2(q, p);
      const t = (qp[0] * s[1] - qp[1] * s[0]) / den; const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { at: [p[0] + t * r[0], p[1] + t * r[1]], da: r, db: s };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// PNG: a reader for what the raster writes (8-bit RGB or RGBA, no interlace), and an animated-PNG writer.

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
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; } else if (type === 'IDAT') data.push(body); else if (type === 'IEND') break;
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
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
export const readPng = (path: string): Image => decodePng(readFileSync(path));
/** Ink's coverage of pixel (x, y), black ink over the white ground: (255 − red) ÷ 255. */
export const coverage = (image: Image, x: number, y: number): number => (255 - image.rgba[(y * image.width + x) * 4]!) / 255;

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([head, typed, crc]);
}
const scanlines = (img: Image): Buffer => {
  const out = Buffer.alloc(img.height * (img.width * 4 + 1));
  for (let y = 0; y < img.height; y++) Buffer.from(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4)).copy(out, y * (img.width * 4 + 1) + 1);
  return out;
};
/** An animated PNG of `frames` (each the canvas's own frame, unchanged) at `fps`, played once. */
export function apng(frames: Image[], fps: number): Buffer {
  const first = frames[0]!;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(first.width, 0); ihdr.writeUInt32BE(first.height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(1, 4);
  const parts: Buffer[] = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(f.width, 4); fctl.writeUInt32BE(f.height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = deflateSync(scanlines(f));
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as #160's suite).

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
    model = sh('sysctl', '-n', 'hw.model'); chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30); power = sh('pmset', '-g'); therm = sh('pmset', '-g', 'therm');
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

// ---------------------------------------------------------------------------------------------------
// The documents the criteria describe (README: Fixtures)

/** Criterion 1's grid: 21 × 21 lines over the plane's [−1, 1] square, in u (x 300 … 500, y 200 … 400, step 10). */
export const GRID_X: [number, number, number] = [300, 500, 10];
export const GRID_Y: [number, number, number] = [200, 400, 10];
/** The z² warp (criterion 1), mixed by `mix` (a number, or omitted for its default). */
export const Z_SQUARED = (mix: number | null = 1): JsonObject => ({ complex: { f: 'cmul(z, z)' }, ...(mix === null ? {} : { mix }), plane: planeJson(PLANE) });
/** The 21 × 21 grid under `warp` (none: the same grid in a plain group). */
export function gridDoc(id: string, warp: JsonObject | null, extra: JsonObject = {}, more: JsonObject[] = []): JsonObject {
  return figure(id, [800, 600], [warpGroup('g', warp), gridItem('grid', 'a1', GRID_X, GRID_Y, 1, { parent: 'g' }), ...more], extra);
}

/** Criterion 4's homotopy: (x, y + 1.5·u·sin(2x − 6u)), u read from t in seconds through `vars`, over 1 s. */
export const HOMOTOPY_Y = 'y + 1.5 * u * sin(2 * x - 6 * u)';
export const homotopyAt = (u: number) => (q: Pt): Pt => [q[0], q[1] + 1.5 * u * Math.sin(2 * q[0] - 6 * u)];
/** The homotopy on the horizontal line y = 0 from x = −3 to 3 (u 100 … 700 at y 300), stroked 4 u; `mixKeys` keys its mix. */
export function homotopyDoc(id: string, mixKeys: [number, number][] | null = null): JsonObject {
  const warp: JsonObject = { map: { x: 'x', y: HOMOTOPY_Y }, vars: { u: 'time' }, mix: mixKeys ? 0 : 1, plane: planeJson(PLANE) };
  return figure(id, [800, 600], [warpGroup('g', warp), pathItem('line', 'a1', 'M 100 300 L 700 300', 4, {}, { parent: 'g' })], {
    transport: { span: '1s' }, ...(mixKeys ? { channels: { mix: keyed('items/g/params/warp/mix', mixKeys) } } : {}),
  });
}

/** Criterion 5's shear: `linear {matrix: [[1, 1], [0, 1]]}`, x' = x + y in the plane. */
export const SHEAR = [[1, 1], [0, 1]];
/** An arrow up the plane's y axis from (0, −1) to (0, 1) (u 400, 400 → 400, 200), stroke 3, `ends: {end: arrow, size: 4}`. */
export function arrowDoc(id: string, ends: 'redraw' | 'warp' | null): JsonObject {
  const warp: JsonObject | null = ends ? { linear: { matrix: SHEAR }, mix: 1, plane: planeJson(PLANE), ends } : null;
  return figure(id, [800, 600], [warpGroup('g', warp), pathItem('arrow', 'a1', 'M 400 400 L 400 200', 3, { ends: { end: 'arrow', size: 4 } }, { parent: 'g' })]);
}

/** A grid's lines as straight segments in u: each vertical line x = a over [y0, y1], then each horizontal one. */
export function gridLines(x: [number, number, number], y: [number, number, number]): Pt[][] {
  const out: Pt[][] = [];
  for (let a = x[0]; a <= x[1] + 1e-9; a += x[2]) out.push([[a, y[0]], [a, y[1]]]);
  for (let b = y[0]; b <= y[1] + 1e-9; b += y[2]) out.push([[x[0], b], [x[1], b]]);
  return out;
}
/** A straight segment's image under a screen map, as `n` points. */
export const imageOf = (seg: Pt[], f: (s: Pt) => Pt, n: number): Pt[] => along(seg[0]!, seg[1]!, n).map(f);

/** Where the taste call's pictures are kept (README: The taste call). */
export const evidenceDir = (): string => process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-223-taste');
