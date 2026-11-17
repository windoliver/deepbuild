// Criterion 15: a 1 m jump under a slab whose underside is 0.5 m above the capsule's top meets the slab and reads a
// downward vertical speed on the next step; a planted controller that keeps its upward speed stays against the slab
// for 40 steps and fails, naming the first of them.
//
// The body stands on the floor (its top 1.81 m up, its lowest point the offset above the floor) and jumps at step 30.
// It meets the slab on the step whose row is its contact_begin with the slab; it stays against the slab until its
// contact_end. The judge requires a downward vertical speed in the state after the meeting step, and names the stretch
// of steps it stayed against the slab and the first of them. The wrong program is `--planted ceiling_keeps_upward`.
import { describe, expect, test } from 'vitest';
import {
  AC, HALF_HEIGHT, HERO, OFFSET, RADIUS, TIMEOUT, bake, between, caught, characterStates, characterWorld, heroBody, jump, named,
  none, physics, prebuild, rowsOf, slab, standing, statesOf, type Runner,
} from './helpers.ts';

prebuild(['shipped']);
const AT = 30;
const STEPS = 150;
const UNDERSIDE = OFFSET + 2 * (HALF_HEIGHT + RADIUS) + 0.5;

function ceilingRun(r: Runner): { failures: string[]; met: number | null; stay: number | null } {
  const w = characterWorld({ statics: { floor: slab(-5, 5, -1, 0), slab: slab(-2, 2, UNDERSIDE, UNDERSIDE + 0.5) }, movers: { [HERO]: heroBody([0, standing(0), 0]) } });
  const [reply] = physics([bake(w, STEPS, { track: [jump(AT)], read: [HERO] })], r);
  const chars = characterStates(statesOf(reply!, HERO, 'the jump under the slab'), 'the jump under the slab');
  const rows = rowsOf(reply!, 'the jump under the slab');
  const begin = between(rows, 'contact_begin', HERO, 'slab')[0];
  if (!begin) return { failures: ['the body never meets the slab (no contact_begin naming it and the slab)'], met: null, stay: null };
  const m = begin.step;
  const end = between(rows, 'contact_end', HERO, 'slab').find((x) => x.step > m);
  const stay = end ? end.step - m : null;
  const failures: string[] = [];
  if (!(chars[m + 1]!.vertical < 0)) failures.push(`after meeting the slab at step ${m} its vertical speed is ${chars[m + 1]!.vertical} m/s on the next step, not downward: it stays against the slab for ${stay ?? 'the rest of the run'} steps, the first of them step ${m}`);
  return { failures, met: m, stay };
}

describe(`${AC[15]} a ceiling stops a jump's rise`, () => {
  test(`${AC[15]} a 1 m jump under a slab 0.5 m above the capsule's top meets it and reads a downward vertical speed on the next step`, () => {
    const { failures, met } = ceilingRun({});
    none(failures, 'rapier3d');
    expect(met! > AT, `it meets the slab after the jump (step ${met})`).toBe(true);
  }, TIMEOUT);

  test(`${AC[15]} a controller that keeps its upward speed (--planted ceiling_keeps_upward) stays against the slab for 40 steps and fails, naming the first of them`, () => {
    const { failures, met, stay } = ceilingRun({ planted: 'ceiling_keeps_upward' });
    caught(failures, 'the controller that keeps its upward speed');
    named(failures, [`the first of them step ${met}`], 'its failure');
    expect(stay !== null && Math.abs(stay - 40) <= 1, `it stays against the slab for 40 steps, within one (README: Readings); it stays ${stay}`).toBe(true);
  }, TIMEOUT);
});
