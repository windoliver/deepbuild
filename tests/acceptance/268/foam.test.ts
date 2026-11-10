// #268.ed64c4a9: "A pile of 1 m radius in a 20 × 20 m plate, with `foam: {width: 0.5, breakup: 0}` and the steepness
// foam off: foam covers all 64 sampled pixels between 0.05 and 0.4 m from where the pile meets the water, and none of 64
// beyond 0.7 m; with `breakup: 0.5` none of those 64 shows foam either; a planted field measured from the pile's centre
// foams only inside the pile, leaves the band bare and fails, naming the material"
//
// The fixture (helpers.ts `pileDoc`, 512 × 512): a still 20 m × 20 m plate whose material `pile-water` carries the
// steepness foam off (threshold 1) and `shore: {items: "pile-shore", foam: {width: 0.5, breakup: 0}}`; the pile `pile`, a
// cylinder of 1 m radius at the origin standing from 2 m below the water to 0.1 m above it, the one member of
// `pile-shore`. The camera looks straight down from 8 m over the pile (fov 30°, 8.4 mm a pixel on the water), so a
// pixel's centre ray meets the water at rest at a point whose distance from where the pile meets the water is its
// distance from the origin less 1 m; the pile's top hides the water only within 1.013 m of the origin, inside the band.
// 64 pixels whose point lies 0.05 to 0.4 m from the pile and 64 whose point lies beyond 0.7 m are drawn with a seeded
// generator. The foam is read from the `foam` target (README): covered is at least 0.5, none is under 1/255. So the
// foam target is no decoy, each band pixel is also brighter in `pre_tone` than the same water with `shore: "none"`.
//
// With `breakup: 0.5` the 64 pixels beyond 0.7 m still show no foam, and the noise is drawn: at least one band pixel
// shows less foam than with breakup 0. The planted field (`deep-gpu run --planted shore_field_from_centre`) measures the
// distance from the pile's centre instead of its outline, so its band lies inside the pile; the check fails, naming the
// material `pile-water` and the band.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, type Floats, Lcg, PILE_SHORE, type Planted, STILL, at1, camItem, failsNaming, frameAt, framesOf, look3d, lumAt, none, onWater,
  pileDoc, readFloats, requireGpu, runGpu, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [512, 512];
const CAM: Cam = { position: [0, 8, 0], target: [0, 0, 0], fov: 30, size: SIZE };
const LOOK = look3d('foam-268');
const AT = 30;

interface Px { i: number; j: number; d: number }
/** 64 band pixels (0.05 to 0.4 m from where the pile meets the water) and 64 beyond 0.7 m, seeded. */
function samples(): { band: Px[]; beyond: Px[] } {
  const rng = new Lcg(268); const band: Px[] = []; const beyond: Px[] = [];
  for (let n = 0; n < 1_000_000 && (band.length < 64 || beyond.length < 64); n++) {
    const i = Math.floor(rng.next() * SIZE[0]); const j = Math.floor(rng.next() * SIZE[1]);
    const p = onWater(CAM, i, j)!;
    const d = Math.hypot(p[0], p[1]) - 1;
    if (d >= 0.05 && d <= 0.4 && band.length < 64) band.push({ i, j, d });
    else if (d > 0.7 && beyond.length < 64) beyond.push({ i, j, d });
  }
  return { band, beyond };
}
const SAMPLES = samples();

/** The pile drawn with `shore` (foam and pre_tone) and, for the brightness check, with `shore: "none"` (pre_tone). */
function draw(breakup: number, planted?: Planted): { foam: Floats; lit: Floats; plain: Floats } {
  const dir = out();
  const doc = (name: string, shore: typeof PILE_SHORE | 'none') => writeJson(dir, name, pileDoc(`pile-${name}`, SIZE, camItem(CAM), { ...STILL, shore }));
  const [withShore, without] = runGpu(bin(), dir, [
    view3d({ doc: doc('shore', { ...PILE_SHORE, foam: { width: 0.5, breakup } }), look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30, capture: [AT], targets: ['foam', 'pre_tone'] }),
    view3d({ doc: doc('plain', 'none'), look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30, capture: [AT], targets: ['pre_tone'] }),
  ], planted);
  const f = frameAt(framesOf(withShore!, 'the pile with shore'), AT, 'the pile with shore');
  const p = frameAt(framesOf(without!, 'the pile without shore'), AT, 'the pile without shore');
  return { foam: readFloats(dir, f, 'foam', SIZE, 'the pile with shore'), lit: readFloats(dir, f, 'pre_tone', SIZE, 'the pile with shore'), plain: readFloats(dir, p, 'pre_tone', SIZE, 'the pile without shore') };
}
const NONE = 1 / 255;
/** The band covered and whiter than plain water, nothing beyond 0.7 m; each failure names the material. */
function bandProblems(d: { foam: Floats; lit: Floats; plain: Floats }, checkBand: boolean): string[] {
  expect([SAMPLES.band.length, SAMPLES.beyond.length], 'the seeded draw found 64 band pixels and 64 beyond 0.7 m').toEqual([64, 64]);
  const failures: string[] = [];
  if (checkBand) for (const { i, j, d: m } of SAMPLES.band) {
    const f = at1(d.foam, i, j);
    if (!(f >= 0.5)) failures.push(`material pile-water: pixel (${i}, ${j}), ${m.toFixed(3)} m from where the pile meets the water (in the band 0.05 to 0.4 m), shows foam ${f.toFixed(3)}, not covered`);
    const lit = lumAt(d.lit, i, j); const plain = lumAt(d.plain, i, j);
    if (!(lit > plain)) failures.push(`material pile-water: pixel (${i}, ${j}), ${m.toFixed(3)} m from the pile (in the band), is no whiter with its foam (${lit.toFixed(5)}) than with shore none (${plain.toFixed(5)})`);
  }
  for (const { i, j, d: m } of SAMPLES.beyond) {
    const f = at1(d.foam, i, j);
    if (!(f < NONE)) failures.push(`material pile-water: pixel (${i}, ${j}), ${m.toFixed(3)} m from where the pile meets the water (beyond 0.7 m), shows foam ${f.toFixed(4)}`);
  }
  return failures;
}

describe(`${AC[1]} shore foam covers a band around the pile and nothing past it`, () => {
  it(`${AC[1]} with foam width 0.5 and breakup 0, foam covers all 64 band pixels between 0.05 and 0.4 m from the pile and none of 64 beyond 0.7 m`, () => {
    requireGpu();
    none(bandProblems(draw(0), true), 'the solid foam band');
  });

  it(`${AC[1]} with breakup 0.5 none of the 64 pixels beyond 0.7 m shows foam, and the breakup clears some of the band`, () => {
    requireGpu();
    const broken = draw(0.5);
    none(bandProblems(broken, false), 'the broken foam band adds nothing past 0.7 m');
    const solid = draw(0);
    const cleared = SAMPLES.band.filter(({ i, j }) => at1(broken.foam, i, j) < at1(solid.foam, i, j) - 0.05);
    console.log(`${AC[1]}: breakup 0.5 cleared ${cleared.length} of 64 band pixels`);
    expect(cleared.length, 'the breakup noise is drawn: some band pixel shows less foam than with breakup 0').toBeGreaterThan(0);
  });

  it(`${AC[1]} a planted field measured from the pile's centre (--planted shore_field_from_centre) leaves the band bare and fails, naming the material`, () => {
    requireGpu();
    failsNaming(bandProblems(draw(0, 'shore_field_from_centre'), true), ['material pile-water', 'in the band'], 'shore_field_from_centre');
  });
});
