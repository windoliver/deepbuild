// Test-side tools for the #225 acceptance tests (README: The surface under test): the deep-show builds (the full set,
// the full set without the data module, the planted motion, a release build for the budget and a linux/amd64 build in
// Docker for the second machine), the scenario calls they answer, the documents the criteria describe, generated here,
// and the f64 references the expected values come from. Nothing here stands in for the vector field: every value a
// test compares comes from a binary, every expected value from the issue's text computed here. Parts are copied from
// the #223, #142, #226 and #408 suites' helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/225 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes this timeout: a first build of deep-show takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/**
 * Each criterion's ID: `#225.` and the first 8 hex digits of SHA-256 of its text as the issue's `- [ ]` line holds
 * it, trimmed, whitespace collapsed (scripts/proof-change.mjs, criterionId).
 */
export const AC = {
  1: 'AC1 #225.e195f5ff',
  2: 'AC2 #225.69823b27',
  3: 'AC3 #225.174320e5',
  4: 'AC4 #225.8a53ced7',
  5: 'AC5 #225.eb041fdb',
  6: 'AC6 #225.18b68534',
  7: 'AC7 #225.57b5ccba',
  8: 'AC8 #225.b55d3896',
} as const;
/** The criterion ID alone, `#225.<h8>`. */
export const idOf = (n: keyof typeof AC): string => AC[n].split(' ')[1]!;

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
/** A list of numbers. */
export const nums = (v: JsonValue | undefined, what: string): number[] => arr(v, what).map((x, i) => num(x, `${what}[${i}]`));
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
/** A step that needs what this machine can't reach fails with this and one ask, never passes. */
export function blocked(reason: string, unblock: string): never {
  expect.fail(`BLOCKED: ${reason}\nUnblock: ${unblock}`);
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick)

export const FLICKS = 705_600_000;
/** Seconds to whole flicks. */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** Whole-flick times of every frame at `fps` from 0 to `seconds`, both ends included. */
export const frameTimes = (fps: number, seconds: number): number[] => Array.from({ length: Math.round(fps * seconds) + 1 }, (_, k) => Math.round((k * FLICKS) / fps));

// ---------------------------------------------------------------------------------------------------
// Builds (README: Run). Each binary is built once per file and copied out of the target folder right after its build,
// since the deep-show builds share one output path.

export type Bin = 'show' | 'show-release' | 'show-no-data' | 'show-plant';
const CARGO: Record<Bin, { args: string[]; release: boolean }> = {
  show: { args: ['--no-default-features', '--features', 'full'], release: false },
  'show-release': { args: ['--no-default-features', '--features', 'full'], release: true },
  // The full set without the data module (#489's test feature).
  'show-no-data': { args: ['--no-default-features', '--features', 'full,test-leave-out-data'], release: false },
  // The same with the planted motion module that registers follow_stream itself (README: The planted programs).
  'show-plant': { args: ['--no-default-features', '--features', 'full,test-leave-out-data,test-follow-stream-in-motion'], release: false },
};
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
export const cargoArgs = (bin: Bin): string[] => ['build', '--locked', ...(CARGO[bin].release ? ['--release'] : []), '--bin', 'deep-show', ...CARGO[bin].args];

/** Builds `bin` and copies it into `dir`: its path, or cargo's error. */
function buildInto(bin: Bin, dir: string): { path: string; error: string } {
  const args = cargoArgs(bin);
  const rustup = '/opt/homebrew/opt/rustup/bin';
  const env = { ...process.env, ...CARGO_ENV, PATH: existsSync(rustup) ? `${rustup}${delimiter}${process.env['PATH'] ?? ''}` : (process.env['PATH'] ?? '') };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const path = join(dir, bin);
  copyFileSync(join(TARGET, CARGO[bin].release ? 'release' : 'debug', 'deep-show'), path);
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
    dir = mkdtempSync(join(tmpdir(), 'deep-225-bin-'));
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

/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-225-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
/** The suite's one document ID per scenario. */
export const DOC = '01JB225D000000000000000001';

/** A scenario: your shell's process tree, one panel, the document the calls name, and the planted program if any. */
export function scenario(evidence: string, calls: JsonObject[], planted?: string): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  return {
    evidence,
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: vector fields', process: { pid: 4100, start: 1_000 } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs,
    ...(planted ? { planted } : {}),
    calls,
  };
}
/** The answer line of a `deep-show run` process, accepted, with one reply per call. */
function answerOf(r: { status: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }, calls: number, what: string): JsonObject[] {
  expect(r.timedOut, `${what} finished within its timeout`).toBe(false);
  expect(r.status, `${what} exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-3000)}`).toBe(0);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one output line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what} accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls);
  return replies;
}
/** One `deep-show run` process on this machine: its replies, one per call. */
export function run(bin: string, sc: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut || r.error === undefined, `deep-show run started: ${r.error?.message ?? ''}`).toBe(true);
  return answerOf({ status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut }, arr(sc['calls'], 'the calls').length, 'deep-show run');
}
/** `deep show` of a whole document from your shell. */
export const present = (document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc: DOC, document, include: ['issues'] });
export const errorsOf = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
/** Why a `deep show` reply isn't a presented document with no error and no vector field skipped as unknown; [] when it is. */
export function notPresented(reply: JsonObject): string[] {
  const notices = [...(Array.isArray(reply['notices']) ? reply['notices'] : []), ...(Array.isArray(reply['issues']) ? reply['issues'] : [])].filter(isObject);
  return [
    ...(reply['outcome'] === 'presented' ? [] : [`the outcome is ${brief(reply['outcome'])}: ${brief(reply, 1500)}`]),
    ...errorsOf(reply).map((i) => `the check raises an error: ${brief(i, 600)}`),
    ...notices.filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped as an unknown kind: ${brief(n, 600)}`),
  ];
}
export function presented(reply: JsonObject, what: string): void {
  none(notPresented(reply), `${what} is presented`);
}
/** #387's `eval` at `t` flicks: `paths` its item paths' values (#1918), `hash` the evaluated-data hash (#222), `clean` a fresh evaluation, `pixels` a snapshot. */
export const evalAt = (t: number, o: { paths?: string[]; hash?: boolean; clean?: boolean; pixels?: [number, number] } = {}): JsonObject => ({
  call: 'eval', doc: DOC, t, ...(o.paths ? { paths: o.paths } : {}), ...(o.hash ? { data_hash: true } : {}), ...(o.clean ? { clean: true } : {}),
  ...(o.pixels ? { pixels: true, size: [...o.pixels] } : {}),
});
function evaluated(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
  return reply;
}
export const valuesOf = (reply: JsonObject, what: string): JsonObject => obj(evaluated(reply, what)['values'], `${what}: values`);
export function dataHashOf(reply: JsonObject, what: string): string {
  const h = evaluated(reply, what)['data_hash'];
  expect(typeof h === 'string' && /^[0-9a-f]{32,}$/.test(h), `${what}: data_hash is a hex digest, got ${brief(h)}`).toBe(true);
  return h as string;
}
/** An item's evaluated position, read through `eval`'s `paths` as `items/<id>/at/pos`. */
export function posOf(reply: JsonObject, id: string, what: string): number[] {
  return nums(valuesOf(reply, what)[`items/${id}/at/pos`], `${what}: items/${id}/at/pos`);
}
/** A snapshot's sha256 from an `eval` with `pixels`. */
export function snapshotOf(reply: JsonObject, what: string): string {
  const list = arr(evaluated(reply, what)['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what}: one snapshot`).toBe(1);
  return str(obj(list[0], `${what}: snapshots[0]`)['sha256'], `${what}: the snapshot's sha256`);
}
/** A snapshot's PNG bytes from the evidence store, checked against its name. */
export function pngOf(evidence: string, sha: string, what: string): Buffer {
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the snapshot ${sha} is in the evidence store`).toBe(true);
  const file = readFileSync(path);
  expect(sha256(file), `${what}: the stored file hashes to its name`).toBe(sha);
  return file;
}
/** One registry row of `registries` (deep://registries, #200). */
export function registryRow(reply: JsonObject, name: string): JsonObject {
  const rows = arr(reply['registries'], 'registries: registries').filter(isObject).filter((r) => r['name'] === name && r['kind'] !== 'slot');
  expect(rows.length, `deep://registries lists the registry ${name}`).toBe(1);
  return rows[0]!;
}
/** An entry's filling module in a registry row; null when the row holds no entry of that name. */
export function entryModule(row: JsonObject, name: string): string | null {
  const e = arr(row['entries'], 'the row\'s entries').filter(isObject).find((x) => x['name'] === name);
  return e ? String(e['module']) : null;
}
/** An interface's digest, from deep://schedule (#185): `interfaces["<name>"].digest`; null when the build lacks it. */
export function digestOf(reply: JsonObject, name: string): string | null {
  const i = obj(reply['interfaces'], 'deep://schedule interfaces')[name];
  return i === undefined ? null : str(obj(i, `interfaces["${name}"]`)['digest'], `interfaces["${name}"].digest`);
}
/** deep-show's `path` at t (#223): the item's drawn sub-paths, flattened, each a list of points in document u. */
export const pathCall = (item: string, t: number): JsonObject => ({ call: 'path', doc: DOC, item, t });
export type Pt = [number, number];
export function subpathsOf(reply: JsonObject, what: string): Pt[][] {
  expect(reply['outcome'] !== 'refused', `${what}: deep-show path answers the drawn path, not a refusal: ${brief(reply, 800)}`).toBe(true);
  return arr(reply['subpaths'], `${what}: subpaths`).map((s, i) => arr(s, `${what}: subpaths[${i}]`).map((p, k) => { const q = nums(p, `${what}: subpaths[${i}][${k}]`); return [q[0]!, q[1]!] as Pt; }));
}

// ---------------------------------------------------------------------------------------------------
// `{"call": "vector_field", doc, item, t}` (README: The surface under test): the item's integrated streams, its
// arrows at t and its flow's trim windows at t.

export interface Stream { id: string; points: number[][]; bytes: string }
export interface Arrow { at: number[]; vector: number[]; length: number; roles: string[]; mix: number }
export interface Field { dims: number; streams: Stream[]; arrows: Arrow[]; trims: [number, number][]; integrateMs: number; raw: JsonObject }
export const fieldCall = (item: string, t = 0): JsonObject => ({ call: 'vector_field', doc: DOC, item, t });
export function fieldOf(reply: JsonObject, what: string): Field {
  expect(reply['outcome'], `${what}: vector_field answers the item: ${brief(reply, 800)}`).toBe('answered');
  const dims = num(reply['dims'], `${what}: dims`);
  const streams = arr(reply['streams'], `${what}: streams`).map((v, i) => {
    const s = obj(v, `${what}: streams[${i}]`);
    return { id: str(s['id'], `${what}: streams[${i}].id`), points: arr(s['points'], `${what}: streams[${i}].points`).map((p, k) => nums(p, `${what}: streams[${i}].points[${k}]`)), bytes: str(s['bytes'], `${what}: streams[${i}].bytes`) };
  });
  const arrows = arr(reply['arrows'], `${what}: arrows`).map((v, i) => {
    const a = obj(v, `${what}: arrows[${i}]`);
    const c = obj(a['color'], `${what}: arrows[${i}].color`);
    return {
      at: nums(a['at'], `${what}: arrows[${i}].at`), vector: nums(a['vector'], `${what}: arrows[${i}].vector`), length: num(a['length'], `${what}: arrows[${i}].length`),
      roles: arr(c['roles'], `${what}: arrows[${i}].color.roles`).map((r) => str(r, `${what}: arrows[${i}].color.roles[]`)), mix: num(c['mix'], `${what}: arrows[${i}].color.mix`),
    };
  });
  const trims = arr(reply['trims'], `${what}: trims`).map((v, i) => { const w = nums(v, `${what}: trims[${i}]`); expect(w.length, `${what}: trims[${i}] is [from, to]`).toBe(2); return [w[0]!, w[1]!] as [number, number]; });
  return { dims, streams, arrows, trims, integrateMs: num(reply['integrate_ms'], `${what}: integrate_ms`), raw: reply };
}
/** A stream's bytes (base64) read as little-endian f64 values. */
export function f64s(bytes: string): number[] {
  const b = Buffer.from(bytes, 'base64');
  return Array.from({ length: Math.floor(b.length / 8) }, (_, i) => b.readDoubleLE(i * 8));
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures): films as your shell sends them to `deep show` (#393): no `id`, no `layers`.

/** A film of `size` u, its items in order, `extra` adding `transport`, `constraints` and the rest. */
export function film(title: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `The vector field acceptance suite's ${title}.`, size, transport: { span: '1s' },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export function item(id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject {
  return { id, kind, name: `Item ${id}`, order, params, ...extra };
}
/** A vector_field@1 (README: Documents). */
export const field = (id: string, order: string, params: JsonObject): JsonObject => item(id, 'vector_field@1', order, params);
/** The field (−y, x), and its half. */
export const SWIRL: JsonObject = { x: '-y', y: 'x' };
export const HALF_SWIRL: JsonObject = { x: '-y / 2', y: 'x / 2' };
/** The Lorenz system, σ 10, ρ 28, β 8/3. */
export const LORENZ: JsonObject = { x: '10 * (y - x)', y: 'x * (28 - z) - y', z: 'x * y - 8 / 3 * z' };
/** The four ramp roles criterion 2 names role 1 to role 4. */
export const RAMP = ['term_blue', 'term_cyan', 'term_yellow', 'term_red'];
/** A small dot, a circle@1 at its item origin, so its `at.pos` is where it sits. */
export const dot = (id: string, order: string, r = 0.05): JsonObject => item(id, 'circle@1', order, { center: [0, 0], r, paint: { fill: { role: 'ink' } } });
/** A follow_stream constraint (Constraint): `owner` rides the stream of `fieldId` from `from`. */
export const followStream = (owner: string, fieldId: string, from: number[], o: { speed?: number; time_offset?: number } = {}): JsonObject =>
  ({ owner, kind: 'follow_stream', vector_field: fieldId, from, ...o });
/** A linear scale@1 (#167's spelling). */
export const scale = (id: string, order: string, domain: [number, number], range: [number, number]): JsonObject =>
  item(id, 'scale@1', order, { type: 'linear', domain, range, nice: false });
/** A path@1 from an SVG `d`, stroked in ink. */
export const pathItem = (id: string, order: string, d: string, extra: JsonObject = {}): JsonObject => item(id, 'path@1', order, { d, paint: { stroke: { role: 'ink', width: 2 } } }, extra);

/** The warp plane (Frame and group: warp): coordinates are offsets from `origin` in `unit`s, y up. */
export interface Plane { origin: Pt; unit: number }
export const toScreen = (p: Plane, q: Pt): Pt => [p.origin[0] + q[0] * p.unit, p.origin[1] - q[1] * p.unit];
export const toPlane = (p: Plane, s: Pt): Pt => [(s[0] - p.origin[0]) / p.unit, (p.origin[1] - s[1]) / p.unit];
/** A group whose identity linear warp flows along `streams` for `time` (#223's spelling); with `time` null, no flow. */
export function flowGroup(id: string, order: string, plane: Plane, streams: string, time: number | null): JsonObject {
  const warp: JsonObject = { linear: { matrix: [[1, 0], [0, 1]] }, mix: 1, plane: { origin: [...plane.origin], unit: plane.unit, y: 'up' } };
  if (time !== null) warp['flow'] = { streams, time };
  return item(id, 'group@1', order, { warp });
}

// ---------------------------------------------------------------------------------------------------
// f64 references

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));
/** The exact flow of (−y, x): a turn by t. */
export const turn = (p: Pt, t: number): Pt => [p[0] * Math.cos(t) - p[1] * Math.sin(t), p[0] * Math.sin(t) + p[1] * Math.cos(t)];
/** fract(x), in [0, 1). */
export const fract = (x: number): number => x - Math.floor(x);
/** The distance from x to y on the circle of length 1. */
export const circular = (x: number, y: number): number => { const d = fract(x - y); return Math.min(d, 1 - d); };
/** A test-side RK4 of `f` from `p` at `h`, `n` steps: the points, the start included. */
export function rk4(f: (p: number[]) => number[], p: number[], h: number, n: number): number[][] {
  const out = [p];
  let q = p;
  const add = (a: number[], b: number[], s: number): number[] => a.map((v, i) => v + s * b[i]!);
  for (let k = 0; k < n; k++) {
    const k1 = f(q); const k2 = f(add(q, k1, h / 2)); const k3 = f(add(q, k2, h / 2)); const k4 = f(add(q, k3, h));
    q = q.map((v, i) => v + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));
    out.push(q);
  }
  return out;
}
export const lorenz = (p: number[]): number[] => [10 * (p[1]! - p[0]!), p[0]! * (28 - p[2]!) - p[1]!, p[0]! * p[1]! - (8 / 3) * p[2]!];

/** The distance from p to the polyline `line`. */
function toPolyline(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!; const b = line[i + 1]!;
    const d: Pt = [b[0] - a[0], b[1] - a[1]]; const l2 = d[0] * d[0] + d[1] * d[1];
    const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2));
    best = Math.min(best, dist(p, [a[0] + u * d[0], a[1] + u * d[1]]));
  }
  return line.length === 1 ? dist(p, line[0]!) : best;
}
/** A polyline's points every `step` u along it, its corners included. */
const densify = (line: Pt[], step = 0.25): Pt[] => line.flatMap((a, i) => {
  const b = line[i + 1];
  if (!b) return [a];
  const n = Math.max(1, Math.ceil(dist(a, b) / step));
  return Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] as Pt);
});
/** A drawn line and a wanted one within `tol` of each other both ways (Hausdorff); the failures name `what` and where. */
export function bothWays(drawn: Pt[], want: Pt[], tol: number, what: string): string[] {
  const show = (p: Pt): string => `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`;
  const out: string[] = [];
  const far = densify(drawn).map((p) => [p, toPolyline(p, want)] as const).reduce((m, x) => (x[1] > m[1] ? x : m), [[0, 0] as Pt, -1] as const);
  if (!(far[1] <= tol)) out.push(`${what}: drawn at ${show(far[0])}, ${far[1].toFixed(3)} u from where it should be`);
  const miss = densify(want).map((p) => [p, toPolyline(p, drawn)] as const).reduce((m, x) => (x[1] > m[1] ? x : m), [[0, 0] as Pt, -1] as const);
  if (!(miss[1] <= tol)) out.push(`${what}: nothing drawn within ${tol} u of ${show(miss[0])} (${miss[1].toFixed(3)} u off)`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// PNG: a reader for the canvas's snapshots (8-bit RGB or RGBA, no interlace), and an animated-PNG writer.

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; } else if (type === 'IDAT') data.push(body); else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
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
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([head, typed, crc]);
}
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
    const lines = Buffer.alloc(f.height * (f.width * 4 + 1));
    for (let y = 0; y < f.height; y++) Buffer.from(f.rgba.subarray(y * f.width * 4, (y + 1) * f.width * 4)).copy(lines, y * (f.width * 4 + 1) + 1);
    const data = deflateSync(lines);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end).

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
/** Why the lane can't judge a timing on this machine now ('' when it can): judgeLimit on five zero runs at this load. */
export async function timingProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}

// ---------------------------------------------------------------------------------------------------
// The second machine: the checkout built for linux/amd64 in Docker with the rust image of rust-toolchain.toml's
// channel, its caches under target/acceptance-225-linux/, as #408's suite runs its Linux half. Nothing is pulled.

const LINUX = join(TARGET, 'acceptance-225-linux');
interface Started { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string }
function docker(args: string[], input?: string, timeoutMs = 600_000): Started {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, signal: null, timedOut, stdout: '', stderr: r.error.message };
  return { status: r.status, signal: r.signal, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
export function linuxImage(): string {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
/** Why the linux/amd64 machine can't run here (no Docker, or no image), or null when it can. */
export function linuxMissing(): string | null {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
  if (info.status !== 0) return `Docker is unreachable (${info.stderr.trim().split('\n').slice(-1)[0] ?? ''})`;
  const image = linuxImage();
  const arch = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  const any = arch.status === 0 ? arch : docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (any.stdout.trim() !== 'amd64') return `Docker has no linux/amd64 image ${image}, and this suite pulls nothing`;
  return null;
}
/** Builds the full deep-show for linux/amd64: cargo's error, or ''. */
export function buildLinux(): string {
  const image = linuxImage();
  for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
  const r = docker([
    'run', '--rm', '--platform', 'linux/amd64',
    '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
    '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
    '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${image.replace(/^rust:/, '').replace(/-slim-bookworm$/, '')}`,
    '-e', `CARGO_INCREMENTAL=${CARGO_ENV.CARGO_INCREMENTAL}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV.CARGO_PROFILE_DEV_DEBUG}`,
    image, 'cargo', ...cargoArgs('show'),
  ], undefined, 3 * TIMEOUT);
  return r.status === 0 ? '' : `cargo ${cargoArgs('show').join(' ')} in ${image} (linux/amd64) failed${r.timedOut ? ' (timed out)' : ''}:\n${r.stderr.slice(-4000)}`;
}
/** One `deep-show run` process in a linux/amd64 container, the checkout read-only, `evidence` as its store. */
export function runLinux(sc: JsonObject, evidence: string): JsonObject[] {
  const r = docker([
    'run', '--rm', '-i', '--platform', 'linux/amd64', '--network', 'none', '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target:ro`, '-v', `${evidence}:/evidence`,
    '-w', '/src', linuxImage(), '/target/debug/deep-show', 'run',
  ], `${JSON.stringify({ ...sc, evidence: '/evidence' })}\n`, 1_800_000);
  return answerOf(r, arr(sc['calls'], 'the calls').length, 'deep-show run on linux/amd64');
}
