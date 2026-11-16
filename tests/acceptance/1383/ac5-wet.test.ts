// #1383.4fb146a3: "At `wet` amount 1, a 0.8 roughness pixel evaluates to 0.4 and its base color to 0.7×"
//
// Fixture (helpers: wetDoc; README: Fixtures): a flat 16 × 16 m plate under one cover entry of `soil` everywhere (base
// colour 0.5, 0.4, 0.3 in linear light, roughness 0.8), with `modify: [{kind: wet, amount: 1}]`, and the same plate
// without `modify` as the control. Four ground points.
//
// Reading (README: Assumed surfaces 2): each point's `cover_points` `base_color` and `roughness`, the values the
// fragment stage shades it with, after the cover and its `modify`, before light.
//
// Expected: the issue's closed form, wet multiplying base colour by 1 − 0.3a and roughness by 1 − 0.5a: at amount 1,
// roughness 0.4 and base colour 0.7 × (0.5, 0.4, 0.3) = (0.35, 0.28, 0.21), each within 1e-4; without `modify`,
// roughness 0.8 and base colour (0.5, 0.4, 0.3), so a reading that never applies the cover can't pass.
// Catches: the base (no cover); wet that replaces the material instead of changing it; another factor or a factor on the
// wrong value; wet that skips roughness or colour.
import { describe, it } from 'vitest';
import { AC, PLATE_ID, SOIL_BASE, SOIL_ROUGHNESS, TIMEOUT, WET_POINTS, at, coverPointsOf, fmt, framesOf, none, requireMetal, runGpu, useGpu, useOut, view3d, wetDoc, writeJson, type CoverPoint, type V3 } from './helpers.ts';

const gpu = useGpu();
const out = useOut();

describe(`${AC[5]} wet at amount 1 on a 0.8 roughness cover`, () => {
  it(`${AC[5]} at wet amount 1 roughness 0.8 evaluates to 0.4 and the base colour to 0.7×; without modify they stay 0.8 and 1×`, () => {
    requireMetal();
    const dir = out();
    const [wet, dry] = runGpu(gpu(), dir, [true, false].map((w) => view3d({ doc: writeJson(dir, w ? 'wet' : 'dry', wetDoc(w)), size: [320, 180], points: { item: PLATE_ID, at: WET_POINTS } })));
    const read = (reply: typeof wet, what: string): CoverPoint[] => coverPointsOf(framesOf(reply!, what)[0]!, WET_POINTS, 1, what);
    const failures: string[] = [];
    const judge = (points: CoverPoint[], what: string, factor: { base: number; rough: number }): void => {
      const base = SOIL_BASE.map((c) => c * factor.base) as V3;
      const rough = SOIL_ROUGHNESS * factor.rough;
      for (const p of points) {
        console.log(`${AC[5]}: ${what} ${at(p.at)}: base colour ${p.base.map((c) => fmt(c, 5)).join(', ')}, roughness ${fmt(p.roughness, 5)}`);
        if (!(Math.abs(p.roughness - rough) <= 1e-4)) failures.push(`${what} ${at(p.at)}: roughness ${fmt(p.roughness, 5)}, not ${fmt(rough, 2)}`);
        if (!p.base.every((c, i) => Math.abs(c - base[i]!) <= 1e-4)) failures.push(`${what} ${at(p.at)}: base colour ${p.base.map((c) => fmt(c, 5)).join(', ')}, not ${base.map((c) => fmt(c, 3)).join(', ')} (${factor.base}× the soil's)`);
      }
    };
    judge(read(wet, 'the wet ground'), 'wet at amount 1', { base: 0.7, rough: 0.5 });
    judge(read(dry, 'the dry ground'), 'without modify', { base: 1, rough: 1 });
    none(failures, 'wet multiplies base colour by 1 − 0.3a and roughness by 1 − 0.5a');
  }, TIMEOUT);
});
