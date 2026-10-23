import { describe, expect, it } from 'vitest';
import {
  CHECKER_BOX, CHECKER_SIZE, back, checkerDoc, checkerPng, firstWrongPixel, forShow, gpui, pixel, put, scratch, useBinaries, vello,
} from './helpers.ts';

useBinaries('deep-canvas-render', 'deep-show');
const dir = scratch('nearest');
const png = checkerPng();
const asset = put(dir, png);

/** The nearest checker: 4 × 4 single black and white texels, fit fill into a 16 × 16 box, in a 24 × 24 document. */
const nearest = (extra: { at?: Record<string, number[]> } = {}) => checkerDoc(asset, { sampling: 'nearest', ...extra });

describe('AC1 a 4 × 4 checker drawn with sampling nearest and fit fill into a 16 × 16 box reads exactly 0 or 255 at every device pixel, the color of its texel', () => {
  for (const zoom of [1, 2]) {
    it(`AC1 through GPUI at zoom ${zoom}`, () => {
      const image = gpui(dir, nearest(), { zoom }, `GPUI render at zoom ${zoom}`);
      expect(firstWrongPixel(image, CHECKER_SIZE, CHECKER_BOX, zoom), `GPUI at zoom ${zoom}: the first device pixel that isn't a texel's own color`).toBeNull();
    }, 300_000);
  }

  for (const zoom of [1, 2]) {
    it(`AC1 through Vello CPU raster at zoom ${zoom}`, () => {
      const image = vello(dir, nearest(), { zoom }, `Vello CPU raster at zoom ${zoom}`);
      expect(firstWrongPixel(image, CHECKER_SIZE, CHECKER_BOX, zoom), `Vello CPU at zoom ${zoom}: the first device pixel that isn't a texel's own color`).toBeNull();
    }, 300_000);
  }

  it('AC1 through render-back', async () => {
    const image = await back(dir, png, (a) => forShow(checkerDoc(a, { sampling: 'nearest' }), a), CHECKER_SIZE, 'render-back of the nearest checker');
    // Render-back paints the shipped look's ground, not this suite's: outside the box every pixel must read the one the corner reads.
    expect(firstWrongPixel(image, CHECKER_SIZE, CHECKER_BOX, 1, pixel(image, 0, 0)), 'render-back: the first device pixel that isn\'t a texel\'s own color').toBeNull();
  }, 300_000);
});

describe('scope: GPUI resamples a nearest image to its drawn size and draws it 1:1 on whole device pixels', () => {
  for (const zoom of [1, 2]) {
    it(`a nearest image at 4.2 u draws on whole device pixels at zoom ${zoom}: every pixel is a texel's own color or the ground, no blended edge`, () => {
      // 4.2 u is 4.2 device px at zoom 1 and 8.4 at zoom 2: whole device pixels 4 and 8 whether they round or floor,
      // so the image lands exactly where an image at 4 u does. The drawn size, 16 u, is whole device pixels already.
      const at = { pos: [0.2, 0.2, 0] };
      const image = gpui(dir, nearest({ at }), { zoom }, `GPUI render of the offset nearest checker at zoom ${zoom}`);
      expect(firstWrongPixel(image, CHECKER_SIZE, CHECKER_BOX, zoom), `GPUI at zoom ${zoom}, image offset by 0.2 u: the first device pixel off its whole-pixel place`).toBeNull();
    }, 300_000);
  }
});
