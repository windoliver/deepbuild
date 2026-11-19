// Test-side tools for the blind redraft of #2239's fourth criterion and the blind draft of its seventh (README). The
// runner, the shot's worlds, the bar and the lint's judges are the first draft's, imported read only from
// ../2239/helpers.ts. This file adds only what that one lacks: the two criterion IDs, the one planted name the amended
// issue adds, the bar and its resting ball, and how a ball left at rest is told from a struck one. Nothing here stands
// in for the lint or the backend: every issue and body state read here is the implementation's own, and every
// expected value is the issue's. A reader returns what it found and asserts nothing, so each test fails at an
// assertion in its own file.

import {
  BALL, BAR, BAR_HALF, BAR_TURN, RATE, barWorld, planted, statesOf, type JsonObject, type Planted, type Twin,
} from '../2239/helpers.ts';

type JsonValue = JsonObject[string];
const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const objectAt = (o: JsonObject, key: string): JsonObject => {
  const v = o[key];
  return isObject(v) ? v : {};
};

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text), from the issue's body as amended. */
export const AC = { 4: '#2239.9cc14721', 7: '#2239.2136cd3f' } as const;

// ---------------------------------------------------------------------------------------------------
// The planted programs (`deep-physics --planted <name>`), one a criterion.

/** Criterion 4's: a lint that reads the backend's sweep alone, without the prediction. The one name this folder adds. */
export const SWEEP_ALONE = 'lint_reads_sweep_alone';
/** Criterion 7's: a lint that reads one body at a time. The first draft's name for that wrong program. */
export const ONE_BODY: Planted = 'lint_one_body_at_a_time';
/** Runs `calls` through one `deep-physics --planted lint_reads_sweep_alone` process, as the first draft's `planted` runs its own names. */
export const plantedSweepAlone = (calls: JsonObject[]): Twin => planted(SWEEP_ALONE as string as Planted, calls);

/** Whether an issue is of kind `pair` and names both bodies. */
export const pairNaming = (i: JsonObject, a: string, b: string): boolean =>
  i['kind'] === 'pair' && Array.isArray(i['ids']) && i['ids'].includes(a) && i['ids'].includes(b);

// ---------------------------------------------------------------------------------------------------
// At rest, or struck.

/** A micron, and a micron a second: the first draft's bound on "at rest". */
const REST = 1e-6;
/**
 * How a ball left at rest is told from a struck one. Left at rest, it is within a micron of where it was built and
 * slower than a micron a second at the end of every step of the run. Struck, it isn't: this is the first step at
 * whose end it is off that spot or moving, and −1 for a ball left at rest.
 */
export function struckStep(reply: JsonObject, id: string, what: string): number {
  const states = statesOf(reply, id, what);
  const built = states[0]!.pos;
  return states.findIndex((s) => Math.hypot(s.pos[0] - built[0], s.pos[1] - built[1], s.pos[2] - built[2]) > REST || Math.hypot(...s.linear) > REST);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 7's world: criterion 3's bar with `ccd: true`, turning toward a resting ball.

/** The resting ball: radius 0.02 m, its centre 0.95 m from the bar's centre. */
const SMALL_RADIUS = 0.02;
const REACH = 0.95;
/** The ball is 15° ahead of the bar in the first start. */
const AHEAD = 15;
/** A tenth of a step's turn, degrees: 720°/s at 120 Hz is 6° a step, so 0.6°. */
export const START_TURN = BAR_TURN / RATE / 10;
/** How far ahead of the bar the ball is in start j, degrees: start j begins a tenth of a step's turn farther back than start j − 1. */
export const aheadOf = (j: number): number => AHEAD + j * START_TURN;
/** The turn that takes the bar's trailing face clear of the ball's far side, past the ball's bearing, degrees. */
export const CLEAR = (Math.asin((BAR_HALF[1] + SMALL_RADIUS) / REACH) * 180) / Math.PI;

/**
 * Start j: the bar as criterion 3 builds it (2 m long along x, 0.02 m thick, turning about z at 720°/s, its centre at
 * the origin, no linear velocity, gravity_scale 0), with `ccd: true`; and the ball at rest in the plane of the turn,
 * 0.95 m from the bar's centre and `aheadOf(j)` degrees ahead of its +x arm, with gravity_scale 0 and `ccd` written.
 */
export function barBallWorld(j: number, ballCcd: boolean): JsonObject {
  const w = barWorld(true);
  const a = (aheadOf(j) * Math.PI) / 180;
  const material = Object.keys(objectAt(w, 'contact_materials'))[0] ?? '';
  return {
    ...w,
    shapes: { ...objectAt(w, 'shapes'), [BALL]: { kind: 'sphere', radius: SMALL_RADIUS } },
    bodies: {
      ...objectAt(w, 'bodies'),
      [BALL]: { kind: 'dynamic', shapes: [{ shape: BALL, contact_material: material }], pose: { pos: [REACH * Math.cos(a), REACH * Math.sin(a), 0] }, gravity_scale: 0, ccd: ballCcd },
    },
  };
}

/**
 * The bar's turn after each step, degrees: the bearing of its +x arm about z, from each state's `rot`, a quaternion
 * [x, y, z, w] (the base's bake). Empty, or NaN at a step, where a state holds none.
 */
function turnsOf(reply: JsonObject): number[] {
  const series = objectAt(reply, 'bodies')[BAR];
  if (!Array.isArray(series)) return [];
  return series.map((state) => {
    const rot = isObject(state) ? state['rot'] : undefined;
    if (!Array.isArray(rot) || rot.length !== 4) return Number.NaN;
    const [x, y, z, w] = rot.map((n) => (typeof n === 'number' ? n : Number.NaN)) as [number, number, number, number];
    return (Math.atan2(2 * (x * y + z * w), 1 - 2 * (y * y + z * z)) * 180) / Math.PI;
  });
}

/** One start of the bar and the ball: what the ball and the bar did, and the sentence that says so. */
export interface Swing {
  /** The first step at whose end the ball is no longer at rest; −1 when it is left at rest. */
  struck: number;
  /** The first step at whose end the bar's trailing face has turned clear of the ball's far side as built; −1 when at none. */
  passed: number;
  /** Why the bar's turn couldn't be read, as `INCONCLUSIVE:` sentences; none when it was. */
  unread: string[];
  said: string;
}
export function swingOf(reply: JsonObject, j: number, what: string): Swing {
  const struck = struckStep(reply, BALL, what);
  const states = statesOf(reply, BALL, what);
  const [built, end] = [states[0]!.pos, states.at(-1)!];
  const turns = turnsOf(reply);
  const unread = turns.length === states.length && turns.every(Number.isFinite) ? [] : [`INCONCLUSIVE: ${what}: the bake's states of ${BAR} hold no rot for each step, so the bar's turn wasn't read`];
  const passed = turns.findIndex((t) => t > aheadOf(j) + CLEAR);
  const ball = struck < 0
    ? 'the ball is left at rest'
    : `the ball is struck in step ${struck}, and ends ${Math.hypot(end.pos[0] - built[0], end.pos[1] - built[1], end.pos[2] - built[2]).toFixed(4)} m from where it was built at ${Math.hypot(...end.linear).toFixed(2)} m/s`;
  const bar = unread.length ? 'the bar\'s turn is unread' : `the bar turns ${turns.at(-1)!.toFixed(2)}° in the run, and ${passed < 0 ? 'is at no step clear past where the ball was built' : `is clear past where the ball was built from step ${passed}`}`;
  return { struck, passed, unread, said: `${what}: ${ball}; ${bar}` };
}
