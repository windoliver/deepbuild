// #2307.8ca832fd: "In a new fixture at 120 Hz and 4 substeps with sleep off, #251's fixture car, braked at 4,000 N with
// grip 1, is set on a static slope facing up it and, in a second world, standing across it, at 10° and at 20°. After 2 s
// to settle, its centre moves less than 1 mm along the slope over the next 10 s in each of the four. A planted wrapper
// that leaves the backend's controller as it is moves 0.183 m facing up 10° and fails, naming the body and the
// distance"
//
// The car (README: The worlds) is set on the static body `ground`, turned 10° or 20° so that it rises along the car's
// heading (the car faces up the slope) or along its axle (it stands across it), with every spring at rest length, sleep
// off, every wheel's grip 1, and a brake of 4,000 N stamped at step 0. Each of the four worlds is baked 12 s. How far
// its centre moves along the slope is the distance between its position after step 240 (2 s) and after step 1,440
// (12 s) with the part along the slope's normal left out. `controller_without_hold` leaves the backend's controller as
// it is, with no hold: facing up the 10° slope the car creeps the issue's 0.183 m in those 10 s.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, alongSlope, bakeOf, bodyOf, brake, fmt, prebuildBuilds, run, slopeText, slopeWorld, stepAt,
  type Planted, type Slope,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[1];
const SETTLE = stepAt(2);
const END = SETTLE + stepAt(10);
const WITHIN = 0.001;
const UP_10: Slope = { deg: 10, way: 'up' };
const SLOPES: Slope[] = [UP_10, { deg: 20, way: 'up' }, { deg: 10, way: 'across' }, { deg: 20, way: 'across' }];
/** What the issue says the planted wrapper moves facing up 10°, and how near it this suite holds it (README: Readings). */
const TWIN_MOVE = 0.183;
const TWIN_WITHIN = 0.05;

/** The car braked on each slope: how far its centre moves along the slope from 2 s to 12 s, and the judge's failures. */
function parked(slopes: Slope[], planted?: Planted): { problem: string; failures: string[]; moved: number[] } {
  const r = run(slopes.map((s) => bakeOf(slopeWorld(s), END, [brake(0, 4000)], ['kart'])), planted ? { planted } : {});
  if (r.problem) return { problem: r.problem, failures: [], moved: [] };
  const moved = slopes.map((s, i) => {
    const kart = bodyOf(r.replies[i], 'kart', END, `the car braked on ${slopeText(s)}`);
    return alongSlope(kart[SETTLE]!.pos, kart[END]!.pos, s);
  });
  const failures = slopes.flatMap((s, i) => (moved[i]! < WITHIN ? [] : [`kart: moves ${fmt(moved[i]!)} m along ${slopeText(s)} over the 10 s after its 2 s to settle, not less than 1 mm`]));
  return { problem: '', failures, moved };
}

describe(`${ID} a car braked at 4,000 N with grip 1 stays where it is parked on a 10° and a 20° slope, facing up it and standing across it`, () => {
  it(`${ID} after 2 s to settle its centre moves less than 1 mm along the slope over the next 10 s, facing up it and standing across it, at 10° and at 20°`, () => {
    const p = parked(SLOPES);
    expect(p.problem, 'deep-physics bakes the car braked on each of the four slopes').toBe('');
    for (const [i, s] of SLOPES.entries()) console.log(`${slopeText(s)}: the car's centre moves ${fmt(p.moved[i]!)} m along it from 2 s to 12 s`);
    expect(p.failures, `the car parked on the four slopes:\n  ${p.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: controller_without_hold) a wrapper that leaves the backend's controller as it is moves 0.183 m facing up 10° and fails, naming the body and the distance`, () => {
    const p = parked([UP_10], 'controller_without_hold');
    expect(p.problem, 'deep-physics --planted controller_without_hold runs and bakes the car braked facing up the 10° slope').toBe('');
    expect(p.failures.length, 'the planted wrapper is caught: the judge that passes the parked car finds it moved').toBeGreaterThan(0);
    expect(p.failures.some((f) => /^kart: moves \d+(\.\d+)? m along the 10° slope, facing up it/.test(f)), `the failure names the body and the distance: ${p.failures.join(' | ')}`).toBe(true);
    expect(Math.abs(p.moved[0]! - TWIN_MOVE) <= TWIN_MOVE * TWIN_WITHIN, `the planted wrapper moves ${fmt(p.moved[0]!)} m facing up 10°, the issue's 0.183 m within 5%`).toBe(true);
  }, TIMEOUT);
});
