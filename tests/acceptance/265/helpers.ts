// Test-side tools for the #265 acceptance tests (README: The surface under test). They reuse #449's and #450's suite
// helpers for what is the same here (building `deep-gpu`, one `deep-gpu run` scenario, #449's acceptance look, the
// particles hash per frame, #450's trail report and its hash, the animated PNG of the canvas's own frames) and #166's
// water material, and add: this suite's criterion IDs and planted names; logic programs written as WebAssembly bytes,
// each step writing f64 arrays that are known closed forms of the step; `view3d` with the call's `assets` and the
// frame's `values`; the fixture documents more than one file draws (a walker with a world-space emitter, a runner with a
// `mark.line` trail, a swimmer with a wake, eight movers with all three), each with a twin whose item a channel moves
// through the same values held at the same steps. Nothing here stands in for the logic module, the bake, the emitter,
// the trail, the wake or the renderer.

import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { DAY_SKY, STEEP_WAVES, material, plate, sun, waterMaterial, type Water } from '../166/helpers.ts';
import {
  FLICKS, arr, camera, inconclusive, look, markBox, obj, runGpu, sha256, show,
  type JsonObject, type JsonValue, type Startup, type V3,
} from '../449/helpers.ts';
import { trailLine } from '../450/helpers.ts';

export {
  FLICKS, REPO, SHA, TIMEOUT, apng, arr, camera, failsNaming, fmt, fmtV, frameFlicks, framesOf, inconclusive, isObject, none, num, obj,
  markBox, random, requireGpu, sha256, show, str, useBins, useDir, writeJson,
  type Frame, type JsonObject, type JsonValue, type V3,
} from '../449/helpers.ts';
export { axisGap, trailAt, trailFrames, trailHash, type TrailFrame, type TrailReport } from '../450/helpers.ts';

/** The criteria's IDs: `#265.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space
 * collapsed (scripts/proof-change.mjs's `criterionId`, computed from the live issue). */
export const CRITERIA = {
  1: '#265.535c93ba', 2: '#265.18266a41', 3: '#265.4bf8a6ac', 4: '#265.69afee79', 5: '#265.8c765c23', 6: '#265.e3eb2a00', 7: '#265.34736230',
} as const;
/** A test title's prefix: `AC<n> #265.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

/** The `deep-gpu run --planted` names this suite adds (README: Planted programs). */
export type Planted = 'anchor_kept_from_frame' | 'trail_reads_stored_steps' | 'wake_keeps_last_frame';
/** One `deep-gpu run` scenario (#449's runGpu), under this suite's planted name when given. */
export function run(bin: string, out: string, calls: JsonObject[], s: { backend?: 'noop'; planted?: Planted } = {}): JsonObject[] {
  return runGpu(bin, out, calls, s as unknown as Startup);
}

// ---------------------------------------------------------------------------------------------------
// Time. Every document here steps its logic at 60 Hz and has the frame interval 1/60 s (`frame_rate: [60, 1]`).

/** One step, and one frame interval of every document here: 11,760,000 flicks. */
export const STEP = FLICKS / 60;
/** The step k whose time is at or before `t` (flicks): the last step a frame at t reads. */
export const stepAt = (t: number): number => Math.floor(t / STEP);

// ---------------------------------------------------------------------------------------------------
// Logic programs, written as WebAssembly bytes (Logic `logic@1`: one memory whose maximum is its minimum, the immutable
// i32 globals `reads_at` and `writes_at`, `init(seed: i64)` and `step(k: i64)`, no imports). The write region holds the
// item's arrays in declaration order on 8-byte boundaries, an f64 taking 8 bytes; the read region starts at 0.

const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (n: number): number[] => {
  const o: number[] = [];
  let v = BigInt(n | 0);
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if ((v === 0n && !(b & 0x40)) || (v === -1n && (b & 0x40))) { o.push(b); return o; }
    o.push(b | 0x80);
  }
};
const f64bytes = (x: number): number[] => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return [...b]; };
const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, 'latin1')];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
/** Instructions, each a list of bytes. */
export const I = {
  get: (l: number): number[] => [0x20, ...uleb(l)],
  set: (l: number): number[] => [0x21, ...uleb(l)],
  i32: (n: number): number[] => [0x41, ...sleb(n)],
  f64: (x: number): number[] => [0x44, ...f64bytes(x)],
  load: [0x28, 0x02, 0x00], f64load: [0x2b, 0x03, 0x00], f64store: [0x39, 0x03, 0x00],
  if: [0x04, 0x40], end: [0x0b], shl: [0x74], fadd: [0xa0], fmul: [0xa2], fromI64: [0xb9],
} as const;
export const code = (...parts: (readonly number[])[]): number[] => parts.flatMap((p) => [...p]);

/** Where every program here keeps its write region. */
export const WRITES_AT = 4096;
export interface Program { name: string; bytes: Buffer; sha: string }
/** A module of one 64 KiB page exporting `init` and `step`, both `(i64) -> ()`; `*Locals`: their local declarations as
 * the code section writes them. */
export function program(id: string, o: { init: number[]; step: number[]; stepLocals: number[] }): Program {
  const body = (locals: number[], b: number[]): number[] => { const f = [...locals, ...b, 0x0b]; return [...uleb(f.length), ...f]; };
  const bytes = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, ...I.i32(0), 0x0b], [0x7f, 0x00, ...I.i32(WRITES_AT), 0x0b]])),
    ...section(7, vec([[...name('memory'), 0x02, 0x00], [...name('reads_at'), 0x03, 0x00], [...name('writes_at'), 0x03, 0x01], [...name('init'), 0x00, 0x00], [...name('step'), 0x00, 0x01]])),
    ...section(10, vec([body([0x00], o.init), body(o.stepLocals, o.step)])),
  ]);
  return { name: id, bytes, sha: sha256(bytes) };
}

/** A value of step k: a + k (b + k c), in f64, in exactly the order the program computes it. */
export interface Quadratic { a: number; b: number; c: number }
export const valueAt = (q: Quadratic, k: number): number => q.a + k * (q.b + k * q.c);
/** A program whose step k writes each array of `arrays`, in order, as `valueAt(q, k)` (f64), reading nothing. */
export function pathProgram(id: string, arrays: readonly Quadratic[]): Program {
  // Locals of `step`: 0 the step (i64), 1 the step as an f64.
  const step = code(I.get(0), I.fromI64, I.set(1), ...arrays.map((q, j) => code(
    I.i32(WRITES_AT + 8 * j), I.f64(q.a), I.get(1), I.f64(q.b), I.get(1), I.f64(q.c), I.fmul, I.fadd, I.fmul, I.fadd, I.f64store,
  )));
  return program(id, { init: [], step, stepLocals: [0x01, 0x01, 0x7c] });
}
/** The program's file, written under `dir`, as `view3d`'s `assets` entry `{sha256: path}`. */
export function putPrograms(dir: string, programs: readonly Program[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of programs) {
    const path = join(dir, `${p.sha}.wasm`);
    writeFileSync(path, p.bytes);
    out[p.sha] = path;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures). Each is a scene as a session holds it (#378), one writer layer, seed 265, the camera
// `cam`, drawn with #449's acceptance look; its logic programs travel beside it.

export interface Fixture { doc: JsonObject; programs: Program[] }
export function sceneDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `doc-265-${slug}`, profile: 'scene', title, description: `${title}: a #265 acceptance fixture.`, size: [320, 240], seed: 265,
    camera: 'cam', requires: { modules: { scene3d: '^1', effects: '^1', logic: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    ...extra,
    items: withIds,
  };
}
/** A logic item at 60 steps a second writing one f64 array per name, each `interpolate` as given (Logic `logic@1`). */
export function logicItem(p: Program, writes: Record<string, 'hold' | 'linear'>): JsonObject {
  return {
    kind: 'logic@1',
    params: { program: p.sha, step_rate: 60, reads: [], writes: Object.fromEntries(Object.entries(writes).map(([n, i]) => [n, { type: 'f64', count: 1, interpolate: i }])) },
  };
}
/** How an item moves: by drivers whose one var reads a logic item's scalar f64 array (a driver var reads such an array
 * from the bake: Logic `logic@1`), or by a channel per axis holding the same value from each step's time (`hold` keys at
 * `<k>f`, one a step). */
export type Moved = 'logic' | 'channels';
export type Axes = Partial<Record<0 | 1 | 2, { array: string; path: Quadratic }>>;
export function moved(how: Moved, item: string, logic: string, axes: Axes, steps: number): JsonObject {
  const out: JsonObject = {};
  for (const [axis, { array, path }] of Object.entries(axes)) {
    const target = `items/${item}/at/pos/${axis}`;
    if (how === 'logic') {
      out[`${item}-${axis}`] = { target, expr: 'v', vars: { v: `${logic}.${array}` } };
    } else {
      const keys: JsonObject = {};
      for (let k = 0; k <= steps; k++) keys[`k${k}`] = { t: `${k}f`, value: valueAt(path, k), interp: 'hold' };
      out[`${item}-${axis}`] = { target, type: 'f32', keys };
    }
  }
  return how === 'logic' ? { drivers: out } : { channels: out };
}
const sphere = (d: number, pos: V3, role: string): JsonObject => ({ kind: 'mark.sphere@1', params: { size: [d, d, d], paint: { fill: { role } } }, at: { pos } });
/** A world-space emitter anchored on `anchor` (Particles `particles@1`: space and paths): `rate` a second, each particle
 * rising at 0.35 m/s from where the anchor was at its birth bucket, for `life` s. */
export const worldEmitter = (anchor: string, rate: number, life: number, count: number): JsonObject => ({
  kind: 'particles@1', at: { pos: [0, 0, 0] },
  params: {
    count, life: [life, life], space: 'world', emit: { anchor, rate },
    motion: { ballistic: { velocity: [0, 0.35, 0], gravity: [0, 0, 0], drag: 0 } },
    draw: 'puff', size: 5, opacity: 1, color: [{ at: 0, role: 'spark-a' }, { at: 1, role: 'spark-b' }],
  },
});

/**
 * The walker (criteria 1 and 7): the logic item `walk` writes, at step k, `x` = −3 + 0.025 k and `z` = −1 + 0.00005 k²
 * (both `hold`), and two drivers place the sphere `walker` there (y = 0.3); the world-space emitter `dust` is anchored on
 * it, 45 particles a second, each living 2 s. A 4 s transport at 60 frames a second. Its twin (`channels`) moves the
 * walker by hold channels through the same values at the same steps, a chain the base already reads at earlier times;
 * both have one title, and so one ID, so they differ by what moves the walker alone.
 */
export const WALK = { x: { a: -3, b: 0.025, c: 0 }, z: { a: -1, b: 0, c: 0.00005 } } as const;
export const WALK_STEPS = 240;
export function walkerDoc(how: Moved): Fixture {
  const p = pathProgram('walk', [WALK.x, WALK.z]);
  return {
    programs: [p],
    doc: sceneDoc('Walker', {
      cam: camera([0, 5, 7.5], [0, 0.3, 0.4], 50),
      floor: markBox([8, 0.02, 5], [0, -0.01, 0.4], 'floor'),
      walk: logicItem(p, { x: 'hold', z: 'hold' }),
      walker: sphere(0.25, [0, 0.3, 0], 'lamp'),
      dust: worldEmitter('walker', 45, 2, 96),
    }, { transport: { span: '4s', frame_rate: [60, 1] }, ...moved(how, 'walker', 'walk', { 0: { array: 'x', path: WALK.x }, 2: { array: 'z', path: WALK.z } }, WALK_STEPS) }),
  };
}

/**
 * The runner (criteria 2, 5 and 7): the logic item `run` writes, at step k, `x` = −10 + k ÷ 6 (10 m/s at 60 Hz) with
 * `interpolate: linear`, and a driver places the box `runner` there (y = 0.5, z = 0); the `mark.line@1` `streak` trails
 * it with the default span window, the last `span` s in 16 segments. A 3 s transport at 60 frames a second.
 */
export const RUN: Quadratic = { a: -10, b: 1 / 6, c: 0 };
export const RUNNER_Y = 0.5;
export function runnerDoc(o: { span?: number; transport?: number } = {}): Fixture {
  const p = pathProgram('run', [RUN]);
  const seconds = o.transport ?? 3;
  return {
    programs: [p],
    doc: sceneDoc(`Runner ${o.span ?? 0.5} s over ${seconds} s`, {
      cam: camera([3, 4, 12], [3, 0.5, 0], 60),
      floor: markBox([40, 0.02, 4], [5, -0.01, 0], 'floor'),
      run: logicItem(p, { x: 'linear' }),
      runner: markBox([0.4, 0.4, 0.4], [0, RUNNER_Y, 0], 'block'),
      streak: trailLine({ of: 'runner', span: o.span ?? 0.5, segments: 16, width: 4 }),
    }, { transport: { span: `${seconds}s`, frame_rate: [60, 1] }, ...moved('logic', 'runner', 'run', { 0: { array: 'x', path: RUN } }, 60 * seconds) }),
  };
}
/** Where the runner is drawn at `t` (flicks): its `linear` array one step late, step k − 1's value blended toward step
 * k's by α = (t − t(k)) ÷ the step, k the last step at or before t (Logic: interpolated writes); for t ≥ one step. */
export function runnerDrawn(t: number): V3 {
  const k = stepAt(t);
  const alpha = (t - k * STEP) / STEP;
  const before = valueAt(RUN, k - 1);
  return [before + alpha * (valueAt(RUN, k) - before), RUNNER_Y, 0];
}

/**
 * The swimmer (criteria 3 and 7): a 30 × 20 m lake whose material `lake-water` carries #166's steep waves, foam at 0.6
 * and a wake behind `swimmer` over the last 8 s; the logic item `swim` writes, at step k, `x` = −8 + 0.01 k and
 * `z` = 2 − 0.006 k + 0.000005 k² (both `hold`), and two drivers place the swimmer there, a U from (−8, 2) through
 * (−2, 0.2) at 10 s to (4, 2) at 20 s. A 24 s transport at 60 frames a second. Its twin (`channels`) moves the swimmer
 * by hold channels through the same values at the same steps; `wake: false` takes the wake out. All have one title, and
 * so one ID.
 */
export const SWIM = { x: { a: -8, b: 0.01, c: 0 }, z: { a: 2, b: -0.006, c: 0.000005 } } as const;
export const SWIM_STEPS = 1440;
export function swimmerDoc(how: Moved, wake = true): Fixture {
  const p = pathProgram('swim', [SWIM.x, SWIM.z]);
  const water: Water = { waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: wake ? { item: 'swimmer', span: 8 } : 'none' };
  return {
    programs: [p],
    doc: sceneDoc('Swimmer', {
      cam: camera([-2, 9, 13], [-2, 0, 0.5], 50), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
      'lake-water': waterMaterial(water, { roughness: 0.05 }), skin: material({ base_color: [0.9, 0.5, 0.2, 1], roughness: 0.5 }),
      lake: plate([30, 20], [192, 128], [0, 0, 0], 'lake-water'),
      swim: logicItem(p, { x: 'hold', z: 'hold' }),
      swimmer: { kind: 'mark.box@1', params: { size: [0.5, 0.3, 0.9] }, at: { pos: [0, 0.1, 0] }, material: 'skin' },
    }, { transport: { span: '24s', frame_rate: [60, 1] }, ...moved(how, 'swimmer', 'swim', { 0: { array: 'x', path: SWIM.x }, 2: { array: 'z', path: SWIM.z } }, SWIM_STEPS) }),
  };
}

/**
 * Eight movers (criteria 6 and 7): one logic item `crowd` writes `x0` … `x7` and `z0` … `z7` (`hold`), mover i in a cell
 * 10 m square of a 4 × 2 grid, crossing it at 0.75 m/s along x on a curve in z; each mover has its own lake plate whose
 * material `water-<i>` wakes behind it over 8 s, a world-space emitter `dust-<i>` anchored on it (30 a second, 2 s each)
 * and a `mark.line@1` trail `trail-<i>` of 16 segments over 0.5 s. A showpiece, 10 s at 60 frames a second.
 */
export const CROWD = 8;
export const crowdCell = (i: number): [number, number] => [-15 + 10 * (i % 4), -5 + 10 * Math.floor(i / 4)];
export function crowdPaths(i: number): { x: Quadratic; z: Quadratic } {
  const [cx, cz] = crowdCell(i);
  return { x: { a: cx - 3.75, b: 0.0125, c: 0 }, z: { a: cz - 2, b: 0.012 + 0.001 * i, c: -0.00002 } };
}
export function crowdDoc(): Fixture {
  const paths = Array.from({ length: CROWD }, (_, i) => crowdPaths(i));
  const p = pathProgram('crowd', [...paths.map((q) => q.x), ...paths.map((q) => q.z)]);
  const writes: Record<string, 'hold'> = {};
  for (let i = 0; i < CROWD; i++) writes[`x${i}`] = 'hold';
  for (let i = 0; i < CROWD; i++) writes[`z${i}`] = 'hold';
  const items: Record<string, JsonObject> = {
    cam: camera([0, 26, 22], [0, 0, 0], 55), sky: DAY_SKY, sun: sun(3, [-40, 25, 0]),
    skin: material({ base_color: [0.9, 0.5, 0.2, 1], roughness: 0.5 }),
    crowd: logicItem(p, writes),
  };
  let drivers: JsonObject = {};
  for (let i = 0; i < CROWD; i++) {
    const [cx, cz] = crowdCell(i);
    items[`water-${i}`] = waterMaterial({ waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: `mover-${i}`, span: 8 } }, { roughness: 0.05 });
    items[`lake-${i}`] = plate([10, 10], [64, 64], [cx, 0, cz], `water-${i}`);
    items[`mover-${i}`] = { kind: 'mark.box@1', params: { size: [0.5, 0.3, 0.9] }, at: { pos: [cx, 0.1, cz] }, material: 'skin' };
    items[`dust-${i}`] = worldEmitter(`mover-${i}`, 30, 2, 64);
    items[`trail-${i}`] = trailLine({ of: `mover-${i}`, span: 0.5, segments: 16, width: 3 });
    drivers = { ...drivers, ...(moved('logic', `mover-${i}`, 'crowd', { 0: { array: `x${i}`, path: paths[i]!.x }, 2: { array: `z${i}`, path: paths[i]!.z } }, 600)['drivers'] as JsonObject) };
  }
  return { programs: [p], doc: sceneDoc('Eight movers', items, { transport: { span: '10s', frame_rate: [60, 1] }, budget: { class: 'showpiece' }, drivers }) };
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378, #380's `from`) with #449's `particles`, #450's `trails`, #429's `evaluate` and #537's `assets`.

export interface View {
  doc: string; assets: Record<string, string>; size?: [number, number]; fps?: number; from?: number; frames?: number;
  particles?: string[]; particle_cull?: 'none'; trails?: string[]; evaluate?: string[]; timings?: boolean;
  capture?: 'every' | number[]; targets?: string[];
}
export const view3d = (v: View): JsonObject => ({ call: 'view3d', look: look(), size: [320, 240], ...(v as unknown as JsonObject) });
/** A view3d reply that drew (not a refusal); INCONCLUSIVE where the platform has no Metal device. */
export function drawn(reply: JsonObject, what: string): JsonObject[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was drawn, not refused: ${show(reply)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
}
/** Each frame's `values` (#429's `evaluate`): the path's value as the frame evaluates it. */
export function valuesOf(reply: JsonObject, what: string): Map<number, JsonObject> {
  return new Map(drawn(reply, what).map((f) => [f['frame'] as number, obj(f['values'], `${what}: frame ${String(f['frame'])}: values (#429's evaluate)`)]));
}
export const v3 = (v: JsonValue | undefined, what: string): V3 => {
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return v as V3;
  throw Error(`${what} is [x, y, z], got ${show(v)}`);
};
