// #1383.3bb69dac: "On a 70° face a checker's texel size stays within 10% of its size on flat ground; planar UV stretches
// 2.92× and fails"
//
// Fixture (helpers: cliffDoc; README: Fixtures): a terrain plate flat at 0 for x ≤ −5 that rises at tan 70° to a
// plateau 30 m up, covered everywhere by `checker` (a 64 × 64 px checker of 2 × 2 cells as its base colour map, so a
// cell is 0.5 m in metre UVs), the entry's `projection` left at its default, `auto`. Two orthographic frames at
// 960 × 640, 41.2 px a metre: straight down on the flat ground, and square onto the face from along its normal. In each,
// 9 scan lines along the rows and 9 down the columns, in linear light, each thresholded halfway between its 10th and
// 90th percentiles; the cell is the mean run between the first and last crossings, the median over the lines.
//
// Expected (the issue's numbers): down the face and across it, the cell within 10% of the flat ground's. Triplanar on
// the face samples mostly the projection along X, whose cell down the slope is 0.5 ÷ sin 70° = 0.532 m (1.06×); the
// planted `cover_keeps_planar_uv` samples by (x, z) on the face as on flat ground, whose cell down the slope is
// 0.5 ÷ cos 70° = 1.46 m: 2.92×. The judge fails it, naming that stretch, which must measure within 10% of 2.92.
// Catches: the base (no cover); `auto` that stays on uv0 past 35°; a triplanar that samples the wrong axes or another
// scale than metres.
import { describe, expect, it } from 'vitest';
import {
  AC, CLIFF_SIZE, TIMEOUT, checkerAsset, cliffDoc, finalOf, framesOf, requireMetal, runGpu, texelJudge, useGpu, useOut, view3d, writeJson,
  type Planted, type TexelReading,
} from './helpers.ts';

const gpu = useGpu();
const out = useOut();
const PLANAR_STRETCH = 1 / Math.cos((70 * Math.PI) / 180);

/** The flat-ground frame and the face frame of the cliff, under `planted` when given, measured. */
function measure(planted?: Planted): TexelReading {
  const dir = out();
  const assets = checkerAsset(dir);
  const calls = (['flat', 'face'] as const).map((v) => view3d({ doc: writeJson(dir, `cliff-${v}`, cliffDoc(v)), size: CLIFF_SIZE, capture: [0], assets }));
  const [flat, face] = runGpu(gpu(), dir, calls, planted);
  const im = (reply: typeof flat, what: string) => finalOf(dir, framesOf(reply!, what)[0]!, what);
  const r = texelJudge(im(flat, 'the flat ground'), im(face, 'the 70° face'));
  console.log(`${AC[1]}${planted ? ` (planted ${planted})` : ''}: checker cell on flat ground ${r.flat.toFixed(3)} m; on the 70° face ${r.down.toFixed(3)} m down it (${(r.down / r.flat).toFixed(3)}×), ${r.across.toFixed(3)} m across it (${(r.across / r.flat).toFixed(3)}×)`);
  return r;
}

describe(`${AC[1]} a checker's texel size on a 70° face against flat ground`, () => {
  it(`${AC[1]} on the 70° face the checker's cell, down the face and across it, stays within 10% of its cell on flat ground`, () => {
    requireMetal();
    const r = measure();
    expect(r.failures, `the 70° face keeps the checker's texel size:\n  ${r.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[1]} the planted cover_keeps_planar_uv stretches the face's cells 2.92× and fails, naming the stretch`, () => {
    requireMetal();
    const r = measure('cover_keeps_planar_uv');
    expect(r.failures.length, 'the judge fails the planted planar UV on the 70° face').toBeGreaterThan(0);
    const stretch = r.down / r.flat;
    expect(Math.abs(stretch / PLANAR_STRETCH - 1), `the planted planar UV measures ${stretch.toFixed(3)}× down the face, within 10% of the issue's ${PLANAR_STRETCH.toFixed(2)}×`).toBeLessThanOrEqual(0.1);
    expect(r.failures.some((f) => f.startsWith('down the face') && f.includes(`${stretch.toFixed(2)}×`)), `a failure names the stretch down the face, ${stretch.toFixed(2)}×: ${r.failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
