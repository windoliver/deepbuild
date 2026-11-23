// Test-side tools for the #2035 acceptance tests (README: The surface under test). They drive the physics module's
// runner `deep-physics` through #251's helpers (and through them #522's, #1918's, #2010's and #2009's: one
// `cargo build --locked --bin deep-physics` a file), with the character body's world built as #182's suite builds it,
// and the logic module's runner `deep-logic` through #545's helpers (its assembler and `cargo build --locked --bin
// deep-logic`), all imported read only. Nothing here stands in for either module: every drawn pose, drawn value,
// refusal and seek read here is the program's own; every expected value is the issue's.

import { expect } from 'vitest';
import { characterWorld, entry as heroEntry, heroBody, slab, standing } from '../182/helpers.ts';
import {
  DEG, SETTLED_Y, WHEEL_NAMES, arr, ask, carWorld, kart, obj, place, rotate, show, vec, vehicleInputs,
  type JsonObject, type JsonValue, type Planted as Planted251, type V3,
} from '../251/helpers.ts';
import {
  assemble, entryAt, layoutFor, live, openView, drawn, type Frame, type Planted as Planted545, type Program, type WriteSpec,
} from '../545/helpers.ts';
import { layoutProbe } from '../545/programs.ts';

export { type JsonObject, type JsonValue } from '../251/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#2035.577758f2', 2: '#2035.9b03a44c', 3: '#2035.e60b6f6d', 4: '#2035.4a4b7836', 5: '#2035.65049ccc' } as const;

/** Every test passes this timeout: a first build of Rapier, or of deep-logic and its assembler, takes many minutes. */
export const TIMEOUT = 5_400_000;

/** This suite's planted names (README: Planted twins), each one criterion's wrong program. */
export type PhysicsTwin = 'place_blends' | 'place_blends_rotation' | 'place_blends_wheels' | 'restore_forgets_place';
export type LogicTwin = 'cut_ignored' | 'restore_forgets_cut';

// ---------------------------------------------------------------------------------------------------
// Time. Both fixtures step at 60 Hz and are drawn at 120 frames a second: frame j is at t = j ÷ 120 s, so the frames
// 2k and 2k + 1 fall in step k's interval and frame 2k + 1 is half way to step k + 1.

export const FLICKS = 705_600_000;
export const RATE = 60;
export const FPS = 120;
export const FRAME_RATE = '120/1';
export const FRAME = FLICKS / FPS;
export const secs = (j: number): string => `${Number((j / FPS).toFixed(6))} s`;
export const frameName = (j: number): string => `frame ${j} (${secs(j)})`;
export const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(9))) : String(x));
/** Frames j with from ≤ j ÷ 120 s ≤ to. */
export const framesBetween = (from: number, to: number): number[] =>
  Array.from({ length: Math.round(to * FPS) - Math.round(from * FPS) + 1 }, (_, i) => Math.round(from * FPS) + i);

// ---------------------------------------------------------------------------------------------------
// Running the binaries under a planted name.

/** `deep-physics [--planted <name>]` over `calls` (#2009's build, through #251's runner). */
export const physics = (calls: JsonObject[], twin?: PhysicsTwin, where = ''): JsonObject[] =>
  ask(calls, twin as unknown as Planted251 | undefined, where);

/** Some failure matches `named` (the criterion's "naming …"). */
export function namedBy(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the criterion's judgement fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure matches ${String(named)}; the failures:\n  ${failures.slice(0, 30).join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Drawn poses: a pose output's samples in a bake's `outputs.series` (#2240's and #251's `{pos, rot}`, or seven numbers).

export interface Pose { pos: V3; rot: number[] }
export function poseOf(v: JsonValue | undefined, what: string): Pose {
  if (Array.isArray(v) && v.length === 7) {
    const n = vec(v, 7, what);
    return { pos: [n[0]!, n[1]!, n[2]!], rot: n.slice(3) };
  }
  const o = obj(v, what);
  return { pos: vec(o['pos'], 3, `${what}.pos`) as V3, rot: vec(o['rot'], 4, `${what}.rot`) };
}
/** A bake's drawn samples of output `id`, index j the frame at j ÷ 120 s. */
export function drawnPoses(reply: JsonObject, id: string, what: string): Pose[] {
  expect(reply['ok'], `${what} is baked, not refused: ${show(reply)}`).toBe(true);
  const series = arr(obj(obj(reply['outputs'], `${what}: outputs`)['series'], `${what}: outputs.series`)[id], `${what}: outputs.series.${id} (the output's drawn samples)`);
  return series.map((v, j) => poseOf(v, `${what}: outputs.series.${id}[${j}]`));
}
/** The heading of a pose: its turn about the up axis (+Y), from +Z, degrees. */
export function heading(p: Pose): number {
  const h = rotate(p.rot, [0, 0, 1]);
  return Math.atan2(h[0], h[2]) * DEG;
}
export const distance = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
/** Two poses the same bit for bit. */
export const samePose = (a: Pose, b: Pose): boolean => [...a.pos, ...a.rot].every((x, i) => Object.is(x, [...b.pos, ...b.rot][i]));
export const poseText = (p: Pose): string => `pos [${p.pos.map(fmt).join(', ')}], rot [${p.rot.map(fmt).join(', ')}]`;

// ---------------------------------------------------------------------------------------------------
// The physics fixtures: 60 Hz worlds, a `place` stamped at step 120 (applied at the start of that step, #522's
// convention), baked 3 s and drawn at 120 frames a second; criteria 1 to 3 read the frames from 1.9 s to 2.2 s.

export const PLACE_STEP = 120;
export const STEPS = 180;
export const WINDOW = framesBetween(1.9, 2.2);
/** The first frame after the place: half way from step 120 to step 121. */
export const AFTER_PLACE = 2 * PLACE_STEP + 1;

/** The character (criteria 1, 2 and 5): #182's capsule at rest at x = 40 m on a floor from x −10 m to 50 m. */
export const HERO = 'hero';
export const HERO_OUTPUT = 'hero_pose';
export const HERO_ITEM = 'hero_figure';
export const HERO_FROM_X = 40;
export const HERO_TO_X = 0;
export function heroWorld(): JsonObject {
  return characterWorld({
    statics: { floor: slab(-10, 50, -1, 0, 4) },
    movers: { [HERO]: heroBody([HERO_FROM_X, standing(0), 0]) },
    rate: RATE,
    outputs: { [HERO_OUTPUT]: { from: HERO, read: 'pose', to: `items/${HERO_ITEM}/at` } },
    extra: { checkpoint: { every: 60 } },
  });
}
/** The place at step 120: to x = 0 m, standing on the same floor, turned 90° about the up axis. */
export const heroTrack = (): JsonObject[] => [heroEntry(PLACE_STEP, 'place', { pose: { pos: [HERO_TO_X, standing(0), 0], rot: [0, 90, 0] } })];
export const heroBake = (extra: JsonObject = {}): JsonObject =>
  ({ call: 'bake', world: heroWorld(), track: heroTrack(), steps: STEPS, frame_rate: FRAME_RATE, read: [], ...extra });
export const HERO_NAMED = `item ${HERO_ITEM} (output ${HERO_OUTPUT} of the character ${HERO})`;

/**
 * Criterion 1's judgement of the character's drawn frames: every frame from 1.9 s to 2.2 s draws x = 40 m or x = 0 m
 * within 1e-6 m, and they change once, from 40 m to 0 m. Each failure names the item and the frame.
 */
export function positionFailures(poses: Pose[]): string[] {
  const out: string[] = [];
  const marks: string[] = [];
  for (const j of WINDOW) {
    const x = poses[j]?.pos[0];
    if (x === undefined) { out.push(`${HERO_NAMED} draws no ${frameName(j)}`); marks.push('?'); continue; }
    const at = Math.abs(x - HERO_FROM_X) <= 1e-6 ? 'old' : Math.abs(x - HERO_TO_X) <= 1e-6 ? 'new' : '';
    if (!at) out.push(`${HERO_NAMED} at ${frameName(j)} draws x = ${fmt(x)} m, neither 40 m nor 0 m within 1e-6 m`);
    marks.push(at || 'x');
  }
  if (out.length === 0) {
    const changes = marks.filter((m, i) => i > 0 && m !== marks[i - 1]).length;
    if (marks[0] !== 'old' || marks.at(-1) !== 'new' || changes !== 1) {
      out.push(`${HERO_NAMED} draws ${marks.join(' ')} over frames ${WINDOW[0]} to ${WINDOW.at(-1)}: not 40 m and then 0 m, with exactly one change`);
    }
  }
  return out;
}
/**
 * Criterion 2's judgement: no frame from 1.9 s to 2.2 s draws a heading between 1° and 89°, and the place turned the
 * body: 0° (within 1°) at 1.9 s and 90° (within 1°) at 2.2 s. Each failure names the item and the frame.
 */
export function headingFailures(poses: Pose[]): string[] {
  const out: string[] = [];
  for (const j of WINDOW) {
    const p = poses[j];
    if (!p) { out.push(`${HERO_NAMED} draws no ${frameName(j)}`); continue; }
    const h = Math.abs(heading(p));
    if (h > 1 && h < 89) out.push(`${HERO_NAMED} at ${frameName(j)} draws a heading of ${fmt(h)}°, between 1° and 89°`);
  }
  const [first, last] = [poses[WINDOW[0]!], poses[WINDOW.at(-1)!]];
  if (first && Math.abs(heading(first)) > 1) out.push(`${HERO_NAMED} at ${frameName(WINDOW[0]!)} draws a heading of ${fmt(heading(first))}°, not its 0° before the place`);
  if (last && Math.abs(Math.abs(heading(last)) - 90) > 1) out.push(`${HERO_NAMED} at ${frameName(WINDOW.at(-1)!)} draws a heading of ${fmt(heading(last))}°, not the place's 90°`);
  return out;
}

/** The vehicle (criterion 3): #251's kart, settled at the origin, placed at step 120 40 m along +x, level, unturned. */
export const KART = 'kart';
export const KART_OUTPUT = 'kart_pose';
export const KART_ITEM = 'kart_body';
export const wheelOutput = (n: string): string => `kart_${n}_pose`;
export const wheelItem = (n: string): string => `kart_${n}`;
export const KART_PLACED: V3 = [40, SETTLED_Y, 0];
export function kartWorld(): JsonObject {
  const outputs: JsonObject = { [KART_OUTPUT]: { from: KART, read: 'pose', to: `items/${KART_ITEM}/at` } };
  for (const n of WHEEL_NAMES) outputs[wheelOutput(n)] = { from: `${KART}#${n}`, read: 'pose', to: `items/${wheelItem(n)}/at` };
  return carWorld(kart([0, SETTLED_Y, 0], { sleep: false }), { step_rate: RATE, inputs: vehicleInputs({ reset: true }), outputs });
}
export const kartTrack = (): JsonObject[] => [place(PLACE_STEP, KART_PLACED, [0, 0, 0])];
export const kartBake = (): JsonObject =>
  ({ call: 'bake', world: kartWorld(), track: kartTrack(), steps: STEPS, frame_rate: FRAME_RATE, read: [] });
/** How far a part may be drawn from its pose at the step before the frame or the step after (README: tolerances). */
export const PART_TOLERANCE = 0.25;

export interface KartFrames { chassis: Pose[]; wheels: Record<string, Pose[]> }
export function kartFrames(reply: JsonObject, what: string): KartFrames {
  const wheels: Record<string, Pose[]> = {};
  for (const n of WHEEL_NAMES) wheels[n] = drawnPoses(reply, wheelOutput(n), what);
  return { chassis: drawnPoses(reply, KART_OUTPUT, what), wheels };
}
/** Where a wheel drawn at frame j sits off its place on the chassis drawn there: from its pose at the step (k or k + 1,
 * read at frames 2k and 2k + 2) whose chassis pose is nearer the drawn chassis. */
export function offChassis(f: KartFrames, n: string, j: number): number {
  const k = Math.floor(j / 2);
  const [a, b] = [2 * k, 2 * k + 2];
  const s = distance(f.chassis[j]!.pos, f.chassis[a]!.pos) <= distance(f.chassis[j]!.pos, f.chassis[b]!.pos) ? a : b;
  return distance(f.wheels[n]![j]!.pos, f.wheels[n]![s]!.pos);
}
/**
 * Criterion 3's judgement: at every frame from 1.9 s to 2.2 s the chassis and each wheel are drawn at the old pose or
 * the new one: within 0.25 m of where that part is drawn at the step at or before the frame (frame 2k) or at the step
 * after (frame 2k + 2). Each failure names the part, its item and the frame, and for a wheel how far it is drawn from
 * its place on the chassis drawn there.
 */
export function kartFailures(f: KartFrames): string[] {
  const out: string[] = [];
  const parts: [string, Pose[], string | null][] = [
    [`the chassis ${KART} (item ${KART_ITEM})`, f.chassis, null],
    ...WHEEL_NAMES.map((n): [string, Pose[], string] => [`wheel ${KART}#${n} (item ${wheelItem(n)})`, f.wheels[n]!, n]),
  ];
  for (const j of WINDOW) {
    const k = Math.floor(j / 2);
    for (const [name, poses, n] of parts) {
      const [p, a, b] = [poses[j], poses[2 * k], poses[2 * k + 2]];
      if (!p || !a || !b) { out.push(`${name} draws no ${frameName(j)} or step ${k} or ${k + 1}`); continue; }
      const [da, db] = [distance(p.pos, a.pos), distance(p.pos, b.pos)];
      if (Math.min(da, db) > PART_TOLERANCE) {
        const off = n === null ? '' : `, ${fmt(offChassis(f, n, j))} m from its place on the chassis drawn there`;
        out.push(`${name} at ${frameName(j)} is drawn ${fmt(da)} m from its pose at step ${k} and ${fmt(db)} m from its pose at step ${k + 1}${off}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The logic fixture (criteria 4 and 5): the 60 Hz item `ship` on a 20 m field. Step k writes x = (k mod 200) ÷ 10 m
// into its vec3 `pos`, declared linear with `cut: wrapped`, and `wrapped` = true on a step where it wrapped (k mod 200
// = 0, k > 0): at step 200 it wraps from 19.9 m to 0 m with its cut true. A checkpoint every 67 steps puts one at 201,
// the state step 200 left (#531's labels: a checkpoint is named by the step about to run).

export const SHIP = 'ship';
export const SHIP_POS = `${SHIP}.pos`;
export const WRAP_STEP = 200;
export const SHIP_EVERY = 67;
/** A write with this suite's `cut` field (Logic: interpolated writes). */
export type CutWrite = WriteSpec & { cut?: string };
export const SHIP_WRITES = (cut: string): Record<string, WriteSpec> => ({
  pos: { type: 'vec3', interpolate: 'linear', cut } as CutWrite,
  wrapped: { type: 'bool' },
  speed: { type: 'f64' },
});
let shipBuilt: Program | undefined;
/** The ship's program, built against the layout `check` gives an item of these writes (its cut naming `wrapped`). */
export function shipProgram(): Program {
  if (shipBuilt) return shipBuilt;
  const l = layoutFor(layoutProbe(), [], SHIP_WRITES('wrapped'));
  const pos = 4096 + entryAt(l, 'writes', 'pos');
  const wrapped = 4096 + entryAt(l, 'writes', 'wrapped');
  const speed = 4096 + entryAt(l, 'writes', 'speed');
  const p = assemble(`ship_${pos}_${wrapped}_${speed}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $m i64)
    (local.set $m (i64.rem_s (local.get $k) (i64.const ${WRAP_STEP})))
    (f64.store (i32.const ${pos}) (f64.div (f64.convert_i64_s (local.get $m)) (f64.const 10)))
    (f64.store (i32.const ${pos + 8}) (f64.const 0))
    (f64.store (i32.const ${pos + 16}) (f64.const 0))
    (i32.store (i32.const ${wrapped}) (i32.and (i64.gt_s (local.get $k) (i64.const 0)) (i64.eqz (local.get $m))))
    (f64.store (i32.const ${speed}) (f64.const 6))))`);
  shipBuilt = p;
  return p;
}
/** The piece: the ship whose `pos` names `cut` (`wrapped`, its bool write; `speed`, an f64 write, to be refused). */
export const shipPiece = (cut = 'wrapped'): JsonObject => ({
  seed: 2035,
  items: { [SHIP]: { kind: 'logic@1', params: { program: shipProgram().sha, step_rate: RATE, writes: SHIP_WRITES(cut) as unknown as JsonObject, checkpoint: { every: SHIP_EVERY } } } },
  assets: { [shipProgram().sha]: shipProgram().b64 },
});

/**
 * The frames that draw steps 190 to 210: a linear write draws one step late (at t(k) it shows step k − 1's value), so
 * they run from t(191) to t(211), frames 382 to 422 at 120 frames a second (README: readings).
 */
export const SHIP_WINDOW = Array.from({ length: 2 * (211 - 191) + 1 }, (_, i) => 2 * 191 + i);
/** The first frame after the wrap: half way from step 200 to step 201. */
export const AFTER_WRAP = 2 * WRAP_STEP + 1;
export const SHIP_LAST = SHIP_WINDOW.at(-1)!;

/** The x a frame draws of `ship.pos` (one vec3 element). */
export function shipX(f: Frame, what: string): number {
  const [e] = drawn(f, SHIP_POS, what);
  const v = arr(e, `${what}: draws["${SHIP_POS}"][0]`);
  expect(typeof v[0], `${what}: draws["${SHIP_POS}"][0] is a vec3`).toBe('number');
  return v[0] as number;
}
export interface Played { frames: Map<number, Frame>; sought: Frame | null }
/**
 * One view of the ship in one `deep-logic` (under `twin` when given): played straight from 0 s by `play: 1/120`, one
 * frame at a time, to frame 422 (t(211)), each landing at j × 1/120 s; then, with `seekTo`, sought back to that frame.
 */
export async function playShip(twin: LogicTwin | null, seekTo: number | null): Promise<Played> {
  const l = live(twin ? [twin as unknown as Planted545] : []);
  try {
    const v = await openView(l, shipPiece(), [], 4);
    const frames = new Map<number, Frame>();
    for (let j = 1; j <= SHIP_LAST; j++) {
      const f = (await v.frame({ play: 1 / FPS })).landed;
      expect(f.t, `played frame ${j} lands at ${j * FRAME} flicks`).toBe(j * FRAME);
      if (j >= SHIP_WINDOW[0]!) frames.set(j, f);
    }
    let sought: Frame | null = null;
    if (seekTo !== null) {
      sought = (await v.frame({ seek: seekTo / FPS })).landed;
      expect(sought.t, `the seek back to ${frameName(seekTo)} lands at ${seekTo * FRAME} flicks`).toBe(seekTo * FRAME);
    }
    return { frames, sought };
  } finally {
    l.stop();
  }
}
/** Criterion 4's judgement: no frame that draws steps 190 to 210 draws x between 1 m and 19 m. Names the frame. */
export function bandFailures(frames: Map<number, Frame>): string[] {
  const out: string[] = [];
  for (const j of SHIP_WINDOW) {
    const f = frames.get(j);
    if (!f) { out.push(`${SHIP_POS}: no ${frameName(j)} was drawn`); continue; }
    const x = shipX(f, `played ${frameName(j)}`);
    if (x > 1 && x < 19) out.push(`${SHIP_POS} at ${frameName(j)} draws x = ${fmt(x)} m, between 1 m and 19 m`);
  }
  return out;
}
