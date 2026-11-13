// Test-side tools for the #1700 acceptance tests: `deep-show` built per Cargo feature set (in release too, for the
// budgets) and driven by JSON lines (#393's `deep-show run`, #403's claims, requirements and `verdict`); stored
// scene documents (#96) of the fixtures the criteria describe, generated here so every file judges the same
// surfaces; glTF fixtures kept in the evidence store by SHA-256, as `mesh.asset@1` reads them (#420, #453); and
// reading geometry.shape's requirement rows, their `results` and their `geometry.reading` issues (README: The
// surface under test). Nothing here stands in for geometry.shape or a verdict: every value a test compares comes
// from the binary, every expected value from the issue's text and the design. Parts are copied from #405's, #1936's
// and #453's helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { glb, type Mesh, type V3 } from './gltf.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type { V3 };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1700 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** The check kind under test. */
export const KIND = 'geometry.shape';
/** The issue code a reading that differs from its expected value raises. */
export const READING = 'geometry.reading';

/** The planted wrong programs this suite names (README: The planted programs), each the scenario's `planted`. */
export const PLANTED = {
  holes: 'holes_count_face_contours',
  route: 'asset_read_unplaced',
  volume: 'volume_sums_flipped_faces',
  section: 'section_leaves_segments_unjoined',
  probe: 'probe_tests_bounds_only',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** `got` is a finite number within `rel` of `want`, relative to `want`. */
export const nearRel = (got: JsonValue | undefined, want: number, rel: number): boolean =>
  typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= rel * Math.abs(want);
/** `got` is a finite number within `abs` of `want`. */
export const nearAbs = (got: JsonValue | undefined, want: number, abs: number): boolean =>
  typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= abs;

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` per Cargo feature set, copied out of target/ under its own name (#405's helpers).

/** A feature set, debug unless `release`. */
export interface Build { features: string[]; release?: boolean }
export const FULL: Build = { features: ['full'] };
export const RELEASE: Build = { features: ['full'], release: true };
const nameOf = (b: Build): string => `${b.features.join('+')}${b.release ? '-release' : ''}`;
const cargoArgs = (b: Build): string[] =>
  ['build', '--locked', ...(b.release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', b.features.join(',')];

/** Builds `b` and copies the binary into `dir`: the binary, or cargo's error. */
export function buildInto(b: Build, dir: string): { bin: string; error: string } {
  const args = cargoArgs(b);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const bin = join(dir, `${SHOW}-${nameOf(b).replace(/[^a-z0-9+.-]/g, '_')}`);
  copyFileSync(join(TARGET, b.release ? 'release' : 'debug', SHOW), bin);
  return { bin, error: '' };
}

/** Builds `full` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let made: { bin: string; error: string } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1700-bin-'));
    made = buildInto(FULL, dir);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (!made) throw Error('the build never ran');
    expect(made.error, `the binary builds: cargo ${cargoArgs(FULL).join(' ')}`).toBe('');
    return made.bin;
  };
}

/** Fresh folders for a test (evidence stores, binaries), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1700-')); made.push(d); return d; };
}

/** Keeps `bytes` in the evidence store at `<first 2 hex>/<other 62 hex>` (deep-show's `evidence::put` layout); its SHA-256. */
export function putEvidence(root: string, bytes: Uint8Array): string {
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(join(root, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
/** A glTF fixture written as a GLB into the evidence store: its SHA-256. */
export const putMesh = (root: string, mesh: Mesh): string => putEvidence(root, glb(mesh));

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process on this machine: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the working agent alpha, the process table, one panel, and stored documents.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: shapes', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1700D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1700C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1700Q', n)}`;

/** One requirement of a claim's locked definition: its ID and its check. */
export interface Requirement { id: string; check: JsonObject }
/** Alpha's claim on one deliverable, its locked definition holding `requirements`. */
export const claimOf = (doc: string, requirements: Requirement[]): JsonObject =>
  ({ session: ALPHA.id, deliverables: [doc], requirements: requirements.map((r) => ({ id: r.id, check: r.check })) });

/** The scenario: each stored document opened as revision 0 on the panel, the claims, the calls, and a planted program. */
export function scenarioOf(evidence: string, docs: Record<string, JsonObject>, claims: JsonObject, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(Object.entries(docs).map(([d, document]) => [d, { panel: 'main', document }])),
    claims, ...(planted ? { planted } : {}), calls,
  };
}
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });

// ---------------------------------------------------------------------------------------------------
// The check input (README: The check, as a claim's requirement)

/** `geometry.shape {of, readings, expect}`, read at the start (no `at`). */
export const shape = (of: string | string[], readings: JsonValue[], expected: JsonObject): JsonObject =>
  ({ kind: KIND, of, readings, expect: expected });
export const section = (axis: 'x' | 'y' | 'z', at: number): JsonObject => ({ section: { axis, at } });
export const probe = (from: V3, dir: V3): JsonObject => ({ probe: { from, dir } });
export const tips = (axis: 'x' | 'y' | 'z'): JsonObject => ({ tips: { axis } });
export const rests = (on: string): JsonObject => ({ rests: { on } });

// ---------------------------------------------------------------------------------------------------
// The verdict's row (README: The verdict's row)

/** One result: `{reading, path: readings/<i>, ids, value}` and the fields a reading adds. */
export interface Result { path: string; ids: string[]; value: JsonValue | undefined; raw: JsonObject }
/** One issue: `geometry.reading {ids, path, reading, expected, actual}` and the rest of the issue's fields. */
export interface Issue { code: string; ids: string[]; path: string; reading: JsonValue | undefined; expected: JsonValue | undefined; actual: JsonValue | undefined; raw: JsonObject }
export interface Row { result: string; issues: Issue[]; results: Result[]; raw: JsonObject }

const strings = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const list = (o: JsonObject, k: string): JsonObject[] => (Array.isArray(o[k]) ? (o[k] as JsonValue[]).filter(isObject) : []);

/** The row of requirement `req` in a verdict. */
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const raw = list(v, 'requirements').find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for its requirement: ${brief(v)}`).toBeDefined();
  return {
    result: String(raw!['result']), raw: raw!,
    issues: list(raw!, 'issues').map((i) => ({
      code: String(i['code']), ids: strings(i['ids']), path: String(i['path'] ?? ''), reading: i['reading'], expected: i['expected'], actual: i['actual'], raw: i,
    })),
    results: list(raw!, 'results').map((r) => ({ path: String(r['path'] ?? ''), ids: strings(r['ids']), value: r['value'], raw: r })),
  };
}
/** The row is decided as `result`; the message carries the row. */
export function decided(row: Row, result: string, what: string): void {
  expect(row.result, `${what} is ${result}: ${brief(row.raw, 3000)}`).toBe(result);
}
/** The results of the check's reading `i` (`path: readings/<i>`). */
export const resultsAt = (row: Row, i: number): Result[] => row.results.filter((r) => r.path === `readings/${i}`);
/** The one result of reading `i`, as for a reading of one surface or of one part. */
export function oneAt(row: Row, i: number, what: string): Result {
  const found = resultsAt(row, i);
  expect(found.length, `${what}: one result at readings/${i}: ${brief(row.raw['results'] ?? null, 3000)}`).toBe(1);
  return found[0]!;
}
/** The `geometry.reading` issues on reading `i`: their path is `readings/<i>`, alone or at the end of a longer path. */
export const readingIssuesAt = (row: Row, i: number): Issue[] =>
  row.issues.filter((x) => x.code === READING && (x.path === `readings/${i}` || x.path.endsWith(`/readings/${i}`)));
/** Whether `ids` names a part of `item`: `<item>#<n>`. */
export const namesPart = (ids: readonly string[], item: string): boolean => ids.some((id) => id.startsWith(`${item}#`) && /^\d+$/.test(id.slice(item.length + 1)));
/** A count a result gives as a number, or as a list's length. */
export const countOf = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : Array.isArray(v) ? v.length : null);
/** A world point: three finite numbers. */
export const point = (v: JsonValue | undefined): V3 | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as V3) : null;

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures). Metres, +Y up. Every scene is a stored document in your layer, its items given
// their ID, name, draw order and layer in the order listed.

const LAYER = 'you-main';
export function stored(title: string, items: Record<string, JsonObject>): JsonObject {
  const out: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, layer: LAYER, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1700 acceptance fixture.`, size: [640, 480],
    requires: { modules: { scene3d: '^1' } },
    layers: { [LAYER]: { writer: 'you:you', title: 'You', order: 'a0' } },
    items: out,
  };
}
const placed = (pos: V3): JsonObject => ({ at: { pos } });
/** A `slab@1` of `size` (x across, y up, z deep): centred across its plan, standing on y = 0 of its own frame. */
const slab = (size: V3, pos: V3 = [0, 0, 0]): JsonObject => ({ kind: 'slab@1', params: { size }, ...placed(pos) });
/** A `mesh.asset@1` naming a glTF in the evidence store by SHA-256, node 0, at `scale`. */
const asset = (sha256: string, scale = 1): JsonObject =>
  ({ kind: 'mesh.asset@1', params: { sha256, node: 0, paint: { fill: { role: 'accent' } } }, ...(scale === 1 ? {} : { at: { scale: [scale, scale, scale] } }) });

// ---- The window (criteria 1, 2, 3 and 5)

/** The window's four holes, each 0.2 m square, centred at (±0.25, ±0.25) m: edges at ±0.15 and ±0.35 m. */
export const HOLE_CENTRES: readonly [number, number][] = [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]];
const HOLES = [
  [[-0.35, -0.35], [-0.15, -0.35], [-0.15, -0.15], [-0.35, -0.15]],
  [[0.15, -0.35], [0.35, -0.35], [0.35, -0.15], [0.15, -0.15]],
  [[0.15, 0.15], [0.35, 0.15], [0.35, 0.35], [0.15, 0.35]],
  [[-0.35, 0.15], [-0.15, 0.15], [-0.15, 0.35], [-0.35, 0.35]],
];
/** The window's thickness along z, in m: it spans z = 0 to 0.1. */
export const WINDOW_DEPTH = 0.1;
/** The window's volume: 1 × 1 × 0.1 − 4 × 0.2 × 0.2 × 0.1 m³. */
export const WINDOW_VOLUME = 0.084;
/** The extruded window: `extrude@1`, a 1 × 1 m square outline with the four holes, 0.1 m along +z. */
export const windowDoc = (): JsonObject => stored('A window', {
  window: { kind: 'extrude@1', params: { outline: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], holes: HOLES, depth: WINDOW_DEPTH } },
});
/** The cut window: the glTF a slab with four boolean cuts leaves (gltf.ts `cutWindow`, in dm), placed at scale 0.1. */
export const cutWindowDoc = (sha256: string): JsonObject => stored('A window cut from a slab', { 'cut-window': asset(sha256, 0.1) });

// ---- The cube and the torus (criterion 1)

/** A solid 1 m cube. */
export const cubeDoc = (): JsonObject => stored('A cube', { cube: slab([1, 1, 1]) });
/** `n` points around the circle of radius `r` centred at (`cr`, `cy`) in a lathe's (r, y) plane, counter-clockwise. */
const circle = (cr: number, cy: number, r: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, k) => { const a = (2 * Math.PI * k) / n; return [cr + r * Math.cos(a), cy + r * Math.sin(a)]; });
/** A torus of radius 1 m and tube radius 0.25 m: a `lathe@1` of a closed 32-point circle about y, 32 segments. */
export const torusDoc = (): JsonObject => stored('A torus', { torus: { kind: 'lathe@1', params: { outline: circle(1, 0, 0.25, 32), closed: true } } });

// ---- The boxes (criterion 3): gltf.ts `box`

export const boxDoc = (sha256: string): JsonObject => stored('A box', { box: asset(sha256) });
export const flippedBoxDoc = (sha256: string): JsonObject => stored('A box with one face flipped', { 'flipped-box': asset(sha256) });

// ---- The posts (criterion 4)

/** The five posts' IDs and their centres along x, 0.5 m apart. */
export const POSTS: readonly string[] = ['post-1', 'post-2', 'post-3', 'post-4', 'post-5'];
/** Five posts, each a `slab@1` 0.1 m square and 1 m high standing on y = 0, centred at x = −1, −0.5, 0, 0.5 and 1. */
export const postsDoc = (): JsonObject => stored('Five posts', Object.fromEntries(POSTS.map((id, k) => [id, slab([0.1, 1, 0.1], [0.5 * (k - 2), 0, 0])])));

// ---- The gears (criterion 6)

/**
 * A 12-tooth gear's outline about the origin, counter-clockwise in (x, y): tooth k centred at 30k degrees, its
 * flanks from the root radius 0.42 m at ±9° to the outer radius 0.5 m at ±5°, each two teeth joined by a straight
 * root. `without` leaves tooth `without` out, its root joined straight across the gap.
 */
export function gearOutline(without?: number): [number, number][] {
  const out: [number, number][] = [];
  const p = (r: number, deg: number): [number, number] => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
  for (let k = 0; k < 12; k++) {
    if (k === without) continue;
    out.push(p(0.42, 30 * k - 9), p(0.5, 30 * k - 5), p(0.5, 30 * k + 5), p(0.42, 30 * k + 9));
  }
  return out;
}
/** The gear, `extrude@1` 0.05 m along +z, and the same gear with tooth 0 removed, 2 m along x. */
export const gearsDoc = (): JsonObject => stored('Two gears', {
  gear: { kind: 'extrude@1', params: { outline: gearOutline(), depth: 0.05 } },
  'gear-11': { kind: 'extrude@1', params: { outline: gearOutline(0), depth: 0.05 }, ...placed([2, 0, 0]) },
});

// ---- The resting cubes (criterion 7)

/** The raise, in m. */
export const RAISE = 0.002;
/** A 0.3 m cube standing on y = 0, and the same cube 1 m along x raised by 2 mm. */
export const restingDoc = (): JsonObject => stored('Two cubes on the ground', {
  cube: slab([0.3, 0.3, 0.3]),
  raised: slab([0.3, 0.3, 0.3], [1, RAISE, 0]),
});

// ---- The closed 100,000-triangle part (criterion 8)

/** The budget torus's outline points and segments: 250 bands × 200 segments × 2 = 100,000 triangles. */
export const BIG = { points: 250, segments: 200, triangles: 100_000 } as const;
/**
 * A torus of radius 1 m and tube radius 0.25 m, a `lathe@1` of a closed 250-point circle about y with 200 segments
 * (each band of the closed outline makes 2 triangles a segment: 250 × 200 × 2 = 100,000), centred 0.25 m up so its
 * lowest points are 2e-5 m above the ground.
 */
export const bigTorusDoc = (): JsonObject => stored('A closed 100,000-triangle torus', {
  torus: { kind: 'lathe@1', params: { outline: circle(1, 0, 0.25, BIG.points), closed: true, segments: BIG.segments }, ...placed([0, 0.25, 0]) },
});

// ---------------------------------------------------------------------------------------------------
// The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end).

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
/** A timing reading on a row, `timing.<key>` in ms: null when it isn't a finite number ≥ 0. */
export function timingOf(row: Row, key: string): number | null {
  const t = row.raw['timing'];
  const v = isObject(t) ? t[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}
