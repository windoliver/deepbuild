// #3258.acf18c87: "On the test build whose soft solver meets no contact (`test-swap-soft-solver`), a rope of 21 particles
// 0.05 m apart, let go level 0.5 m above a static plate 5 mm thick, fails `soft.through`, naming the first particle
// through, the plate and the step. A planted audit that reads only contact pairs passes the run and fails this test, and
// the merge base's run of it is shown"
//
// The rope falls level and unstretched: after step k every particle has dropped g h² n (n + 1) / 2, n = 4 k (h = 1/480 s),
// 0.4951 m after step 38, 4.9 mm above the plate's top, and 0.5214 m after step 39, 16.4 mm below its underside. So each
// particle goes in at the top and comes out of the underside in step 39, and none is inside the plate at either end: no
// state of the run, and no contact pair of it, shows the plate was passed. That motion is first read back from the same
// build's bake. All 21 go through in the one step, so "the first particle through" is any of them, at step 39.
//
// Run at the audit's defaults for 60 steps (under the second the energy rule reads over). The merge base's run of it is
// this test's own at the base: BASE-FAILURE.txt holds its verdict, PASS with no failure.
import { describe, expect, it } from 'vitest';
import {
  AC, PLATE, ROPE, ROPE_ADDRESSES, ROPE_Y, THICK, TIMEOUT, audit, bakes, cleanBuilds, failFailures, fallStep, full, none, particleOf, pathsOf,
  readOf, ropeOverPlate, show, swapped, told, useFailures, type Read,
} from './helpers.ts';

cleanBuilds();
const ID = AC[1];
const STEPS = 60;
const STEP = fallStep(ROPE_Y + THICK);
const WHAT = 'the rope over the plate';

/** Everything wrong with "fails soft.through, naming the first particle through, the plate and the step". */
function failures(r: Read): string[] {
  const out = failFailures(r, STEPS, WHAT);
  const first = r.rows.find((f) => particleOf(f) !== null);
  if (!first) return [...out, `${WHAT}: no soft.through failure names a particle: ${told(r)}`];
  if (!full(ROPE, ROPE_ADDRESSES).includes(particleOf(first)!)) out.push(`${WHAT}: the first particle named is ${show(particleOf(first))}, not one of the rope's`);
  if (first['step'] !== STEP) out.push(`${WHAT}: the first particle through is named at step ${show(first['step'])}, not ${STEP}, when all 21 pass`);
  out.push(...useFailures(first, PLATE, WHAT));
  out.push(...r.rows.filter((f) => typeof f['step'] === 'number' && f['step'] < STEP).map((f) => `${WHAT}: a failure before any particle reaches the plate: ${show(f)}`));
  return out;
}

describe(`${ID} a rope that falls through a thin plate fails the audit`, () => {
  it(`${ID} the rope let go level 0.5 m above a static plate 5 mm thick fails soft.through, naming the first particle through, the plate and the step`, () => {
    const w = ropeOverPlate();
    const [baked, reply] = swapped([bakes(w, STEPS), audit(w, STEPS)]);
    const path = pathsOf(baked, ROPE, STEPS, WHAT);
    const inside = path.flatMap((s, k) => s.filter((p) => p[1] <= 0 && p[1] >= -THICK).map((p) => `step ${k}: a particle at y ${p[1]}`));
    const through = path.findIndex((s) => s.some((p) => p[1] < -THICK));
    expect([inside, STEP, through, path[STEP]!.filter((p) => p[1] < -THICK).length], 'the fixture: no particle is inside the plate at any step, and all 21 are above it until step 39 and below it from there').toEqual([[], 39, 39, 21]);
    const r = readOf(reply, WHAT);
    console.log(`${WHAT}: ${told(r)}`);
    none(failures(r), 'the audit of the rope through the plate');
    expect(r.settings['soft'], 'the audit ran with soft.through.max at its default, 0').toMatchObject({ through: { max: 0 } });
  }, 2 * TIMEOUT);

  it(`${ID} a planted audit that reads only contact pairs passes the run and fails this test`, () => {
    const [reply] = swapped([audit(ropeOverPlate(), STEPS)], 'through_reads_contact_pairs');
    const r = readOf(reply, `${WHAT}, planted`);
    console.log(`planted through_reads_contact_pairs: ${told(r)}`);
    expect([r.verdict, r.through, r.rows], 'the planted audit passes the run').toEqual(['PASS', 0, []]);
    const found = failures(r);
    expect(found.some((f) => f.includes('not FAIL')), `the judge that passes the real audit fails on the planted one, for its verdict: ${found.join('; ')}`).toBe(true);
  }, 2 * TIMEOUT);
});
