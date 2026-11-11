// #1919.b83c52f8: against the bake of a ball whose initial velocity is (10 cos 45°, 10 sin 45°, 0) m/s (no drag,
// g 9.81 m/s²), a physics.query probe of the ball's x at its first hit on the floor expecting 10.19 m ± 0.1 passes; the
// same probe expecting 11 m ± 0.1 fails, naming the step and the value it read; a ray cast straight down from (5, 3, 0)
// at step 0 returns the floor's ID at 3.00 m within 1 mm (floor top at y = 0); and with the bake deleted the check is
// BLOCKED, never PASS.
//
// The projectile (helpers): the floor's top at y = 0, a 0.1 m ball resting on it, launched from there at
// (10 cos 45°, 10 sin 45°, 0) m/s, friction and restitution 0, its position the output `ball`. Its range back at launch
// height is v² sin 2θ ÷ g = 10.19 m (behavior kit: projectile). The probe reads output `outputs/ball/0` at the first
// `hit` row naming ball and floor; its result is checked against the same bake's own list and states: the step of the
// first such row and the ball's x after that step.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, RAY_DOWN, STEPS, STEP_0, TIMEOUT, X_AT_FIRST_HIT, bake, checked, deepPhysics, prebuild, projectile, query, resultOf, rowText, rowsOf,
  scratch, statesOf,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];

describe(`${ID} physics.query against the projectile's bake`, () => {
  it(`${ID} the ball's x at its first hit passes against 10.19 m ± 0.1 and fails against 11 m ± 0.1 naming the step and the value; a ray down from (5, 3, 0) at step 0 hits the floor at 3.00 m`, () => {
    const w = projectile();
    const store = scratch('ac2');
    const [baked, pass, fail, ray] = deepPhysics([
      bake(w, STEPS, { store, read: ['ball'] }),
      query(w, store, X_AT_FIRST_HIT, { value: 10.19 }, { tolerance: 0.1 }),
      query(w, store, X_AT_FIRST_HIT, { value: 11 }, { tolerance: 0.1 }),
      query(w, store, RAY_DOWN, { value: 3 }, { tolerance: 0.001, state: STEP_0 }),
    ]);
    const ball = statesOf(baked!, 'ball', STEPS + 1, 'the projectile\'s bake');
    const rows = rowsOf(baked, 'the projectile\'s bake');
    const hit = rows.find((r) => r.kind === 'hit' && [r.a, r.b].sort().join() === 'ball,floor');
    expect(hit, `the bake writes the ball's hit on the floor: ${rows.map(rowText).join('; ') || 'no rows'}`).toBeDefined();
    const xThen = ball[hit!.step]!.pos[0];

    const p = checked(pass, 'x at the first hit, expecting 10.19 m ± 0.1');
    const pr = resultOf(p, 'x at the first hit, expecting 10.19 m ± 0.1');
    expect(p.verdict, `the probe passes: ${JSON.stringify(p.raw).slice(0, 800)}`).toBe('PASS');
    expect(pr.step, 'it reads at the step of the ball\'s first hit on the floor').toBe(hit!.step);
    expect(Math.abs(pr.value! - xThen), `its value ${pr.value} is the ball's x after step ${hit!.step}, ${xThen}`).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(pr.value! - 10.19), `its value ${pr.value} is within 0.1 of 10.19 m`).toBeLessThanOrEqual(0.1);

    const f = checked(fail, 'x at the first hit, expecting 11 m ± 0.1');
    const fr = resultOf(f, 'x at the first hit, expecting 11 m ± 0.1');
    expect(f.verdict, `the probe fails: ${JSON.stringify(f.raw).slice(0, 800)}`).toBe('FAIL');
    expect([fr.step, fr.value], 'the failure names the step and the value it read: the passing probe\'s').toEqual([pr.step, pr.value]);
    expect(f.what, 'the failure\'s text names the step').toMatch(new RegExp(`\\b${pr.step}\\b`));

    const r = checked(ray, 'the ray down from (5, 3, 0) at step 0');
    const rr = resultOf(r, 'the ray down from (5, 3, 0) at step 0');
    expect(r.verdict, `the ray finds the floor 3.00 m down within 1 mm: ${JSON.stringify(r.raw).slice(0, 800)}`).toBe('PASS');
    expect(rr.ids, 'the ray hits the floor alone').toEqual(['floor']);
    expect(rr.step, 'at step 0').toBe(0);
    expect(Math.abs(rr.value! - 3), `the hit is ${rr.value} m along the ray`).toBeLessThanOrEqual(0.001);
  }, TIMEOUT);

  it(`${ID} with the bake deleted the check is BLOCKED, never PASS`, () => {
    const w = projectile();
    const store = scratch('ac2-deleted');
    const [baked] = deepPhysics([bake(w, STEPS, { store, read: [] })]);
    expect(baked!['ok'], `the projectile bakes into the store: ${JSON.stringify(baked).slice(0, 800)}`).toBe(true);
    const kept = readdirSync(store);
    expect(kept.length, 'the bake is kept in the store').toBeGreaterThan(0);
    for (const f of kept) rmSync(join(store, f), { recursive: true, force: true });
    const [x, ray] = deepPhysics([
      query(w, store, X_AT_FIRST_HIT, { value: 10.19 }, { tolerance: 0.1 }),
      query(w, store, RAY_DOWN, { value: 3 }, { tolerance: 0.001, state: STEP_0 }),
    ]);
    expect(checked(x, 'x at the first hit, its bake deleted').verdict, 'the output probe is BLOCKED').toBe('BLOCKED');
    expect(checked(ray, 'the ray, its bake deleted').verdict, 'the ray is BLOCKED').toBe('BLOCKED');
  }, TIMEOUT);
});
