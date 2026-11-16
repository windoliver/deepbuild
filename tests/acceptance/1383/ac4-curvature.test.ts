// #1383.3f20cff6: "A ridge has positive curvature and a gully negative at their fixture centers"
//
// Fixture (helpers: ridgesDoc; README: Fixtures): a 96 × 64 m plate at 2 m, a Gaussian ridge 20 m high along z at
// x = 20 and a Gaussian gully 20 m deep along z at x = −20, each σ = 8 m. Rock under moss where `curvature: {min: 0}`.
// The fixture centers: three points on each centre line, z = −16, 0 and 16.
//
// Reading (README: Assumed surfaces 2): each point's `cover_points` `curvature`, the value `where.curvature` reads there.
//
// Expected: the issue's signs, positive on the ridge and negative in the gully, at the magnitude of the Laplacian of the
// heights (the scope's "a true Laplacian of the heights", per metre): ∂²h/∂x² + ∂²h/∂z² is −20 ÷ σ² = −0.3125 per m on
// the ridge's centre line and +0.3125 on the gully's, so the curvature is +0.3125 on the ridge and −0.3125 in the gully,
// each within 10% (a five-point Laplacian at the 2 m spacing reads 0.3077, 1.5% under).
// Catches: the base (no cover); the Laplacian's own sign, which reads a ridge negative; a curvature from the mesh's mean
// curvature (half the Laplacian at a crest) or over sample indices instead of metres (four times it at 2 m).
import { describe, it } from 'vitest';
import { AC, GULLY_POINTS, LAPLACIAN, PLATE_ID, RIDGE_POINTS, TIMEOUT, at, coverPointsOf, fmt, framesOf, none, requireMetal, ridgesDoc, runGpu, useGpu, useOut, view3d, writeJson } from './helpers.ts';

const gpu = useGpu();
const out = useOut();

describe(`${AC[4]} curvature on a ridge and in a gully`, () => {
  it(`${AC[4]} at the ridge's centre line the curvature is +${LAPLACIAN} per m and at the gully's −${LAPLACIAN}, each within 10%`, () => {
    requireMetal();
    const dir = out();
    const asked = [...RIDGE_POINTS, ...GULLY_POINTS];
    const [reply] = runGpu(gpu(), dir, [view3d({ doc: writeJson(dir, 'ridges', ridgesDoc()), size: [320, 180], points: { item: PLATE_ID, at: asked } })]);
    const points = coverPointsOf(framesOf(reply!, 'the ridge and the gully')[0]!, asked, 1, 'the ridge and the gully');
    console.log(`${AC[4]}: curvature: ${points.map((p) => `${at(p.at)} ${fmt(p.curvature, 5)}`).join('; ')}`);
    const failures: string[] = [];
    points.forEach((p, k) => {
      const ridge = k < RIDGE_POINTS.length;
      const want = ridge ? LAPLACIAN : -LAPLACIAN;
      const where = ridge ? 'the ridge' : 'the gully';
      if (ridge ? !(p.curvature > 0) : !(p.curvature < 0)) failures.push(`${where} at ${at(p.at)}: curvature ${fmt(p.curvature, 5)}, not ${ridge ? 'positive' : 'negative'}`);
      else if (!(Math.abs(p.curvature - want) <= 0.1 * LAPLACIAN)) failures.push(`${where} at ${at(p.at)}: curvature ${fmt(p.curvature, 5)} per m, not the Laplacian's ${fmt(want, 4)} within 10%`);
    });
    none(failures, 'a ridge has positive curvature and a gully negative');
  }, TIMEOUT);
});
