// Test-side tools for the #2013 acceptance tests: `deep-show` built with cargo and driven by JSON lines (#393's
// `deep-show run`, #420's `geometry` call, #411's `deep_query`, #387's `frames`, #403's claims and `verdict`); the
// documents the criteria describe, generated here so every file judges the same ones; and the judges the tests compute
// themselves (the least pairwise distance, bounds that pass into each other, the largest empty disc, a ball's gap to a
// box). Nothing here stands in for the scatter, the rest or the audit: every value a test compares comes from the
// binary, every expected value from the issue's text and the design. Parts are copied from #405's helpers, since
// suites don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2013 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** The criteria's IDs: `#2013.` and the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
export const AC = { 1: '#2013.8b415be3', 2: '#2013.8f9fddef', 3: '#2013.2dab09c8' } as const;

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
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
}
/** A leg that needs something this machine lacks fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with every module, copied out of target/.

const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `deep-show` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let made = { bin: '', error: 'the build did not run' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2013-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}` }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
      return;
    }
    const bin = join(dir, SHOW);
    copyFileSync(join(TARGET, 'debug', SHOW), bin);
    made = { bin, error: '' };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2013-')); made.push(d); return d; };
}

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
  expect(out['ok'], `${SHOW} run refused the scenario${typeof scenario['planted'] === 'string' ? ` (its planted program is ${scenario['planted']})` : ''}: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

/** The working agent, alpha. */
export const SESSION = 'sess-alpha';
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB2013D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB2013C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB2013Q', n)}`;

/** The scenario: the documents on the panel (each shown by a call), the claims, the calls, and a planted program. */
export function scenarioOf(evidence: string, docs: readonly string[], calls: JsonObject[], more: { claims?: JsonObject; planted?: string } = {}): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: garden', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    ...(more.claims ? { claims: more.claims } : {}), ...(more.planted ? { planted: more.planted } : {}), calls,
  };
}

/** The working agent's deep_show of a whole revision (#393's agent form: no `id`, no `layers`). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** #420's `geometry` call on the named items. */
export const geometry = (doc: string, items: readonly string[]): JsonObject => ({ call: 'geometry', doc, items: [...items] });
/** #411's `deep_query` of evaluated values at 0 s. */
export const query = (doc: string, paths: readonly string[]): JsonObject => ({ call: 'deep_query', session: SESSION, doc, paths: [...paths], at: ['0s'] });
/** #387's `frames`: `count` frames 1/60 s apart from 0. */
export const frames = (doc: string, count: number): JsonObject => ({ call: 'frames', doc, count });
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });
/** Alpha's claim on one deliverable, its locked definition one requirement holding `check`. */
export const claimOf = (doc: string, req: string, check: JsonObject): JsonObject => ({ session: SESSION, deliverables: [doc], requirements: [{ id: req, check }] });

/** The show was presented: no error issue, and no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject, what: string): void {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const unknown = [...notices, ...issues].filter((n) => n['code'] === 'unknown_kind');
  expect(unknown.map((n) => brief(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(issues.filter((i) => i['severity'] === 'error').map((i) => brief(i, 600)), `${what}: the check raises no error`).toEqual([]);
  expect(reply['outcome'], `${what} is presented: ${brief(reply, 3000)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// Scenes. Metres, +Y up, right +X. `mark.box@1` and `mark.sphere@1` are unit solids centred on `at.pos` and scaled by
// `params.size`; `plate@1 {grid, size: [x, z]}` is a flat sheet at y = 0, centred on `at.pos`, its normal +Y.

export type V3 = [number, number, number];
const box = (size: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, ...extra });
/** A flat plate `x` × `z` m centred on (`cx`, 0, `cz`). */
const plate = (x: number, z: number, cx = 0, cz = 0): JsonObject => ({ kind: 'plate@1', params: { grid: [1, 1], size: [x, z] }, at: { pos: [cx, 0, cz] } });
/** A prototype: a box of side `d`, hidden, drawn only as an instancer's elements. */
const proto = (d: number): JsonObject => box([d, d, d], { visible: false });
/** An instancer fed by a scatter: `params.from.distribute` holds the issue's fields. */
const scatter = (of: readonly string[], distribute: JsonObject): JsonObject => ({ kind: 'instance@1', params: { of: [...of], from: { distribute } } });

/** A scene in the agent's form: each item given its ID, name and order key; `reversed` lists the siblings, and orders them, the other way round. */
export function scene(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}, modules: readonly string[] = ['scene3d'], reversed = false): JsonObject {
  const entries = Object.entries(items).map(([id, item], k) => [id, { id, name: id, order: `a${String(reversed ? 9999 - k : k).padStart(4, '0')}`, ...item }] as const);
  if (reversed) entries.reverse();
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #2013 acceptance fixture.`, size: [640, 480],
    requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) }, ...extra, items: Object.fromEntries(entries),
  };
}

/** The issue's numbers. */
export const PLATE = 10;
export const MIN_DISTANCE = 0.5;
export const DISC_RADIUS = 1.0;
export const INSIDE = 0.5;
export const PLANTED_POINTS = 10;
export const TOLERANCE = 0.002;
/** The pinned upstream test's rtol on its least pairwise distance (the oracle page's test_fill_space), for f32 positions. */
export const RTOL = 1e-6;
/** Criterion 3's planted wrong program: the sampler stops after 10 points (README: The planted program). */
export const STOPS_AFTER_10 = 'distribute_stops_after_10_points';

/** Criterion 1's prototypes, boxes by side: prototype 0 `bush`, 1.2 m; prototype 1 `flower`, 0.3 m. */
export const PROTO_SIDES: readonly number[] = [1.2, 0.3];
export const SHRUBS = 'shrubs';
export const LOOSE = 'loose';
/**
 * Criterion 1: the 10 × 10 m plate and two scatters over it of the same two prototypes, the same seed and
 * `min_distance: 0.5`, turned by nothing (`yaw: [0, 0]`), so an element's bounds are its prototype's box at its point:
 * `shrubs` with `prune: larger_first`, and `loose`, the same with pruning left out (`prune: none` by default).
 * `reversed` lists and orders the siblings the other way round; nothing else differs.
 */
export function gardenDoc(reversed = false): JsonObject {
  const fields = { on: 'plate', mode: 'poisson', min_distance: MIN_DISTANCE, yaw: [0, 0], seed: 2013 };
  return scene('A scattered garden', {
    plate: plate(PLATE, PLATE),
    bush: proto(PROTO_SIDES[0]!),
    flower: proto(PROTO_SIDES[1]!),
    [SHRUBS]: scatter(['bush', 'flower'], { ...fields, prune: 'larger_first' }),
    [LOOSE]: scatter(['bush', 'flower'], fields),
  }, {}, ['scene3d'], reversed);
}

export const STONES = 'stones';
/**
 * Criterion 3 and the oracle lane: a flat plate `x` × `z` m centred on (`cx`, 0, `cz`) and `stones`, a poisson
 * scatter of one 0.1 m prototype over it with `min_distance`, plus any further distribute fields (`density`, `max`).
 */
export function poissonDoc(minDistance: number, more: JsonObject = {}, x = PLATE, z = PLATE, cx = 0, cz = 0): JsonObject {
  return scene('Stones on a plate', {
    plate: plate(x, z, cx, cz),
    stone: proto(0.1),
    [STONES]: scatter(['stone'], { on: 'plate', mode: 'poisson', min_distance: minDistance, seed: 2013, ...more }),
  });
}
/** Density 0 over the left half (x < 0) and 1 over the right: a field over `position`, from the closed function list. */
export const LEFT_HALF_EMPTY = 'max(sign(position.x), 0)';

// ---- Criterion 2: a round vase over a tilted table top

export const VASE = { r: 0.1, x: -0.3, start: 1.2 } as const;
export const TABLE = { size: [1.2, 0.05, 0.8] as V3, pos: [0, 0.8, 0] as V3, tilt: 20 } as const;
/**
 * `table`, a 1.2 × 0.05 × 0.8 m top centred at y 0.8 and tilted 20° about +Z (its +X side up), and `vase`, a ball of
 * radius 0.1 m written 0.3 m left of the table's centre at y 1.2, well above it. The constraint `rest` rests the vase
 * on the table with every default: `{owner: vase, kind: rest_on, on: table}` (axis (0, −1, 0), contact true_shape,
 * offset 0, max_drop 10). Nothing in the document moves.
 */
export function vaseDoc(): JsonObject {
  return scene('A vase on a table', {
    table: { kind: 'mark.box@1', params: { size: [...TABLE.size] }, at: { pos: [...TABLE.pos], rot: [0, 0, TABLE.tilt] } },
    vase: { kind: 'mark.sphere@1', params: { size: [2 * VASE.r, 2 * VASE.r, 2 * VASE.r] }, at: { pos: [VASE.x, VASE.start, 0] } },
  }, { constraints: { rest: { owner: 'vase', kind: 'rest_on', on: 'table' } } }, ['scene3d', 'motion']);
}
/** The definition's check: the scene audit at 2 mm for a part sunk into another and for a part that touches nothing; the table may float. */
export const VASE_CHECK: JsonObject = { kind: 'geometry.audit', scope: 'scene', tolerance: { sunk: TOLERANCE, touch: TOLERANCE, land: TOLERANCE }, support: { floating: ['table'] } };

/** The vase's gap to the table's true shape with its centre at `c`, in m: over 0 apart, under 0 passing into it. */
export function vaseGap(c: V3): number {
  const a = (TABLE.tilt * Math.PI) / 180;
  const d: V3 = [c[0] - TABLE.pos[0], c[1] - TABLE.pos[1], c[2] - TABLE.pos[2]];
  // The centre in the table's own axes: u along its length (tilted), n its top's normal, z its depth.
  const local: V3 = [d[0] * Math.cos(a) + d[1] * Math.sin(a), -d[0] * Math.sin(a) + d[1] * Math.cos(a), d[2]];
  const q = local.map((v, k) => Math.abs(v) - TABLE.size[k]! / 2);
  const outside = Math.hypot(...q.map((v) => Math.max(v, 0)));
  return outside + Math.min(Math.max(...q), 0) - VASE.r;
}
/** The height of the vase's centre where its ball touches the table's top, 0.3 m left of the table's centre. */
export function vaseRestY(): number {
  const a = (TABLE.tilt * Math.PI) / 180;
  return TABLE.pos[1] + (TABLE.size[1] / 2 + VASE.r + Math.sin(a) * (VASE.x - TABLE.pos[0])) / Math.cos(a);
}

// ---------------------------------------------------------------------------------------------------
// Reading a scatter back: the `geometry` call's row for an instancer (README: The surface under test).

/** One element of an instancer: its stable ID, its prototype's index in `of`, its point, and its turn and scale. */
export interface Element { id: number; proto: number; pos: V3; yaw: number; scale: V3 }

/** The elements of instancer `id` in a `geometry` reply, by stable ID. */
export function elementsOf(reply: JsonObject, id: string, protos: number, what: string): Element[] {
  expect(reply['code'], `${what}: the geometry call answers for the instancer ${id}: ${brief(reply)}`).toBeUndefined();
  const row = arr(reply['items'], `${what}: the geometry reply's items`).filter(isObject).find((r) => r['id'] === id);
  expect(row, `${what}: the geometry reply has a row for the instancer ${id}: ${brief(reply)}`).toBeDefined();
  const out = arr(row!['elements'], `${what}: ${id}'s row lists its elements`).map((v, i): Element => {
    const e = obj(v, `${what}: ${id}.elements[${i}]`);
    const p = arr(e['pos'], `${what}: ${id}.elements[${i}].pos`);
    expect(p.length, `${what}: ${id}.elements[${i}].pos holds three numbers`).toBe(3);
    const s = e['scale'] ?? 1;
    const scale = (Array.isArray(s) ? s : [s, s, s]).map((x, k) => num(x, `${what}: ${id}.elements[${i}].scale[${k}]`));
    expect(scale.length, `${what}: ${id}.elements[${i}].scale is a number or three`).toBe(3);
    return {
      id: num(e['id'], `${what}: ${id}.elements[${i}].id`),
      proto: num(e['proto'] ?? 0, `${what}: ${id}.elements[${i}].proto`),
      pos: [num(p[0], 'pos[0]'), num(p[1], 'pos[1]'), num(p[2], 'pos[2]')],
      yaw: num(e['yaw'] ?? 0, `${what}: ${id}.elements[${i}].yaw`),
      scale: scale as V3,
    };
  });
  const ids = out.map((e) => e.id);
  expect(ids.every((n) => Number.isInteger(n) && n >= 0) && new Set(ids).size === ids.length, `${what}: ${id}'s element IDs are whole numbers, none twice`).toBe(true);
  expect(out.every((e) => Number.isInteger(e.proto) && e.proto >= 0 && e.proto < protos), `${what}: every element of ${id} names one of its ${protos} prototypes`).toBe(true);
  return out.sort((a, b) => a.id - b.id);
}
/** A scatter as text, for comparing two of them to the last bit: each element by ID with its prototype, point, turn and scale. */
export const pointsText = (elements: readonly Element[]): string => JSON.stringify(elements.map((e) => [e.id, e.proto, e.pos, e.yaw, e.scale]));

// ---------------------------------------------------------------------------------------------------
// The judges the tests compute themselves. Each is run on a planted set it must fail, in every file that uses it.

/** The least distance between two of `points`, and the pair; Infinity for fewer than two. */
export function leastDistance(points: readonly V3[]): { d: number; pair: [number, number] } {
  let best = { d: Infinity, pair: [-1, -1] as [number, number] };
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const d = Math.hypot(points[i]![0] - points[j]![0], points[i]![1] - points[j]![1], points[i]![2] - points[j]![2]);
    if (d < best.d) best = { d, pair: [i, j] };
  }
  return best;
}
/** Why `points` break the distance rule: fewer than two points, or a pair closer than `min` (less upstream's rtol). */
export function distanceFailures(points: readonly V3[], min: number, what: string): string[] {
  if (points.length < 2) return [`${what} places ${points.length} point(s): no pair to judge`];
  const { d, pair } = leastDistance(points);
  return d >= min * (1 - RTOL) ? [] : [`${what}: points ${pair[0]} and ${pair[1]} are ${d} m apart, under ${min} m`];
}

/** An element's bounds: its prototype's box of side `sides[proto]`, scaled, turned by its yaw about +Y, at its point. */
export function boundsOf(e: Element, sides: readonly number[]): { min: V3; max: V3 } {
  const [c, s] = [Math.abs(Math.cos((e.yaw * Math.PI) / 180)), Math.abs(Math.sin((e.yaw * Math.PI) / 180))];
  const size = e.scale.map((k) => Math.abs(k) * sides[e.proto]!) as V3;
  const half: V3 = [(c * size[0] + s * size[2]) / 2, size[1] / 2, (s * size[0] + c * size[2]) / 2];
  return { min: e.pos.map((p, k) => p - half[k]!) as V3, max: e.pos.map((p, k) => p + half[k]!) as V3 };
}
/** The pairs of elements whose bounds pass more than `tolerance` into each other, with the depth, deepest first. */
export function boundsOverlaps(elements: readonly Element[], sides: readonly number[], tolerance: number): { a: number; b: number; depth: number }[] {
  const boxes = elements.map((e) => boundsOf(e, sides));
  const out: { a: number; b: number; depth: number }[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const depth = Math.min(...[0, 1, 2].map((k) => Math.min(boxes[i]!.max[k]!, boxes[j]!.max[k]!) - Math.max(boxes[i]!.min[k]!, boxes[j]!.min[k]!)));
    if (depth > tolerance) out.push({ a: elements[i]!.id, b: elements[j]!.id, depth });
  }
  return out.sort((p, q) => q.depth - p.depth);
}

/**
 * An empty disc of radius `radius` on the plane y = 0 whose centre lies more than `inside` within the square plate of
 * side `side` centred on the origin: its centre and the distance from it to the nearest point, or null when there is
 * none. Exact by branch and bound: the distance to the nearest point changes by at most the distance moved, so a cell
 * whose centre is nearer a point than `radius` less its half diagonal holds no such centre, and is dropped; a centre at
 * least `radius` from every point is the disc; any other cell splits in four. A cell under a micron that still can't
 * be dropped holds a disc empty to within a micron, and is returned.
 */
export function emptyDisc(points: readonly V3[], side: number, inside: number, radius: number): { centre: [number, number]; nearest: number } | null {
  const nearest = (x: number, z: number): number => points.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[2] - z)), Infinity);
  const stack: [number, number, number][] = [[0, 0, side / 2 - inside]];
  while (stack.length) {
    const [x, z, half] = stack.pop()!;
    const d = nearest(x, z);
    if (d >= radius || half < 1e-6) return { centre: [x, z], nearest: d };
    if (d + half * Math.SQRT2 < radius) continue;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) stack.push([x + (sx * half) / 2, z + (sz * half) / 2, half / 2]);
  }
  return null;
}

/** A square lattice of points `pitch` apart over the plate of side `side`, edges included: a planted set for the judges. */
export function lattice(side: number, pitch: number): V3[] {
  const n = Math.round(side / pitch);
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) out.push([-side / 2 + i * pitch, 0, -side / 2 + j * pitch]);
  return out;
}
/**
 * The judges fail their planted sets, so a judge that passes everything can't pass a file:
 * - distance: the 0.5 m lattice passes at 0.5 m; with one more point 0.4 m from a lattice point, it fails;
 * - empty disc: the lattice leaves none; with every point within 1.0 m of (2.25, 2.25) removed, it leaves that one;
 * - bounds: two 1.2 m boxes 1.3 m apart pass; 1.0 m apart along x and z, further than the 0.5 m minimum, they fail,
 *   0.2 m deep, while a 0.3 m box 0.7 m from one of them fails too.
 */
export function judgesFailTheirPlants(): void {
  const grid = lattice(PLATE, MIN_DISTANCE);
  expect(distanceFailures(grid, MIN_DISTANCE, 'the lattice'), 'the distance judge passes the 0.5 m lattice').toEqual([]);
  expect(distanceFailures([...grid, [0.4, 0, 0]], MIN_DISTANCE, 'the lattice and a point 0.4 m off').length, 'the distance judge fails a pair 0.4 m apart').toBe(1);
  expect(distanceFailures([[0, 0, 0]], MIN_DISTANCE, 'one point').length, 'the distance judge fails a set with no pair').toBe(1);
  expect(emptyDisc(grid, PLATE, INSIDE, DISC_RADIUS), 'the empty-disc judge finds no disc on the 0.5 m lattice').toBeNull();
  const holed = grid.filter((p) => Math.hypot(p[0] - 2.25, p[2] - 2.25) > DISC_RADIUS);
  const found = emptyDisc(holed, PLATE, INSIDE, DISC_RADIUS);
  expect(found, 'the empty-disc judge finds the disc cut out of the lattice').not.toBeNull();
  expect(Math.hypot(found!.centre[0] - 2.25, found!.centre[1] - 2.25), 'the disc it finds is the one cut out').toBeLessThan(0.3);
  const at = (id: number, proto: number, x: number, z: number): Element => ({ id, proto, pos: [x, 0, z], yaw: 0, scale: [1, 1, 1] });
  expect(boundsOverlaps([at(0, 0, 0, 0), at(1, 0, 1.3, 0)], PROTO_SIDES, TOLERANCE), 'the bounds judge passes two 1.2 m boxes 1.3 m apart').toEqual([]);
  const close = boundsOverlaps([at(0, 0, 0, 0), at(1, 0, 1.0, 1.0), at(2, 1, -0.7, 0)], PROTO_SIDES, TOLERANCE);
  expect(close.map((o) => [o.a, o.b]), 'the bounds judge fails boxes further apart than the minimum distance whose bounds still pass into each other').toEqual([[0, 1], [0, 2]]);
  expect(close[0]!.depth, 'the two 1.2 m boxes pass 0.2 m into each other').toBeCloseTo(0.2, 9);
}

// ---------------------------------------------------------------------------------------------------
// The verdict's row (#405's README: The verdict's row)

export interface Issue { code: string; severity: string; ids: string[]; raw: JsonObject }
export interface Row { result: string; issues: Issue[]; raw: JsonObject }
/** The row of requirement `req` in a verdict. */
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for its requirement: ${brief(v)}`).toBeDefined();
  const issues = (Array.isArray(raw!['issues']) ? raw!['issues'] : []).map((x, i) => {
    const o = obj(x, `${what}: issues[${i}]`);
    const ids = Array.isArray(o['ids']) ? o['ids'].filter((s): s is string => typeof s === 'string') : [];
    return { code: String(o['code']), severity: String(o['severity']), ids: [...ids].sort(), raw: o };
  });
  return { result: String(raw!['result']), issues, raw: raw! };
}
/** Why the row isn't a clean PASS: its result, and every error or warning raised. */
export function passFailures(row: Row, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw)}`);
  for (const i of row.issues.filter((x) => x.severity === 'error' || x.severity === 'warning')) failures.push(`${what} raises ${i.code} naming ${i.ids.join(', ') || 'nothing'} (${i.severity}): ${brief(i.raw, 600)}`);
  return failures;
}
