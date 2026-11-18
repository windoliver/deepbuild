// #458, criterion 14: scaling every light's power, the sky and every emission by 1/100 and raising exposure by
// log2 100 EV, with bloom's threshold off, leaves every linear pixel after exposure within 1e-4 relative on one
// machine. The fixture (helpers.ts, `lightLevelFixture`): a room under a casting sun, two point lights with written
// ranges, a sky with a gradient and ambient light and an emissive box, bloom on with no threshold; its scaled side
// multiplies the sun's illuminance, both lights' power, the sky's four colors and the emission's strength by 1/100 and
// its look gives log2 100 EV more exposure. The lane's `relation` call draws both and judges `exposed` (linear, after
// bloom and exposure, before the tone map); this file reads the two targets it returns with the same number. Wrong programs: the
// base (no `relation` call) and `--planted light_cut_absolute_illuminance` (a light policy whose cut uses an absolute
// illuminance, 0.05 lx at the eye), which drops `lamp-far` from the scaled side alone and must fail, naming it.

import { describe, expect, it } from 'vitest';
import {
  AC, FAR_LAMP, LIGHT_EV, LIGHT_SCALE, TIMEOUT, at, brighterThan, callsFor, drew, f32Of, failsNaming, heldOf, laneFailsNaming, lanePasses,
  lightLevelFixture, linearProblems, none, num, obj, requireMetal, runGpu, str, useBuilds, useDir, REL,
  type Fixture, type Held, type JsonObject,
} from './helpers.ts';

const bin = useBuilds(['default']);
const dir = useDir();

/** The criterion's measure over the two `exposed` targets the lane returned; each failure names the relation. */
function problems(f: Fixture, h: Held, out: string): string[] {
  const what = 'light-level (read here)';
  const base = f32Of(out, h, f, 'base', 'exposed', what);
  expect(brighterThan(base, 0.01), `${what}: the base frame is lit over at least 5,000 pixels (fixture)`).toBeGreaterThanOrEqual(5000);
  return linearProblems('light-level', f32Of(out, h, f, 'scaled', 'exposed', what), (x, y, c) => at(base, x, y, c), REL);
}

describe('#458 criterion 14: light-level invariance', () => {
  it(`${AC[14]}: every light's power, the sky and every emission at 1/100 with exposure up log2 100 EV and bloom's threshold off leaves every linear pixel after exposure within 1e-4 relative`, () => {
    requireMetal();
    const out = dir();
    const f = lightLevelFixture();
    // Fixture checks: the scaled side is the base side at 1/100, with nothing else changed, and both draw at the base.
    const item = (side: string, id: string): JsonObject => obj(obj(obj(f.sides[side]!.doc['items'], 'items')[id], id)['params'], `${id}.params`);
    const ratio = (id: string, field: string): number => num(item('scaled', id)[field], `${id}.${field}`) / num(item('base', id)[field], `${id}.${field}`);
    for (const [id, field] of [['key', 'illuminance'], ['lamp-near', 'power'], [FAR_LAMP, 'power'], ['ember', 'emission_strength']] as const) expect(ratio(id, field), `${id}.${field} is scaled by 1/100`).toBeCloseTo(LIGHT_SCALE, 12);
    for (const field of ['top', 'low', 'ambient_top', 'ambient_low']) expect((item('scaled', 'sky')[field] as number[])[1]! / (item('base', 'sky')[field] as number[])[1]!, `sky.${field} is scaled by 1/100`).toBeCloseTo(LIGHT_SCALE, 12);
    // The look's `exposure` is an EV100: log2 100 stops more exposure is that number lower by log2 100.
    expect(num(f.sides['base']!.look['exposure'], 'exposure') - num(f.sides['scaled']!.look['exposure'], 'exposure'), 'exposure rises by log2 100 EV').toBeCloseTo(LIGHT_EV, 12);
    expect(obj(f.sides['base']!.look['bloom'], 'bloom')['threshold'], 'bloom is on with no threshold').toBeUndefined();
    const m = callsFor(out, f);
    const replies = runGpu(bin('default'), out, [...m.draws, m.relation]);
    m.sides.forEach((side, i) => drew(replies[i]!, `light-level: view3d of side ${side}`));
    const h = heldOf(replies[m.sides.length]!, f, 'relation light-level');
    none(problems(f, h, out), 'every linear pixel after exposure is within 1e-4 relative');
    lanePasses(h, 'relation light-level');
  }, TIMEOUT);

  it(`${AC[14]}: a planted light policy whose cut uses an absolute illuminance changes a pixel and fails, naming the light`, () => {
    requireMetal();
    const out = dir();
    const f = lightLevelFixture();
    const planted = 'light_cut_absolute_illuminance';
    const h = heldOf(runGpu(bin('default'), out, [callsFor(out, f).relation], { planted })[0]!, f, `relation light-level under --planted ${planted}`);
    failsNaming(problems(f, h, out), ['light-level'], `--planted ${planted}`);
    laneFailsNaming(h, `--planted ${planted}`);
    expect(str(obj(h.first ?? undefined, `--planted ${planted}: first`)['light'], `--planted ${planted}: first.light`), `--planted ${planted}: the lane names the light whose cut changed`).toBe(FAR_LAMP);
    expect(h.reason, `--planted ${planted}: the lane's reason names the light`).toContain(FAR_LAMP);
  }, TIMEOUT);
});
