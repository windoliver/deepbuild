// Criterion 1: a 2D writer layer drawn by GPUI and by the GPU layer compares through the perceptual oracle, and its
// interior pixels (farther than 1.5 device px from every edge the layer draws), gradients included, agree within one
// 8-bit code value on 99.9%; a fill whose color a planted fault shifts by two codes fails; and edge pixels are checked
// per item: each glyph run's and stroke's coverage, summed over its pixels in the window, matches Vello CPU's within
// 2%, and its coverage centroid within 0.1 device px, so a planted half-pixel shift of the glyph quads fails, naming
// the item.
//
// One `deep-gpu run` draws the layer three ways in one `layers` call (README): by GPUI's offscreen Metal renderer, by
// the GPU layer (Vello GPU on the app's wgpu device), and by Vello CPU. The oracle is helpers.ts's
// `layerParityProblems`, run on the files the binary writes. At the base `deep-gpu` holds no `layers` call.
import { describe, expect, it } from 'vitest';
import { DEEP_GPU, LOOK, WRITER_RUNS, gpuReplies, layerParityProblems, layersCall, needsMac, readLayers, useBuilds, useDir, writerDoc } from './helpers.ts';

const builds = useBuilds([DEEP_GPU]);
const dir = useDir('deep-385-parity-');

/** The writer layer drawn by all three, under `planted` when given: the oracle's problems. */
function problems(planted?: string): string[] {
  needsMac();
  const out = dir();
  const [reply] = gpuReplies(builds.bin(DEEP_GPU), out, [layersCall(writerDoc(), LOOK, ['gpui', 'gpu_layer', 'vello_cpu'])], planted ? ['--planted', planted] : []);
  const layers = readLayers(out, reply!, 'writer-385');
  expect([...layers.keys()], 'the figure has one 2D writer layer, main').toEqual(['main']);
  expect(layers.get('main')!.dim, 'main is a 2D writer layer').toBe('2d');
  return layerParityProblems('writer-385/main', layers.get('main')!, WRITER_RUNS);
}

describe('C1 a 2D writer layer by GPUI and by the GPU layer, through the perceptual oracle', () => {
  it('C1 interior pixels within one code value on 99.9% (the two-stop gradient band included), and each glyph run and stroke within 2% of Vello CPU\'s coverage and 0.1 device px of its centroid', () => {
    expect(problems(), 'GPUI against the GPU layer, and each item against Vello CPU').toEqual([]);
  }, 1_800_000);

  it('C1 a planted two-code shift of a fill on the GPU layer (--planted shifts_fill_two_codes) fails the interior comparison', () => {
    const found = problems('shifts_fill_two_codes');
    const interior = found.filter((s) => /interior pixels: .* under 99\.9%/.test(s));
    expect(interior.length, `the shifted fill fails the interior share: ${JSON.stringify(found)}`).toBe(1);
    expect(/worst at \(\d+, \d+\), 2 codes/.test(interior[0]!), `the worst interior pixel is two codes off, as planted: ${interior[0]}`).toBe(true);
  }, 1_800_000);

  it('C1 a planted half-pixel shift of GPUI\'s glyph quads (--planted shifts_glyph_quads) fails, naming the glyph run\'s item and no other', () => {
    const found = problems('shifts_glyph_quads');
    const named = found.filter((s) => /item title:glyphs: coverage centroid .* by GPUI against .* by Vello CPU/.test(s));
    expect(named.length, `the centroid check names the title's glyph run: ${JSON.stringify(found)}`).toBe(1);
    const off = Number(/, ([\d.]+) device px apart/.exec(named[0]!)?.[1]);
    expect(off > 0.4 && off < 0.6, `the centroid moved about half a device px: ${named[0]}`).toBe(true);
    expect(found.filter((s) => /item rule:stroke/.test(s)), 'the stroke is not named: only the glyph quads moved').toEqual([]);
    expect(found.filter((s) => /by the GPU layer against/.test(s)), 'the GPU layer\'s glyphs are not named: the planted shift is GPUI\'s').toEqual([]);
  }, 1_800_000);
});
