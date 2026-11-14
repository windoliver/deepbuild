// Test-side tools for the #224 acceptance tests (README: The surface under test). Every reading comes from the program:
// `deep-show run` (#393's scenario) for documents, the document check and `geometry` (#420's call, #441's `at`, with
// this suite's `track` and `play`), `deep-gpu run` (#377) for `view3d`'s own frames, and `scripts/benchmark.mjs` for the
// budget record and its judge. The 3D axes, the sky, the sun, materials and the look's shape are #226's fixtures
// (../226/helpers.ts); the animated PNG and SHA-256 are #252's (../252/helpers.ts). Nothing here stands in for the
// builder, the curve, the mesher or the renderer: every expected value is the issue's or the design's, or a closed form
// computed here in f64 from published formulas (OKLab: Björn Ottosson, 2020; the sRGB transfer function, IEC 61966-2-1).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, expect } from 'vitest';
import { AXES, DAY_SKY, MOD_AXES, axesItem, look3d, material, scales, sun } from '../226/helpers.ts';
import { apng, sha256 } from '../252/helpers.ts';

export { AXES, DAY_SKY, MOD_AXES, apng, axesItem, material, scales, sha256, sun };

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/224 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/**
 * Each criterion's tag (scripts/proof-change.mjs: `#224.` and the first 8 hex digits of the SHA-256 of its text, trimmed,
 * white space collapsed, computed from the live issue).
 */
export const AC = {
  1: 'AC1 #224.855c9747',
  2: 'AC2 #224.e2f417bd',
  3: 'AC3 #224.7f436e55',
  4: 'AC4 #224.84d92ff1',
  5: 'AC5 #224.54b3f7df',
  6: 'AC6 #224.bb45c6d2',
  7: 'AC7 #224.52ce6885',
  8: 'AC8 #224.5f6db998',
  9: 'AC9 #224.08c2cd78',
  10: 'AC10 #224.01150621',
  11: 'AC11 #224.c7725e3e',
} as const;
/** The bare ID, `#224.xxxxxxxx`, of a tag. */
export const idOf = (tag: string): string => tag.split(' ')[1]!;

/** Each test may build deep-show or deep-gpu on a shared machine first. */
export const TIMEOUT = 3_600_000;
export const FLICKS = 705_600_000;
export const PI = Math.PI;
export const TAU = 2 * Math.PI;
const MIB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const shown = (v: unknown): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${shown(value)}`).toBe(true);
  return value as number;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one naming each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails the judge, but the judge found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names "${name}"; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(why: string): never {
  throw Error(`INCONCLUSIVE: ${why}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file when a test first needs it, debug, copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
interface Built { bin: string; error: string }
const builds = new Map<string, Built>();
const buildDirs: string[] = [];
/** Deletes this file's copied builds after its tests; call once at a file's top. */
export function useBins(): void {
  afterAll(() => { for (const d of buildDirs.splice(0)) rmSync(d, { recursive: true, force: true }); builds.clear(); });
}
function cargoEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const rustup = '/opt/homebrew/opt/rustup/bin';
  if (existsSync(rustup)) env['PATH'] = `${rustup}${delimiter}${env['PATH'] ?? ''}`;
  return env;
}
function built(key: string, args: string[], name: string): string {
  let b = builds.get(key);
  if (!b) {
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, env: cargoEnv() });
    let error = '';
    if (run.error) error = `BLOCKED: cargo could not run (${run.error.message}); install the toolchain rust-toolchain.toml pins`;
    else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`;
    const dir = mkdtempSync(join(tmpdir(), 'deep-224-bin-'));
    buildDirs.push(dir);
    const bin = join(dir, exe(name));
    if (error === '') copyFileSync(join(TARGET, 'debug', exe(name)), bin);
    b = { bin, error };
    builds.set(key, b);
  }
  expect(b.error, `${name} builds (cargo ${args.join(' ')})`).toBe('');
  return b.bin;
}
/** `deep-show` with its default features: the full build set. */
export const showBin = (): string => built('deep-show', ['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show'], 'deep-show');
/** `deep-gpu`, for the renderer's own frames. */
export const gpuBin = (): string => built('deep-gpu', ['build', '--locked', '--bin', 'deep-gpu'], 'deep-gpu');

/** A fresh temporary folder per call, all deleted after each test. */
export function useTemp(): () => string {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), 'deep-224-'));
    dirs.push(d);
    return d;
  };
}

// ---------------------------------------------------------------------------------------------------
// Color: OKLab from its published formula, and the look the suite's roles live in.

const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** OKLab [L, a, b] of an sRGB `#rrggbb`. */
export function oklab(hex: string): V3 {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16))) as V3;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const deltaE = (x: readonly number[], y: readonly number[]): number => Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);

/**
 * The suite's roles (README: The look): `a`, `b` and `c` for criterion 3's ramp and checker, and the oracle lane's five,
 * each a palette entry of its own.
 */
export const ROLE_COLORS: Record<string, string> = {
  a: '#1f5fbf', b: '#2f9e44', c: '#d9480f',
  blue: '#58c4dd', green: '#83c167', yellow: '#ffff00', orange: '#ff862f', red: '#fc6255',
};
const withRoles = (look: JsonObject): JsonObject => {
  const palette = { ...obj(look['palette'], 'look.palette') };
  const roles = { ...obj(look['roles'], 'look.roles') };
  for (const [role, hex] of Object.entries(ROLE_COLORS)) { palette[`p224_${role}`] = hex; roles[role] = `p224_${role}`; }
  return { ...look, palette, roles };
};
/** The document look (`look-224@1`): the shipped clean look with the suite's roles added, as deep-show resolves a look@1. */
export const LOOK_ID = 'look-224';
export const LOOK_BYTES = Buffer.from(JSON.stringify(withRoles({ ...(JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject), id: LOOK_ID })));
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Made by the #224 acceptance tests at test time.', shareable: true, credit: 'Test fixture.' };
/** A document's envelope fields that name the suite's look, whose bytes `ask` puts into the evidence store. */
export const LOOK_FIELDS: JsonObject = { look: { asset: `${LOOK_ID}@1`, theme: 'light' }, assets: { [LOOK_ID]: { sha256: sha256(LOOK_BYTES), license: LICENSE } } };
/** The look `view3d` draws the taste call's pictures in: #226's physical look, filmic, with the same roles. */
export const LOOK_3D: JsonObject = withRoles(look3d('look-224-filmic', { tone_map: 'filmic', exposure: 0 }));

// ---------------------------------------------------------------------------------------------------
// Documents (an agent's payload for deep_show: no `id`, no `layers`) and their items.

/** A 3D scene around `items`, with a still camera `cam`, in the figure class unless `extra` says otherwise. */
export function sceneDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const all: Record<string, JsonObject> = { cam: CAMERA, ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #224 acceptance fixture.`, size: [480, 360], camera: 'cam', seed: 224,
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'figure' }, ...extra, items: withIds,
  };
}
/** The same document as a `view3d` session holds it (#378): an `id`, one writer layer `main`, every item in it. */
export function sessionForm(doc: JsonObject, id: string): JsonObject {
  const { look: _look, assets: _assets, ...rest } = doc;
  const items: JsonObject = {};
  for (const [k, v] of Object.entries(obj(doc['items'], 'items'))) items[k] = { ...obj(v, k), layer: 'main' };
  return { ...rest, id, layers: { main: { writer: 'agent:sess-alpha', title: 'Main', order: 'a0' } }, items };
}
export const CAMERA: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [3, 2.5, 4], target: [0, 0, 0], fov: 40 } };
/** A `surface@1` item (Builder `surface`). */
export const surface = (params: JsonObject, more: JsonObject = {}): JsonObject => ({ kind: 'surface@1', params, ...more });
/** Grid lines' stroke (Paint's stroke: a role and a width). */
export const STROKE: JsonObject = { role: 'ink', width: 1.5 };

/** Criterion 1's unit sphere: x = cos u sin v, y = sin u sin v, z = cos v over u ∈ [0, 2π], v ∈ [0, π] at 0.001 m. */
export const UNIT_SPHERE: JsonObject = { fn: { x: 'cos(u) * sin(v)', y: 'sin(u) * sin(v)', z: 'cos(v)' }, u: [0, TAU], v: [0, PI], tolerance: 0.001, two_sided: false };

/** The helicoid-to-catenoid family (README: Fixtures): θ = 0 the helicoid, θ = π/2 the catenoid, isometric throughout. */
export const FAMILY_FN: JsonObject = {
  x: 'cos(theta) * sinh(v) * sin(u) + sin(theta) * cosh(v) * cos(u)',
  y: '-cos(theta) * sinh(v) * cos(u) + sin(theta) * cosh(v) * sin(u)',
  z: 'u * cos(theta) + v * sin(theta)',
};
/** The family on θ's slider, 128 × 128 at most, its tolerance fine enough that the build reaches 128 × 128. */
export const family = (u: [number, number], gridLines: JsonObject, more: JsonObject = {}): JsonObject =>
  surface({ fn: FAMILY_FN, u, v: [-1, 1], vars: { theta: 'controls/theta/value' }, tolerance: 1e-5, max: [128, 128], grid_lines: { ...gridLines, stroke: STROKE } }, more);
/** θ's slider (Control): a document slider over [0, π/2], 0 until an entry. */
export const THETA: JsonObject = { kind: 'slider', class: 'document', label: 'θ', role: 'slider', range: [0, PI / 2], default: 0 };
/** One input-track entry of yours on θ at `seconds` (Input track; #504's form). */
export const thetaEntry = (seconds: number, seq: number, value: number): JsonObject =>
  ({ t: Math.round(seconds * FLICKS), seq, control: 'theta', value, writer: 'you', player: 1 });

/** An implicit `surface@1` (Builder `surface`: implicit surfaces), one-sided so its shells are read on one side. */
export const zeroSurface = (zero: string, half: number, tolerance: number, more: JsonObject = {}): JsonObject =>
  surface({ zero, box: [[-half, half], [-half, half], [-half, half]], tolerance, two_sided: false, ...more });
export const UNIT_SPHERE_ZERO = 'x^2 + y^2 + z^2 - 1';

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one agent's session, one visible panel per document, an optional `planted` and `threads`.

/** Scenario `planted` values this suite adds (README: The planted programs). */
export type Planted = 'grid_lines_from_start' | 'nets_number_by_thread' | 'octree_drops_same_sign' | 'octree_stops_mid_level' | 'zero_keeps_first_mesh';
export interface Run { planted?: Planted; threads?: number }

const SESSION = 'sess-alpha';
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted (26 characters). */
export const DOC = (n: number): string => `01JB224D${String(n).padStart(18, '0')}`;
/** The agent's `deep_show` of a whole revision, with its issues (#393). */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** #420's `geometry` call at `t` (a time literal or flicks), with this suite's `track` and `play` when given. */
export const geometry = (doc: string, items: string[], t: string | number = '0s', extra: JsonObject = {}): JsonObject =>
  ({ call: 'geometry', doc, items, t, ...extra });

/** One `deep-show run` of `calls`: exit 0, accepted, one reply per call. The look's bytes are in its evidence store. */
export function ask(calls: JsonObject[], o: Run = {}): JsonObject[] {
  const bin = showBin();
  const evidence = mkdtempSync(join(tmpdir(), 'deep-224-evidence-'));
  try {
    const sha = sha256(LOOK_BYTES);
    const at = join(evidence, sha.slice(0, 2));
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, sha.slice(2)), LOOK_BYTES);
    const docs = [...new Set(calls.map((c) => c['doc']).filter((d): d is string => typeof d === 'string'))];
    const docsOut: JsonObject = {};
    const panels: JsonObject = {};
    docs.forEach((id, i) => { docsOut[id] = { panel: `p${i + 1}` }; panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; });
    const scenario: JsonObject = {
      evidence, sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: surfaces', process: { pid: 4100, start: 1_000 } } },
      processes: PROCESSES, panels, docs: docsOut, calls,
      ...(o.planted ? { planted: o.planted } : {}), ...(o.threads ? { threads: o.threads } : {}),
    };
    const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 600_000, killSignal: 'SIGKILL' });
    if (run.error) throw Error(`deep-show run: ${run.error.message}`);
    const stdout = run.stdout ?? '';
    expect(run.status, `deep-show run exits 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
    const lines = stdout.split('\n').filter((l) => l !== '');
    expect(lines.length, 'deep-show run: one output line').toBe(1);
    const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
    expect(answer['ok'], `deep-show run accepts the scenario: ${shown(answer)}`).toBe(true);
    const replies = arr(answer['replies'], 'deep-show run: replies').map((r, i) => obj(r, `deep-show run: replies[${i}]`));
    expect(replies.length, 'deep-show run: one reply per call').toBe(calls.length);
    return replies;
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export function issuesOf(reply: JsonObject | undefined, what: string): Issue[] {
  return arr(reply?.['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return {
      code: String(o['code']), severity: String(o['severity']), path: typeof o['path'] === 'string' ? o['path'] : '',
      ids: Array.isArray(o['ids']) ? o['ids'].filter((x): x is string => typeof x === 'string') : [], raw: o,
    };
  });
}
/** An issue's field, on the issue itself or in its `actual` (as #537's issues spread theirs). */
export const fieldOf = (i: Issue, key: string): JsonValue | undefined => i.raw[key] ?? (isObject(i.raw['actual']) ? i.raw['actual'][key] : undefined);
/** Whether an issue names item `id`: in `ids`, as its `item`, or by its path. */
export const names = (i: Issue, id: string): boolean => i.ids.includes(id) || fieldOf(i, 'item') === id || i.path.startsWith(`items/${id}/`) || i.path === `items/${id}`;
/** A revision presented with no error issue and no item skipped as an unknown kind (the base's notice). */
export function admitted(reply: JsonObject | undefined, what: string): Issue[] {
  const list = issuesOf(reply, what);
  expect(list.filter((i) => i.severity === 'error').map((i) => shown(i.raw)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply?.['notices'] ?? [], `${what}: notices`).filter((n) => isObject(n) && n['code'] === 'unknown_kind');
  expect(skipped.map((n) => shown(n)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply?.['outcome'], `${what} is presented: ${shown(reply)}`).toBe('presented');
  return list;
}
/** A revision refused with an error issue at `path` (or below it). */
export function refusedAt(reply: JsonObject | undefined, path: string, what: string): void {
  const errors = issuesOf(reply, what).filter((i) => i.severity === 'error');
  expect(errors.some((i) => i.path === path || i.path.startsWith(`${path}/`)), `${what}: an error issue names ${path}; the errors were ${shown(errors.map((e) => e.raw))}`).toBe(true);
  expect(reply?.['outcome'], `${what} is refused: ${shown(reply)}`).toBe('refused');
}

// ---------------------------------------------------------------------------------------------------
// `geometry` rows (README: The surface under test)

export interface GridLine { along: 'u' | 'v'; value: number; edges: [number, number][] }
export interface Mesh {
  id: string; positions: V3[]; normals: V3[]; indices: number[]; values: JsonObject; attributes: JsonObject; gridLines: GridLine[];
  points: V3[]; raw: JsonObject;
}
/** An array of three finite numbers per entry, as `geometry` writes positions, normals and colors. */
export function finiteTriples(v: JsonValue | undefined, what: string): V3[] {
  const list = arr(v ?? [], what);
  const out: V3[] = new Array(list.length);
  let bad = -1;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!Array.isArray(p) || p.length !== 3 || !p.every((c) => typeof c === 'number' && Number.isFinite(c))) { bad = i; break; }
    out[i] = p as V3;
  }
  expect(bad, `${what}: every entry is three finite numbers (no NaN, which JSON writes as null); entry ${bad} is ${shown(list[bad])}`).toBe(-1);
  return out;
}
/** Item `id`'s row in a `geometry` reply, its arrays checked: finite triples, whole indices in range. */
export function meshOf(reply: JsonObject | undefined, id: string, what: string): Mesh {
  expect(reply?.['code'], `${what}: geometry answers rows, not a refusal: ${shown(reply)}`).toBeUndefined();
  const rows = arr(reply?.['items'], `${what}: geometry's items`).map((r, i) => obj(r, `${what}: items[${i}]`));
  const row = rows.find((r) => r['id'] === id);
  expect(row, `${what}: geometry answers a row for ${id}`).toBeDefined();
  const r = row!;
  const positions = finiteTriples(r['positions'], `${what}: ${id}.positions`);
  const normals = finiteTriples(r['normals'], `${what}: ${id}.normals`);
  const indices = arr(r['indices'] ?? [], `${what}: ${id}.indices`) as number[];
  const badIndex = indices.findIndex((i) => !Number.isInteger(i) || i < 0 || i >= positions.length);
  expect(badIndex, `${what}: ${id}.indices are whole numbers into its ${positions.length} positions; index ${badIndex} is ${shown(indices[badIndex])}`).toBe(-1);
  expect(indices.length % 3, `${what}: ${id}.indices are triangles`).toBe(0);
  const gridLines = (Array.isArray(r['grid_lines']) ? r['grid_lines'] : []).map((g, k): GridLine => {
    const o = obj(g, `${what}: ${id}.grid_lines[${k}]`);
    const along = 'u' in o ? 'u' : 'v';
    const edges = arr(o['edges'], `${what}: ${id}.grid_lines[${k}].edges`).map((e) => e as [number, number]);
    expect(edges.every((e) => Array.isArray(e) && e.length === 2 && e.every((i) => Number.isInteger(i) && i >= 0 && i < positions.length)), `${what}: ${id}.grid_lines[${k}]'s edges are vertex index pairs`).toBe(true);
    return { along, value: num(o[along], `${what}: ${id}.grid_lines[${k}].${along}`), edges };
  });
  return {
    id, positions, normals, indices, gridLines, raw: r,
    values: isObject(r['values']) ? r['values'] : {}, attributes: isObject(r['attributes']) ? r['attributes'] : {},
    points: r['points'] === undefined ? [] : finiteTriples(r['points'], `${what}: ${id}.points`),
  };
}
export const triangleCount = (m: Mesh): number => m.indices.length / 3;

/** A row's colors (README: `attributes.color`): OKLab [L, a, b], one per vertex (`point`) or per triangle (`face`). */
export function colorsOf(m: Mesh, what: string): { domain: 'point' | 'face'; values: V3[] } {
  const c = obj(m.attributes['color'], `${what}: ${m.id}'s attributes.color`);
  expect(c['type'], `${what}: ${m.id}'s colors are OKLab`).toBe('oklab');
  const domain = c['domain'];
  expect(domain === 'point' || domain === 'face', `${what}: ${m.id}'s colors are per point or per face, got ${shown(domain)}`).toBe(true);
  const values = finiteTriples(c['values'], `${what}: ${m.id}'s attributes.color.values`);
  expect(values.length, `${what}: one color per ${String(domain)}`).toBe(domain === 'point' ? m.positions.length : triangleCount(m));
  return { domain: domain as 'point' | 'face', values };
}
/**
 * Every vertex whose z equals a ramp stop's value within 1e-12, held to that stop's role color within OKLab ΔE 0.01;
 * with how many vertices sit at each stop.
 */
export function atStops(m: Mesh, colors: readonly V3[], stops: ReadonlyArray<readonly [number, string]>): { failures: string[]; counts: number[] } {
  const failures: string[] = [];
  const counts = stops.map(() => 0);
  m.positions.forEach((p, i) => stops.forEach(([z, role], k) => {
    if (Math.abs(p[2] - z) > 1e-12) return;
    counts[k]!++;
    const e = deltaE(colors[i]!, oklab(ROLE_COLORS[role]!));
    if (!(e <= 0.01)) failures.push(`vertex ${i} at z = ${z} is ${JSON.stringify(colors[i])} in OKLab, ΔE ${e.toFixed(4)} from role ${role} (${ROLE_COLORS[role]!})`);
  }));
  return { failures, counts };
}

/**
 * The vertex hash (README: The vertex hash): SHA-256 of the vertex count (u32 little-endian), each position's x, y and z
 * as IEEE 754 f64 little-endian in vertex order, the index count (u32) and each index (u32), as `geometry` answers them.
 */
export function vertexHash(m: Mesh): string {
  const buf = Buffer.alloc(8 + m.positions.length * 24 + m.indices.length * 4);
  let o = buf.writeUInt32LE(m.positions.length, 0);
  for (const p of m.positions) for (const c of p) o = buf.writeDoubleLE(c, o);
  o = buf.writeUInt32LE(m.indices.length, o);
  for (const i of m.indices) o = buf.writeUInt32LE(i, o);
  return sha256(buf);
}

/** One connected piece of a mesh, on positions welded at 1e-6 m (as the base's `welded` welds them). */
export interface Shell { vertices: number; edges: number; faces: number; euler: number; open: number; nonManifold: number }
export function shells(m: Mesh): Shell[] {
  const ids = new Map<string, number>();
  const w = m.positions.map((p) => {
    const k = p.map((c) => Math.round(c / 1e-6)).join(',');
    let i = ids.get(k);
    if (i === undefined) { i = ids.size; ids.set(k, i); }
    return i;
  });
  const root = Array.from({ length: ids.size }, (_, i) => i);
  const find = (x: number): number => { while (root[x] !== x) { root[x] = root[root[x]!]!; x = root[x]!; } return x; };
  const edges = new Map<string, number>();
  const used = new Set<number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const c = [w[m.indices[t]!]!, w[m.indices[t + 1]!]!, w[m.indices[t + 2]!]!];
    c.forEach((v) => used.add(v));
    root[find(c[0]!)] = find(c[1]!);
    root[find(c[1]!)] = find(c[2]!);
    for (const [a, b] of [[c[0]!, c[1]!], [c[1]!, c[2]!], [c[2]!, c[0]!]] as const) {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  const by = new Map<number, Shell>();
  const of = (r: number): Shell => { let s = by.get(r); if (!s) { s = { vertices: 0, edges: 0, faces: 0, euler: 0, open: 0, nonManifold: 0 }; by.set(r, s); } return s; };
  for (const v of used) of(find(v)).vertices++;
  for (let t = 0; t < m.indices.length; t += 3) of(find(w[m.indices[t]!]!)).faces++;
  for (const [k, n] of edges) {
    const s = of(find(Number(k.split(',')[0])));
    s.edges++;
    if (n === 1) s.open++;
    if (n > 2) s.nonManifold++;
  }
  const out = [...by.values()];
  for (const s of out) s.euler = s.vertices - s.edges + s.faces;
  return out;
}
/** What keeps a mesh from being `count` closed shells, each with V − E + F = `euler`. */
export function shellFailures(m: Mesh, count: number, euler: number, what: string): string[] {
  const list = shells(m);
  const f: string[] = [];
  if (triangleCount(m) === 0) return [`${what}: found nothing, no triangle`];
  if (list.length !== count) f.push(`${what}: ${list.length} shells, not ${count}`);
  list.forEach((s, i) => {
    if (s.open) f.push(`${what}: shell ${i + 1} has ${s.open} open edges`);
    if (s.nonManifold) f.push(`${what}: shell ${i + 1} has ${s.nonManifold} edges on more than two triangles`);
    if (s.euler !== euler) f.push(`${what}: shell ${i + 1} has V − E + F = ${s.vertices} − ${s.edges} + ${s.faces} = ${s.euler}, not ${euler}`);
  });
  return f;
}

// ---------------------------------------------------------------------------------------------------
// Vectors and seeds

export const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const len = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
export const dist = (a: readonly number[], b: readonly number[]): number => len(sub(a, b));
/** The angle between two directions, in degrees. */
export const angle = (a: readonly number[], b: readonly number[]): number => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) * 180) / PI;
/** Distance from p to the segment a–b. */
export function toSegment(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, [a[0]! + t * ab[0], a[1]! + t * ab[1], a[2]! + t * ab[2]]);
}
/** mulberry32 seeded with `seed` (the #490 suite's seeded search uses the same): uniform in [0, 1). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ---------------------------------------------------------------------------------------------------
// The budget record (docs/parallel-proof.md §12a): a task of benchmarks/budgets.json names the timing criterion, and the
// budget window measures it against the merge base. scripts/benchmark.mjs is read for its validator and judges.

export interface Task { id: string; command: string[]; targets: Record<string, number> }
export const SURFACE_TASK: Task = { id: 'canvas-surface', command: ['node', 'benchmarks/canvas.mjs', 'surface'], targets: { rebuild_128_ms: 2 } };
interface Bench {
  validateBudgets: (current: unknown, base: unknown) => void;
  judgeTargets: (budget: unknown, cwd: string) => JsonObject;
  judgeLimit: (o: unknown) => { status: string; reason?: string };
  fingerprint: () => unknown;
}
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/** What keeps benchmarks/budgets.json from recording `task` for `criterion` as the budget window reads it. */
export async function recordFailures(task: Task, criterion: string): Promise<string[]> {
  const f: string[] = [];
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
  const entry = arr(current['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === task.id);
  if (!entry) return [`benchmarks/budgets.json has no task ${task.id}`];
  if (JSON.stringify(entry['command']) !== JSON.stringify(task.command)) f.push(`${task.id} runs ${shown(entry['command'])}, not ${shown(task.command)}`);
  if (JSON.stringify(entry['targets']) !== JSON.stringify(task.targets)) f.push(`${task.id} holds ${shown(entry['targets'])}, not the issue's numbers ${shown(task.targets)}`);
  if (entry['margin'] !== 0.5) f.push(`${task.id} compares with the merge base at margin ${shown(entry['margin'])}, not the lane's 0.5`);
  if (!Array.isArray(entry['criteria']) || !entry['criteria'].includes(criterion)) f.push(`${task.id} doesn't name ${criterion} among its criteria, so the budget window never measures it`);
  if (!/#224\b/.test(String(entry['initialReason'] ?? ''))) f.push(`${task.id}'s initialReason doesn't name #224`);
  const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
  if (mergeBase.status !== 0) return [...f, `git merge-base HEAD origin/main: ${mergeBase.stderr}`];
  const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB });
  if (base.status !== 0) return [...f, `the merge base's benchmarks/budgets.json: ${base.stderr}`];
  try { (await bench()).validateBudgets(current, JSON.parse(base.stdout)); } catch (e) { f.push(`the lane's validator refuses budgets.json against the merge base's: ${String(e)}`); }
  return f;
}
/** The task's own judge on this checkout (the budget window's `judgeTargets`). */
export const judgeTask = async (task: Task): Promise<JsonObject> => (await bench()).judgeTargets(task, REPO);
export const load = (): number => loadavg()[0]!;
/** Whether this is a reference Mac at rest, by the perf lane's own rule (judgeLimit on five zero readings). */
export async function standing(loads: { start: number; end: number }): Promise<{ status: string; reason: string }> {
  const b = await bench();
  const r = b.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: b.fingerprint(), loads: Array.from({ length: 5 }, () => loads) });
  return { status: r.status, reason: r.reason ?? `load ${loads.start} and ${loads.end} on ${availableParallelism()} cores` };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run` (#377) for `view3d`'s own frames (#378)

/** One `deep-gpu run` process: exit 0, one answer line, ok, one reply per call. */
export function gpu(out: string, calls: JsonObject[]): JsonObject[] {
  const r = spawnSync(gpuBin(), ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 600_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`deep-gpu run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(r.status, `deep-gpu run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-gpu run: one answer line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-gpu run: the answer');
  expect(answer['ok'], `deep-gpu run answers the scenario ok: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-gpu run: replies').map((x, i) => obj(x, `deep-gpu run: replies[${i}]`));
  expect(replies.length, 'deep-gpu run: one reply per call').toBe(calls.length);
  return replies;
}
/** A `final` PNG `view3d` wrote into `dir`, named by its SHA-256, byte for byte. */
export function readPng(dir: string, hash: JsonValue | undefined, what: string): Buffer {
  expect(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash), `${what}: the renderer's final PNG, named by its SHA-256, got ${shown(hash)}`).toBe(true);
  const b = readFileSync(join(dir, `${hash as string}.png`));
  expect(sha256(b), `${what}: the PNG's SHA-256 is its name`).toBe(hash);
  return b;
}
