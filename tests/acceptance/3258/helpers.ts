// Test-side tools for the #3258 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply a line) as #524's suite does, through its helpers (imported read only): the
// checkout's own build and the `test-swap-soft-solver` build, whose soft solver meets no contact and tears nothing. They
// add this issue's worlds, its planted names and its judges. Nothing here stands in for the audit: every verdict, failure
// and reading judged here is the program's own, every expected value is the issue's, the fixture's own numbers or the
// motion the same binary bakes. A judge returns what is wrong as sentences; each test asserts that there are none.

import {
  ask, auditOf, bake, cloth, isObject, on, particlesOf, rope, sceneDoc, show, softWorld, swappedBin, SWAP_FEATURE,
  type JsonObject, type JsonValue, type Planted as Planted524, type V3, type World,
} from '../524/helpers.ts';
import { physicsBin } from '../191/helpers.ts';

export {
  LABS, REPO, TIMEOUT, arr, banner, builtOf, check, cleanBuilds, inconclusive, isObject, labOf, load, none, num, obj, ropeAndBanner, show,
  softWorld, standing, str, type JsonObject, type Lab, type V3, type World,
} from '../524/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = {
  1: '#3258.acf18c87', 2: '#3258.96b5e231', 3: '#3258.e4187366', 4: '#3258.5e7ec8a8', 5: '#3258.940c680d', 6: '#3258.7ba56287',
} as const;

/** This suite's planted names (`deep-physics --planted <name>`, on either build), each a wrong reading a criterion names (README). */
export type Planted = 'through_reads_contact_pairs' | 'through_in_world_frame' | 'through_reads_one_step' | 'through_counts_inside';

/** Runs `calls` through the build whose soft solver meets no contact, as shipped or with one planted reading: exit 0, one reply a call. */
export const swapped = (calls: JsonObject[], planted?: Planted): JsonObject[] =>
  ask(calls, { bin: swappedBin(), where: `--features ${SWAP_FEATURE}`, ...(planted ? { planted: planted as unknown as Planted524 } : {}) });

/** Runs `calls` through this checkout's build as shipped, on the pinned backend (#191's build, whose `prebuild(['shipped'])` a file calls once). */
export const pinned = (calls: JsonObject[]): JsonObject[] => ask(calls, { bin: physicsBin('shipped') });

/** physics.audit of `w` over `steps` steps, at its defaults but for `settings`. */
export const audit = (w: World, steps: number, settings?: JsonObject): JsonObject => ({ call: 'audit', ...on(w), steps, ...(settings ? { settings } : {}) });

// ---------------------------------------------------------------------------------------------------
// The worlds (README: The worlds): g = 9.81 m/s², 120 Hz, 4 substeps, no damping, particle_radius 0 unless said.

const RATE = 120;
const G = 9.81;
/** The rope of criteria 1 to 3: 21 particles 0.05 m apart along x, level, 0.5 m up. */
export const ROPE = 'rope';
export const ROPE_Y = 0.5;
const levelRope = (extra: JsonObject): JsonObject => rope([-0.5, ROPE_Y, 0], [0.5, ROPE_Y, 0], 21, { damping: 0, ...extra });
export const ROPE_ADDRESSES = Array.from({ length: 21 }, (_, i) => String(i));
/** The plate: a box 5 mm thick, 2 m × 1 m, all of the rope over it. */
export const PLATE = 'plate';
export const THICK = 0.005;
const PLATE_SHAPE: JsonObject = { plate: { kind: 'box', half: [1, THICK / 2, 0.5] } };
const PLATE_USES = [{ shape: 'plate', contact_material: 'ground' }];

/** What gravity drops a particle let go from rest by `k` steps of 4 substeps of the swapped solver: g h² n (n + 1) / 2, n = 4 k. */
export const fallen = (k: number): number => { const n = 4 * k; return (G * n * (n + 1)) / (2 * (4 * RATE) ** 2); };
/** The step at whose end a particle let go level `height` above a face is first past it. */
export const fallStep = (height: number): number => { let k = 0; while (fallen(k) <= height) k++; return k; };

/** Criterion 1: the rope let go 0.5 m above a static plate whose top is y = 0. */
export const ropeOverPlate = (): World => ({
  doc: softWorld({ shapes: PLATE_SHAPE, bodies: { [PLATE]: { kind: 'static', shapes: PLATE_USES, pose: { pos: [0, -THICK / 2, 0] } } }, soft: { [ROPE]: levelRope({}) } }),
  id: 'plate',
});

const box = (at: readonly number[]): JsonObject => ({ kind: 'mark.box@1', params: { size: [0.02, 0.02, 0.02] }, at: { pos: [...at] } });
interface Key { t: string; value: V3 }
const channel = (item: string, keys: Key[]): JsonObject => ({
  target: `items/${item}/at/pos`, type: 'vec3',
  keys: Object.fromEntries(keys.map((k, i) => [`k${i}`, { t: k.t, value: k.value, interp: i + 1 < keys.length ? 'linear' : 'hold' }])),
});

/** Criterion 2: the rope with every particle pinned, and a kinematic plate whose top starts `below` the rope and moves by `keys` (each the top's height over its start, m). */
function pinnedRope(title: string, below: number, keys: { t: string; up: number }[]): World {
  const at = (up: number): V3 => [0, ROPE_Y - below + up - THICK / 2, 0];
  const doc = softWorld({
    shapes: PLATE_SHAPE, bodies: { [PLATE]: { kind: 'kinematic', shapes: PLATE_USES, pose: { pos: at(0) }, follow: 'items/lift/at/pos' } },
    soft: { [ROPE]: levelRope({ pins: ROPE_ADDRESSES }) },
  });
  return { doc, scene: sceneDoc(title, '2s', 60, { lift: box(at(0)) }, { lab: doc }, { channels: { lift: channel('lift', keys.map((k) => ({ t: k.t, value: at(k.up) }))) } }), id: 'lab' };
}
/** A step's rise at 0.1 m/s: a sixth of the plate's thickness. */
export const RISE = 0.1 / RATE;
/** The plate rises through the rope at 0.1 m/s. Its top starts 12.5 steps below, so it is past the rope from step 13 and its underside from step 19: each particle is inside at the ends of steps 13 to 18. */
export const risingPlate = (): World => pinnedRope('Rising plate', 12.5 * RISE, [{ t: '0s', up: 0 }, { t: '1s', up: 0.1 }]);
export const RISEN_STEP = 19;
/** The plate rises 12.5 mm in 15 steps from 9.5 mm below, 3 mm past the rope, and goes back down in 15: each particle is inside at the ends of steps 12 to 18. */
export const turnedPlate = (): World => pinnedRope('Turned plate', 0.0095, [{ t: '0s', up: 0 }, { t: '0.125s', up: 0.0125 }, { t: '0.25s', up: 0 }]);

/** Criterion 3: the rope's ends ride two kinematic bodies down at 1 m/s, under gravity, past a static peg 4 mm across 0.3 m below it, lying along z midway between particles 10 and 11, or `beside` it. */
export const PEG = 'peg';
export const PEG_X = 0.025;
export const PEG_Y = ROPE_Y - 0.3;
export const PEG_RADIUS = 0.002;
export function peggedRope(beside: boolean): World {
  const hand = (x: number, y: number): V3 => [x, y, 0];
  const hands = { left: -0.7, right: 0.7 } as const;
  const doc = softWorld({
    shapes: { hand: { kind: 'sphere', radius: 0.05 }, peg: { kind: 'cylinder', half_height: 0.05, radius: PEG_RADIUS } },
    bodies: {
      [PEG]: { kind: 'static', shapes: [{ shape: 'peg', contact_material: 'ground' }], pose: { pos: [PEG_X, PEG_Y, beside ? 0.1 : 0], rot: [90, 0, 0] } },
      ...Object.fromEntries(Object.entries(hands).map(([id, x]) => [id, { kind: 'kinematic', shapes: [{ shape: 'hand', contact_material: 'ground' }], pose: { pos: hand(x, ROPE_Y) }, follow: `items/${id}_item/at/pos` }])),
    },
    soft: { [ROPE]: levelRope({ pinned_to: { 0: 'left', 20: 'right' } }) },
  });
  const items = Object.fromEntries(Object.entries(hands).map(([id, x]) => [`${id}_item`, box(hand(x, ROPE_Y))]));
  const channels = Object.fromEntries(Object.entries(hands).map(([id, x]) => [id, channel(`${id}_item`, [{ t: '0s', value: hand(x, ROPE_Y) }, { t: '1s', value: hand(x, ROPE_Y - 1) }])]));
  return { doc, scene: sceneDoc('Rope past a peg', '1s', 60, items, { lab: doc }, { channels }), id: 'lab' };
}
/** The rope's own edges stretch as its ends go ahead of it: the other rules are set wide, so `through` alone decides criterion 3's verdicts. */
export const WIDE: JsonObject = { energy: { max_gain: 1e6 }, soft: { max_stretch: 100 } };

/** Criterion 4: a cloth of 11 × 11 particles 0.1 m apart let go level 0.5 m above a second of the same lattice, pinned whole, half a cell aside along x and z. */
export const LOWER = 'lower';
export const UPPER = 'upper';
const SIDE = 11;
const CELL = 0.1;
export function twoCloths(): World {
  const sheet = (aside: number, y: number, extra: JsonObject): JsonObject =>
    cloth([-0.5 + aside, y, -0.5 + aside], [CELL, 0, 0], [0, 0, CELL], SIDE, SIDE, { damping: 0, ...extra });
  const every = Array.from({ length: SIDE * SIDE }, (_, i) => `r${Math.floor(i / SIDE)}c${i % SIDE}`);
  return { doc: softWorld({ soft: { [LOWER]: sheet(0, 0, { pins: every }), [UPPER]: sheet(CELL / 2, ROPE_Y, {}) } }), id: 'cloths' };
}
/** Criterion 4's rope: particles 0 to 9 along x at y = 0, pinned, and 10 to 19 along z 2 cm above, let go, each pass its own chain of edges 0.05 m long, crossing over the middle of edge 4–5 with the middle of edge 14–15. */
export const PASS_GAP = 0.02;
export const PASSES: readonly [readonly [string, string], readonly [string, string]] = [['4', '5'], ['14', '15']];
export function crossedRope(selfContacts: boolean): World {
  const along = Array.from({ length: 10 }, (_, i) => -0.225 + 0.05 * i);
  const positions = [...along.map((x) => [x, 0, 0]), ...along.map((z) => [0, PASS_GAP, z])];
  const edges = [0, 10].flatMap((start) => Array.from({ length: 9 }, (_, i) => [String(start + i), String(start + i + 1)]));
  const passes: JsonObject = {
    shape: 'rope', positions, edges, masses: { default: 0.05 }, stretch: { hz: 30, damping_ratio: 0.5 }, damping: 0, contact_material: 'cloth',
    pins: along.map((_, i) => String(i)), self_contacts: selfContacts,
  };
  return { doc: softWorld({ soft: { [ROPE]: passes } }), id: 'passes' };
}

/**
 * Criterion 5: on the pinned backend, a rope of 61 particles 0.025 m apart lying on a box 2 m long, 1 m high and 1 m wide, 5 cm
 * of it past the top edge at x = 1 m, its end pinned to a kinematic body that draws it straight down the side at 0.4 m/s for 2 s.
 */
export const CRATE: V3 = [1, 0.5, 0.5];
export const DRAG_STEPS = 2 * RATE;
export function draggedRope(): World {
  const top = 2 * CRATE[1] + 0.005;
  const end = CRATE[0] + 0.05;
  const puller = (y: number): V3 => [end + 0.25, y, 0];
  const doc = softWorld({
    shapes: { crate: { kind: 'box', half: CRATE }, hand: { kind: 'sphere', radius: 0.05 } },
    contact_materials: { ground: { friction: 0.1, restitution: 0 }, cloth: { friction: 0.1, restitution: 0, density: 100 } },
    bodies: {
      crate: { kind: 'static', shapes: [{ shape: 'crate', contact_material: 'ground' }], pose: { pos: [0, CRATE[1], 0] } },
      puller: { kind: 'kinematic', shapes: [{ shape: 'hand', contact_material: 'ground' }], pose: { pos: puller(top) }, follow: 'items/grip/at/pos' },
    },
    soft: { [ROPE]: rope([end - 1.5, top, 0], [end, top, 0], 61, { stretch: { hz: 120, damping_ratio: 1 }, pinned_to: { 60: 'puller' } }) },
  });
  const scene = sceneDoc('Rope over an edge', '2s', 60, { grip: box(puller(top)) }, { lab: doc }, { channels: { grip: channel('grip', [{ t: '0s', value: puller(top) }, { t: '2s', value: puller(top - 0.8) }]) } });
  return { doc, scene, id: 'lab' };
}

// ---------------------------------------------------------------------------------------------------
// The motion a fixture has, from the same binary's bake: positions[k][i], particle i after step k.

/** Soft body `id`'s particles at the end of each of `steps` steps. */
export const pathsOf = (reply: JsonObject | undefined, id: string, steps: number, what: string): V3[][] => particlesOf(reply, id, steps + 1, what).positions;
export const bakes = (w: World, steps: number): JsonObject => bake(w, steps);

// ---------------------------------------------------------------------------------------------------
// The audit's reply (README: What the audit answers).

export const RULE = 'soft.through';
export interface Read { verdict: string; settings: JsonObject; rows: JsonObject[]; others: JsonObject[]; readings: JsonObject; through: JsonValue; self: JsonValue }
/** An audit's reply: its verdict, its `soft.through` failures in their order and the others, and the two readings as they came. */
export function readOf(reply: JsonObject | undefined, what: string): Read {
  const a = auditOf(reply, what);
  const r = isObject(reply!['readings']) ? reply!['readings'] : {};
  const rows = a.failures.map((f) => f.raw);
  return {
    verdict: a.verdict, settings: a.settings, rows: rows.filter((f) => f['rule'] === RULE), others: rows.filter((f) => f['rule'] !== RULE),
    readings: r, through: r['through'] ?? null, self: r['self_through'] ?? null,
  };
}
/** What an audit said, for a message and the run's output. */
export const told = (r: Read): string => `${r.verdict}, readings ${show(r.readings)}, ${RULE} failures ${show(r.rows)}, other failures ${show(r.others)}`;
const count = (v: JsonValue): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Everything wrong with "reads 0": no `through` reading, one above 0, no `self_through` reading, or a `soft.through` failure. */
export function zeroFailures(r: Read, what: string): string[] {
  const out: string[] = [];
  if (!count(r.through)) out.push(`${what}: the audit's readings hold no count \`through\`: ${show(r.through)}`);
  else if (r.through !== 0) out.push(`${what}: readings.through is ${r.through}, not 0`);
  if (!count(r.self)) out.push(`${what}: the audit's readings hold no count \`self_through\`: ${show(r.self)}`);
  out.push(...r.rows.map((f) => `${what}: a ${RULE} failure, where nothing passed through: ${show(f)}`));
  return out;
}
/** Everything wrong with "the audit passes, reading 0". */
export const passFailures = (r: Read, what: string): string[] => [...(r.verdict === 'PASS' ? [] : [`${what}: the audit's verdict is ${r.verdict}, not PASS: ${told(r)}`]), ...zeroFailures(r, what)];

/** One fix the issue lists: a larger `particle_radius`, particles closer together, more substeps, or a thicker shape. */
const FIXES = /particle_radius|closer|substep|thick/i;
/**
 * Everything wrong with "fails `soft.through`": the verdict not FAIL, another rule failing, no `soft.through` failure, either
 * reading missing or the two counting nothing, and for each failure a count not above its limit, the limit not the default
 * 0, no soft body in `id`, no step of the run, or no fix the issue lists.
 */
export function failFailures(r: Read, steps: number, what: string): string[] {
  const out: string[] = [];
  if (r.verdict !== 'FAIL') out.push(`${what}: the audit's verdict is ${r.verdict}, not FAIL: ${told(r)}`);
  if (r.others.length) out.push(`${what}: another rule fails beside ${RULE}: ${show(r.others)}`);
  if (!r.rows.length) out.push(`${what}: no failure of rule ${RULE}: ${told(r)}`);
  if (!count(r.through)) out.push(`${what}: the audit's readings hold no count \`through\`: ${show(r.through)}`);
  if (!count(r.self)) out.push(`${what}: the audit's readings hold no count \`self_through\`: ${show(r.self)}`);
  if (count(r.through) && count(r.self) && r.through + r.self === 0) out.push(`${what}: the audit's readings count nothing through: ${show(r.readings)}`);
  for (const f of r.rows) {
    const [k, m, limit, fix] = [f['step'], f['measured'], f['limit'], f['fix']];
    if (limit !== 0) out.push(`${what}: a failure's limit is ${show(limit)}, not soft.through.max's default 0: ${show(f)}`);
    if (!count(m ?? null) || (m as number) < 1) out.push(`${what}: a failure's measured is ${show(m)}, not a count of ways through above the limit: ${show(f)}`);
    if (typeof f['id'] !== 'string') out.push(`${what}: a failure names no soft body in id: ${show(f)}`);
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > steps) out.push(`${what}: a failure names step ${show(k)}, not a step of the run (1 to ${steps}): ${show(f)}`);
    if (typeof fix !== 'string' || !FIXES.test(fix)) out.push(`${what}: a failure's fix names none of the issue's (particle_radius, particles closer together, substeps, a thicker shape): ${show(fix)}`);
  }
  return out;
}

/** An address as `<soft>#<address>`: as it came in that form, or a local address under the failure's own soft body or `owner`. */
export const address = (v: JsonValue | undefined, owner: string): string | null => (typeof v !== 'string' ? null : v.includes('#') ? v : `${owner}#${v}`);
/** A failure's list of addresses, sorted, or null when it holds none. */
const addresses = (v: JsonValue | undefined, owner: string, n: number): string[] | null => {
  if (!Array.isArray(v) || v.length !== n) return null;
  const all = v.map((a) => address(a, owner));
  return all.every((a): a is string => a !== null) ? all.sort() : null;
};
const idOf = (f: JsonObject): string => (typeof f['id'] === 'string' ? f['id'] : '');
/** The soft body on the other side of a soft-through-soft failure: `other`, or for a body through itself its own. */
const otherOf = (f: JsonObject): string => (typeof f['other'] === 'string' ? f['other'] : idOf(f));
export const particleOf = (f: JsonObject): string | null => address(f['particle'], idOf(f));
export const edgeOf = (f: JsonObject): string[] | null => addresses(f['edge'], idOf(f), 2);
export const otherEdgeOf = (f: JsonObject): string[] | null => addresses(f['other_edge'], otherOf(f), 2);
export const faceOf = (f: JsonObject): string[] | null => addresses(f['face'], otherOf(f), 3);
/** Every soft body a failure names by `id` or `other`. */
export const softsOf = (f: JsonObject): string[] => [...new Set([idOf(f), otherOf(f)])].sort();
/** Everything wrong with a failure naming body `id`'s one shape use: `shape: {body, index}`, as the runner names a shape use. */
export function useFailures(f: JsonObject, id: string, what: string): string[] {
  const s = f['shape'];
  return isObject(s) && s['body'] === id && s['index'] === 0 ? [] : [`${what}: the failure names the shape use ${show(s)}, not {"body": "${id}", "index": 0}: ${show(f)}`];
}
export const full = (soft: string, local: readonly string[]): string[] => local.map((a) => `${soft}#${a}`).sort();
