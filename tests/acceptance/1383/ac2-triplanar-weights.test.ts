// #1383.c10c4d30: "Triplanar weights sum to 1 within 1e-5"
//
// Fixture (helpers: veeDoc; README: Fixtures): a 32 × 32 m plate at 2 m made of four planes that meet at creases on the
// sample lines x = 0 and z = 0, rising at 1.2 toward +x, 0.4 toward −x, 0.5 toward +z and 0.9 toward −z, so every cell
// lies in one plane and its geometric normal is that quadrant's, while the vertices on a crease average two planes'
// normals and the shaded normal in the cells beside it leans off the geometric one. One cover entry, the checker, with
// `projection: triplanar`. 28 ground points: four inside each quadrant and three in its cells beside a crease.
//
// Reading (README: Assumed surfaces 2): each point's `cover_points` entry `triplanar`, the weights of the projections
// along X, Y and Z that the fragment stage samples with there.
//
// Expected: at every point the three weights sum to 1 within 1e-5 (the criterion), and they are the issue's weights,
// |n|^(1.5 × sharpness) normalized over the geometric normal n: ln(w_x ÷ w_y) ÷ ln(|n_x| ÷ |n_y|) and the same with z
// give one p > 0 at every point, within 1%. The planted `triplanar_by_shaded_normal` weights by the shaded normal (and
// reports what it samples with): its sums still hold, and the judge fails it at a point beside a crease, naming it.
// Catches: the base (no cover); weights that don't sum to 1; weights from the shaded normal; weights of another form.
import { describe, expect, it } from 'vitest';
import {
  AC, PLATE_ID, TIMEOUT, VEE_POINTS, at, besideCrease, checkerAsset, coverPointsOf, framesOf, none, requireMetal, runGpu, useGpu, useOut, veeDoc,
  view3d, weightFailures, writeJson, type Planted,
} from './helpers.ts';

const gpu = useGpu();
const out = useOut();

/** The triplanar weights at the 28 points, under `planted` when given, judged. */
function judge(planted?: Planted): { failures: string[]; p: number } {
  const dir = out();
  const [reply] = runGpu(gpu(), dir, [view3d({ doc: writeJson(dir, 'vee', veeDoc()), size: [320, 180], points: { item: PLATE_ID, at: VEE_POINTS }, assets: checkerAsset(dir) })], planted);
  const frame = framesOf(reply!, 'the four planes')[0]!;
  const points = coverPointsOf(frame, VEE_POINTS, 1, 'the four planes');
  const r = weightFailures(points);
  console.log(`${AC[2]}${planted ? ` (planted ${planted})` : ''}: p = ${r.p.toFixed(4)}; ${points.map((q) => `${at(q.at)} ${q.entries[0]!.triplanar?.map((w) => w.toFixed(5)).join('/') ?? 'uv0'}`).join('; ')}`);
  return r;
}

describe(`${AC[2]} triplanar weights over the geometric normal, summed to 1`, () => {
  it(`${AC[2]} at every point the triplanar weights sum to 1 within 1e-5, as |n|^p of the geometric normal normalized`, () => {
    requireMetal();
    none(judge().failures, 'the triplanar weights');
  }, TIMEOUT);

  it(`${AC[2]} the planted triplanar_by_shaded_normal fails at a point beside a crease, naming it`, () => {
    requireMetal();
    const { failures } = judge('triplanar_by_shaded_normal');
    expect(failures.length, 'the judge fails weights taken from the shaded normal').toBeGreaterThan(0);
    const named = VEE_POINTS.filter(besideCrease).filter((p) => failures.some((f) => f.startsWith(`point ${at(p)}`)));
    expect(named.length, `a failure names a point beside a crease: ${failures.slice(0, 8).join('; ')}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
