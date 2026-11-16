// The slab fixture (README: Fixtures and cameras): a floor under a slab 20 m square, its underside h above the floor,
// under uniform ambient with no lights, multi_bounce and specular off, strength 1, a floor material with no specular
// share; radius 0.5 m. The camera stands in the gap, halfway up it, 1.5 m from the middle, looking level at it, so the
// floor and the slab's underside within the radius of the middle are both in the frame. The reading is the floor's linear
// luminance with ao on ÷ with `ao: none`, averaged under the slab's middle (|x|, |z| ≤ 0.25 m).
//
// AC3 "On the slab fixture at radius 0.5 m the reading is within 0.05 of 0.25 with the slab 0.25 m above the floor, and of
//     0.5625 with it at 0.375 m. The loop as it is on main reads above 0.8 at the first and fails, naming the height. A
//     planted loop that weights its directions evenly over the hemisphere reads 0.5 there and fails"
//
// Read at every setting (8 and 16 samples, half and full resolution: the issue's proof line, "at every setting"). On
// the base the shipped program is main's loop, which the issue bounds at 0.81 or above here (its CPU model reads 0.93),
// so the first test fails there on its reading.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTING, SETTINGS, SLAB_HEIGHTS, aoOn, failsNaming, fixtureDoc, fmt, judge, measure, none, requireGpu, settingName,
  slabBin, slabBoxes, slabCam, slabClosed, useGpuBin, useOut, writeJson, type Plant,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();
const TOL = 0.05;

function slab(h: number, settings: typeof SETTINGS, plant?: Plant): Map<string, number> {
  const cam = slabCam(h);
  const doc = writeJson(out(), `slab-${h}-${plant ?? 'shipped'}.json`, fixtureDoc(`slab-2516-${String(h).replace('.', '_')}`, slabBoxes(h), cam));
  const name = slabBin(h).name;
  const m = measure(gpu.bin(), out(), doc, cam, settings.map((s) => ({ label: settingName(s), ao: aoOn(s) })), [slabBin(h)], plant);
  const flat = new Map([...m].map(([s, row]) => [s, row.get(name)!]));
  console.log(`#2516 slab at ${h} m${plant ? ` (--planted ${plant})` : ''}: ${fmt(flat)} (closed form ${slabClosed(h)})`);
  return flat;
}

describe('AC3 the floor under a slab is held to (h ÷ radius)²', () => {
  it('AC3 under the slab at 0.25 m the reading is within 0.05 of 0.25, and at 0.375 m of 0.5625, at every setting', () => {
    requireGpu();
    const problems: string[] = [];
    for (const h of SLAB_HEIGHTS) for (const [s, r] of slab(h, SETTINGS)) {
      problems.push(...judge(`slab, ${s}`, [{ point: slabBin(h).name, reading: r, expected: slabClosed(h), tol: TOL, against: 'the closed form' }]));
    }
    none(problems, 'every slab reading is within 0.05 of (h ÷ radius)²');
  }, 3_600_000);

  it('AC3 the loop as it is on main reads above 0.8 under the slab at 0.25 m and fails, naming the height', () => {
    requireGpu();
    const r = slab(0.25, [DEFAULT_SETTING], 'ao_main_loop').get(settingName(DEFAULT_SETTING))!;
    expect(r, 'main\'s loop reads above 0.8 under the slab at 0.25 m, as the issue bounds it').toBeGreaterThan(0.8);
    const problems = judge(`slab, main's loop, ${settingName(DEFAULT_SETTING)}`, [{ point: slabBin(0.25).name, reading: r, expected: slabClosed(0.25), tol: TOL, against: 'the closed form' }]);
    failsNaming(problems, ['the slab 0.25 m above the floor', `the reading is ${r.toFixed(3)}`], 'main\'s loop under the slab');
  }, 1_800_000);

  it('AC3 a loop that weights its directions evenly over the hemisphere reads 0.5 under the slab at 0.25 m and fails', () => {
    requireGpu();
    const r = slab(0.25, [DEFAULT_SETTING], 'ao_uniform_hemisphere').get(settingName(DEFAULT_SETTING))!;
    expect(Math.abs(r - 0.5), `the even-weighted loop reads ${r.toFixed(3)}, the uniform hemisphere's 1 − h ÷ radius = 0.5 within 0.05`).toBeLessThanOrEqual(TOL);
    const problems = judge(`slab, even-weighted loop, ${settingName(DEFAULT_SETTING)}`, [{ point: slabBin(0.25).name, reading: r, expected: slabClosed(0.25), tol: TOL, against: 'the closed form' }]);
    failsNaming(problems, ['the slab 0.25 m above the floor'], 'the even-weighted loop under the slab');
  }, 1_800_000);
});
