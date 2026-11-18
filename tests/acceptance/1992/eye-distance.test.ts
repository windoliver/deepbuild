// AC2 #1992.80a02b86: Fog reads distance from the eye: under the linear fixture, from a camera at the origin with fov
// 90°, a panel 30 m away on the axis and one 30 m away 40° off it both read 0.75 within 1/255, and turning the camera
// 40° in place changes neither by more than 1/255. A planted fog by view depth reads 0.838 for the off-axis panel and
// fails, naming the pixel. The same holds under exp and exp2.
//
// The pair fixture (helpers: pairDoc): the linear fixture's sky (ID `sky`, black background, fog color 0.5); a camera
// at the origin, fov 90° across 640 × 360, looking along −Z; two unlit white panels 3 m square, each turned to face
// the eye, their near faces' centres 30 m from the eye on the axis and 40° to its right. The same document is drawn
// again with the camera turned 40° in place toward the off-axis panel, so each panel is on the axis in one pose and
// 40° off it in the other. Each panel is read on the linear target at the pixel its near face's centre projects to.
// Under each of three curves, every one mixing half the fog in at 30 m (README: Readings): `linear {near: 10, far: 50}`;
// `exp` at the issue's 0.0231 per m; `exp2` at 0.02775 per m:
//   - fixture, per panel and pose (helpers: readPanel): the surface at the judged pixel is 30 m from the eye within
//     5 cm, the panel covers every pixel within 2 px, and its pixels span what the pinhole gives within 2 px;
//   - both panels read 0.75 within 1/255, and neither moves by more than 1/255 between the poses;
//   - the planted fog by view depth, on the CPU (README: Planted programs): the curve fed the depth along the camera's
//     axis, 30 cos 40° = 22.98 m for the panel 40° off it, which under linear is 0.838, through the same judge: it
//     fails, every failure naming a pixel, on the off-axis panel's reading and on both panels' move under the turn.
// Wrong programs: the base (no fog on an unlit part); fog by view depth or by any other distance than the eye's; a
// curve that reads the eye's distance under linear only.
import { describe, expect, it } from 'vitest';
import {
  AC, CURVES, PAIR, PAIR_SIZE, PIXEL, byViewDepth, failsNaming, fmt, judgePair, none, only, pairCam, pairDoc, readIds, readLinear, readPanel, requireMetal,
  runGpu, useBin, useDir, view3dCall, writeJson, type PairReading,
} from './helpers.ts';

const bin = useBin();
const dir = useDir();

describe(`${AC[2]} fog reads distance from the eye`, () => {
  for (const curve of CURVES) {
    it(`${AC[2]} under ${curve.name}, a panel 30 m away on the axis and one 30 m away 40° off it both read 0.75 within 1/255 and a 40° turn in place moves neither by more than 1/255; a planted fog by view depth fails, naming the pixel`, () => {
      requireMetal();
      const out = dir();
      const poses = [false, true];
      const replies = runGpu(bin(), out, poses.map((turned) => view3dCall({ doc: writeJson(out, `pair-${curve.name}-${turned ? 'turned' : 'ahead'}`, pairDoc(curve.sky, turned)), size: PAIR_SIZE, targets: ['linear', 'ids'] })));
      const problems: string[] = [];
      const read = poses.map((turned, i) => {
        const what = `${curve.name}, the camera ${turned ? 'turned 40°' : 'looking along −Z'}`;
        const f = only(replies[i]!, what);
        const lin = readLinear(out, f, PAIR_SIZE, what); const ids = readIds(out, f, what);
        return PAIR.map((p) => { const r = readPanel(pairCam(turned), p, lin, ids, what); problems.push(...r.problems); return r; });
      });
      none(problems, 'the pair fixture\'s panels are 30 m from the eye in both poses');
      const readings: PairReading[] = PAIR.map((p, k) => ({ panel: p, pixel: read[0]![k]!.pixel, value: read[0]![k]!.value, turnedPixel: read[1]![k]!.pixel, turned: read[1]![k]!.value }));
      expect(curve.share(30), `${curve.text} mixes half the fog in at 30 m, so a white panel reads 0.75 there`).toBeCloseTo(0.5, 3);
      console.log(`${AC[2]} ${curve.name}: ${readings.map((r) => `${r.panel.id} reads ${fmt(r.value)}, turned ${fmt(r.turned)}`).join('; ')}`);
      none(judgePair(curve, readings), `under ${curve.text} both panels read 0.75 and the turn moves neither`);

      // The planted fog by view depth: each reading replaced by what the depth along the camera's axis gives.
      const planted: PairReading[] = readings.map((r) => ({ ...r, value: byViewDepth(curve, pairCam(false), r.panel), turned: byViewDepth(curve, pairCam(true), r.panel) }));
      const off = planted.find((r) => r.panel.id === 'off_axis')!;
      if (curve.name === 'linear') expect(off.value[0], 'the planted fog by view depth reads 0.838 for the off-axis panel').toBeCloseTo(0.838, 3);
      const failures = judgePair(curve, planted);
      failsNaming(failures, PIXEL, `the planted fog by view depth under ${curve.name}`);
      expect(failures.some((f) => f.includes(`(${off.pixel.join(', ')})`) && f.includes('`off_axis`') && f.includes('should read')), `the planted fog fails on the off-axis panel's reading, naming its pixel:\n  ${failures.join('\n  ')}`).toBe(true);
      expect(failures.filter((f) => f.includes('turning the camera')).length, 'the planted fog moves both panels under the turn').toBe(2);
    }, 1_800_000);
  }
});
