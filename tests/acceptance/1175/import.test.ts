// #1175 AC1: "`elements.svg` imports with the clipped rect inside its clip within 0.5 u, the masked rect's alpha
// following the mask's luminance within 2 codes, the pattern tiled at its own size, an arrowhead at the line's end
// turned to its tangent within 1°, and the styled rect teal, compared with Chrome's render of the same file at the same
// size within 4 codes at 99% of pixels."
//
// elements.svg (#398's fixture, unchanged) drawn by `deep-canvas-render raster` at its own size (240 × 160, scale 1),
// every color mapped to a role holding exactly that color over a white ground, and by the pinned headless Chrome at
// 240 × 160 on the same ground. Each element's measure reads the canvas's pixels (README: What each test holds); the
// last test compares the whole render with Chrome's. The wrong program each fails on is the base, which draws the
// clipped rect whole, the masked rect unmasked, no pattern, no marker and the styled rect orange.

import { describe, expect, it } from 'vitest';
import {
  ELEMENTS_SVG, MEASURES, chromeRender, drawn, elementsDoc, scratch, shareWithin, useRenderBinary, type Image,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('import');

let canvas: Image | null = null;
const ours = (): Image => (canvas ??= drawn(dir, elementsDoc(dir), 'elements.svg at 240 × 160'));
let chrome: Image | null = null;
const reference = (): Image => (chrome ??= chromeRender(dir, ELEMENTS_SVG, [240, 160], 'elements'));

describe('#1175 AC1 elements.svg imports with each element drawn as SVG defines it', () => {
  it('AC1 the clipped rect lies inside its clip within 0.5 u', () => {
    expect(MEASURES.clipPath(ours())).toEqual([]);
  }, 1_800_000);

  it('AC1 the masked rect\'s alpha follows the mask\'s luminance within 2 codes', () => {
    expect(MEASURES.mask(ours())).toEqual([]);
  }, 1_800_000);

  it('AC1 the pattern is tiled at its own size', () => {
    expect(MEASURES.pattern(ours())).toEqual([]);
  }, 1_800_000);

  it('AC1 the marker sits at the line\'s end, turned to its tangent within 1°', () => {
    expect(MEASURES.marker(ours())).toEqual([]);
  }, 1_800_000);

  it('AC1 the styled rect is teal: the <style> class rule beats the presentation attribute', () => {
    expect(MEASURES.style(ours())).toEqual([]);
  }, 1_800_000);
});

describe('#1175 AC1 compared with the pinned Chrome\'s render of the same file at the same size', () => {
  it('AC1 the canvas\'s render is within 4 codes of Chrome\'s at 99% of pixels', () => {
    const theirs = reference();
    // The reference itself meets every measure above, so the measures and Chrome's setup agree with SVG.
    for (const [name, measure] of Object.entries(MEASURES)) expect(measure(theirs), `Chrome's render of elements.svg meets the <${name}> measure`).toEqual([]);
    // The comparison's planted-mismatch twin: Chrome's own render of the file with its <style> block dropped (the
    // styled rect orange, as the base draws it) must fail it.
    const twin = chromeRender(dir, Buffer.from(ELEMENTS_SVG.toString('utf8').replace(/<style[^>]*>[^<]*<\/style>/, '')), [240, 160], 'elements-no-style');
    const twinShare = shareWithin(twin, theirs, 4);
    expect(twinShare, `the comparison rejects Chrome's render with the <style> block dropped (share within 4 codes: ${twinShare.toFixed(4)})`).toBeLessThan(0.99);
    const share = shareWithin(ours(), theirs, 4);
    expect(share, `the share of the canvas's pixels within 4 codes of Chrome's (at least 0.99)`).toBeGreaterThanOrEqual(0.99);
  }, 1_800_000);
});
