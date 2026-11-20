// Test-side tools for the #2307 acceptance tests (README: The surface under test). They extend #2306's surface,
// imported read only through ../2306/helpers.ts (and through it #251's, #522's, #1918's, #2010's, #2009's and #191's):
// the same `deep-physics` binary, #191's release build (and its `test-backends` build for the behavior kit), asked
// `bake` of world documents holding #251's car on a static slope or on level ground, of a scene's world for a kinematic
// platform that follows a channel (#1918's form), and #191's `behavior_fixtures` and `behavior_kit`; and run under
// this suite's five planted names. Nothing here stands in for the physics module: every state, row, hash, fixture and
// result read here is the program's own; every expected value is the issue's, or computed here from its formulas.

import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import {
  DECK_Y, FLICKS, GROUND_HALF, PER_STEP, RATE, REPO, REST_Y, TIMEOUT, WHEEL_NAMES, arr, box, camera, dot, isObject, kart, length,
  markBox, num, obj, rotate, sceneDoc, show, sub, vehicleField, vehicleWorld, wheel, wheelNamed,
  type JsonObject, type JsonValue, type Row, type State, type V3,
} from '../2306/helpers.ts';
import { physicsBin, type PhysicsBuild } from '../191/helpers.ts';

export * from '../2306/helpers.ts';
export type { FixtureData } from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#2307.8ca832fd',
  2: '#2307.3dfea1f1',
  3: '#2307.536a975c',
  4: '#2307.9f33326e',
  5: '#2307.400e4569',
  6: '#2307.fd4b6bbc',
  7: '#2307.ac8e941b',
} as const;

// ---------------------------------------------------------------------------------------------------
// deep-physics under this suite's planted names (README: Planted wrong programs), or #251's test backend.

/**
 * `controller_without_hold`: the wrapper leaves the backend's vehicle controller as it is, its own brake and grip
 * worked out before the step, with no hold. `hold_ignores_brake_limit`: the hold resists the whole pull along a wheel's
 * heading, whatever its brake has left. `hold_takes_out_side_slip`: the hold itself takes out each wheel's sideways
 * slip, where the controller's grip already does. `controller_runs_asleep`: the controller runs on a sleeping vehicle
 * body and its pushes are stored in the body's velocity. `leaves_asleep_on_moving_ground`: a sleeping vehicle body
 * stays asleep when the body under its wheels moves.
 */
export type Planted =
  | 'controller_without_hold' | 'hold_ignores_brake_limit' | 'hold_takes_out_side_slip' | 'controller_runs_asleep'
  | 'leaves_asleep_on_moving_ground';
/** #251's test backend (its README): Rapier with `vehicle_controller` left out of its caps(), in the `test-backends` build. */
export type Backend = 'no_vehicle_controller';

/** What one deep-physics process answered: `problem` is empty when it exited 0 with one JSON reply per call. */
export interface Ran { problem: string; replies: JsonObject[] }
/**
 * Runs `calls` through one `deep-physics [--backend b] [--planted p]` process of #191's builds: the release build, or
 * the `test-backends` build for a test backend. It never throws on what the program does: a test asserts `problem` is
 * empty in its own file, so a planted name or a backend the program doesn't know fails there.
 */
export function run(calls: JsonObject[], o: { planted?: Planted; backend?: Backend; build?: PhysicsBuild } = {}): Ran {
  const args = [...(o.backend ? ['--backend', o.backend] : []), ...(o.planted ? ['--planted', o.planted] : [])];
  const what = `deep-physics${args.length ? ` ${args.join(' ')}` : ''}`;
  const bin = physicsBin(o.build ?? (o.backend ? 'test' : 'release'));
  const r = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 2 ** 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT') return { problem: `${what} didn't finish in time`, replies: [] };
  if (r.error && code !== 'EPIPE') return { problem: `${what} couldn't run: ${r.error.message}`, replies: [] };
  const stdout = r.stdout ?? '';
  if (r.status !== 0) return { problem: `${what} exits ${String(r.status)}, not 0; stdout: ${stdout.slice(0, 600)}; stderr: ${(r.stderr ?? '').slice(-1200)}`, replies: [] };
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== calls.length) return { problem: `${what} answers ${lines.length} lines to ${calls.length} calls; stdout: ${stdout.slice(0, 600)}`, replies: [] };
  return { problem: '', replies: lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i}`)) };
}

// ---------------------------------------------------------------------------------------------------
// The fixtures (README: The worlds): #251's car (`kart`, 1,000 kg, heading +Z, axle X, up +Y) set down with every
// spring at rest length on the static body `ground`, a box whose top face passes through the origin, turned so the
// surface rises along the car's heading (the car faces up the slope) or along its axle (it stands across it); 0° is
// level ground. On #2009's world defaults: 120 Hz, 4 substeps, gravity (0, −9.81, 0), sleep on in the world.

/** How the slope lies under the car: `up`, rising along its heading; `across`, rising along its axle. */
export type Way = 'up' | 'across';
export interface Slope { deg: number; way: Way }
export const LEVEL: Slope = { deg: 0, way: 'up' };
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The slope's turn, a quaternion `[x, y, z, w]`: about X by −deg (its +Z rises), or about Z by +deg (its +X rises). */
export function slopeRot(s: Slope): number[] {
  const half = rad(s.deg) / 2;
  return s.way === 'up' ? [-Math.sin(half), 0, 0, Math.cos(half)] : [0, 0, Math.sin(half), Math.cos(half)];
}
/** The slope's unit normal, out of the ground. */
export const normalOf = (s: Slope): V3 => rotate(slopeRot(s), [0, 1, 0]);
/** The unit vector down the slope, along its fall line: against the car's heading facing up it, against its axle across it. */
export const downOf = (s: Slope): V3 => rotate(slopeRot(s), s.way === 'up' ? [0, 0, -1] : [-1, 0, 0]);
/** A slope in words, for messages. */
export const slopeText = (s: Slope): string => (s.deg === 0 ? 'level ground' : `the ${s.deg}° slope, ${s.way === 'up' ? 'facing up it' : 'standing across it'}`);

export interface Parked { sleep?: boolean; grip?: number }
/**
 * The car set on the slope with every spring at rest length (its centre `REST_Y` from the surface along its normal, each
 * ray just reaching it), turned with the slope, every wheel's `grip` written (1 unless given), and with `sleep: false`
 * unless `sleep` is asked, when the body's `sleep` is left to its default, on.
 */
export function slopeWorld(s: Slope, o: Parked = {}): JsonObject {
  const rot = slopeRot(s);
  const n = normalOf(s);
  const pos = n.map((c) => c * REST_Y) as V3;
  const wheels = Object.fromEntries(WHEEL_NAMES.map((name) => [name, wheel(name, { grip: o.grip ?? 1 })]));
  const body = kart(pos, { pose: { pos, rot }, vehicle: vehicleField(wheels), ...(o.sleep ? {} : { sleep: false }) });
  return vehicleWorld(body, {
    shapes: { ground: box([GROUND_HALF, 0.5, GROUND_HALF]) },
    bodies: { ground: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'ground' }], pose: { pos: n.map((c) => -0.5 * c), rot } } },
  });
}

/** How far `to` is from `from` along the slope: their distance with the part along the slope's normal left out, m. */
export function alongSlope(from: readonly number[], to: readonly number[], s: Slope): number {
  const d = sub(to, from);
  const n = normalOf(s);
  return length(sub(d, n.map((c) => c * dot(d, n))));
}
/** How far down the slope `to` is from `from`, m (negative: up it). */
export const wentDown = (from: readonly number[], to: readonly number[], s: Slope): number => dot(sub(to, from), downOf(s));
/** A state's speed down the slope, m/s (negative: up it). */
export const speedDown = (st: State, s: Slope): number => dot(st.linear, downOf(s));

// ---------------------------------------------------------------------------------------------------
// Criterion 6's platform, as #2306's (its README: The fixtures, the platform): a kinematic body of a scene's world
// `ride`, 20 × 0.2 × 20 m, its top at y = 0.2, following the scene's channel `deck`, nothing under it; the car set down
// on its middle with every spring at rest length, heading +Z. The channel stands still through step `start`, then takes
// the platform from rest to 2 m/s along the car's heading over 1 s (a key at every step, t² m on) and holds 2 m/s for
// 2 s: 5 m in all.

export const RAMP_STEPS = 3 * RATE;
export const RAMP_TRAVEL = 5;
const STEP_FLICKS = FLICKS / RATE;
/** The platform's place along z after `step` steps, m, for a ramp that starts at step `start`. */
export function platformAt(step: number, start: number): number {
  const s = (step - start) / RATE;
  return s <= 0 ? 0 : s <= 1 ? s * s : Math.min(1 + 2 * (s - 1), RAMP_TRAVEL);
}
/** The scene holding the world `ride`: the car on the platform, which starts to move in the step after `start` steps. */
export function parkScene(start: number, park: Parked = {}): JsonObject {
  const steps = [...new Set([0, ...Array.from({ length: RATE + 1 }, (_, k) => start + k), start + RAMP_STEPS])];
  const keys = Object.fromEntries(steps.map((k, i) => [`k${String(i).padStart(3, '0')}`, { t: k * STEP_FLICKS, value: [0, DECK_Y, platformAt(k, start)], interp: 'linear' }]));
  const ride = vehicleWorld(kart([0, 2 * DECK_Y + REST_Y, 0], park.sleep ? {} : { sleep: false }), {
    shapes: { deck: box([10, DECK_Y, 10]) },
    bodies: { platform: { kind: 'kinematic', shapes: [{ shape: 'deck', contact_material: 'ground' }], pose: { pos: [0, DECK_Y, 0] }, follow: 'items/platform/at/pos' } },
  });
  return sceneDoc('A car parked on a platform', '10s', { cam: camera([0, 12, 24], [0, 0, 0]), platform: markBox([20, 2 * DECK_Y, 20], [0, DECK_Y, 0]) }, {
    channels: { deck: { target: 'items/platform/at/pos', type: 'vec3', keys } },
    worlds: { ride },
  });
}

// ---------------------------------------------------------------------------------------------------
// The behavior kit's data (#191's `behavior_fixtures`), with the run each fixture holds: its `steps` and its `track`.

export interface KitFixture { name: string; world: JsonObject; steps: number; track: JsonObject[]; answer: number; tolerance: JsonValue; caps: string[]; vehicle: string | null }
/** The kit's fixtures named `name` (once, when the kit holds it once), each with the ID of its world's one vehicle body. */
export function kitFixtures(reply: JsonObject | undefined, name: string): KitFixture[] {
  expect(reply?.['ok'], `the interface's fixtures answer (call behavior_fixtures): ${show(reply)}`).toBe(true);
  return arr(reply!['fixtures'], 'behavior_fixtures: fixtures').map((v, i) => obj(v, `behavior_fixtures: fixtures[${i}]`)).filter((f) => f['name'] === name).map((f) => {
    const world = obj(f['world'], `${name}: world`);
    const bodies = isObject(world['bodies']) ? world['bodies'] : {};
    const vehicles = Object.entries(bodies).filter(([, b]) => isObject(b) && b['kind'] === 'vehicle').map(([id]) => id);
    return {
      name, world, steps: num(f['steps'], `${name}: steps`), track: arr(f['track'] ?? [], `${name}: track`).map((e, i) => obj(e, `${name}: track[${i}]`)),
      answer: num(f['answer'], `${name}: answer`), tolerance: f['tolerance'] ?? null,
      caps: arr(f['caps'] ?? [], `${name}: caps`).map((c) => String(c)), vehicle: vehicles.length === 1 ? vehicles[0]! : null,
    };
  });
}
/** A fixture's own run: its world baked over its own track and steps, sampled once a step, reading `read`. */
export const fixtureBake = (f: KitFixture, read: string[]): JsonObject => ({ call: 'bake', world: f.world, track: f.track, steps: f.steps, frame_rate: PER_STEP, read });
/** The first entry of `kind` on a fixture's track: its step and its data. */
export function entryOn(f: KitFixture, kind: string): { step: number; data: JsonObject } | null {
  const e = f.track.find((x) => x['kind'] === kind);
  return e && typeof e['step'] === 'number' ? { step: e['step'], data: isObject(e['data']) ? e['data'] : {} } : null;
}

// ---------------------------------------------------------------------------------------------------
// Rows: a body that falls asleep writes `rest` naming it, one that wakes `wake` (Occurrence list); a bake holds no
// other word on sleep. A wheel's rows name the body and the wheel (#251's README: Rows).

/** `body`'s rest and wake rows, in the list's order. */
export const sleepRows = (rows: readonly Row[], body = 'kart'): Row[] => rows.filter((r) => r.a === body && (r.kind === 'rest' || r.kind === 'wake'));
/** Whether `body` is asleep after step `k`: its last rest or wake row at or before `k` is `rest`. */
export const asleepAfter = (rows: readonly Row[], k: number, body = 'kart'): boolean => sleepRows(rows, body).filter((r) => r.step <= k).at(-1)?.kind === 'rest';
/** The rows a wheel of `body` writes. */
export const wheelRows = (rows: readonly Row[], body = 'kart'): Row[] => rows.filter((r) => wheelNamed(r, body) !== null);
/** Sleep rows as text, for messages. */
export const sleepText = (rows: readonly Row[], body = 'kart'): string => sleepRows(rows, body).map((r) => `${r.kind} at step ${r.step}`).join(', ') || 'none';
