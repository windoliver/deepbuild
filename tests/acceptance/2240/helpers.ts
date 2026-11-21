// Test-side tools for the #2240 acceptance tests (README: The surface under test). They extend #251's surface, imported
// read only through ../251/helpers.ts (and through it #522's, #1918's, #2010's, #2009's and #191's): the same
// `deep-physics` binary, #191's release build, built once per file, asked `check`, `bake`, `seek`, `behavior_fixtures`
// and `behavior_kit` of world documents whose dynamic bodies write `centre_of_mass`, and run under this suite's four
// planted names. #523's reader gives a hinge's readings and #2309's runner the merge base's build. Nothing here stands
// in for the physics module: every state, reading, pose, issue, hash and kit row read here is the program's own; every
// expected value is the issue's, or worked here from the issue's formulas.

import { expect } from 'vitest';
import {
  DEG, G, PER_STEP, RATE, arr, box, cross, errorsOf, fixturesOf, fmt, isObject, kitReport, length, num, obj, onTest, rng, rotate, show, sub,
  vec, world, type JsonObject, type JsonValue, type KitReport, type KitResult, type Planted as Planted251, type State, type V3,
} from '../251/helpers.ts';
import { failFailures, type FixtureData } from '../191/helpers.ts';
import { readingsOf } from '../523/helpers.ts';
import { onBase, withBase } from '../2309/helpers.ts';

export * from '../251/helpers.ts';
export { failFailures, onBase, readingsOf, withBase, type FixtureData };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#2240.b395689a',
  2: '#2240.07b0552b',
  3: '#2240.cb44a798',
  4: '#2240.c9639f9f',
  5: '#2240.e07f41f3',
} as const;

// ---------------------------------------------------------------------------------------------------
// deep-physics, #191's release build, under this suite's planted names (README: Planted twins)

/**
 * `centre_of_mass_ignored`: the wrapper reads the field and leaves the weight where the shapes put it.
 * `centre_of_mass_parallel_axis`: the wrapper moves the weight to the written point and adds a parallel-axis term to
 * the shapes' inertia. `check_accepts_centre_outside`: the check takes a point outside the bounds of the body's shapes.
 * `pose_reads_centre_of_mass`: a `pose` output reads the body's centre of mass, not its origin.
 */
export type Planted = 'centre_of_mass_ignored' | 'centre_of_mass_parallel_axis' | 'check_accepts_centre_outside' | 'pose_reads_centre_of_mass';
/** Runs `calls` through one deep-physics process of this checkout's release build, under `planted` when given. */
export function ask(calls: JsonObject[], planted?: Planted): JsonObject[] {
  return onTest(calls, { build: 'release', ...(planted ? { planted: planted as unknown as Planted251 } : {}) });
}

// ---------------------------------------------------------------------------------------------------
// The fixtures (README: The fixtures), on #2009's world defaults: 120 Hz, 4 substeps, gravity (0, −9.81, 0).

/** The field, as the issue and its criteria spell it, and its path on a body, as the reader's refusals name fields. */
export const FIELD = 'centre_of_mass';
export const fieldPath = (body: string): string => `bodies/${body}/${FIELD}`;

const rad = (deg: number): number => (deg * Math.PI) / 180;
/** "Both of friction 2": the box's contact material and the ground's. */
const GRIP: JsonObject = { friction: 2, restitution: 0, density: 1000 };
/** The box: 100 kg, 1 m wide (x), 2 m tall (y) and 1 m deep (z), its origin at its middle. */
export const BOX_HALF: V3 = [0.5, 1, 0.5];
export const BOX_MASS = 100;
/** The issue's `centre_of_mass: (0, −0.75, 0)`: 0.25 m above the box's base. */
export const LOW: V3 = [0, -0.75, 0];
/**
 * The box `box` standing on the static `ground`, a slab 20 × 1 × 10 m turned `angle`° about +Z (0: level ground), its
 * top face through the origin; the box's base rests on that face and its sleep is off. With `centre`, the box writes
 * `centre_of_mass`.
 */
export function standWorld(angle: number, centre?: V3, parts: JsonObject = {}): JsonObject {
  const [s, c] = [Math.sin(rad(angle)), Math.cos(rad(angle))];
  const rot = [0, 0, angle];
  return world({
    contact_materials: { box: GRIP, ground: GRIP },
    shapes: { box: box(BOX_HALF), ground: box([10, 0.5, 5]) },
    bodies: {
      ground: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'ground' }], pose: { pos: [0.5 * s, -0.5 * c, 0], rot } },
      box: { kind: 'dynamic', shapes: [{ shape: 'box', contact_material: 'box' }], pose: { pos: [0 - s, c, 0], rot }, mass: BOX_MASS, sleep: false, ...(centre ? { [FIELD]: centre } : {}) },
    },
    ...parts,
  });
}

/** The bar's length, the height of its hinge and the angle it is released from. */
export const BAR_LENGTH = 1;
export const HINGE_Y = 2;
export const RELEASE = 10;
/** `centre_of_mass` 0.75 m from the hinge along the bar: the hinge is at the bar's local (0, 0.5, 0). */
export const BAR_LOW: V3 = [0, -0.25, 0];
/**
 * The bar `bar`: a uniform box 1 m long (y) and 0.04 m thick, 1 kg, hanging from the world by the hinge `pivot` about
 * +Z at its top end, built turned 10° from hanging and at rest. Output `swing` reads the hinge's joint_coordinate.
 */
export function barWorld(centre?: V3): JsonObject {
  const [s, c] = [Math.sin(rad(RELEASE)), Math.cos(rad(RELEASE))];
  const half = BAR_LENGTH / 2;
  return world({
    shapes: { bar: box([0.02, half, 0.02]) },
    bodies: { bar: { kind: 'dynamic', shapes: [{ shape: 'bar' }], pose: { pos: [half * s, HINGE_Y - half * c, 0], rot: [0, 0, RELEASE] }, mass: 1, sleep: false, ...(centre ? { [FIELD]: centre } : {}) } },
    joints: { pivot: { kind: 'hinge', a: 'world', b: 'bar', frame_a: { anchor: [0, HINGE_Y, 0], axis: [0, 0, 1] }, frame_b: { anchor: [0, half, 0], axis: [0, 0, 1] } } },
    outputs: { swing: { from: 'pivot', read: 'joint_coordinate' } },
  });
}

const DRAWN_SHAPES: JsonObject = {
  floor: box([30, 0.1, 30]),
  brick: box([0.3, 0.15, 0.2]),
  ball: { kind: 'sphere', radius: 0.25 },
  pill: { kind: 'capsule', half_height: 0.3, radius: 0.15 },
  drum: { kind: 'cylinder', half_height: 0.2, radius: 0.25 },
};
/**
 * A world with no `centre_of_mass`, drawn from `seed` (#1918's mulberry32): a static floor and three to six dynamic
 * bodies dropped onto it, each of one shape or of two (the second at an offset), of two densities, its mass declared
 * or left to its shapes, turned and moving as drawn. Every number has two decimals, so the document is the same text
 * wherever it is drawn.
 */
export function drawnWorld(seed: number): JsonObject {
  const next = rng(seed);
  const u = (): number => next() / 2 ** 32;
  const between = (a: number, b: number): number => Math.round((a + (b - a) * u()) * 100) / 100;
  const pick = (list: readonly string[]): string => list[next() % list.length]!;
  const triple = (a: number, b: number): number[] => [between(a, b), between(a, b), between(a, b)];
  const use = (offset: boolean): JsonObject => ({
    shape: pick(['brick', 'ball', 'pill', 'drum']), contact_material: pick(['light', 'heavy']),
    ...(offset ? { offset: { pos: triple(-0.4, 0.4), rot: triple(-90, 90) } } : {}),
  });
  const bodies: JsonObject = { floor: { kind: 'static', shapes: [{ shape: 'floor', contact_material: 'heavy' }], pose: { pos: [0, -0.1, 0] } } };
  const count = 3 + (next() % 4);
  for (let i = 0; i < count; i++) {
    const shapes = u() < 0.5 ? [use(false), use(true)] : [use(false)];
    const pose = { pos: [between(-1, 1), 1 + 1.2 * i, between(-1, 1)], rot: triple(-90, 90) };
    const velocity = { linear: triple(-2, 2), angular: triple(-180, 180) };
    bodies[`body${i}`] = { kind: 'dynamic', shapes, pose, velocity, sleep: false, ...(u() < 0.5 ? { mass: between(0.5, 20) } : {}) };
  }
  return world({
    contact_materials: { light: { friction: 0.5, restitution: 0.2, density: 300 }, heavy: { friction: 0.7, restitution: 0, density: 2500 } },
    shapes: DRAWN_SHAPES, bodies,
  });
}

// ---------------------------------------------------------------------------------------------------
// Calls and readings

/** A bake sampled once a step, so frame k is the state after step k, reading `read`'s states and every output. */
export const bakeRead = (w: JsonObject, steps: number, read: string[] = []): JsonObject => ({ call: 'bake', world: w, steps, frame_rate: PER_STEP, read });

/** The angle, deg, of the rotation that takes orientation `from` to `to` (quaternions `[x, y, z, w]`), 0 to 180. */
export function turnBetween(from: readonly number[], to: readonly number[]): number {
  // to ⊗ from⁻¹: its vector part is as long as sin(θ ÷ 2) and its w is cos(θ ÷ 2); atan2 keeps a small turn's digits.
  const [av, bv] = [from.slice(0, 3), to.slice(0, 3)];
  const [aw, bw] = [from[3]!, to[3]!];
  const v = sub(sub(bv.map((x) => x * aw), av.map((x) => x * bw)), cross(bv, av));
  return 2 * Math.atan2(length(v), Math.abs(bw * aw + bv[0]! * av[0]! + bv[1]! * av[1]! + bv[2]! * av[2]!)) * DEG;
}
/** The most a body has turned from its built orientation at any step of its states, deg, and the step. */
export function mostTurned(states: readonly State[]): { deg: number; step: number } {
  let most = { deg: 0, step: 0 };
  states.forEach((s, step) => {
    const deg = turnBetween(states[0]!.rot, s.rot);
    if (deg > most.deg) most = { deg, step };
  });
  return most;
}

/** A reading's swing about its middle level: its highest and lowest values and each time, s, it falls through the level between them. */
export interface Swing { period: number | null; high: number; low: number; falls: number[] }
/**
 * The period of a reading sampled once a step: the time between the first two times it falls through the level midway
 * between its highest and its lowest value, each time interpolated linearly between its two steps; null when it falls
 * through it fewer than twice. The level is the reading's own, so a coordinate counted from any zero reads alike.
 */
export function swingOf(samples: readonly number[]): Swing {
  const [high, low] = [Math.max(...samples), Math.min(...samples)];
  const middle = (high + low) / 2;
  const falls: number[] = [];
  for (let k = 1; k < samples.length; k++) {
    const [a, b] = [samples[k - 1]! - middle, samples[k]! - middle];
    if (a > 0 && b <= 0) falls.push((k - 1 + a / (a - b)) / RATE);
  }
  return { period: falls.length >= 2 ? falls[1]! - falls[0]! : null, high, low, falls };
}

/** One sample of a body's `pose` output (README: A body's `pose` output): `{pos: [x, y, z], rot: [x, y, z, w]}`, or the same as seven numbers. */
export interface PoseSample { pos: V3; rot: number[] }
/** Output `id`'s pose samples in a bake sampled at 120/1: `count` of them, index k the pose after step k. */
export function posesOf(reply: JsonObject | undefined, id: string, count: number, what: string): PoseSample[] {
  expect(reply?.['ok'], `${what} is baked, not refused: ${show(reply)}`).toBe(true);
  const o = obj(reply!['outputs'], `${what}: outputs`);
  const series = arr(obj(o['series'], `${what}: outputs.series`)[id], `${what}: outputs.series.${id} (the pose output's sample at each frame)`);
  expect(series.length, `${what}: outputs.series.${id} holds ${count} samples (step 0, then one per step at 120/1)`).toBe(count);
  return series.map((v, k) => {
    const at = `${what}: outputs.series.${id}[${k}]`;
    if (Array.isArray(v) && v.length === 7) {
      const n = vec(v, 7, at);
      return { pos: [n[0]!, n[1]!, n[2]!], rot: n.slice(3) };
    }
    const s = obj(v, at);
    return { pos: vec(s['pos'], 3, `${at}.pos`) as V3, rot: vec(s['rot'], 4, `${at}.rot`) };
  });
}

// ---------------------------------------------------------------------------------------------------
// The check (#2009's call: `{ok: true, issues: [{code, severity, path, actual, what, …}]}`)

/** The error issues of a check at `body`'s `centre_of_mass`: those whose path is the field's. */
export function fieldIssues(reply: JsonObject | undefined, body: string, what: string): JsonObject[] {
  return errorsOf(reply, what).filter((i) => typeof i['path'] === 'string' && i['path'].replace(/^\//, '') === fieldPath(body));
}
/** Everything wrong with a refusal of `body`'s `centre_of_mass` at check: no error issue at the field. The failure names the field. */
export function fieldRefusalFailures(reply: JsonObject | undefined, body: string, what: string): string[] {
  return fieldIssues(reply, body, what).length ? [] : [`${fieldPath(body)}: ${what} isn't refused at check by an error issue at the field; its error issues: ${show(errorsOf(reply, what))}`];
}
/** Everything wrong with a world the check takes: each error issue. */
export function takenFailures(reply: JsonObject | undefined, what: string): string[] {
  return errorsOf(reply, what).map((i) => `${what} isn't taken at check: ${show(i)}`);
}
/** The numbers a sentence writes, a minus sign as `-` or `−`; a hyphen straight after a digit joins two numbers and is no sign. */
export const numbersIn = (text: string): number[] => [...text.matchAll(/(?<!\d)(?<!\d\.)[-−]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0].replace('−', '-')));

// ---------------------------------------------------------------------------------------------------
// The behavior kit (#191's calls): the interface's data and its report on this process's backend.

export interface Kit { data: FixtureData[]; report: KitReport }
/** `behavior_fixtures` and `behavior_kit` from one process, under `planted` when given. */
export function kitOf(planted?: Planted): Kit {
  const [fixtures, report] = ask([{ call: 'behavior_fixtures' }, { call: 'behavior_kit' }], planted);
  return { data: fixturesOf(fixtures!, 'behavior_fixtures'), report: kitReport(report!, `behavior_kit${planted ? ` under ${planted}` : ''}`) };
}
/** The kit's data for fixture `name` when it holds it exactly once; else null, and why in `f`. */
export function dataOf(k: Kit, name: string, f: string[]): FixtureData | null {
  const found = k.data.filter((d) => d.name === name);
  if (found.length !== 1) f.push(`${name}: the kit's data holds it ${found.length} times, not once`);
  return found.length === 1 ? found[0]! : null;
}
/** The report's row for fixture `name` when it holds it exactly once; else null, and why in `f`. */
export function rowOf(k: Kit, name: string, f: string[]): KitResult | null {
  const rows = k.report.results.filter((r) => r.fixture === name);
  if (rows.length !== 1) f.push(`${name}: the kit's report on ${k.report.backend} holds it ${rows.length} times, not once`);
  return rows.length === 1 ? rows[0]! : null;
}
/** A fixture's bodies of `kind`, by ID. */
export function bodiesOf(d: FixtureData, kind: string): [string, JsonObject][] {
  const bodies = isObject(d.world['bodies']) ? d.world['bodies'] : {};
  return Object.entries(bodies).flatMap(([id, b]) => (isObject(b) && b['kind'] === kind ? [[id, b] as [string, JsonObject]] : []));
}
/** Three numbers, or null. */
export const three = (v: JsonValue | undefined): V3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? (v as V3) : null);
/** Everything about a fixture's world that isn't the kit's g = 9.81 m/s² at 120 Hz and 4 substeps (each the design's default when unwritten). */
export function worldFailures(d: FixtureData): string[] {
  const w = d.world;
  const gravity = w['gravity'] === undefined ? [0, -G, 0] : three(w['gravity']);
  const ok = (w['step_rate'] ?? RATE) === RATE && (w['substeps'] ?? 4) === 4 && gravity !== null && Math.abs(Math.hypot(...gravity) - G) < 1e-9;
  return ok ? [] : [`${d.name}: its world isn't at g = 9.81 m/s², 120 Hz and 4 substeps: ${show({ step_rate: w['step_rate'] ?? null, substeps: w['substeps'] ?? null, gravity: w['gravity'] ?? null })}`];
}
/** An answer as the issue prints it admits the exact value within half a unit of its last printed digit. */
export const printedAs = (x: number, printed: string): boolean => Math.abs(x - Number(printed)) <= 0.5 * 10 ** -((printed.split('.')[1] ?? '').length) + 1e-12;
/** A pose's `rot` as a quaternion `[x, y, z, w]`: four numbers as written; three as degrees about X, then Y, then Z in fixed axes; none as no turn. */
export function quatOf(rot: JsonValue | undefined, what: string): number[] {
  if (rot === undefined) return [0, 0, 0, 1];
  const a = arr(rot, what).map((x, i) => num(x, `${what}[${i}]`));
  if (a.length === 4) return a;
  expect(a.length, `${what} is a quaternion [x, y, z, w] or degrees [x, y, z]`).toBe(3);
  const about = (axis: number, deg: number): number[] => { const q = [0, 0, 0, Math.cos(rad(deg) / 2)]; q[axis] = Math.sin(rad(deg) / 2); return q; };
  const times = (p: number[], q: number[]): number[] => {
    const [pv, qv] = [p.slice(0, 3), q.slice(0, 3)];
    const c = cross(pv, qv);
    return [...[0, 1, 2].map((i) => p[3]! * qv[i]! + q[3]! * pv[i]! + c[i]!), p[3]! * q[3]! - pv[0]! * qv[0]! - pv[1]! * qv[1]! - pv[2]! * qv[2]!];
  };
  return times(about(2, a[2]!), times(about(1, a[1]!), about(0, a[0]!)));
}

// ---------------------------------------------------------------------------------------------------
// The two fixtures in the behavior kit's data (README: Fixture names in the behavior kit)

/** One run of criterion 1's fixture: its slope, whether its box writes the issue's `centre_of_mass`, whether it stands, and its name in the behavior kit. */
export interface BoxRun { slope: number; centre: boolean; stands: boolean; fixture: string }
/** The friction of a shape use's contact material; the world's default (0.5 unwritten) for a use that names none or a material that writes none. */
function frictionOf(w: JsonObject, use: JsonObject): number | null {
  const defaults = isObject(w['defaults']) && typeof w['defaults']['friction'] === 'number' ? w['defaults']['friction'] : 0.5;
  if (use['contact_material'] === undefined) return defaults;
  const m = isObject(w['contact_materials']) ? w['contact_materials'][String(use['contact_material'])] : undefined;
  if (!isObject(m)) return null;
  return m['friction'] === undefined ? defaults : typeof m['friction'] === 'number' ? m['friction'] : null;
}
const usesOf = (body: JsonObject): JsonObject[] => (Array.isArray(body['shapes']) ? body['shapes'].filter(isObject) : []);
/**
 * Everything about a run's fixture in the kit's data that isn't criterion 1's: its answer and tolerance; the kit's
 * rate and gravity; one dynamic body of 100 kg, one box 2 m tall along its y and 1 m wide along the slope's fall,
 * standing turned the run's slope from the world's up, with the criterion's `centre_of_mass` or none; a static body
 * under it; friction 2 on every shape use of both.
 */
export function boxDataFailures(r: BoxRun, d: FixtureData): string[] {
  const f = worldFailures(d);
  if (r.stands && (d.answer !== 0 || JSON.stringify(d.tolerance) !== JSON.stringify({ deg: 1 }))) f.push(`${r.fixture}: its answer ${d.answer} and tolerance ${show(d.tolerance)} aren't a turn of 0° within {"deg": 1}`);
  if (!r.stands && d.answer !== 45) f.push(`${r.fixture}: its answer ${d.answer} isn't 45, the turn in degrees its box passes`);
  const [boxes, grounds] = [bodiesOf(d, 'dynamic'), bodiesOf(d, 'static')];
  if (grounds.length === 0) f.push(`${r.fixture}: its world holds no static body for the slope`);
  if (boxes.length !== 1) return [...f, `${r.fixture}: its world holds ${boxes.length} dynamic bodies, not the one box`];
  const [id, b] = boxes[0]!;
  if (b['mass'] !== BOX_MASS) f.push(`${r.fixture}: ${id}'s mass is ${show(b['mass'])}, not 100 kg`);
  if (r.centre ? JSON.stringify(b[FIELD]) !== JSON.stringify(LOW) : b[FIELD] !== undefined) f.push(`${r.fixture}: ${id} writes ${FIELD} ${show(b[FIELD])}, not ${r.centre ? '[0, -0.75, 0]' : 'none'}`);
  const slippery = [...boxes, ...grounds].flatMap(([body, x]) => usesOf(x).map((u) => ({ body, friction: frictionOf(d.world, u) }))).filter((x) => x.friction !== 2);
  if (slippery.length) f.push(`${r.fixture}: the box and the slope aren't both of friction 2: ${show(slippery)}`);
  const shapes = isObject(d.world['shapes']) ? d.world['shapes'] : {};
  const shape = usesOf(b).length === 1 ? shapes[String(usesOf(b)[0]!['shape'])] : undefined;
  const half = isObject(shape) && shape['kind'] === 'box' ? three(shape['half']) : null;
  if (!half) return [...f, `${r.fixture}: ${id} isn't one box: ${show(b['shapes'])}`];
  // Gravity's direction in the box's own frame: its part along the box's y is the slope's cosine, the rest runs down the slope.
  const gravity = d.world['gravity'] === undefined ? [0, -G, 0] : three(d.world['gravity']);
  if (!gravity) return f;
  const q = quatOf(isObject(b['pose']) ? b['pose']['rot'] : undefined, `${r.fixture}: ${id}'s pose.rot`);
  const down = rotate([-q[0]!, -q[1]!, -q[2]!, q[3]!], gravity.map((x) => x / Math.hypot(...gravity)));
  const tilt = Math.acos(Math.max(-1, Math.min(1, -down[1]))) * DEG;
  if (Math.abs(tilt - r.slope) > 0.01 || half[1] !== BOX_HALF[1]) f.push(`${r.fixture}: ${id}, ${2 * half[1]} m tall along its y, stands turned ${fmt(tilt)}° from the world's up, not 2 m tall on a ${r.slope}° slope`);
  const along = Math.abs(down[0]) >= Math.abs(down[2]) ? 0 : 2;
  if (Math.abs(down[2 - along]!) > 1e-6 || half[along] !== BOX_HALF[0]) f.push(`${r.fixture}: ${id} isn't 1 m wide along the slope's fall (its half extents ${show(half)}, gravity in its frame ${show(down)})`);
  return f;
}

/** One of criterion 2's bars: whether it writes `centre_of_mass`, its answer worked from the issue's formula and as the issue prints it, and its name in the behavior kit. */
export interface BarRun { centre: boolean; answer: number; printed: string; fixture: string }
/** How far from the hinge, along the bar, criterion 2 writes the centre, m. */
export const FROM_HINGE = 0.75;
/** Where a hinge holds body `id`, in the body's frame: its named anchor (`<id>#<anchor>`), else its frame's anchor; null when the joint doesn't hold it to the world. */
function hingedAt(j: JsonObject, id: string, body: JsonObject): number[] | null {
  if (j['kind'] !== 'hinge') return null;
  const ends = (['a', 'b'] as const).map((key) => ({ key, name: String(j[key]).split('#') }));
  const mine = ends.find((e) => e.name[0] === id);
  if (!mine || !ends.some((e) => e.name[0] === 'world')) return null;
  const [anchors, anchor] = [isObject(body['anchors']) ? body['anchors'] : {}, mine.name[1]];
  const frame = j[`frame_${mine.key}`];
  return (anchor !== undefined ? three(anchors[anchor]) : null) ?? (isObject(frame) ? three(frame['anchor']) : null) ?? [0, 0, 0];
}
/**
 * Everything about a bar's fixture in the kit's data that isn't criterion 2's: its answer as the issue prints it and
 * its tolerance of 1%; the kit's rate and gravity; one dynamic body on a hinge to the world; with the field, its
 * `centre_of_mass` 0.75 m from the hinge's anchor on it, and without, none.
 */
export function barDataFailures(b: BarRun, d: FixtureData): string[] {
  const f = worldFailures(d);
  if (!printedAs(d.answer, b.printed) || JSON.stringify(d.tolerance) !== JSON.stringify({ relative: 0.01 })) f.push(`${b.fixture}: its answer ${d.answer} and tolerance ${show(d.tolerance)} aren't the issue's ${b.printed} s within {"relative": 0.01}`);
  const bars = bodiesOf(d, 'dynamic');
  if (bars.length !== 1) return [...f, `${b.fixture}: its world holds ${bars.length} dynamic bodies, not the one bar`];
  const [id, body] = bars[0]!;
  const joints = isObject(d.world['joints']) ? Object.values(d.world['joints']).filter(isObject) : [];
  const at = joints.map((j) => hingedAt(j, id, body)).find((a) => a !== null);
  if (!at) return [...f, `${b.fixture}: no hinge holds ${id} to the world: ${show(d.world['joints'])}`];
  const centre = three(body[FIELD]);
  if (!b.centre && body[FIELD] !== undefined) f.push(`${b.fixture}: ${id} writes ${FIELD} ${show(body[FIELD])}, not none`);
  if (b.centre && (!centre || Math.abs(length(sub(centre, at)) - FROM_HINGE) > 1e-9)) f.push(`${b.fixture}: ${id} writes ${FIELD} ${show(body[FIELD])}, not a point 0.75 m from its hinge at ${show(at)}`);
  return f;
}
