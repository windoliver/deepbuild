// AC6 #424.ba7f5708: With `resolve: per_pixel`, a translucent saddle at opacity 0.5 crossing a translucent plane at 0.5,
// and a self-intersecting surface at 0.4, each match an f64 per-pixel reference composite within 2 code values on
// 99.9% of pixels; with `resolve: sorted` the saddle misses on one side, as its planted twin.
//
// The fixtures (helpers: SADDLE, CROSSING_PLANE, FIGURE_EIGHT, `layeredDoc`): each surface a JSON glTF written here and
// drawn as a `mesh.asset@1` with an unlit, double-sided, alpha_mode blend material (so back faces draw), over a black
// sky, through the same pinhole (480 × 360). The saddle y = 0.5 (x² − z²) (orange, alpha 0.5) crosses the plane
// y = 0.05 + 0.1 x (blue, 0.5) along two curves; the figure-eight sweep (green, 0.4) crosses itself along the y axis.
// The reference (`referenceComposite`) casts a ray through each pixel's centre at every triangle of the same f32
// positions, both faces, and composites the hits back to front in f64; it judges a pixel where it has a layer and the
// rays ±0.5 px away meet the same items in the same order (no silhouette or crossing inside it). Over the judged
// pixels (at least 20,000 per fixture), the final target (tone map none) is within 2 codes of the reference's sRGB code
// on 99.9%. The twin: the saddle and plane with `resolve: sorted` must miss on at least 1% of judged pixels, where the
// per-object order puts the wrong surface in front. Wrong programs: the base (per-object sorting only); a per-pixel
// list that drops back faces or keeps only the nearest k layers; a resolve in sRGB.
import { describe, expect, it } from 'vitest';
import {
  AC, EIGHT_LAYERS, SADDLE_CAM, SADDLE_LAYERS, codeOff, codes, layeredDoc, only, px, readPng, referenceComposite,
  requireMetal, runGpu, useDir, useGpu, view3dCall, writeJson, type Image, type Layered, type Rgb,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE = SADDLE_CAM.size;

/** The share of judged pixels within 2 codes of the reference, and the first miss. */
function match(final: Image, layers: Layered[]): { judged: number; share: number; first: string } {
  const ref = referenceComposite(SADDLE_CAM, layers);
  let judged = 0; let ok = 0; let first = '';
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const i = y * SIZE[0] + x;
    if (!ref.judged[i]) continue;
    judged++;
    const want = codes([ref.color[i * 3]!, ref.color[i * 3 + 1]!, ref.color[i * 3 + 2]!] as Rgb);
    if (codeOff(px(final, x, y), want) <= 2) ok++; else if (!first) first = `(${x}, ${y}) reads ${px(final, x, y).join(', ')}, the reference ${want.join(', ')}`;
  }
  return { judged, share: judged ? ok / judged : 0, first };
}
function drawn(out: string, fixtures: [string, Layered[], 'sorted' | 'per_pixel'][]): Image[] {
  const calls = fixtures.map(([name, layers, resolve]) => {
    const { doc, assets } = layeredDoc(out, name, SADDLE_CAM, SIZE, layers, resolve);
    return view3dCall({ doc: writeJson(out, name, doc), size: SIZE, targets: ['final'], assets });
  });
  return runGpu(bin(), out, calls).map((r, i) => readPng(out, only(r, fixtures[i]![0]).final, fixtures[i]![0]));
}

describe(`${AC[6]} the per-pixel see-through resolve`, () => {
  it(`${AC[6]} with resolve per_pixel, the saddle crossing a plane and the self-crossing surface each match the f64 per-pixel composite within 2 codes on 99.9% of pixels`, () => {
    requireMetal();
    const out = dir();
    const [saddle, eight] = drawn(out, [['saddle-per-pixel', SADDLE_LAYERS, 'per_pixel'], ['eight-per-pixel', EIGHT_LAYERS, 'per_pixel']]);
    for (const [name, img, layers] of [['the saddle and plane', saddle!, SADDLE_LAYERS], ['the self-crossing surface', eight!, EIGHT_LAYERS]] as const) {
      const m = match(img, layers);
      console.log(`${AC[6]}: ${name}: ${(m.share * 100).toFixed(3)}% of ${m.judged} judged pixels within 2 codes`);
      expect(m.judged, `${name}: at least 20,000 judged pixels (the fixture)`).toBeGreaterThanOrEqual(20_000);
      expect(m.share, `${name} matches the per-pixel reference within 2 codes on 99.9% of pixels; first miss ${m.first}`).toBeGreaterThanOrEqual(0.999);
    }
  }, 1_800_000);

  it(`${AC[6]} the planted twin: with resolve sorted, the saddle and plane miss the reference on one side`, () => {
    requireMetal();
    const out = dir();
    const [sorted] = drawn(out, [['saddle-sorted', SADDLE_LAYERS, 'sorted']]);
    const m = match(sorted!, SADDLE_LAYERS);
    console.log(`${AC[6]}: sorted: ${(m.share * 100).toFixed(3)}% of ${m.judged} judged pixels within 2 codes`);
    expect(m.judged, 'at least 20,000 judged pixels (the fixture)').toBeGreaterThanOrEqual(20_000);
    expect(m.share, 'with resolve sorted the check fails: at least 1% of judged pixels miss, where per-object order puts the wrong surface in front').toBeLessThanOrEqual(0.99);
  }, 1_800_000);
});
