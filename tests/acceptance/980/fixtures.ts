// Each criterion's expected values worked out from first principles, in closed form, and the runs as interface fixtures
// with their answers (README: Fixtures). Every value follows from the scene's numbers and README: The step contract
// (ticks, rounding, lowest free row, the settle's order); none comes from a library. Each check here throws when a
// scene doesn't give the numbers it was built for, so a fixture bug fails before any library runs.

import type { JsonObject, JsonValue, Program } from '../190/helpers.ts';
import { itemParams } from './helpers.ts';
import type { Writes } from './programs.ts';
import {
  BELT, BELT_ST, BELT_STEPS, GRANT, GRANT_ST, GRANT_STEPS, PALLET, PALLET_ST, PALLET_STEPS, STEADY, STEADY_STEPS, type Scene,
} from './scenes.ts';

const fail = (what: string): never => { throw Error(`fixture bug: ${what}`); };
const check = (ok: boolean, what: string): void => { if (!ok) fail(what); };
/** A length or a time in ticks, as the library rounds it (README: Time). */
export const ticks = (s: Scene, seconds: number): number => Math.round(seconds / s.tick);
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const fill = <T>(n: number, v: T): T[] => Array<T>(n).fill(v);

export interface Fixture { name: string; item: { kind: 'logic@1'; params: JsonObject }; track: JsonValue[]; steps: number; expect: { arrays: Record<string, Record<string, JsonValue[]>>; tolerance: JsonValue }; answer: string }
function fixture(name: string, s: Scene, program: Program, writes: Writes, steps: number, arrays: Record<string, Record<string, JsonValue[]>>, answer: string): Fixture {
  return { name, item: { kind: 'logic@1', params: itemParams(program, s, writes) }, track: [], steps, expect: { arrays, tolerance: { abs: 1e-9 } }, answer };
}
const at = (steps: number[], f: (k: number) => Record<string, JsonValue[]>): Record<string, Record<string, JsonValue[]>> => Object.fromEntries(steps.map((k) => [String(k), f(k)]));

// ---------------------------------------------------------------------------------------------------
// Criterion 1.

/**
 * Step k runs ticks 3,600k to 3,600k + 3,599 of 1/60 s: the source makes order k at tick 3,600k (t = 60k s, `every`'s
 * i·every), it passes its queue at once (the resource is free), holds 45 s = 2,700 ticks and is out at tick 3,600k +
 * 2,700. So at every step's end nothing is held, one more record of exactly 45 s exists, and each minute is busy 45 s.
 */
export function steadyRun() {
  const s = STEADY, perStep = s.ticksPerStep, hold = ticks(s, 45), gap = ticks(s, 60);
  check(perStep === gap && hold === 2700 && gap === 3600, 'one arrival a step, a 2,700-tick hold');
  const N1 = 5;
  /** The arrays at the end of step k (stations: sink, request, queue, source, then all). */
  const after = (k: number): Record<string, JsonValue[]> => {
    const n = k + 1, held = 45 * n;
    return {
      clock: [60 * n, 3600, 0], rec_n: [n], made_n: [n], out_n: [n], count: fill(N1, 0), left: fill(N1, n),
      area: [0, held, 0, 0, held], dwell: [0, held, 0, 0, held], busy: [0], cap: [1], busy_area: [held],
      thru: fill(N1, 60), mean: [0, 45, 0, 0, 45], p90: [0, 45, 0, 0, 45], wip: [0, 0.75, 0, 0, 0.75],
      kind: fill(s.rows, -1), gen: [n, ...fill(s.rows - 1, 0)],
    };
  };
  /** Record i (0-based) sits at ring index i mod 64: out at 60i + 45 s, after exactly 45 s. */
  const ring = (k: number): { t: number[]; w: number[] } => {
    const t = fill(s.ring, 0), w = fill(s.ring, 0);
    for (let i = 0; i <= k; i++) { t[i % s.ring] = 60 * i + 45; w[i % s.ring] = 45; }
    return { t, w };
  };
  return { after, ring, busyShare: (45 * STEADY_STEPS) / (60 * STEADY_STEPS) };
}
export const steadyFixture = (program: Program, writes: Writes): Fixture => {
  const r = steadyRun();
  return fixture('steady', STEADY, program, writes, STEADY_STEPS, at([0, 1, 59, 60, STEADY_STEPS - 1], (k) => ({ ...r.after(k), rec_t: r.ring(k).t, rec_w: r.ring(k).w })),
    'One source every 60 s (arrivals at 0, 60, 120 … s) into a fifo queue feeding one resource of capacity 1 held 45 s, then a sink, at a 1/60 s tick, 3,600 ticks (one minute) a step. Each minute one order arrives at its first tick, passes the empty queue in the same tick, holds 2,700 ticks and leaves at tick 2,700 of the minute, so at every step end nothing is held; after step k: k + 1 made, out and recorded, every record 45 s; the request\'s dwell and area 45(k + 1) s; busy area 45(k + 1) s of 60(k + 1) s, a share of 0.75 exactly; every station\'s throughput 60 an hour; the queue\'s dwell 0 (nothing waits). Over each window, mean work in progress at the resource 45/60 = 0.75 = throughput (1/60 s) × time in system (45 s). Row 0 is reused each minute, so its generation is k + 1.');
};

// ---------------------------------------------------------------------------------------------------
// Criterion 3.

/**
 * Belts of 10 m at 0.5 m/s with 0.6 m spacing at a 1/60 s tick: P = 10 ÷ (0.5 × 1/60) = 1,200 ticks end to end (20 s),
 * S = 0.6 ÷ (0.5 × 1/60) = 72 ticks of spacing. A case at progress p is d = p × 0.5 × (1/60) = p ÷ 120 m along.
 *
 * Belt A: the lone case (row 0, made first) enters at tick 0 and moves one tick a tick: d = (k + 1) ÷ 120 at step k, 10 m
 * at step 1,199; at tick 1,200 it is at the end and leaves to the sink: 20 s on the belt and in the system.
 *
 * Belt B: cases i = 0 … 17 (rows 1 to 18) all made at tick 0 into its infeed queue. Case i enters when the case before it
 * is 72 ticks along: at tick 72i. All move together, 72 ticks apart, until case 0 reaches the end at tick 1,199's motion;
 * then the end is blocked and every case stops where it is: case i at 1,200 − 72i, case 16 at 48 (0.4 m) < 72, so case
 * 17 never enters: ⌊1,200 ÷ 72⌋ + 1 = 17 cases ride, at 10 − 0.6i m, and the 18th waits at the head of the infeed queue.
 */
export function beltRun() {
  const s = BELT, P = ticks(s, 10 / 0.5), S = ticks(s, 0.6 / 0.5);
  check(P === 1200 && S === 72 && Math.floor(P / S) + 1 === 17 && P - 16 * S < S, 'belts of 1,200 ticks and 72 ticks of spacing hold 17');
  const dOf = (p: number): number => (p * 0.5) / 60;
  /** Case i's progress at the end of step k on belt B, or null while it waits. */
  const pB = (i: number, k: number): number | null => (i <= 16 && k >= S * i ? Math.min(k + 1, P) - S * i : null);
  const onB = (k: number): number => Math.min(Math.floor(k / S) + 1, 17);
  const after = (k: number): Record<string, JsonValue[]> => {
    const lone = k < P ? { at: BELT_ST.a, d: dOf(k + 1) } : { at: -1, d: 0 };
    const d = [lone.d, ...range(0, 17).map((i) => { const p = pB(i, k); return p === null ? 0 : dOf(p); }), 0];
    const atB = [lone.at, ...range(0, 17).map((i) => (pB(i, k) === null ? BELT_ST.qb : BELT_ST.b)), -1];
    const waiting = range(0, 17).filter((i) => pB(i, k) === null);
    const rank = [0, ...range(0, 17).map((i) => (pB(i, k) === null ? waiting.indexOf(i) : i)), 0];
    return {
      kind: [k < P ? 0 : -1, ...fill(18, 0), -1], at: atB, d, rank,
      count: [0, k < P ? 1 : 0, 0, onB(k), 18 - onB(k), 0, 0, k < P ? 19 : 18],
      made_n: [19], out_n: [k < P ? 0 : 1], rec_n: [k < P ? 0 : 1],
    };
  };
  return { P, S, after, pB, dOf };
}
export const beltFixture = (program: Program, writes: Writes): Fixture => {
  const r = beltRun();
  return fixture('belt', BELT, program, writes, BELT_STEPS, {
    ...at([0, 71, 72, 1151, 1152, 1198, 1199, 1200, BELT_STEPS - 1], r.after),
    // Belt A's one departure took 20 s, as did the lone case's time in system; belt B's infeed queue let case i go after
    // 72i ticks, Σ 72i for i = 0 … 16 = 9,792 ticks = 163.2 s.
    '1200': { ...r.after(1200), rec_t: [20, ...fill(BELT.ring - 1, 0)], rec_w: [20, ...fill(BELT.ring - 1, 0)], dwell: [0, 20, 0, 0, (72 * 136) / 60, 0, 0, 20] },
  }, 'Two conveyors of 10 m at 0.5 m/s with 0.6 m spacing at a 1/60 s tick, one step a tick: 1,200 ticks end to end, 72 ticks of spacing, d = p ÷ 120 m. Belt A carries one case made at t = 0 from rest at the infeed to the end in 1,200 ticks = 20 s; it leaves to the sink at tick 1,200, its time in system 20 s. Belt B, whose end leads nowhere, is fed 18 cases made at t = 0; case i enters at tick 72i, all 72 ticks apart, until the lead reaches the end at step 1,199 and stops; then each stops where it is, case i at 10 − 0.6i m, case 16 at 0.4 m, short of the 0.6 m the next needs: ⌊10 ÷ 0.6⌋ + 1 = 17 ride, the 18th waits at the head of the infeed queue. Nothing is made or lost: 19 made = held + out at every step.');
};

// ---------------------------------------------------------------------------------------------------
// Criterion 4.

/**
 * Three sources each make one order at tick 0, in station order, so they take rows 0, 1, 2; entity e enters queue q_e,
 * and the queues were built e = 2, 1, 0 (station 2 holds entity 2). All three heads ask at tick 0; the settle grants by
 * (ask tick, ID): entity 0 takes resource 0 (the lowest with a free unit), entity 1 resource 1, entity 2 finds none and
 * waits at the head of its queue. Holds are unlimited; the program releases entity 1 at step 30, so at tick 30 it leaves
 * to the sink and entity 2 takes resource 1 in the same tick; entity 0 at step 50; entity 2 at step 70.
 */
export function grantRun() {
  const st = GRANT_ST;
  const after = (k: number): Record<string, JsonValue[]> => {
    if (k < 30) return { kind: [0, 0, 0, -1], at: [st.request, st.request, st.q2, -1], holds: [0, 1, -1, -1], busy: [1, 1], out_n: [0] };
    if (k < 50) return { kind: [0, -1, 0, -1], at: [st.request, -1, st.request, -1], holds: [0, -1, 1, -1], busy: [1, 1], out_n: [1] };
    if (k < 70) return { kind: [-1, -1, 0, -1], at: [-1, -1, st.request, -1], holds: [-1, -1, 1, -1], busy: [0, 1], out_n: [2] };
    return { kind: [-1, -1, -1, -1], at: [-1, -1, -1, -1], holds: [-1, -1, -1, -1], busy: [0, 0], out_n: [3] };
  };
  return { after, grantedAt: 30 };
}
export const grantFixture = (program: Program, writes: Writes): Fixture => {
  const r = grantRun();
  check(GRANT.releases!.map((x) => x.at).join() === '30,50,70', 'releases at 30, 50, 70');
  return fixture('grant', GRANT, program, writes, GRANT_STEPS, at([0, 29, 30, 49, 50, 69, 70, GRANT_STEPS - 1], r.after),
    'Two resources of capacity 1 behind one request station that takes either; three orders made at t = 0 by three sources in station order (rows 0, 1, 2), each into its own queue, the queues built in the reverse order. All three ask at tick 0 and are granted by (ask tick, entity ID): 0 takes resource 0, 1 takes resource 1, 2 waits at its queue\'s head. Holds last until release: entity 1 is released at step 30, leaves at tick 30, and entity 2 takes resource 1 at tick 30; entity 0 at step 50; entity 2 at step 70. Busy counts equal the holders at every step.');
};

// ---------------------------------------------------------------------------------------------------
// Criterion 5.

/**
 * Tick 0: three cases (rows 0 to 2) pass their queue to the sink at once, leaving rows 0 to 2 free at generation 1; the
 * blocker (row 3) takes the forklift for 40 s (2,400 ticks). Tick 60 (t = 1 s): six cases take the lowest free rows,
 * 0, 1, 2 (generation 2) and 4, 5, 6 (generation 1), the pallet row 7. The settle loads the pallet first (the pack
 * refuses a case with no carrier), then the six by ID, load order 0 to 5; the full pallet goes into the middle queue and
 * waits there: the forklift is the blocker's until tick 2,400, when the blocker leaves and the pallet takes it, held
 * 30 s (1,800 ticks) to tick 4,200, when it is unpacked: the six come out by ID into the out queue, then the empty pallet
 * leaves to the sink.
 */
export function palletRun() {
  const st = PALLET_ST;
  const cases = [0, 1, 2, 4, 5, 6];
  check(ticks(PALLET, 40) === 2400 && ticks(PALLET, 30) === 1800 && ticks(PALLET, 1) === 60, 'holds of 2,400 and 1,800 ticks, the six at tick 60');
  const after = (k: number): Record<string, JsonValue[]> => {
    if (k < 60) return { kind: [-1, -1, -1, 0, -1, -1, -1, -1], gen: [1, 1, 1, 1, 0, 0, 0, 0], at: [-1, -1, -1, st.block, -1, -1, -1, -1], batch: fill(8, -1), holds: [-1, -1, -1, 0, -1, -1, -1, -1], made_n: [4, 0], out_n: [3, 0] };
    const gen = [2, 2, 2, 1, 1, 1, 1, 1];
    const packed = { batch: [7, 7, 7, -1, 7, 7, 7, -1], rank: [0, 1, 2, 0, 3, 4, 5, 0] };
    if (k < 2400) return { kind: [0, 0, 0, 0, 0, 0, 0, 1], gen, at: [-1, -1, -1, st.block, -1, -1, -1, st.qmid], ...packed, holds: [-1, -1, -1, 0, -1, -1, -1, -1], made_n: [10, 1], out_n: [3, 0] };
    if (k < 4200) return { kind: [0, 0, 0, -1, 0, 0, 0, 1], gen, at: [-1, -1, -1, -1, -1, -1, -1, st.fork], ...packed, holds: [-1, -1, -1, -1, -1, -1, -1, 0], made_n: [10, 1], out_n: [4, 0] };
    return { kind: [0, 0, 0, -1, 0, 0, 0, -1], gen, at: [st.qout, st.qout, st.qout, -1, st.qout, st.qout, st.qout, -1], batch: fill(8, -1), rank: [0, 1, 2, 0, 3, 4, 5, 0], holds: fill(8, -1), made_n: [10, 1], out_n: [4, 1] };
  };
  return { after, cases, packedFrom: 60, unpackedAt: 4200, waitsFrom: 60, takenAt: 2400 };
}
export const palletFixture = (program: Program, writes: Writes): Fixture => {
  const r = palletRun();
  return fixture('pallet', PALLET, program, writes, PALLET_STEPS, at([0, 59, 60, 61, 2399, 2400, 4199, 4200, PALLET_STEPS - 1], r.after),
    'At t = 0 three cases go straight out (rows 0 to 2 free at generation 1) and a blocker holds the one forklift 40 s. At t = 1 s six cases take rows 0, 1, 2 (generation 2) and 4, 5, 6 (generation 1), a pallet row 7; the pallet enters the pack station, the six load onto it by ID, and the full pallet goes into a queue, where it waits for the forklift until the blocker leaves at 40 s; held 30 s, it is unpacked at 70 s: the same six rows, generations 2, 2, 2, 1, 1, 1, come out into the out queue in ID order and the empty pallet leaves. While packed each case\'s batch is row 7, so made (10 cases, 1 pallet) = held + out at every step.');
};

export const ANSWERS = { mm1: 'M/M/1: arrivals at exponential gaps of mean 120 s (λ = 1/120 s⁻¹), holds exponential of mean 60 s (μ = 1/60 s⁻¹), one server: ρ = λ/μ = 0.5, mean time in system W = 1/(μ − λ) = 120 s, mean work in progress L = λW = 1.' };
