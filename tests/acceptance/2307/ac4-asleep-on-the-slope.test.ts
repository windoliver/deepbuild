// #2307.9f33326e: "With sleep on, the car braked on the 10° slope writes `rest` and is asleep by step 180, and 10 s later
// has not moved 1 mm. Every step hash while it sleeps equals the one before it, and no wheel writes an occurrence. A
// planted wrapper that runs the controller on the sleeping body stores a velocity in it, so its step hashes change, and
// fails, naming the first step"
//
// The car (README: The worlds) is set facing up the 10° slope with every spring at rest length, its `sleep` left on, a
// brake of 4,000 N stamped at step 0, and baked 1,380 steps: to step 180, then 10 s. A bake holds no flag for a body
// asleep: it falls asleep in the step whose `rest` row names it and sleeps until a `wake` row names it. The judge
// wants a `rest` row by step 180 with no `wake` after it to the end, since nothing wakes it; its position after step
// 1,380 within 1 mm of its position after step 180; every step hash from the step after its `rest` on equal to the
// one before it; and no row naming one of its wheels after its `rest`. That the hashes can differ is shown on the same
// run: the first step's differs from the built state's. `controller_runs_asleep` runs the controller on the sleeping
// body and stores its pushes in the body's velocity, so the hashes change while it sleeps.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, bakeOf, bodyOf, brake, fmt, hashesOf, length, prebuildBuilds, rowText, rowsOf, run, sleepRows, sleepText, slopeWorld,
  stepAt, sub, wheelRows, type Planted, type Slope, type State,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[4];
const ASLEEP_BY = 180;
const LATER = ASLEEP_BY + stepAt(10);
const UP_10: Slope = { deg: 10, way: 'up' };
const WHAT = 'the car braked on the 10° slope with sleep on';

interface Slept { problem: string; failures: string[]; kart: State[]; hashes: string[]; first: number | null }
/** The car's sleep on the slope: the judge's failures, and the first step whose hash differs from the one before it while it sleeps. */
function slept(planted?: Planted): Slept {
  const r = run([bakeOf(slopeWorld(UP_10, { sleep: true }), LATER, [brake(0, 4000)], ['kart'])], planted ? { planted } : {});
  if (r.problem) return { problem: r.problem, failures: [], kart: [], hashes: [], first: null };
  const kart = bodyOf(r.replies[0], 'kart', LATER, WHAT);
  const hashes = hashesOf(r.replies[0], WHAT);
  expect(hashes.length, `${WHAT}: a step hash for the built state and each of its ${LATER} steps`).toBe(LATER + 1);
  const rows = rowsOf(r.replies[0], WHAT);
  const rest = sleepRows(rows).find((x) => x.kind === 'rest');
  const failures: string[] = [];
  let first: number | null = null;
  if (!rest || rest.step > ASLEEP_BY) failures.push(`kart: writes no rest by step ${ASLEEP_BY} (its rest and wake rows: ${sleepText(rows)})`);
  if (rest) {
    const woken = sleepRows(rows).find((x) => x.kind === 'wake' && x.step > rest.step);
    if (woken) failures.push(`kart: wakes at step ${woken.step} with nothing to wake it, after its rest at step ${rest.step}`);
    const to = woken ? woken.step - 1 : LATER;
    const changed = hashes.map((h, k) => ({ h, k })).filter(({ h, k }) => k > rest.step && k <= to && h !== hashes[k - 1]);
    if (changed.length) {
      first = changed[0]!.k;
      failures.push(`step ${first}: its step hash ${changed[0]!.h} isn't step ${first - 1}'s, ${hashes[first - 1]!}, while kart sleeps (${changed.length} of the ${to - rest.step} steps it sleeps change the hash)`);
    }
    const wheels = wheelRows(rows).filter((x) => x.step > rest.step && x.step <= to);
    if (wheels.length) failures.push(`kart: its wheels write ${wheels.length} occurrences while it sleeps, the first ${rowText(wheels[0]!)}`);
  }
  const moved = length(sub(kart[LATER]!.pos, kart[ASLEEP_BY]!.pos));
  if (!(moved < 0.001)) failures.push(`kart: has moved ${fmt(moved)} m 10 s after step ${ASLEEP_BY}, not less than 1 mm`);
  return { problem: '', failures, kart, hashes, first };
}

describe(`${ID} with sleep on, the car braked on the 10° slope falls asleep and rests: nothing moves it, changes its state or writes for its wheels`, () => {
  it(`${ID} it writes rest and is asleep by step 180, 10 s later has not moved 1 mm, every step hash while it sleeps equals the one before it, and no wheel writes an occurrence`, () => {
    const s = slept();
    expect(s.problem, `deep-physics bakes ${WHAT}`).toBe('');
    expect(s.hashes[1], 'the comparison can fail: the first step\'s hash, taken while the car is awake, isn\'t the built state\'s').not.toBe(s.hashes[0]);
    expect(s.failures, `${WHAT}:\n  ${s.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: controller_runs_asleep) a wrapper that runs the controller on the sleeping body stores a velocity in it, so its step hashes change, and fails, naming the first step`, () => {
    const s = slept('controller_runs_asleep');
    expect(s.problem, `deep-physics --planted controller_runs_asleep runs and bakes ${WHAT}`).toBe('');
    expect(s.failures.length, 'the planted wrapper is caught: the judge that passes the sleeping car finds its state changing').toBeGreaterThan(0);
    expect(s.first, `a failure names the first step whose hash changes while the car sleeps: ${s.failures.join(' | ')}`).not.toBeNull();
    expect(s.failures.some((f) => f.startsWith(`step ${s.first!}: `)), `a failure starts with that step, ${s.first!}: ${s.failures.join(' | ')}`).toBe(true);
    const held = s.kart[s.first!]!;
    const stored = Math.hypot(...held.linear, ...held.angular);
    expect(stored, `the planted wrapper stores a velocity in the sleeping body: after step ${s.first!} it holds linear ${JSON.stringify(held.linear)} m/s and angular ${JSON.stringify(held.angular)} deg/s`).toBeGreaterThan(0);
  }, TIMEOUT);
});
