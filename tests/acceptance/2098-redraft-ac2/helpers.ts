// Test-side tools for the #2098 criterion 2 redraft (README: The surface under test). The runner, the worlds and the
// names are the first draft's (../2098/helpers.ts, imported read only, and through it #191's): one `deep-physics`
// process answering `bake`, plain or as `deep-physics --planted wind_noise_from_platform_sin`. This file adds the two
// judges the owner's answer makes possible, each worked from the amended Force section's sentences (README: Criteria
// to tests), and the closed function list's `noise` worked here from its published steps. Nothing here stands in for
// the wind: every state judged is the program's own, and no expected value is recorded from a run of it.
//
// No function here asserts: what a judge finds wrong comes back as text, so each test's failing assertion is in its
// own file.

import { RATE, VANE, WIND, calmWind, gustyWind, type Gust, type JsonObject, type State, type Vec3 } from '../2098/helpers.ts';

export {
  AC, GUST, GUST_STEPS, NOISE_FROM_SIN, OTHER_SEED, RATE, SEED, TIMEOUT, VANE, WIND, ask, bake, prebuild, statesOf, steadyWind, type State,
} from '../2098/helpers.ts';

// ---------------------------------------------------------------------------------------------------
// The body, as the first draft's `windWorld` writes it: "a 1 kg cube of 1 m at coefficient 1" (Force).

/** The cube's mass, kg; its half extent, m; the coupling's coefficient, kg/(m²·s). */
export const MASS = 1;
export const HALF = 0.5;
export const COEFFICIENT = 1;
/** A: the area of one of its faces, m². */
export const FACE = (2 * HALF) ** 2;
/** The wind's speed, m/s: 2. */
export const SPEED = Math.hypot(...WIND);
/** The criterion's bound, 1%: of the wind's speed, and of the closed-form time. */
export const WITHIN = 0.01;

// ---------------------------------------------------------------------------------------------------
// Condition 1: "reaches the wind's speed within 1% at its closed-form time".

/** "first within 1% of w at t = m × ln 100 ÷ (2 × coefficient × A)" (Force), s: 2.302585…, the design's 2.303 s. */
export const REACH_TIME = (MASS * Math.log(100)) / (2 * COEFFICIENT * FACE);
/** Three seconds: 81 steps past the last one within 1% of that time (step 279). */
export const REACH_STEPS = 3 * RATE;

/**
 * Everything wrong with "moves at w × (1 − e^(−2 × coefficient × A × t ÷ m)) from rest, and is first within 1% of w
 * at t = m × ln 100 ÷ (2 × coefficient × A) …, which a world stepped at 120 Hz reaches within 1% of that time": the
 * body is built at rest; the first step after which its velocity is within 1% of the wind's speed of the wind's
 * velocity comes at a time within 1% of the closed form's; and from then on it stays within that 1%, as the closed
 * form does.
 */
export function reachFailures(states: State[]): string[] {
  const off = (s: State): number => Math.hypot(s.linear[0] - WIND[0], s.linear[1] - WIND[1], s.linear[2] - WIND[2]);
  const within = (s: State): boolean => off(s) <= WITHIN * SPEED;
  const [built, last] = [states[0]!, states[states.length - 1]!];
  if (built.linear.some((v) => v !== 0)) return [`${VANE} isn't built at rest: its velocity is ${JSON.stringify(built.linear)} m/s`];
  const first = states.findIndex(within);
  if (first < 0) return [`${VANE} is never within 1% of the wind's ${SPEED} m/s in ${states.length - 1} steps (${((states.length - 1) / RATE).toFixed(2)} s): it ends at ${JSON.stringify(last.linear)} m/s, ${off(last).toFixed(4)} m/s off the wind`];
  const out: string[] = [];
  const at = first / RATE;
  const [from, to] = [Math.ceil((1 - WITHIN) * REACH_TIME * RATE), Math.floor((1 + WITHIN) * REACH_TIME * RATE)];
  if (!(Math.abs(at - REACH_TIME) <= WITHIN * REACH_TIME)) out.push(`${VANE} is first within 1% of the wind's ${SPEED} m/s after step ${first}, at ${at.toFixed(4)} s, not within 1% of m × ln 100 ÷ (2 × coefficient × A) = ${REACH_TIME.toFixed(4)} s (steps ${from} to ${to})`);
  const left = states.findIndex((s, k) => k > first && !within(s));
  if (left >= 0) out.push(`${VANE} doesn't stay at the wind's speed: within 1% of it after step ${first}, it moves at ${JSON.stringify(states[left]!.linear)} m/s after step ${left}, ${off(states[left]!).toFixed(4)} m/s off the wind`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The closed function list's `noise(p, seed)` over three components, worked here from its published steps
// (crates/deep-canvas/src/expr/noise.rs at the base: the fixed 32-bit integer hash, its fold over a lattice point,
// that point's unit gradient, the quintic fade and the blend of a cell's eight corners). The gradient's sine, cosine
// and square root are this machine's where the base's are its pinned ones: they differ in an f64's last places.

const u32 = (x: number): number => x >>> 0;
function hash32(x: number): number {
  x = u32(x ^ (x >>> 16));
  x = u32(Math.imul(x, 0x7feb352d));
  x = u32(x ^ (x >>> 15));
  x = u32(Math.imul(x, 0x846ca68b));
  return u32(x ^ (x >>> 16));
}
const mix = (h: number, v: number): number => hash32(u32(h ^ u32(v + 0x9e3779b9 + u32(h << 6) + (h >>> 2))));
const unit = (h: number): number => (h >>> 8) / 2 ** 24;
/** The unit gradient at a lattice point. */
function gradient(seed: number, cell: Vec3): Vec3 {
  let h = hash32(u32(seed ^ 0x51ed270b));
  for (const c of cell) h = mix(h, u32(c));
  const [u, v] = [unit(h), unit(mix(h, 0x68e31da4))];
  const z = 2 * v - 1;
  const r = Math.sqrt(Math.max(1 - z * z, 0));
  const a = 2 * Math.PI * u;
  return [r * Math.cos(a), r * Math.sin(a), z];
}
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
/** Gradient noise at `p` on the integer lattice hash, for a seed of at most 32 bits. */
export function noise(p: Vec3, seed: number): number {
  const cell = p.map((v) => Math.floor(v)) as Vec3;
  const f = p.map((v, k) => v - cell[k]!) as Vec3;
  let acc = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const i: Vec3 = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    let [weight, dot] = [1, 0];
    for (let k = 0; k < 3; k += 1) weight *= i[k] === 1 ? fade(f[k]!) : 1 - fade(f[k]!);
    const g = gradient(seed, [cell[0] + i[0], cell[1] + i[1], cell[2] + i[2]]);
    for (let k = 0; k < 3; k += 1) dot += g[k]! * (f[k]! - i[k]!);
    acc += weight * dot;
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------------
// Condition 2: "the same gusts by hash", held to the formula: the first draft's winds on its cube, which can't turn.

/** The first draft's wind world with the base's `locks` on the cube, so the wind's pushes move it and never turn it. */
function locked(w: JsonObject): JsonObject {
  const bodies = w['bodies'] as JsonObject;
  return { ...w, bodies: { ...bodies, [VANE]: { ...(bodies[VANE] as JsonObject), locks: { angular: [true, true, true] } } } };
}
/** The first draft's gusty wind under a seed, and the same wind and seed with no gust, each on the cube that can't turn. */
export const lockedGusty = (seed: number): JsonObject => locked(gustyWind(seed));
export const lockedCalm = (seed: number): JsonObject => locked(calmWind(seed));

/** A wind as a judge works it: the criterion's velocity under this seed, with this gust or, with none, steady. */
export interface Blow { gust?: Gust; seed: number }
/**
 * The wind's speed along +x at t and p, m/s: "velocity(t, p) × (1 + amplitude × noise((p − d × speed × t) ÷ scale,
 * seed)), with d the direction of velocity(t, p)", here +x; "a wind with no `gust` blows at its velocity" (Force).
 */
export function windAt(t: number, p: Vec3, b: Blow): number {
  if (!b.gust) return WIND[0];
  const { amplitude, scale, speed } = b.gust;
  return WIND[0] * (1 + amplitude * noise([(p[0] - speed * t) / scale, p[1] / scale, p[2] / scale], b.seed));
}

/**
 * The centroids, in the cube's frame, of the four triangles of its two faces across x, the lesser side first: "the
 * face's centre − (h_j ÷ 3) along j + (h_k ÷ 3) along k and … + (h_j ÷ 3) along j − (h_k ÷ 3) along k", j = y and
 * k = z; and each one's area, m²: "2 × h_j × h_k" (Force).
 */
export const CENTROIDS: Vec3[] = [-HALF, HALF].flatMap((x): Vec3[] => [[x, -HALF / 3, HALF / 3], [x, HALF / 3, -HALF / 3]]);
export const TRIANGLE = 2 * HALF * HALF;
/**
 * How near the formula's wind the wind a step's push implies must be, m/s: 0.001, a twentieth of a percent of the
 * wind's speed. Ours (README: Readings): states are f32, so a velocity under 4 m/s is told to 2.4e-7 m/s, and 60
 * times a step's change of it leaves that wind unsure by under 0.0001 m/s.
 */
export const GUST_WITHIN = 1e-3;
/** A velocity across the wind, m/s, or a turn rate, deg/s, past which the cube isn't moving along the wind alone. */
const STILL = 1e-6;

/**
 * Everything wrong with "the gusts are the ones the formula gives": over each step, the wind the cube felt isn't the
 * blow's, read at its four centroids across the wind at t(k) from its state there. The push is "computed once per
 * step from the state at t(k) … and held over the substeps", each triangle's "F = coefficient × area × ((wind − v) ·
 * n) × n", so over the step from t(k) the cube's velocity v along +x changes by
 * dt × coefficient × area × Σ (wind at each centroid − v) ÷ m, the other eight triangles lying along the wind and
 * the velocity and pushing nothing. The mean wind that implies, v + m × (v′ − v) ÷ (dt × coefficient × 4 × area), is
 * held to the mean of the formula's at the four centroids, within `GUST_WITHIN`.
 */
export function gustFailures(states: State[], b: Blow): string[] {
  const out: string[] = [];
  const steps = states.length - 1;
  const astray = states.findIndex((s) => Math.abs(s.linear[1]) > STILL || Math.abs(s.linear[2]) > STILL || s.angular.some((a) => Math.abs(a) > STILL));
  if (astray >= 0) out.push(`${VANE}, which can't turn, under a wind along +x: after step ${astray} it moves ${JSON.stringify(states[astray]!.linear)} m/s and turns ${JSON.stringify(states[astray]!.angular)} deg/s, not along the wind alone`);
  const misses: string[] = [];
  let worst = 0;
  for (let k = 0; k < steps; k += 1) {
    const [s, next] = [states[k]!, states[k + 1]!];
    const want = CENTROIDS.reduce((sum, c) => sum + windAt(k / RATE, [s.pos[0] + c[0], s.pos[1] + c[1], s.pos[2] + c[2]], b), 0) / CENTROIDS.length;
    const felt = s.linear[0] + (MASS * (next.linear[0] - s.linear[0]) * RATE) / (COEFFICIENT * CENTROIDS.length * TRIANGLE);
    const miss = Math.abs(felt - want);
    if (miss <= GUST_WITHIN) continue;
    worst = Math.max(worst, miss);
    misses.push(`over step ${k + 1}, from x = ${s.pos[0]} m at ${s.linear[0]} m/s to ${next.linear[0]} m/s, it felt a wind of ${felt.toFixed(5)} m/s where the formula's, at its four centroids across the wind at t = ${k}/${RATE} s, is ${want.toFixed(5)} m/s`);
  }
  if (misses.length) out.push(`${VANE}: the wind it felt isn't the formula's within ${GUST_WITHIN} m/s over ${misses.length} of ${steps} steps (by up to ${worst.toFixed(5)} m/s); the first: ${misses[0]!}`);
  return out;
}
