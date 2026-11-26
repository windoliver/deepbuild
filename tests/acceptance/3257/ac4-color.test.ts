// AC4 #3257.09613218: "A map whose opaque texels are one green and whose transparent texels store magenta: every kept
// texel of every level is within 2 code values of that green. A planted chain that averages color without alpha mixes
// magenta into level 1 and fails, naming the level and the first texel"
//
// The fence's lines in one green with magenta under the gaps (./chains.ts `greenFence`). The planted chain is built here
// (`plainColorChain`: the control's alphas, colors averaged with no regard for alpha): it fails naming level 1 and its
// first kept texel; the control, whose colors are weighted by alpha, passes. Then the product's chain at
// `alpha_cutoff: 0.5`: each level down to 16 × 16 keeps some texels and every kept texel of all nine levels is the green
// within 2 codes. And the scope's sentence beside it, "this holds for every base color map whose alpha isn't 255
// throughout, mask or blend": the same map with no `alpha_cutoff` (no `mask` material samples it) is the green within 2
// codes in every texel whose alpha isn't 0, its alphas the box's mean within a code; and a tile of four colors at four
// alphas (`tiled`) is, at every level below level 0 and either way, their mean weighted by alpha in linear light within
// 2 codes.
// Wrong programs: the base; a color box in a mask chain or in a blend chain; weights by the stored, thresholded alpha;
// a mean taken in sRGB; weights by kept or not where the scope says alpha.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, failsNaming, none, useDir, useGpu } from '../1634/helpers.ts';
import { GREEN, TILE_MEAN, boxChain, colorFaults, controlChain, greenFence, kept, named, plainColorChain, tiled, type Level } from './chains.ts';
import { AC, transcode } from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const isKept = (a: number): boolean => kept(a, 0.5);
const alphaOff = (got: Level, want: Level): number => {
  let off = 0;
  for (let i = 3; i < got.px.length; i += 4) off = Math.max(off, Math.abs(got.px[i]! - want.px[i]!));
  return off;
};

describe(`${AC[4]} color is averaged by alpha`, () => {
  it(`${AC[4]} every kept texel of every level is within 2 codes of the opaque texels' green; a planted chain that averages color without alpha fails, naming level 1 and the first texel`, () => {
    const map = greenFence();
    failsNaming(colorFaults(plainColorChain(map), GREEN, isKept, 'kept'), [/^level 1 \(128 × 128\): texel \(0, 0\) is /], 'the planted chain that averages color without alpha');
    none(colorFaults(controlChain(map), GREEN, isKept, 'kept'), 'the control chain');

    const [mask, blend, tileMask, tileBlend] = transcode(bin(), dir(), [
      { name: 'green-mask', map, cutoff: 0.5 }, { name: 'green-blend', map },
      { name: 'tile-mask', map: tiled(), cutoff: 0.5 }, { name: 'tile-blend', map: tiled() },
    ]);
    const box = boxChain(map);
    none([
      ...colorFaults(mask!.levels, GREEN, isKept, 'kept').map((m) => `the mask chain, ${m}`),
      ...colorFaults(blend!.levels, GREEN, (a) => a > 0, 'with alpha').map((m) => `the blend chain, ${m}`),
      ...blend!.levels.flatMap((l, i) => (alphaOff(l, box[i]!) <= 1 ? [] : [`the blend chain, ${named(i, l)}: an alpha is ${alphaOff(l, box[i]!)} codes off the box's mean`])),
      ...colorFaults(tileMask!.levels, TILE_MEAN, () => true, 'in all', 1).map((m) => `the four-color tile's mask chain, ${m}`),
      ...colorFaults(tileBlend!.levels, TILE_MEAN, () => true, 'in all', 1).map((m) => `the four-color tile's blend chain, ${m}`),
    ], 'the chains\' colors');
    expect(mask!.levels.length, 'the mask chain has nine levels').toBe(9);
  }, TIMEOUT);
});
