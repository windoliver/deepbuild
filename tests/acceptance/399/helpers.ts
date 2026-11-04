// Test-side tools for the #399 acceptance tests: the binaries (deep-graph, deep-canvas-render, deep-layout, and
// deep-show per feature set, debug or release with a kit ledger) built and driven by JSON lines; the documents these
// tests send, generated here so every item is readable; PNG reading; geometry on boxes and routes; the reference-Mac
// gate and the design's judge for timings; and the M4 reference ported from tsdownsample. Nothing here stands in for
// the layout, the router, the placer, the decimator, the crosshair or the kit under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
/** `[x, y, w, h]`, y down. */
export type Box = [number, number, number, number];
export type Point = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/399 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 1_800_000;
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};
const targetDir = (root = REPO): string => (root === REPO && process.env['CARGO_TARGET_DIR']) || join(root, 'target');

// ---------------------------------------------------------------------------------------------------
// JSON

export const show = (value: unknown, n = 1500): string => JSON.stringify(value)?.slice(0, n) ?? String(value);
export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value, 600)}`).toBe('string');
  return value as string;
}
export function box(value: JsonValue | undefined, what: string): Box {
  const b = arr(value, what);
  expect(b.length, `${what} is [x, y, w, h]`).toBe(4);
  return b.map((v, i) => num(v, `${what}[${i}]`)) as Box;
}
export function points(value: JsonValue | undefined, what: string): Point[] {
  return arr(value, what).map((p, i) => {
    const q = arr(p, `${what}[${i}]`);
    expect(q.length, `${what}[${i}] is [x, y]`).toBe(2);
    return [num(q[0], `${what}[${i}][0]`), num(q[1], `${what}[${i}][1]`)] as Point;
  });
}
/** Every string anywhere inside a JSON value, outside the human-readable `what` and `fix`. */
export function strings(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isObject(value)) return Object.entries(value).filter(([k]) => k !== 'what' && k !== 'fix').flatMap(([, v]) => strings(v));
  return [];
}
export function fixture(name: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonValue, `fixture ${name}`);
}
export const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Builds: each binary once per file, copied out under its own name; a failed build fails each test that uses it.

function cargo(args: string[], root = REPO, env: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync('cargo', args, { cwd: root, env: { ...CARGO_ENV, ...env }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const lines = r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(0, 4000)}`;
}

export type Bin = 'deep-graph' | 'deep-canvas-render' | 'deep-layout';
/** Builds each binary once before the file's tests (debug, `--locked`); `path(bin)` fails the test when its build failed. */
export function useBins(bins: Bin[]): (bin: Bin) => string {
  const made = new Map<Bin, { path: string; error: string }>();
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-399-bins-'));
    for (const bin of bins) {
      const error = cargo(['build', '--locked', '--bin', bin]);
      const path = join(dir, bin);
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe(bin)), path);
      made.set(bin, { path, error });
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin) => {
    const m = made.get(bin);
    if (!m) throw Error(`the file didn't list the build ${bin}`);
    expect(m.error, `the binary builds: ${bin}`).toBe('');
    return m.path;
  };
}

/** A fresh temporary folder per test, deleted after it. */
export function useTemp(prefix: string): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), `deep-399-${prefix}-`)); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export interface Ran { status: number | null; stdout: string; stderr: string; ms: number }
export function spawn(bin: string, args: string[], input: string, timeout = TIMEOUT): Ran {
  const t0 = performance.now();
  const r = spawnSync(bin, args, { cwd: REPO, input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${bin.split('/').pop()} ${args.join(' ')}: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: performance.now() - t0 };
}

/** One run of `bin args`, the inputs as JSON lines on stdin: one JSON line out per line in, in order, exit 0. */
export function lines(bin: string, args: string[], inputs: (JsonValue | string)[]): JsonObject[] {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const r = spawn(bin, args, `${text}\n`);
  const name = `${bin.split('/').pop()} ${args.join(' ')}`;
  expect(r.status, `${name} exits 0: ${r.stderr.slice(0, 2000)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${name}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `${name}: answer ${i}`));
}
/** One line that must be accepted (`ok: true`). */
export function accepted(bin: string, args: string[], input: JsonValue, what: string): JsonObject {
  const [out] = lines(bin, args, [input]);
  expect(out!['ok'], `${what}: accepted, got ${show(out, 2500)}`).toBe(true);
  return out!;
}
/** A line naming an unknown `planted` value answers `bad_input` (#391's convention). */
export function expectBadPlanted(bin: string, args: string[], input: JsonObject): void {
  const [out] = lines(bin, args, [{ ...input, planted: 'no_such_plant' }]);
  expect([out!['ok'], out!['code']], `${args.join(' ')} answers bad_input to an unknown planted value`).toEqual([false, 'bad_input']);
}

// ---------------------------------------------------------------------------------------------------
// deep-show (#185's interfaces, #138's kit): per feature set, debug or release with DEEP_KIT_LEDGER.

export const SHOW = 'deep-show';
function showBuild(features: string[], release: boolean, copyTo: string, env: NodeJS.ProcessEnv = {}): string {
  const error = cargo(['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', features.join(',')], REPO, env);
  if (error === '') copyFileSync(join(targetDir(), release ? 'release' : 'debug', exe(SHOW)), copyTo);
  return error;
}
/** Debug builds of `deep-show` per feature set, made before the file's tests. */
export function useShowBuilds(sets: string[][]): { bin: (features: string[]) => string } {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-399-show-'));
    for (const f of sets) {
      const bin = join(dir, `${SHOW}-${f.join('+')}`);
      made.set(f.join(','), { bin, error: showBuild(f, false, bin) });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(features) {
      const m = made.get(features.join(','));
      if (!m) throw Error(`the file didn't build ${features.join(',')}`);
      expect(m.error, `the binary builds: ${SHOW} with features ${features.join(',')}`).toBe('');
      return m.bin;
    },
  };
}
/** A release build embedding the kit ledger at `ledger` (#138: DEEP_KIT_LEDGER at build time). */
export function releaseBuild(features: string[], ledger: string, dir: string): { bin: string; error: string } {
  const bin = join(dir, `${SHOW}-release-${features.join('+')}`);
  return { bin, error: showBuild(features, true, bin, { DEEP_KIT_LEDGER: ledger }) };
}
/** `deep-show run`: one scenario `{evidence, calls}`, accepted, one reply per call, exit 0. */
export function showRun(bin: string, evidence: string, calls: JsonObject[]): JsonObject[] {
  const r = spawn(bin, ['run'], `${JSON.stringify({ evidence, calls })}\n`, 7_200_000);
  expect(r.status, `${SHOW} run starts and exits 0; stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(0, 1500)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${SHOW} run: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(answer['ok'], `${SHOW} run refused the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((x, i) => obj(x, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
/** A startup the seal refuses: one `{"ok": false, "code": "seal_refused", …}` line and exit 2 (#305, #185, #138). */
export function startupRefusal(bin: string, evidence: string): JsonObject {
  const r = spawn(bin, ['run'], `${JSON.stringify({ evidence, calls: [{ call: 'registry' }] })}\n`);
  expect(r.status, `${SHOW} refuses to start (exit 2); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(0, 1000)}`).toBe(2);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `the refusal is one JSON line: ${r.stdout.slice(0, 1500)}`).toBe(1);
  const raw = obj(JSON.parse(out[0]!) as JsonValue, 'the refusal line');
  expect([raw['ok'], raw['code']], `the refusal is the seal's: ${show(raw)}`).toEqual([false, 'seal_refused']);
  return raw;
}
/** #138's `kit` call, with the suite's smaller fuzz sizes (the planted faults don't depend on them). */
export const kitCall = (options: { modules?: string[]; ledger?: string } = {}): JsonObject => ({
  call: 'kit', sequences: 100, param_sets: 50, ...(options.modules ? { modules: options.modules } : {}), ...(options.ledger ? { ledger: options.ledger } : {}),
});
export interface Interface { digest: string; reference: string; kit: string[]; behavior: string; module: string; implementation: { name: string; version: string; equivalence: string; state: string } }
/** `interfaces["name@major"]` of a `schedule` reply (the published plan, #185). */
export function interfaceIn(schedule: JsonObject, name: string): Interface {
  const all = obj(schedule['interfaces'], 'schedule: interfaces');
  const i = obj(all[name], `schedule: interfaces["${name}"] (it holds ${Object.keys(all).join(', ')})`);
  const impl = obj(i['implementation'], `${name}.implementation`);
  return {
    digest: str(i['digest'], `${name}.digest`), reference: str(i['reference'], `${name}.reference`),
    kit: arr(i['kit'], `${name}.kit`).map((p, k) => str(p, `${name}.kit[${k}]`)), behavior: str(i['behavior'], `${name}.behavior`),
    module: str(i['module'], `${name}.module`),
    implementation: {
      name: str(impl['name'], `${name}.implementation.name`), version: str(impl['version'], `${name}.implementation.version`),
      equivalence: str(impl['equivalence'], `${name}.implementation.equivalence`), state: str(impl['state'], `${name}.implementation.state`),
    },
  };
}
export interface KitPart { part: string; verdict: string; declared: number; ran: number; cases: JsonObject[]; failures: JsonObject[] }
export interface KitModule { module: string; verdict: string; digest: string; parts: KitPart[]; failures: JsonObject[] }
export function kitModule(reply: JsonObject, name: string): KitModule {
  const list = arr(reply['modules'], 'kit: modules').map((m, i) => obj(m, `kit: modules[${i}]`));
  const o = list.find((m) => m['module'] === name);
  expect(o, `the kit's report holds module ${name}; it holds ${list.map((m) => String(m['module'])).join(', ')}`).toBeDefined();
  const objs = (v: JsonValue | undefined, w: string): JsonObject[] => arr(v ?? [], w).map((f, j) => obj(f, `${w}[${j}]`));
  return {
    module: name, verdict: str(o!['verdict'], `${name}.verdict`), digest: str(o!['digest'], `${name}.digest`), failures: objs(o!['failures'], `${name}.failures`),
    parts: arr(o!['parts'], `${name}.parts`).map((p, j) => {
      const po = obj(p, `${name}.parts[${j}]`);
      const part = str(po['part'], `${name}.parts[${j}].part`);
      return {
        part, verdict: str(po['verdict'], `${name}.${part}.verdict`), declared: num(po['declared'], `${name}.${part}.declared`), ran: num(po['ran'], `${name}.${part}.ran`),
        cases: objs(po['cases'], `${name}.${part}.cases`), failures: objs(po['failures'], `${name}.${part}.failures`),
      };
    }),
  };
}
/** Every failure a module's result carries: the module's, each part's and each case's `failure`. */
export const kitFailures = (m: KitModule): JsonObject[] => [
  ...m.failures, ...m.parts.flatMap((p) => [...p.failures, ...p.cases.flatMap((c) => (isObject(c['failure']) ? [c['failure']] : []))]),
];
/** The fixture names the kit ran on a module (any part's cases). */
export const kitFixtures = (m: KitModule): Set<string> => new Set(m.parts.flatMap((p) => p.cases.flatMap((c) => (typeof c['fixture'] === 'string' ? [c['fixture']] : []))));
/** The fixture names the `manifest` call lists for a module. */
export function moduleFixtures(manifest: JsonObject, module: string): string[] {
  return arr(manifest['fixtures'], 'manifest.fixtures').map((f, i) => obj(f, `manifest.fixtures[${i}]`))
    .filter((f) => f['module'] === module).map((f, i) => str(f['name'], `${module}'s fixtures[${i}].name`));
}
/** Every part of the canvas conformance kit (#138), by the names its `kit` call reports. */
export const CANVAS_KIT = ['fixtures', 'clean_rebuild', 'patch_fuzz', 'read_set', 'order', 'schedule', 'repair_loop', 'carried_state', 'late_entry', 'time_order', 'contribution', 'catalog', 'migration'];

// ---------------------------------------------------------------------------------------------------
// Documents (the design's envelope as #373's and #398's suites write it: 2D, u, y down, origin top left).

/** An order key for the i-th item: a0 … a9, b0 … (fractional-index keys, as the fixtures at the base write them). */
export const orderKey = (i: number): string => `${String.fromCharCode(97 + Math.floor(i / 10))}${i % 10}`;
export function doc(id: string, title: string, description: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title, description, size,
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((it, i) => [String(it['id']), { layer: 'main', order: orderKey(i), ...it }])),
    ...extra,
  };
}
/** A status mark: a rect bound to a verdict (The status-color rule), as #392's and #397's suites bind one. */
export function statusMark(id: string, b: Box): { item: JsonObject; bindings: JsonObject } {
  return {
    item: { id, kind: 'rect@1', name: 'Status of the release', params: { box: b } },
    bindings: { [`${id}-state`]: { target: `items/${id}/params/paint/fill`, source: 'verdict:01JB3990000000000000000001' } },
  };
}

const f32s = (values: number[]): string => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b.toString('base64'); };
const u32s = (values: number[]): string => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b.toString('base64'); };
export const f32Column = (values: number[]): JsonObject => ({ dtype: 'f32', len: values.length, data: f32s(values) });
export const u32Column = (values: number[]): JsonObject => ({ dtype: 'u32', len: values.length, data: u32s(values) });
export function i64Column(values: bigint[]): JsonObject {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeBigInt64LE(v, i * 8));
  return { dtype: 'i64', len: values.length, data: b.toString('base64') };
}
/** f32 rounding, as the column stores a value. */
export const f32 = (v: number): number => Math.fround(v);

/** A marks@1 point set `id` with one row per point, keyed 0 … n−1 (so a row is addressed `<id>#<k>`). */
export function pointSet(id: string, pts: Point[]): JsonObject {
  return {
    id, kind: 'marks@1', name: 'Points',
    params: {
      mark: 'point', n: pts.length, key: 'key',
      columns: { key: u32Column(pts.map((_, i) => i)), x: f32Column(pts.map((p) => p[0])), y: f32Column(pts.map((p) => p[1])) },
      encode: { x: { column: 'x' }, y: { column: 'y' } },
    },
  };
}
/** Words with no digit and no number word, for label texts (Honest numbers reads none of them). */
export const WORDS = ['Alder', 'Birch', 'Cedar', 'Daisy', 'Elm', 'Fern', 'Gorse', 'Hazel', 'Iris', 'Juniper', 'Kale', 'Laurel', 'Maple', 'Nettle', 'Oak', 'Poppy', 'Quince', 'Rowan', 'Sage', 'Thyme', 'Ulmus', 'Violet', 'Willow', 'Yarrow', 'Zinnia'];
/** A label@1 item (Labels `label@1`); `size` is this suite's field fixing the label's box in px (README). */
export function label(id: string, target: string, text: string, size: [number, number], extra: JsonObject = {}): JsonObject {
  return { id, kind: 'label@1', name: 'Label', params: { target, text, size, ...extra } };
}

/** The view's label placement at each stop of a camera path (README: `labels`). */
export interface Placed { state: 'placed' | 'folded'; box: Box | null; opacity: number }
export interface Step { zoom: number; bucket: number; labels: Record<string, Placed>; folded: number; raw: JsonObject }
export function labelSteps(answer: JsonObject): Step[] {
  return arr(answer['steps'], 'labels: steps').map((s, i) => {
    const o = obj(s, `steps[${i}]`);
    const ls = obj(o['labels'], `steps[${i}].labels`);
    const labels: Record<string, Placed> = {};
    for (const [id, v] of Object.entries(ls)) {
      const l = obj(v, `steps[${i}].labels.${id}`);
      const state = str(l['state'], `steps[${i}].labels.${id}.state`);
      expect(['placed', 'folded'], `steps[${i}].labels.${id}.state`).toContain(state);
      labels[id] = {
        state: state as Placed['state'], opacity: num(l['opacity'], `steps[${i}].labels.${id}.opacity`),
        box: state === 'placed' ? box(l['box'], `steps[${i}].labels.${id}.box`) : null,
      };
    }
    return { zoom: num(o['zoom'], `steps[${i}].zoom`), bucket: num(o['bucket'], `steps[${i}].bucket`), labels, folded: num(o['folded'], `steps[${i}].folded`), raw: o };
  });
}

/** A graph@1 item (the base's params: `graph: {nodes, edges}`, `layout`, `memory`), plus this issue's fields. */
export function graphItem(id: string, graph: JsonObject, layout: JsonObject, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'graph@1', name: 'Graph', params: { graph, layout, ...extra } };
}
/** `geometry`'s `graph` for a graph@1 item (README: `geometry` of a graph). */
export interface GraphGeometry { nodes: Record<string, Box>; groups: Record<string, { box: Box; title: Box }>; routes: Record<string, Point[]>; raw: JsonObject }
export function graphGeometry(answer: JsonObject): GraphGeometry {
  const g = obj(answer['graph'], `geometry: graph (${show(answer, 600)})`);
  const nodes = Object.fromEntries(Object.entries(obj(g['nodes'], 'graph.nodes')).map(([k, v]) => [k, box(v, `graph.nodes.${k}`)]));
  const groups = Object.fromEntries(Object.entries(obj(g['groups'] ?? {}, 'graph.groups')).map(([k, v]) => {
    const o = obj(v, `graph.groups.${k}`);
    return [k, { box: box(o['box'], `graph.groups.${k}.box`), title: box(o['title'], `graph.groups.${k}.title`) }];
  }));
  const routes = Object.fromEntries(Object.entries(obj(g['routes'], 'graph.routes')).map(([k, v]) => [k, points(v, `graph.routes.${k}`)]));
  return { nodes, groups, routes, raw: g };
}

// ---------------------------------------------------------------------------------------------------
// Layout memory: `{id → [rank, order, x, y]}`.

export interface Entry { rank: number; order: number; x: number; y: number }
export function memoryOf(value: JsonValue | undefined, what: string): Record<string, Entry> {
  const m = obj(value, what);
  return Object.fromEntries(Object.entries(m).map(([id, v]) => {
    const t = arr(v, `${what}[${id}]`);
    expect(t.length, `${what}[${id}] is [rank, order, x, y]`).toBe(4);
    const [rank, order, x, y] = t.map((n, i) => num(n, `${what}[${id}][${i}]`)) as [number, number, number, number];
    return [id, { rank, order, x, y }];
  }));
}

// ---------------------------------------------------------------------------------------------------
// Geometry on boxes and polylines (u or px, y down).

export const inside = (inner: Box, outer: Box, tol = 0.5): boolean =>
  inner[0] >= outer[0] - tol && inner[1] >= outer[1] - tol && inner[0] + inner[2] <= outer[0] + outer[2] + tol && inner[1] + inner[3] <= outer[1] + outer[3] + tol;
/** Two boxes share interior area (touching edges don't count). */
export const overlap = (a: Box, b: Box): boolean => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
export const boxesNear = (a: Box, b: Box, tol: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
export function boundsOf(pts: Point[]): Box {
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}
function pointBox(p: Point, b: Box): number {
  const dx = Math.max(b[0] - p[0], 0, p[0] - (b[0] + b[2]));
  const dy = Math.max(b[1] - p[1], 0, p[1] - (b[1] + b[3]));
  return Math.hypot(dx, dy);
}
function pointSegment(p: Point, a: Point, b: Point): number {
  const vx = b[0] - a[0]; const vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
/** The least distance between a segment and a box (0 when they meet). */
export function segmentBox(a: Point, b: Point, r: Box): number {
  if (pointBox(a, r) === 0 || pointBox(b, r) === 0) return 0;
  const c: Point[] = [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0] + r[2], r[1] + r[3]], [r[0], r[1] + r[3]]];
  for (let i = 0; i < 4; i++) if (segmentsCross(a, b, c[i]!, c[(i + 1) % 4]!)) return 0;
  return Math.min(pointBox(a, r), pointBox(b, r), ...c.map((p) => pointSegment(p, a, b)));
}
/** The least distance between a polyline and a box. */
export const routeBox = (route: Point[], r: Box): number => Math.min(...route.slice(1).map((p, i) => segmentBox(route[i]!, p, r)));
/** Does a polyline pass through a box's interior? */
export function routeEnters(route: Point[], r: Box): boolean {
  const shrunk: Box = [r[0] + 1e-6, r[1] + 1e-6, r[2] - 2e-6, r[3] - 2e-6];
  return routeBox(route, shrunk) === 0;
}
/** The number of pairs of collinear segments, one from each route, that overlap over a positive length. */
export function sharedSegments(p: Point[], q: Point[], eps = 1e-6): number {
  let n = 0;
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) {
    const [a, b, c, d] = [p[i - 1]!, p[i]!, q[j - 1]!, q[j]!];
    const cross = (u: Point, v: Point, w: Point): number => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    if (Math.abs(cross(a, b, c)) > eps || Math.abs(cross(a, b, d)) > eps) continue;
    const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    const k = horizontal ? 0 : 1;
    const lo = Math.max(Math.min(a[k], b[k]), Math.min(c[k], d[k]));
    const hi = Math.min(Math.max(a[k], b[k]), Math.max(c[k], d[k]));
    if (hi - lo > eps) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------
// PNG (8-bit RGB or RGBA, no interlace).

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
export const readPng = (path: string): Image => decodePng(readFileSync(path));
/** The packed RGB of a pixel. */
export const rgbAt = (im: Image, x: number, y: number): number => { const o = (y * im.width + x) * 4; return (im.rgba[o]! << 16) | (im.rgba[o + 1]! << 8) | im.rgba[o + 2]!; };
/** The most common color: the ground. */
export function groundOf(im: Image): number {
  const counts = new Map<number, number>();
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) { const c = rgbAt(im, x, y); counts.set(c, (counts.get(c) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}
/** Pixels that aren't the ground. */
export function inked(im: Image): number {
  const g = groundOf(im); let n = 0;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (rgbAt(im, x, y) !== g) n++;
  return n;
}
/** The pixel columns where two images of one size differ, in order. */
export function differingColumns(a: Image, b: Image): number[] {
  expect([a.width, a.height], 'the two pictures have one size').toEqual([b.width, b.height]);
  const out: number[] = [];
  for (let x = 0; x < a.width; x++) for (let y = 0; y < a.height; y++) if (rgbAt(a, x, y) !== rgbAt(b, x, y)) { out.push(x); break; }
  return out;
}

/** The shipped clean look, as `deep-canvas-render look` answers it. */
export function cleanLook(render: string): JsonObject {
  const out = accepted(render, ['look'], { look: 'clean' }, 'look "clean"');
  return obj(out['look'], 'look "clean": look');
}

// ---------------------------------------------------------------------------------------------------
// Seeded numbers (mulberry32), so every generated fixture is the same on every run.

export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------------------------------
// The M4 reference (the Oracle lane, criterion 6).
//
// Ported from tsdownsample (https://github.com/predict-idlab/tsdownsample) at 567f68f5f5,
// tsdownsample/_python/downsamplers.py, `M4_py._downsample` and `_get_bin_idxs`; MIT License, copyright the
// tsdownsample authors. Permission is hereby granted, free of charge, to any person obtaining a copy of this software
// and associated documentation files, to deal in the Software without restriction, subject to the condition that the
// copyright notice and this permission notice be included in all copies or substantial portions of the Software. THE
// SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
//
// Changes: bins are pixel columns over the series' window `[t0, t1]` (README: the pixel columns), computed exactly on
// integers with tsdownsample's own edge rule (`searchsorted(…, side="right")`: a row on an edge belongs to the column
// on its left, the first row to column 0); duplicates are kept as the reference keeps them.

/** The column of each row: the k with t0 + k·(t1−t0)/w < t ≤ t0 + (k+1)·(t1−t0)/w, the first row in column 0. */
export function columnOf(t: bigint, t0: bigint, t1: bigint, w: number): number {
  const span = t1 - t0; const W = BigInt(w);
  const scaled = (t - t0) * W; // column = ceil(scaled / span) − 1, at least 0
  const k = scaled === 0n ? 0n : (scaled + span - 1n) / span - 1n;
  return Number(k < 0n ? 0n : k >= W ? W - 1n : k);
}
/** M4's row indices per column (first, argmin, argmax, last), sorted, duplicates kept. */
export function m4Reference(t: bigint[], v: number[], t0: bigint, t1: bigint, w: number): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < t.length) {
    const col = columnOf(t[i]!, t0, t1, w);
    let j = i; let lo = i; let hi = i;
    while (j < t.length && columnOf(t[j]!, t0, t1, w) === col) {
      if (v[j]! < v[lo]!) lo = j;
      if (v[j]! > v[hi]!) hi = j;
      j++;
    }
    out.push(i, lo, hi, j - 1);
    i = j;
  }
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------
// Readings: the reference-Mac gate, the design's judge, peak memory, and the merge base.

export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => spawnSync(cmd, args, { encoding: 'utf8' }).stdout?.trim() ?? '';
/** Why this machine can't take a timing reading now, or null (as #397's: mains power never gates). */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const model = sh('sysctl', '-n', 'hw.model');
  const chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
  const gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(sh('pmset', '-g'));
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const therm = sh('pmset', '-g', 'therm');
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const load = loadavg()[0]!;
  if (load > cpus().length / 2) return `loaded: a 1-minute load average of ${load.toFixed(1)} on ${cpus().length} cores`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE (a skip). */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
/** One run under `/usr/bin/time -l` (macOS): its stdout and its peak resident memory in bytes. */
export function withPeakMemory(bin: string, args: string[], input: string): { stdout: string; bytes: number } {
  const r = spawnSync('/usr/bin/time', ['-l', bin, ...args], { cwd: REPO, input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.status, `${bin.split('/').pop()} ${args.join(' ')} exits 0 under /usr/bin/time: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const m = /(\d+)\s+maximum resident set size/.exec(r.stderr ?? '');
  expect(m, `/usr/bin/time -l reports the maximum resident set size: ${(r.stderr ?? '').slice(-800)}`).not.toBeNull();
  return { stdout: r.stdout ?? '', bytes: Number(m![1]) };
}
export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
/** The merge base exported whole by `git archive` into the (git-ignored) target folder, and one binary built there. */
export function mergeBaseBin(sha: string, bin: Bin): { path: string; error: string } {
  const dir = join(REPO, 'target', 'acceptance-399-base', sha.slice(0, 12));
  const done = join(dir, '.exported');
  if (!existsSync(done)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(done, sha);
  }
  const error = cargo(['build', '--locked', '--bin', bin], dir, { CARGO_TARGET_DIR: join(dir, 'target') });
  return { path: join(dir, 'target', 'debug', exe(bin)), error };
}

// ---------------------------------------------------------------------------------------------------
// The suite's documents (README: Fixtures). Each is generated from a fixed seed, so every run sends the same bytes.

/** The 40-node layered graph of fixtures/layered-40.json as a graph@1 item with its memory; `after` adds n41. */
export function graph40Doc(after: boolean): JsonObject {
  const f = fixture('layered-40.json');
  const g = obj(f['graph'], 'layered-40: graph');
  const added = obj(f['added'], 'layered-40: added');
  const graph: JsonObject = after
    ? { nodes: [...arr(g['nodes'], 'nodes'), added['node']!], edges: [...arr(g['edges'], 'edges'), added['edge']!] }
    : g;
  return doc(`graph-40-${after ? 'after' : 'before'}`, 'Forty steps in six ranks', 'A layered graph of forty steps whose layout memory keeps every node in place.', [900, 600],
    [graphItem('g', graph, obj(f['layout'], 'layout'), { memory: f['memory']! })]);
}

/** AC2: thirty labels crowded on thirty points around a status mark; they can't all fit. */
export const CROWD_STATUS: Box = [326, 224, 28, 14];
export function crowdDoc(): JsonObject {
  const r = rng(2);
  const pts: Point[] = Array.from({ length: 30 }, () => [300 + r() * 80, 200 + r() * 60] as Point);
  const status = statusMark('gate', CROWD_STATUS);
  return doc('labels-crowd', 'Labels around a status mark', 'Thirty labelled points crowd around a status mark; labels that do not fit fold and are counted.', [700, 460],
    [pointSet('pts', pts), status.item, ...pts.map((_, k) => label(`l${k}`, `pts#${k}`, WORDS[k % WORDS.length]!, [56, 14], { fold: 'count' }))],
    { status_bindings: status.bindings });
}

/** AC3: sixty labels of mixed sizes and priorities over a wide board. */
export function fadeDoc(): JsonObject {
  const r = rng(3);
  const pts: Point[] = Array.from({ length: 60 }, () => [40 + r() * 720, 40 + r() * 420] as Point);
  return doc('labels-zoom', 'Labels across zoom buckets', 'Sixty labelled points whose placement is chained from the base zoom.', [800, 500],
    [pointSet('pts', pts), ...pts.map((_, k) => label(`l${k}`, `pts#${k}`, WORDS[k % WORDS.length]!, [30 + Math.round(r() * 40), 12 + Math.round(r() * 4)], { priority: Math.floor(r() * 5) - 2 }))]);
}

/** AC7: fifty points 60 px apart (ten by five), each with a 40 × 12 px label. */
export function gridDoc(): JsonObject {
  const pts: Point[] = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 10; i++) pts.push([60 + 60 * i, 60 + 60 * j]);
  return doc('labels-grid', 'Fifty labelled points', 'Fifty points sixty pixels apart, each with a forty by twelve pixel label.', [720, 400],
    [pointSet('pts', pts), ...pts.map((_, k) => label(`l${k}`, `pts#${k}`, WORDS[k % WORDS.length]!, [40, 12], { fold: 'count' }))]);
}

/** AC7: A, B, C, D and E pinned; C's label sits below C, on the straight line from A to B. */
export const ROUTE_NODES: Record<string, Box> = {
  A: [40, 40, 60, 30], D: [440, 40, 60, 30], C: [220, 190, 60, 30], E: [40, 440, 60, 30], B: [440, 440, 60, 30],
};
export function routeDoc(): JsonObject {
  const order: Record<string, [number, number]> = { A: [0, 0], D: [0, 1], C: [1, 0], E: [2, 0], B: [2, 1] };
  const nodes = Object.entries(ROUTE_NODES).map(([id, b]) => ({ id, kind: 'step', w: b[2], h: b[3] }));
  const memory: JsonObject = Object.fromEntries(Object.entries(ROUTE_NODES).map(([id, b]) => [id, [order[id]![0], order[id]![1], b[0], b[1]]]));
  const edges = [{ id: 'ab', a: 'A', b: 'B', kind: 'flow' }, { id: 'ad', a: 'A', b: 'D', kind: 'flow' }, { id: 'eb', a: 'E', b: 'B', kind: 'flow' }];
  return doc('route-past-c', 'A route past C', 'An edge from A to B routed around node C and its label.', [560, 520], [
    graphItem('g', { nodes, edges }, { algo: 'pinned', direction: 'down', seed: 399 }, { memory, route: { mode: 'orthogonal' } }),
    label('lab-c', 'g#C', 'Cedar', [40, 12], { anchors: ['s'], fold: 'count' }),
  ]);
}

/** AC4: six card frames, each a column of a title and a line, and the graph whose nodes name them, in two groups. */
export const CARDS: [string, string, string, string][] = [
  ['b1', 'Build', 'Plan the work', 'Scope and owners'],
  ['b2', 'Build', 'Write the code', 'Small reviewed changes'],
  ['b3', 'Build', 'Run the checks', 'Every lane on this Mac'],
  ['s1', 'Ship', 'Stage the release', 'Notes and a tag'],
  ['s2', 'Ship', 'Ship to people', 'Signed and notarised'],
  ['s3', 'Ship', 'Watch the field', 'Crashes and reports'],
];
export function cardItems(): JsonObject[] {
  return CARDS.flatMap(([id, , title, line]) => [
    { id: `card-${id}`, kind: 'frame@1', name: 'Card', at: { pos: [0, 0, 0] }, params: { layout: 'column', gap: 4, padding: 8 } },
    { id: `card-${id}-title`, kind: 'text@1', name: 'Card title', parent: `card-${id}`, params: { text: title, font: 'body', size: 15, weight: 600 } },
    { id: `card-${id}-line`, kind: 'text@1', name: 'Card line', parent: `card-${id}`, params: { text: line, font: 'body', size: 12 } },
  ]);
}
export function cardsDoc(): JsonObject {
  const nodes = CARDS.map(([id, group]) => ({ id, kind: 'step', item: `card-${id}`, group }));
  const edges = [['b1', 'b2'], ['b1', 'b3'], ['b3', 's1'], ['s1', 's2'], ['s1', 's3']].map(([a, b]) => ({ id: `${a}-${b}`, a: a!, b: b!, kind: 'flow' }));
  return doc('cards-in-groups', 'Six cards in two groups', 'Six card frames drawn as the nodes of a layered graph, three in each titled group.', [900, 700],
    [...cardItems(), graphItem('g', { nodes, edges }, { algo: 'layered', direction: 'down', seed: 399 })]);
}

/** AC5 and AC6: 1,000,000 rows of seeded noise in [0, 0.5) at one row per millisecond, with one spike row at 1.0. */
export const SERIES_ROWS = 1_000_000;
export const SPIKE = 500_166;
export const SERIES_COLUMNS = 3000;
export const MS = 705_600n;
export interface SeriesData { t: bigint[]; v: number[] }
let noise: SeriesData | null = null;
export function seriesData(): SeriesData {
  if (!noise) {
    const r = rng(6);
    const t = new Array<bigint>(SERIES_ROWS);
    const v = new Array<number>(SERIES_ROWS);
    for (let i = 0; i < SERIES_ROWS; i++) { t[i] = BigInt(i) * MS; v[i] = f32(r() * 0.5); }
    v[SPIKE] = 1;
    noise = { t, v };
  }
  return noise;
}
/** A series@1 line over `data`, decimated as `decimate`, filling a `w` × `h` box at the origin of a document that size. */
export function seriesDoc(decimate: 'm4' | 'none', data: SeriesData = seriesData(), w = SERIES_COLUMNS, h = 400): JsonObject {
  const n = data.t.length;
  return doc(`series-${decimate}`, 'Noise with one spike', 'A million rows of seeded noise with one spike, drawn as one line per pixel column.', [w, h], [{
    id: 's', kind: 'series@1', name: 'Noise',
    params: {
      source: 'reading:01JB399S000000000000000001#noise', t: i64Column(data.t), v: f32Column(data.v),
      window: [Number(data.t[0]!), Number(data.t[n - 1]!)], decimate, bucket: '1px', marks: ['line'], box: [0, 0, w, h],
    },
  }]);
}
/** `geometry`'s `series.rows` for a series@1 item: the row behind each vertex it draws, in draw order. */
export function seriesRows(answer: JsonObject): number[] {
  return arr(obj(answer['series'], `geometry: series (${show(answer, 400)})`)['rows'], 'series.rows').map((r, i) => num(r, `series.rows[${i}]`));
}
