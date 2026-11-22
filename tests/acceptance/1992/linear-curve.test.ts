// AC1 #1992.cf298652: With fog color linear 0.5, `fog_curve: linear {near: 10, far: 50}` and tone map none, an unlit
// white panel reads 1.0 at 8 m from the eye, 0.75 at 30 m and 0.5 at 60 m, each within 1/255 on linear targets. A
// planted exp curve fitted to the same halfway distance (density 0.0231 per m) reads 0.897 at 10 m and fails, naming
// the sky. A sky with near 50 and far 10 is refused at check, naming the sky.
//
// The linear fixture (helpers: panelsDoc): a camera at the origin looking along −Z, fov 60°, 640 × 360; a `sky@1`
// (ID `sky`) with a black background, no ambient light, `fog: [0.5, 0.5, 0.5, 1]` and the curve, and no density; four
// panels, each a thin `mark.box@1` in an unlit white `material@1` (README: Readings), turned to face the eye, its
// near face's centre 8, 10, 30 and 60 m from the eye at −21°, −7°, 7° and 21° off the axis, each 8° wide; tone map
// none at exposure scale 1; the linear target read at the pixel each near face's centre projects to.
//   1. Fixture, per panel (helpers: readPanel): the ray through the judged pixel meets the near face 8, 10, 30 or 60 m
//      from the eye within 5 cm; the ID target shows the panel on every pixel within 2 px; the panel's pixels span
//      what the pinhole gives within 2 px. Then the panels read 1.0, 1.0 (10 m is `near`), 0.75 and 0.5 within 1/255.
//   2. The planted exp curve, drawn by the renderer through real fields: the same fixture with `fog_curve: exp` and
//      `fog_density: 0.0231`. Its 10 m panel reads 0.897 (0.5 + 0.5 e^(−0.231), within 1/255), and the same judge
//      fails on its frame, every failure naming the sky; its 30 m panel reads 0.75 as the linear one does (the same
//      halfway distance), so only the curve's shape tells them apart.
//   3. The refusal and its boundary pair: near 50 / far 10 and near 50 / far 50 (near = far, the threshold) are each
//      refused, a reply with a `code`, no frames, naming the sky, both with one code; near 49.5 / far 50 (1% inside)
//      is drawn.
// Wrong programs: the base (an object curve read as the default, no fog on an unlit part); a linear curve with near
// and far swapped or measured from another origin; a curve that still needs a density; exp or exp2 under the name
// linear; near ≥ far drawn as a hard step or with far taken as near.
import { describe, expect, it } from 'vitest';
import {
  AC, EXP, LINEAR, PANELS, PANELS_CAM, PANELS_SIZE, SKY, TOL, failsNaming, fmt, fogged, judgePanels, linearCurve, none, off, only, panelsDoc, readIds,
  readLinear, readPanel, requireMetal, runGpu, shown, skyRefusal, useBin, useDir, view3dCall, writeJson, type JsonObject, type Panel, type Rgb,
} from './helpers.ts';

const bin = useBin();
const dir = useDir();

/** The panels of one frame, each read at its judged pixel, with the fixture's problems. */
function panelsOf(out: string, reply: JsonObject, what: string): { readings: { panel: Panel; value: Rgb; pixel: [number, number] }[]; problems: string[] } {
  const f = only(reply, what);
  const lin = readLinear(out, f, PANELS_SIZE, what); const ids = readIds(out, f, what);
  const read = PANELS.map((p) => ({ panel: p, ...readPanel(PANELS_CAM, p, lin, ids, what) }));
  return { readings: read.map((r) => ({ panel: r.panel, value: r.value, pixel: r.pixel })), problems: read.flatMap((r) => r.problems) };
}
const draw = (out: string, name: string, curve: JsonObject): JsonObject => view3dCall({ doc: writeJson(out, name, panelsDoc(curve)), size: PANELS_SIZE, targets: ['linear', 'ids'] });

describe(`${AC[1]} a linear fog curve between two distances`, () => {
  it(`${AC[1]} under fog color 0.5 and fog_curve linear {near: 10, far: 50} an unlit white panel reads 1.0 at 8 m from the eye, 0.75 at 30 m and 0.5 at 60 m within 1/255 on the linear target`, () => {
    requireMetal();
    const out = dir();
    const [reply] = runGpu(bin(), out, [draw(out, 'linear', LINEAR.sky)]);
    const { readings, problems } = panelsOf(out, reply!, 'the linear fixture');
    none(problems, 'the linear fixture\'s panels are where the criterion puts them');
    expect(PANELS.map((p) => [p.distance, fogged(LINEAR.share(p.distance))]), 'the curve\'s closed form gives the issue\'s values').toEqual([[8, 1], [10, 1], [30, 0.75], [60, 0.5]]);
    console.log(`${AC[1]}: ${readings.map((r) => `${r.panel.distance} m reads ${fmt(r.value)}`).join('; ')}`);
    none(judgePanels(readings, 'the linear fixture'), 'the panels read 1.0 at 8 m, 0.75 at 30 m and 0.5 at 60 m');
  }, 1_800_000);

  it(`${AC[1]} a planted exp curve fitted to the same halfway distance (density 0.0231 per m) reads 0.897 at 10 m and fails, naming the sky`, () => {
    requireMetal();
    const out = dir();
    const [reply] = runGpu(bin(), out, [draw(out, 'planted-exp', EXP.sky)]);
    const { readings, problems } = panelsOf(out, reply!, 'the planted exp curve');
    none(problems, 'the planted fixture\'s panels are where the criterion puts them');
    const at = (d: number): Rgb => readings.find((r) => r.panel.distance === d)!.value;
    expect(fogged(EXP.share(10)), 'the exp curve at 0.0231 per m gives 0.897 at 10 m').toBeCloseTo(0.897, 3);
    expect(off(at(10), 0.897), `the planted exp curve's panel at 10 m reads ${fmt(at(10))}, should read 0.897 (the fog reaches an unlit panel under exp)`).toBeLessThanOrEqual(TOL);
    expect(off(at(30), 0.75), `the planted exp curve's panel at 30 m reads ${fmt(at(30))}, should read 0.75: the same halfway distance`).toBeLessThanOrEqual(TOL);
    const failures = judgePanels(readings, 'the planted exp curve');
    failsNaming(failures, `the sky \`${SKY}\``, 'the planted exp curve');
    expect(failures.some((f) => f.includes('`p10`')), `the planted exp curve fails at the 10 m panel:\n  ${failures.join('\n  ')}`).toBe(true);
  }, 1_800_000);

  it(`${AC[1]} a sky with near 50 and far 10 is refused at check, naming the sky; near = far is refused too, and near 1% under far is drawn`, () => {
    requireMetal();
    const out = dir();
    const [swapped, equal, inside] = runGpu(bin(), out, [draw(out, 'near-50-far-10', linearCurve(50, 10)), draw(out, 'near-50-far-50', linearCurve(50, 50)), draw(out, 'near-49.5-far-50', linearCurve(49.5, 50))]);
    expect(skyRefusal(swapped!), 'fog_curve linear {near: 50, far: 10} is refused, naming the sky').toBe('');
    expect(skyRefusal(equal!), 'fog_curve linear {near: 50, far: 50}, near = far, is refused, naming the sky').toBe('');
    expect(equal!['code'], 'near = far is refused with the code near > far is').toBe(swapped!['code']);
    expect(inside!['code'], `fog_curve linear {near: 49.5, far: 50}, near under far, is drawn: ${shown(inside, 400)}`).toBeUndefined();
  }, 1_800_000);
});
