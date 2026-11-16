// #1383.7dfe9767: "On a four-sided pyramid, a `where: aspect` for north covers the north face and none of the south"
//
// Fixture (helpers: pyramidDoc; README: Fixtures): a 64 × 64 m plate at 1 m, 32 − max(|x|, |z|): four 45° faces facing
// north (−Z), east, south (+Z) and west. Rock under one cover entry of snow with `where: {aspect: {direction: 0, min:
// 0.5}}` and `blend: 0`: aspect is the compass facing, from −Z (north) turning toward +X (east), read as
// cos(aspect − direction), so 1 on the north face and −1 on the south. Twelve points on the north face and their
// mirrors on the south face, each at least 3.5 m from a ridge.
//
// Reading (README: Assumed surfaces 2): each point's `cover_points` entry `weight`, the share of the point the snow
// entry covers.
//
// Expected: weight 1 (within 1e-3) at every north point; 0 (within 1e-6) at every south point.
// Catches: the base (no cover); an aspect measured from another axis or turning the other way (north read as south,
// east or west); an aspect read without the cosine's sign; a `where` that ignores aspect.
import { describe, it } from 'vitest';
import { AC, NORTH_POINTS, PLATE_ID, SOUTH_POINTS, TIMEOUT, at, coverPointsOf, fmt, framesOf, none, pyramidDoc, requireMetal, runGpu, useGpu, useOut, view3d, writeJson } from './helpers.ts';

const gpu = useGpu();
const out = useOut();

describe(`${AC[3]} a where: aspect for north on a four-sided pyramid`, () => {
  it(`${AC[3]} the snow entry for north covers every point of the north face and none of the south face`, () => {
    requireMetal();
    const dir = out();
    const asked = [...NORTH_POINTS, ...SOUTH_POINTS];
    const [reply] = runGpu(gpu(), dir, [view3d({ doc: writeJson(dir, 'pyramid', pyramidDoc()), size: [320, 180], points: { item: PLATE_ID, at: asked } })]);
    const points = coverPointsOf(framesOf(reply!, 'the pyramid')[0]!, asked, 1, 'the pyramid');
    console.log(`${AC[3]}: snow weights: ${points.map((p) => `${at(p.at)} ${fmt(p.entries[0]!.weight, 4)}`).join('; ')}`);
    const failures: string[] = [];
    points.forEach((p, k) => {
      const w = p.entries[0]!.weight;
      if (k < NORTH_POINTS.length && !(w >= 1 - 1e-3)) failures.push(`north face ${at(p.at)}: the snow entry for north covers ${fmt(w, 6)} of it, not all`);
      if (k >= NORTH_POINTS.length && !(Math.abs(w) <= 1e-6)) failures.push(`south face ${at(p.at)}: the snow entry for north covers ${fmt(w, 6)} of it, not none`);
    });
    none(failures, 'a where: aspect for north covers the north face and none of the south');
  }, TIMEOUT);
});
