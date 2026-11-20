// #2307.3dfea1f1: "Never more than asked. With brakes of 1,000 N in all facing up 20°, the car moves at 4 × (9.81 ×
// sin 20° − 1) = 9.42 m/s at 4 s within 1%. With grip 0.3 standing across 20°, its speed down the slope rises at 9.81 ×
// (sin 20° − 0.3 × cos 20°) = 0.590 m/s² within 2%. With `brake` 0 facing up 10° it rolls back 9.81 × sin 10° × t² ÷ 2
// within 1% at 4 s. A planted hold that ignores the brake's limit keeps the first car still and fails, naming the body"
//
// Three cars (README: The worlds), each set on its slope at rest with every spring at rest length, sleep off, and
// baked 4 s. The first faces up the 20° slope with a brake of 1,000 N stamped at step 0: its speed down the slope after
// step 480 is 4 × (g × sin 20° − 1,000 ÷ 1,000). The second stands across the 20° slope with every wheel's grip 0.3
// and a brake of 4,000 N: its speed down the slope after step 480 less that after step 120, over the 3 s between, is
// g × (sin 20° − 0.3 × cos 20°). The third faces up the 10° slope with a brake of 0 stamped at step 0: how far down
// the slope it is after step 480 is g × sin 10° × 4² ÷ 2. `hold_ignores_brake_limit` resists the whole pull along a
// wheel's heading whatever its brake has left, so the first car stands still.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, G, MASS, TIMEOUT, bakeOf, bodyOf, brake, fmt, near, prebuildBuilds, run, slopeWorld, speedDown, stepAt, wentDown,
  type JsonObject, type Planted, type Slope, type State,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[2];
const END = stepAt(4);
const FROM = stepAt(1);
const sin = (deg: number): number => Math.sin((deg * Math.PI) / 180);
const cos = (deg: number): number => Math.cos((deg * Math.PI) / 180);
/** The world's sleep speed (World and backend: `solver.sleep.speed`): slower than this, a body counts as at rest. */
const STILL = 0.05;

interface Slide { name: 'weak brake' | 'grip 0.3' | 'brake 0'; slope: Slope; call: JsonObject; judge: (kart: State[]) => { read: number; failure: string | null } }
const UP_20: Slope = { deg: 20, way: 'up' };
const ACROSS_20: Slope = { deg: 20, way: 'across' };
const UP_10: Slope = { deg: 10, way: 'up' };
const SLIDES: Slide[] = [
  {
    name: 'weak brake', slope: UP_20, call: bakeOf(slopeWorld(UP_20), END, [brake(0, 1000)], ['kart']),
    judge: (kart) => {
      const want = 4 * (G * sin(20) - 1000 / MASS);
      const v = speedDown(kart[END]!, UP_20);
      return { read: v, failure: near(v, want, 0.01) ? null : `kart: with brakes of 1,000 N in all, facing up the 20° slope, moves ${fmt(v)} m/s down it at 4 s, not 4 × (9.81 × sin 20° − 1) = ${fmt(want, 4)} m/s within 1%` };
    },
  },
  {
    name: 'grip 0.3', slope: ACROSS_20, call: bakeOf(slopeWorld(ACROSS_20, { grip: 0.3 }), END, [brake(0, 4000)], ['kart']),
    judge: (kart) => {
      const want = G * (sin(20) - 0.3 * cos(20));
      const rate = (speedDown(kart[END]!, ACROSS_20) - speedDown(kart[FROM]!, ACROSS_20)) / ((END - FROM) / 120);
      return { read: rate, failure: near(rate, want, 0.02) ? null : `kart: with grip 0.3, standing across the 20° slope, its speed down it rises at ${fmt(rate)} m/s² from 1 s to 4 s, not 9.81 × (sin 20° − 0.3 × cos 20°) = ${fmt(want, 3)} m/s² within 2%` };
    },
  },
  {
    name: 'brake 0', slope: UP_10, call: bakeOf(slopeWorld(UP_10), END, [brake(0, 0)], ['kart']),
    judge: (kart) => {
      const want = (G * sin(10) * 4 ** 2) / 2;
      const back = wentDown(kart[0]!.pos, kart[END]!.pos, UP_10);
      return { read: back, failure: near(back, want, 0.01) ? null : `kart: with brake 0, facing up the 10° slope, has rolled back ${fmt(back)} m at 4 s, not 9.81 × sin 10° × 4² ÷ 2 = ${fmt(want, 4)} m within 1%` };
    },
  },
];

/** Each car's reading and the judge's failures. */
function slid(slides: Slide[], planted?: Planted): { problem: string; failures: string[]; read: number[]; karts: State[][] } {
  const r = run(slides.map((s) => s.call), planted ? { planted } : {});
  if (r.problem) return { problem: r.problem, failures: [], read: [], karts: [] };
  const karts = slides.map((s, i) => bodyOf(r.replies[i], 'kart', END, `the car sliding (${s.name})`));
  const judged = slides.map((s, i) => s.judge(karts[i]!));
  return { problem: '', failures: judged.flatMap((j) => (j.failure === null ? [] : [j.failure])), read: judged.map((j) => j.read), karts };
}

describe(`${ID} brakes and grip hold no more than they are asked: weak brakes, weak grip and no brake slide the car at the worked rates`, () => {
  it(`${ID} brakes of 1,000 N facing up 20° leave it 9.42 m/s at 4 s within 1%; grip 0.3 across 20° lets its speed rise at 0.590 m/s² within 2%; brake 0 facing up 10° rolls it back 9.81 × sin 10° × t² ÷ 2 at 4 s within 1%`, () => {
    const s = slid(SLIDES);
    expect(s.problem, 'deep-physics bakes the three sliding cars').toBe('');
    console.log(`weak brake, up 20°: ${fmt(s.read[0]!)} m/s at 4 s; grip 0.3, across 20°: ${fmt(s.read[1]!)} m/s²; brake 0, up 10°: ${fmt(s.read[2]!)} m back at 4 s`);
    expect(s.failures, `the three slides beside their worked rates:\n  ${s.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: hold_ignores_brake_limit) a hold that ignores the brake's limit keeps the first car still and fails, naming the body`, () => {
    const s = slid([SLIDES[0]!], 'hold_ignores_brake_limit');
    expect(s.problem, 'deep-physics --planted hold_ignores_brake_limit runs and bakes the car with brakes of 1,000 N facing up the 20° slope').toBe('');
    expect(s.failures.length, 'the planted hold is caught: the judge that passes the sliding car finds it off its worked speed').toBeGreaterThan(0);
    expect(s.failures.some((f) => /^kart: with brakes of 1,000 N in all/.test(f)), `the failure names the body: ${s.failures.join(' | ')}`).toBe(true);
    const speed = Math.hypot(...s.karts[0]![END]!.linear);
    expect(speed, `the planted hold keeps the first car still: it moves ${fmt(speed)} m/s at 4 s, slower than the world's sleep speed, 0.05 m/s`).toBeLessThan(STILL);
  }, TIMEOUT);
});
