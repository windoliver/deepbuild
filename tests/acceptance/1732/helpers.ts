// Test-side tools for the #1732 acceptance tests: `deep-show` (the canvas core's scenario binary) built once per
// file and driven by one scenario line; the calls this suite reads (`deep_show` with render-back's `audit`,
// `deep_query` values, `frames` with its `solves` counters); the room documents the criteria name; and the
// reviewed references the relations are held to: oriented boxes turned only about +Y, their overlap depth and
// gap, and each relation's miss. Nothing here stands in for the solve, the audit or the scheduler.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 1_800_000;

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text. */
export const AC = {
  1: 'AC1 #1732.1a7a49ce',
  2: 'AC2 #1732.c7ddc865',
  3: 'AC3 #1732.88ac1cf0',
  4: 'AC4 #1732.f19db12b',
  5: 'AC5 #1732.8a28edd6',
} as const;

/** The issue's tolerances: every relation held to 1 mm and 1°, no interpenetration past 1 mm, a 20° facing cone. */
export const MM = 0.001;
export const DEG = 1;
export const FACING_CONE = 20;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export function canon(v: JsonValue | undefined): string {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Every number anywhere in a JSON value. */
export function numbersIn(v: JsonValue | undefined): number[] {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(numbersIn);
  if (isObject(v)) return Object.values(v).flatMap(numbersIn);
  return [];
}

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The binary: deep-show in the full build set, built once per file and copied out under its own name.

const BUILD = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');

export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1732-bin-'));
    const env = {
      ...process.env,
      PATH: `/opt/homebrew/opt/rustup/bin:${process.env['PATH'] ?? ''}`,
      CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
      CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    };
    const run = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${BUILD.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(targetDir(), 'debug', 'deep-show'), join(dir, 'deep-show'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, 'deep-show builds').toBe('');
    return join(dir, 'deep-show');
  };
}

/** A fresh evidence folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1732-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out (#393), with one reply per call.

export type Planted = 'arrange_ignores_pair_overlap' | 'arrange_solves_per_frame';
export const SESSION = 'sess-alpha';
const ulid = (n: number): string => `01JB1732D${String(n).padStart(17, '0')}`;
export const DOC = { a: ulid(1), b: ulid(2) } as const;

export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: Planted): JsonObject {
  const docsOut: JsonObject = {};
  const panels: JsonObject = {};
  docs.forEach((id, i) => { docsOut[id] = { panel: `p${i + 1}` }; panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; });
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: arrange', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels, docs: docsOut, calls, ...(planted ? { planted } : {}),
  };
}

export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 1_500_000, killSignal: 'SIGKILL' });
  expect(run.error, `deep-show run ran: ${run.error?.message}`).toBeUndefined();
  expect(run.status, `deep-show run exited 0; stdout: ${(run.stdout ?? '').slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'one answer line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'the answer');
  expect(answer['ok'], `deep-show accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'replies').map((r, i) => obj(r, `replies[${i}]`));
  expect(replies.length, 'one reply per call').toBe(arr(sc['calls'], 'calls').length);
  return replies;
}

/** The agent's deep_show of a whole revision, asking for its issues and render-back's geometry audit. */
export const show = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues', 'audit'] });
export const query = (doc: string, ids: readonly string[]): JsonObject =>
  ({ call: 'deep_query', session: SESSION, doc, paths: ids.flatMap((id) => [`items/${id}/at/pos`, `items/${id}/at/rot`]), at: ['0s'] });
export const frames = (doc: string, count: number): JsonObject => ({ call: 'frames', doc, count });

export interface Issue { code: string; severity: string; raw: JsonObject }
export const issuesOf = (reply: JsonObject): Issue[] =>
  arr(reply['issues'] ?? [], 'issues').map((v, i) => {
    const o = obj(v, `issues[${i}]`);
    return { code: String(o['code']), severity: String(o['severity']), raw: o };
  });

/** Presented with no error issue and no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject, what: string): void {
  const errors = issuesOf(reply).filter((i) => i.severity === 'error');
  expect(errors.map((e) => canon(e.raw)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply['notices'] ?? [], `${what}: notices`).filter((n) => isObject(n) && n['code'] === 'unknown_kind');
  expect(skipped.map(canon), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply['outcome'], `${what}: presented, got ${shown(reply)}`).toBe('presented');
}

/** Render-back's geometry audit on a deep_show reply: `{failures: [{check, ids, …}]}`. */
export interface Failure { check: string; ids: string[]; raw: JsonObject }
export function auditOf(reply: JsonObject, what: string): Failure[] {
  const audit = obj(reply['audit'], `${what}: the reply's audit`);
  return arr(audit['failures'], `${what}: audit.failures`).map((v, i) => {
    const o = obj(v, `${what}: audit.failures[${i}]`);
    return { check: String(o['check']), ids: arr(o['ids'], `${what}: audit.failures[${i}].ids`).map(String), raw: o };
  });
}

/** Each named item's evaluated pose from a deep_query reply. */
export interface Pose { pos: [number, number, number]; rot: [number, number, number] }
export function posesOf(reply: JsonObject, ids: readonly string[], what: string): Map<string, Pose> {
  const values = obj(reply['values'], `${what}: values`);
  const v3 = (path: string): [number, number, number] => {
    const at = arr(values[path], `${what}: values[${path}]`);
    const a = arr(at[0], `${what}: ${path} at 0s`);
    expect(a.length, `${what}: ${path} has three numbers`).toBe(3);
    return [num(a[0], path), num(a[1], path), num(a[2], path)];
  };
  return new Map(ids.map((id) => [id, { pos: v3(`items/${id}/at/pos`), rot: v3(`items/${id}/at/rot`) }]));
}
/** One hash over the poses, keys sorted. */
export const posesHash = (poses: Map<string, Pose>): string =>
  sha256(canon(Object.fromEntries([...poses].map(([id, p]) => [id, { pos: p.pos, rot: p.rot }]))));

// ---------------------------------------------------------------------------------------------------
// The documents (README: Fixtures). Metres, +Y up, front +Z; north is −Z.

export type V3 = [number, number, number];
export const SIZE = {
  floor: [4.2, 0.1, 3.2], wall_ns: [4.2, 2.5, 0.1], wall_ew: [0.1, 2.5, 3.0],
  table: [1.2, 0.75, 0.8], chair: [0.65, 0.85, 0.65], lamp: [0.2, 0.45, 0.2], shelf: [0.9, 1.8, 0.35], rug: [1.0, 0.01, 0.6],
  fan: [0.3, 0.05, 0.3],
} as const satisfies Record<string, V3>;
export const SHELL = ['floor', 'wall_n', 'wall_e', 'wall_s', 'wall_w'] as const;
export const FOUR = ['chair_1', 'chair_2', 'chair_3', 'chair_4'] as const;
export const SIX = ['chair_1', 'chair_2', 'chair_3', 'chair_4', 'chair_5', 'chair_6'] as const;
export const ARRANGED = ['table', ...FOUR, 'lamp', 'shelf', 'rug'] as const;
export const ARRANGEMENT = 'arrangement';

export interface Relation { a: string; rel: string; b: string; d?: number }
const box = (size: readonly number[], pos: V3, yaw = 0): JsonObject =>
  ({ kind: 'mark.box@1', params: { size: [...size] }, at: { pos, rot: [0, yaw, 0] } });

/** The room's fixed shell: a floor whose top is y = 0 and four walls standing on it around a 4 × 3 m interior. */
function shell(): Record<string, JsonObject> {
  return {
    floor: box(SIZE.floor, [0, -0.05, 0]),
    wall_n: box(SIZE.wall_ns, [0, 1.25, -1.55]),
    wall_s: box(SIZE.wall_ns, [0, 1.25, 1.55]),
    wall_e: box(SIZE.wall_ew, [2.05, 1.25, 0]),
    wall_w: box(SIZE.wall_ew, [-2.05, 1.25, 0]),
  };
}
const onFloor = (size: readonly number[], x: number, z: number, yaw = 0): JsonObject => box(size, [x, size[1]! / 2, z], yaw);

/** The issue's relations: chairs next_to table, chairs facing table, lamp on table, shelf against north wall, rug on floor, table inside room. */
export const ROOM_RELATIONS: Relation[] = [
  ...FOUR.map((c) => ({ a: c, rel: 'next_to', b: 'table' })),
  ...FOUR.map((c) => ({ a: c, rel: 'facing', b: 'table' })),
  { a: 'lamp', rel: 'on', b: 'table' },
  { a: 'shelf', rel: 'against', b: 'wall_n' },
  { a: 'rug', rel: 'on', b: 'floor' },
  { a: 'table', rel: 'inside', b: 'room' },
];

function envelope(title: string, items: Record<string, JsonObject>, floating: string[], extra: JsonObject = {}): JsonObject {
  const out: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) out[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1732 acceptance fixture.`, size: [480, 360],
    requires: { modules: { scene3d: '^1', motion: '^1' } },
    collections: { room: { members: [...SHELL] } },
    audit: { scope: 'scene', overlap: { pairs: 'all', tolerance: MM }, support: { floating: ['floor', ...floating] } },
    ...extra, items: out,
  };
}
const arrangement = (items: readonly string[], relations: Relation[]): JsonObject =>
  ({ kind: 'arrange@1', params: { items: [...items], relations: relations as unknown as JsonValue[] } });

/** Criterion 1's room: every item standing on the floor where an agent might first drop it. `stacked` starts the chairs at the room's centre (criterion 2). */
export function roomDoc(opts: { stacked?: boolean; fan?: boolean } = {}): JsonObject {
  const chairsAt: [number, number][] = opts.stacked ? [[0, 0], [0, 0], [0, 0], [0, 0]] : [[-0.9, 1.1], [0.9, 1.1], [-0.9, -1.0], [0.9, -1.0]];
  const items: Record<string, JsonObject> = {
    ...shell(),
    table: onFloor(SIZE.table, 0, 0),
    ...Object.fromEntries(FOUR.map((c, i) => [c, onFloor(SIZE.chair, chairsAt[i]![0], chairsAt[i]![1])])),
    lamp: onFloor(SIZE.lamp, 1.7, 0),
    shelf: onFloor(SIZE.shelf, 0, -1.2),
    rug: onFloor(SIZE.rug, 1.6, 0.95, 90),
    [ARRANGEMENT]: arrangement(ARRANGED, ROOM_RELATIONS),
  };
  const extra: JsonObject = {};
  if (opts.fan) {
    // A ceiling fan the arrangement doesn't read, turning about +Y over 2 s: frames change something, never what the solve reads.
    items['fan'] = box(SIZE.fan, [0, 2.2, 0]);
    extra['transport'] = { frame_rate: '60/1', span: '2s', loop: 'wrap' };
    extra['channels'] = { spin: { target: 'items/fan/at/rot/1', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 360, interp: 'linear' } } } };
  }
  return envelope('A furnished room', items, opts.fan ? ['fan'] : [], extra);
}

/** Criterion 3: six chairs next_to the 1.2 m table, where only four fit. */
export function sixChairsDoc(): JsonObject {
  const at: [number, number][] = [[-1.4, 1.1], [0, 1.1], [1.4, 1.1], [-1.4, -1.0], [0, -1.0], [1.4, -1.0]];
  const relations: Relation[] = [...SIX.map((c) => ({ a: c, rel: 'next_to', b: 'table' })), { a: 'table', rel: 'inside', b: 'room' }];
  return envelope('Six chairs at a small table', {
    ...shell(),
    table: onFloor(SIZE.table, 0, 0),
    ...Object.fromEntries(SIX.map((c, i) => [c, onFloor(SIZE.chair, at[i]![0], at[i]![1])])),
    [ARRANGEMENT]: arrangement(['table', ...SIX], relations),
  }, []);
}

// ---------------------------------------------------------------------------------------------------
// Oriented boxes turned only about +Y, and each relation's miss.

export interface Box { id: string; c: V3; h: V3; yaw: number }
const rad = (d: number): number => (d * Math.PI) / 180;
/** The item's box from its document size and its evaluated pose. */
export function boxOf(doc: JsonObject, id: string, pose: Pose): Box {
  const item = obj(obj(doc['items'], 'items')[id], `item ${id}`);
  const size = arr(obj(item['params'], `${id} params`)['size'], `${id} size`).map((v) => num(v, `${id} size`));
  return { id, c: pose.pos, h: [size[0]! / 2, size[1]! / 2, size[2]! / 2], yaw: pose.rot[1] };
}
type V2 = [number, number];
/** Local x and z axes in world (x, z) for Ry(yaw): local +Z (the front) is (sin, cos). */
const axes = (b: Box): [V2, V2] => [[Math.cos(rad(b.yaw)), -Math.sin(rad(b.yaw))], [Math.sin(rad(b.yaw)), Math.cos(rad(b.yaw))]];
const dot2 = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
export const front = (b: Box): V2 => axes(b)[1];
function corners2(b: Box): V2[] {
  const [ux, uz] = axes(b);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz]) => [b.c[0] + sx! * b.h[0] * ux[0] + sz! * b.h[2] * uz[0], b.c[2] + sx! * b.h[0] * ux[1] + sz! * b.h[2] * uz[1]]);
}
export function corners3(b: Box): V3[] {
  return corners2(b).flatMap(([x, z]) => [[x, b.c[1] - b.h[1], z] as V3, [x, b.c[1] + b.h[1], z] as V3]);
}
/** Footprint penetration by the separating axis test: > 0 overlapping by that depth, ≤ 0 apart. */
function footDepth(a: Box, b: Box): number {
  const d: V2 = [b.c[0] - a.c[0], b.c[2] - a.c[2]];
  const [ax, az] = axes(a);
  const [bx, bz] = axes(b);
  let depth = Infinity;
  for (const u of [ax, az, bx, bz]) {
    const ra = a.h[0] * Math.abs(dot2(ax, u)) + a.h[2] * Math.abs(dot2(az, u));
    const rb = b.h[0] * Math.abs(dot2(bx, u)) + b.h[2] * Math.abs(dot2(bz, u));
    depth = Math.min(depth, ra + rb - Math.abs(dot2(d, u)));
  }
  return depth;
}
function segDist(p: V2, a: V2, b: V2): number {
  const ab: V2 = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, dot2([p[0] - a[0], p[1] - a[1]], ab) / dot2(ab, ab)));
  return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]);
}
function footGap(a: Box, b: Box): number {
  if (footDepth(a, b) > 0) return 0;
  const [pa, pb] = [corners2(a), corners2(b)];
  let g = Infinity;
  for (const [p, q] of [[pa, pb], [pb, pa]] as const) for (const v of p) for (let i = 0; i < 4; i++) g = Math.min(g, segDist(v, q[i]!, q[(i + 1) % 4]!));
  return g;
}
const yOverlap = (a: Box, b: Box): number => Math.min(a.c[1] + a.h[1], b.c[1] + b.h[1]) - Math.max(a.c[1] - a.h[1], b.c[1] - b.h[1]);
/** How deep two boxes pass into each other (0 when apart or touching). */
export const depth = (a: Box, b: Box): number => Math.max(0, Math.min(footDepth(a, b), yOverlap(a, b)));
/** The gap between two boxes (0 when they touch or overlap). */
export const gap = (a: Box, b: Box): number => Math.hypot(footGap(a, b), Math.max(0, -yOverlap(a, b)));

/** Every pair passing into each other past 1 mm, named. */
export function overlaps(boxes: readonly Box[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const d = depth(boxes[i]!, boxes[j]!);
    if (d > MM) out.push(`${boxes[i]!.id} and ${boxes[j]!.id} pass ${(d * 1000).toFixed(1)} mm into each other`);
  }
  return out;
}

/** A vertical face: centre (x, z), outward normal, half width along it, and its y range. */
interface Face { c: V2; n: V2; t: V2; w: number; y: [number, number] }
function sideFaces(b: Box): Face[] {
  const [ux, uz] = axes(b);
  const y: [number, number] = [b.c[1] - b.h[1], b.c[1] + b.h[1]];
  const at = (u: V2, s: number, half: number, along: V2, w: number): Face =>
    ({ c: [b.c[0] + s * half * u[0], b.c[2] + s * half * u[1]], n: [s * u[0], s * u[1]], t: along, w, y });
  return [at(ux, 1, b.h[0], uz, b.h[2]), at(ux, -1, b.h[0], uz, b.h[2]), at(uz, 1, b.h[2], ux, b.h[0]), at(uz, -1, b.h[2], ux, b.h[0])];
}
/** How far face `f` of a misses lying flat on face `g` of b, along g's width: in m, and its turn off opposite in degrees. */
function faceMiss(f: Face, g: Face): { m: number; deg: number } {
  const turn = (Math.acos(Math.max(-1, Math.min(1, -dot2(f.n, g.n)))) * 180) / Math.PI;
  const plane = Math.abs(dot2([f.c[0] - g.c[0], f.c[1] - g.c[1]], g.n));
  const along = Math.abs(dot2([f.c[0] - g.c[0], f.c[1] - g.c[1]], g.t)) + f.w * Math.abs(dot2(f.t, g.t)) - g.w;
  const vertical = Math.max(0, -(Math.min(f.y[1], g.y[1]) - Math.max(f.y[0], g.y[0])));
  return { m: Math.max(plane, along, vertical), deg: turn };
}
const held = (miss: { m: number; deg: number }): boolean => miss.m <= MM && miss.deg <= DEG;

/** A relation's miss from the evaluated boxes, or '' when it holds to 1 mm and 1° (README: Relations as these tests hold them). */
export function relationMiss(r: Relation, boxes: Map<string, Box>, bounds: (id: string) => [V3, V3]): string {
  const a = boxes.get(r.a)!;
  const name = `${r.a} ${r.rel} ${r.b}`;
  if (r.rel === 'inside') {
    const [lo, hi] = bounds(r.b);
    const out = Math.max(...corners3(a).flatMap((p) => [0, 1, 2].map((k) => Math.max(lo[k]! - p[k]!, p[k]! - hi[k]!))));
    return out <= MM ? '' : `${name}: a corner is ${(out * 1000).toFixed(1)} mm outside`;
  }
  const b = boxes.get(r.b)!;
  if (r.rel === 'on') {
    const [bx, bz] = axes(b);
    const d: V2 = [a.c[0] - b.c[0], a.c[2] - b.c[2]];
    const off = Math.max(Math.abs(dot2(d, bx)) - b.h[0], Math.abs(dot2(d, bz)) - b.h[2]);
    const lift = Math.abs(a.c[1] - a.h[1] - (b.c[1] + b.h[1]));
    return lift <= MM && off <= MM ? '' : `${name}: its bottom is ${(lift * 1000).toFixed(1)} mm off ${r.b}'s top and its centre ${(Math.max(0, off) * 1000).toFixed(1)} mm off it`;
  }
  if (r.rel === 'next_to' || r.rel === 'against') {
    const own = r.rel === 'against' ? [sideFaces(a)[3]!] : sideFaces(a);
    const best = own.flatMap((f) => sideFaces(b).map((g) => faceMiss(f, g))).reduce((x, y) => (Math.max(x.m / MM, x.deg / DEG) <= Math.max(y.m / MM, y.deg / DEG) ? x : y));
    const touching = depth(a, b) <= MM && gap(a, b) <= MM;
    return held(best) && touching ? '' : `${name}: ${r.rel === 'against' ? 'its back' : 'no side face'} lies flat on ${r.b}'s face (best ${(best.m * 1000).toFixed(1)} mm, ${best.deg.toFixed(2)}°), gap ${(gap(a, b) * 1000).toFixed(1)} mm, depth ${(depth(a, b) * 1000).toFixed(1)} mm`;
  }
  if (r.rel === 'facing') {
    const f = front(a);
    const to: V2 = [b.c[0] - a.c[0], b.c[2] - a.c[2]];
    const angle = (Math.acos(Math.max(-1, Math.min(1, dot2(f, to) / Math.hypot(...to)))) * 180) / Math.PI;
    // Or the front ray meets b's footprint (grown by 1 mm), in b's own frame.
    const [bx, bz] = axes(b);
    const o: V2 = [dot2([a.c[0] - b.c[0], a.c[2] - b.c[2]], bx), dot2([a.c[0] - b.c[0], a.c[2] - b.c[2]], bz)];
    const dir: V2 = [dot2(f, bx), dot2(f, bz)];
    let [t0, t1] = [0, Infinity];
    for (const k of [0, 1] as const) {
      const half = (k === 0 ? b.h[0] : b.h[2]) + MM;
      if (Math.abs(dir[k]) < 1e-12) { if (Math.abs(o[k]) > half) t1 = -1; continue; }
      const [p, q] = [(-half - o[k]) / dir[k], (half - o[k]) / dir[k]];
      t0 = Math.max(t0, Math.min(p, q));
      t1 = Math.min(t1, Math.max(p, q));
    }
    return t0 <= t1 || angle <= FACING_CONE + DEG ? '' : `${name}: its front points ${angle.toFixed(2)}° off ${r.b}'s centre and misses it`;
  }
  return `${name}: this suite holds no relation ${r.rel}`;
}

/** The world box around the shell's members, for `inside room`. */
export function unionBounds(boxes: readonly Box[]): [V3, V3] {
  const pts = boxes.flatMap(corners3);
  const lo: V3 = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]!))) as V3;
  const hi: V3 = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]!))) as V3;
  return [lo, hi];
}

/** Reads every item's pose, then every relation's miss, the turn about anything but +Y, and every overlap past 1 mm. */
export function arrangementProblems(doc: JsonObject, poses: Map<string, Pose>, relations: Relation[], solids: readonly string[]): string[] {
  const boxes = new Map(solids.map((id) => [id, boxOf(doc, id, poses.get(id)!)]));
  const room = unionBounds(SHELL.map((id) => boxes.get(id)!));
  const out = relations.map((r) => relationMiss(r, boxes, (id) => (id === 'room' ? room : unionBounds([boxes.get(id)!])))).filter((m) => m !== '');
  for (const [id, p] of poses) if (Math.abs(p.rot[0]) > 1e-9 || Math.abs(p.rot[2]) > 1e-9) out.push(`${id} is turned about x or z: rot ${JSON.stringify(p.rot)}`);
  return [...out, ...overlaps([...boxes.values()])];
}
