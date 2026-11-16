// Test-side tools for the #251 criterion 6 redraft (README: The surface under test). The runner is the first draft's
// (../251/helpers.ts, imported read only, and through it #2009's to #522's): one `deep-physics` process answering
// `check` of a world document, built once per file, or started as `deep-physics --planted check_counts_wheels_only`.
// The worlds and the judge are this suite's own, built from the issue's Fields. Nothing here stands in for the physics
// module: every issue judged is the program's own.

import { ask, box, errorsOf, show, world, type JsonObject, type JsonValue, type Planted } from '../251/helpers.ts';

export { TIMEOUT, caught, none, prebuild } from '../251/helpers.ts';

/** Criterion 6's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const ID = '#251.2e102906';
/** The criterion's wrong program: the vehicle body's check counts the wheels and refuses nothing else. */
export const TWIN: Planted = 'check_counts_wheels_only';

// ---------------------------------------------------------------------------------------------------
// The vehicle body `kart` (README: The worlds), on the issue's Fields: heading +Z, up +Y, axle X, so left is +X.

type V3 = [number, number, number];
/** The chassis box's half extents; its centre is the body's origin. */
const CHASSIS: V3 = [0.9, 0.25, 1.7];
const RADIUS = 0.3;
const SUSPENSION: JsonObject = { rest: 0.3, travel: 0.2, hz: 2, damping_ratio: 0.3 };
/** Mounts on the chassis's underside: `x` across (left +), `z` along (front +). */
const at = (x: number, z: number): V3 => [x, -CHASSIS[1], z];
const wheel = (x: number, z: number, role: JsonObject = {}): JsonObject => ({ at: at(x, z), radius: RADIUS, suspension: SUSPENSION, ...role });

/** The issue's car: four wheels at the corners of a 2.5 m wheelbase and a 1.6 m track, front steering, rear driving. */
const FOUR: JsonObject = {
  fl: wheel(0.8, 1.25, { steers: true }),
  fr: wheel(-0.8, 1.25, { steers: true }),
  rl: wheel(0.8, -1.25, { drives: true }),
  rr: wheel(-0.8, -1.25, { drives: true }),
};
/** Eight wheels, the most a vehicle holds: four axles, the front one steering, the rear one driving. */
const EIGHT: JsonObject = {
  a1l: wheel(0.8, 1.25, { steers: true }), a1r: wheel(-0.8, 1.25, { steers: true }),
  a2l: wheel(0.8, 0.42), a2r: wheel(-0.8, 0.42),
  a3l: wheel(0.8, -0.42), a3r: wheel(-0.8, -0.42),
  a4l: wheel(0.8, -1.25, { drives: true }), a4r: wheel(-0.8, -1.25, { drives: true }),
};
/** The eight and a ninth under the chassis's middle. */
const NINE: JsonObject = { ...EIGHT, a5c: wheel(0, 0) };

/** The vehicle body `kart`, 1,000 kg, its wheels just reaching the floor at rest length. */
function kart(wheels: JsonObject, vehicle: JsonObject = {}, extra: JsonObject = {}): JsonObject {
  return {
    kind: 'vehicle',
    shapes: [{ shape: 'chassis' }],
    pose: { pos: [0, CHASSIS[1] + 0.3 + RADIUS, 0] },
    mass: 1000,
    vehicle: { wheels, ...vehicle },
    ...extra,
  };
}
/** A 3D world on level ground (a static floor whose top is y = 0) holding `body` as `kart`. */
function onFloor(body: JsonObject): JsonObject {
  return world({
    shapes: { floor: box([50, 0.5, 50]), chassis: box(CHASSIS) },
    bodies: { floor: { kind: 'static', shapes: [{ shape: 'floor' }], pose: { pos: [0, -0.5, 0] } }, kart: body },
  });
}

/** Each world this suite checks, by the name its failures use. */
export const WORLDS = {
  /** The issue's car in a 3D world, `steer_max` written out: admitted. */
  'the four-wheeled kart': onFloor(kart(FOUR, { steer_max: 35 })),
  /** Eight wheels, `steer_max` left to its default: admitted. */
  'the eight-wheeled kart': onFloor(kart(EIGHT)),
  /** The four-wheeled kart's world with `dimensions: 2` and nothing else changed. */
  'the 2D world': { ...onFloor(kart(FOUR, { steer_max: 35 })), dimensions: 2 },
  /** The four-wheeled kart with a follow channel. */
  'the follow channel': onFloor(kart(FOUR, { steer_max: 35 }, { follow: 'items/gate/at/pos' })),
  /** The eight-wheeled kart with a ninth wheel. */
  'the ninth wheel': onFloor(kart(NINE)),
} as const;
export type WorldName = keyof typeof WORLDS;
const NAMES = Object.keys(WORLDS) as WorldName[];

/** Checks every world in one deep-physics process, under `planted` when given: each world's error issues. */
export function checkAll(planted?: Planted): Record<WorldName, JsonObject[]> {
  const replies = ask(NAMES.map((n) => ({ call: 'check', world: WORLDS[n] })), planted, planted ?? 'the vehicle worlds');
  return Object.fromEntries(NAMES.map((n, i) => [n, errorsOf(replies[i], `${planted ?? 'deep-physics'}: check of ${n}`)])) as Record<WorldName, JsonObject[]>;
}

// ---------------------------------------------------------------------------------------------------
// Judging (README: Readings). A refusal names its field by its `path`, whatever its separator or leading slash.

const segments = (path: JsonValue | undefined): string[] => (typeof path === 'string' ? path.split(/[/.]/).filter((s) => s !== '') : []);
const underKart = (s: string[]): boolean => s[0] === 'bodies' && s[1] === 'kart';
/** The issue names the body `kart`: its path is under it, its `ids` hold it, or its `what` names it as a word. */
const namesKart = (e: JsonObject): boolean =>
  underKart(segments(e['path'])) || (Array.isArray(e['ids']) && e['ids'].includes('kart')) || (typeof e['what'] === 'string' && /\bkart\b/.test(e['what']));

/** Each refused world: the field its refusal must name, and the test of an error issue that names it. */
const REFUSALS: [WorldName, string, (e: JsonObject) => boolean][] = [
  ['the 2D world', 'bodies/kart/kind (or dimensions, naming kart)', (e) => {
    const s = segments(e['path']);
    return (underKart(s) && s.length === 3 && s[2] === 'kind') || (s.length === 1 && s[0] === 'dimensions' && namesKart(e));
  }],
  ['the follow channel', 'bodies/kart/follow', (e) => { const s = segments(e['path']); return underKart(s) && s[2] === 'follow'; }],
  ['the ninth wheel', 'bodies/kart/vehicle/wheels', (e) => { const s = segments(e['path']); return underKart(s) && s[2] === 'vehicle' && s[3] === 'wheels'; }],
];
const ADMITTED: WorldName[] = ['the four-wheeled kart', 'the eight-wheeled kart'];

/** Criterion 6's judge: the two right bodies admitted, each wrong one refused naming its field; one line a failure, led by the world. */
export function judge(errors: Record<WorldName, JsonObject[]>): string[] {
  const out: string[] = [];
  for (const n of ADMITTED) {
    if (errors[n].length) out.push(`${n}: refused, where a right vehicle body is admitted: ${show(errors[n] as JsonValue)}`);
  }
  for (const [n, field, names] of REFUSALS) {
    if (!errors[n].some(names)) out.push(`${n}: no error refuses the vehicle body kart naming the field ${field} (errors: ${show(errors[n] as JsonValue)})`);
  }
  return out;
}
