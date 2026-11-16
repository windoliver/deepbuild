// Test-side tools for the blind redraft of #251's criterion 2 (README). They use the surface the first blind draft
// chose for #251 (../251/helpers.ts, imported read only, unchanged from commit bf254d0fc): the same `deep-physics`
// binary, built once per file, asked `bake` of a world document holding the vehicle body `kart`, with its `drive` and
// `brake` entries on the track, and run under the planted name `brake_whole_force_each_wheel`. Nothing here stands in
// for the physics module: every state and row read here is the program's own; every expected value is the issue's, or
// worked out here from the issue's own formula, m × v² ÷ 2F.

import {
  CRITERIA, REST_Y, SETTLED_Y, ask, bakeRun, brake, carWorld, dot, drive, fmt, forward, kart, kartOf, near, rotate,
  rowText, rowsOf, speed, stepAt, sub, type JsonObject, type Planted, type Row, type State,
} from '../251/helpers.ts';

export { TIMEOUT, caught, naming, none, prebuild } from '../251/helpers.ts';

/** Criterion 2's ID, `#251.acf8ab9a` (scripts/proof-change.mjs: SHA-256 of its text, trimmed, white space collapsed). */
export const ID = CRITERIA[2];
export const BODY = 'kart';

// ---------------------------------------------------------------------------------------------------
// The issue's numbers.

export const MASS = 1000;
export const DRIVE = 2000;
export const BRAKE = 4000;
/** "From 10 m/s". */
export const FROM = 10;
/** A drive of 2,000 N on 1,000 kg for 2 s: 4.00 m/s, within 2%. */
export const DRIVE_SPEED = 4;
export const DRIVE_TOLERANCE = 0.02;
/** m × v² ÷ 2F: 12.5 m, within 3%. */
export const STOP = (MASS * FROM ** 2) / (2 * BRAKE);
export const STOP_TOLERANCE = 0.03;
/** The planted brake gives each of the four braking wheels the whole 4,000 N: m × v² ÷ (2 × 4F) = 3.125 m. */
export const PLANTED_STOP = (MASS * FROM ** 2) / (2 * 4 * BRAKE);
/** The issue gives the planted stop no tolerance; this suite's reading (README): 10%. */
export const PLANTED_TOLERANCE = 0.1;

/** The world's sleep, written out as the design's defaults (`solver.sleep`): on, under 0.05 m/s for 0.5 s. */
export const SLEEP_SPEED = 0.05;
const SOLVER: JsonObject = { sleep: { on: true, speed: SLEEP_SPEED, time: 0.5 } };

/** Settling: 3 s on its springs from rest length (the sag criterion's own time), so the drive is stamped at step 360. */
export const SETTLE = stepAt(3);
/** The drive's reading, 2 s after its stamp. */
export const READ = SETTLE + stepAt(2);
/** The brake's run: 6 s, its stop near 2.5 s. */
export const BRAKE_STEPS = stepAt(6);
/** "Never rolls backwards": its centre never more than this behind its farthest (README: the pitch it springs back by). */
export const BACK = 0.02;

// ---------------------------------------------------------------------------------------------------
// The fixtures (README: The fixtures). Level ground whose top is y = 0; the car of ../251/helpers.ts: 1,000 kg, front
// wheels steering, rear wheels driving, all four braking (the default), heading +Z. No outputs: this criterion reads
// the body's own states and the occurrence list.

/** Set down at rest at its rest-length height (each ray just reaching the floor), sleep as given. */
export const resting = (sleep: boolean): JsonObject =>
  carWorld(kart([0, REST_Y, 0], { sleep }), { outputs: {}, solver: SOLVER });
/** Settled on its springs (each g ÷ (2π × 2)² short), rolling at 10 m/s along its heading, sleep off. */
export const rolling = (): JsonObject =>
  carWorld(kart([0, SETTLED_Y, 0], { sleep: false, velocity: { linear: [0, 0, FROM] } }), { outputs: {}, solver: SOLVER });

export interface Run { states: State[]; rows: Row[] }
/** One bake of `w` for `steps` with `track`, in its own deep-physics process (under `planted` when given). */
export function run(w: JsonObject, steps: number, track: JsonObject[], what: string, planted?: Planted): Run {
  const reply = ask([bakeRun(w, steps, track)], planted, what)[0]!;
  return { states: kartOf(reply, steps + 1, what), rows: rowsOf(reply, what) };
}
export const driveTrack = (force: number): JsonObject[] => [drive(SETTLE, force)];
/** The drive of 2,000 N and the brake of 4,000 N both stamped at step 0: the drive is held for the whole brake. */
export const brakeTrack = (): JsonObject[] => [drive(0, DRIVE), brake(0, BRAKE)];

// ---------------------------------------------------------------------------------------------------
// Judges. Each failure names the body by the ID it was baked under.

/** From rest at the stamp, then `want` m/s along its heading (negative backwards) 2 s later, within 2%. */
export function driveFailures(states: readonly State[], want: number, body = BODY): string[] {
  const out: string[] = [];
  const at = speed(states[SETTLE]!.linear);
  if (!(at <= SLEEP_SPEED)) {
    out.push(`${body} isn't at rest when the drive is stamped (step ${SETTLE}): it moves at ${fmt(at)} m/s, over the world's sleep speed ${SLEEP_SPEED} m/s`);
  }
  const v = forward(states[READ]!);
  if (!near(v, want, DRIVE_TOLERANCE)) {
    out.push(`${body} moves at ${fmt(v)} m/s along its heading 2 s after the drive (step ${READ}), not ${want.toFixed(2)} m/s within ${DRIVE_TOLERANCE * 100}%`);
  }
  return out;
}

/** Asleep at the stamp (its last rest or wake row by then is `rest`), and its `wake` row within a step of the drive's. */
export function sleepFailures(rows: readonly Row[], body = BODY): string[] {
  const out: string[] = [];
  const own = rows.filter((r) => (r.kind === 'rest' || r.kind === 'wake') && r.a === body);
  const last = own.filter((r) => r.step <= SETTLE).at(-1);
  if (last?.kind !== 'rest') {
    out.push(`${body} isn't asleep when the drive is stamped (step ${SETTLE}): its last rest or wake row by then is ${last ? rowText(last) : 'none'}`);
  }
  const woke = own.find((r) => r.step > SETTLE && r.kind === 'wake');
  if (!woke || woke.step > SETTLE + 2) {
    out.push(`${body} doesn't wake within a step of the drive (stamped ${SETTLE}, first stepped ${SETTLE + 1}): its first wake row after it is ${woke ? rowText(woke) : 'none'}`);
  }
  return out;
}

/** Its centre's travel at each step along its starting heading (level), from where it started. */
function travelOf(states: readonly State[]): number[] {
  const h = rotate(states[0]!.rot, [0, 0, 1]);
  const level = Math.hypot(h[0], h[2]);
  return states.map((s) => dot(sub(s.pos, states[0]!.pos), [h[0] / level, 0, h[2] / level]));
}
export interface Stop { distance: number; at: number }
/** Its stop: its farthest travel along its starting heading, and the first step it is there. */
export function stopOf(states: readonly State[]): Stop {
  const travel = travelOf(states);
  let at = 0;
  for (let k = 1; k < travel.length; k++) if (travel[k]! > travel[at]!) at = k;
  return { distance: travel[at]!, at };
}

/**
 * From 10 m/s along its heading, braked: its stop (its farthest) 12.5 m on within 3%, reached at least 1 s before the
 * run's end; never more than 2 cm behind its farthest after it; at rest (under the sleep speed) at the end.
 */
export function brakeFailures(states: readonly State[], body = BODY): string[] {
  const out: string[] = [];
  const v0 = forward(states[0]!);
  if (!near(v0, FROM, 0.01)) out.push(`${body} starts at ${fmt(v0)} m/s along its heading, not ${FROM} m/s`);
  const travel = travelOf(states);
  const stop = stopOf(states);
  if (!near(stop.distance, STOP, STOP_TOLERANCE)) {
    out.push(`${body} stops ${fmt(stop.distance)} m on (its farthest, step ${stop.at}), not ${STOP} m (m × v² ÷ 2F) within ${STOP_TOLERANCE * 100}%`);
  }
  const last = states.length - 1;
  if (stop.at > last - stepAt(1)) {
    out.push(`${body} hasn't stopped: its farthest travel is at step ${stop.at}, within 1 s of the run's end (step ${last})`);
  }
  let worst = stop.at;
  for (let k = stop.at; k <= last; k++) if (travel[k]! < travel[worst]!) worst = k;
  const back = stop.distance - travel[worst]!;
  if (back > BACK) {
    out.push(`${body} rolls backwards after its stop: ${fmt(back)} m behind its farthest (step ${stop.at}) by step ${worst}, more than ${BACK} m`);
  }
  const end = speed(states[last]!.linear);
  if (!(end <= SLEEP_SPEED)) out.push(`${body} is still moving at ${fmt(end)} m/s at the run's end (step ${last}), over the world's sleep speed ${SLEEP_SPEED} m/s`);
  return out;
}
