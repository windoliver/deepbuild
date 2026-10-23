import { describe, expect, it } from 'vitest';
import { checkerDoc, checkerPng, firstBeyond, gpui, largestDifference, put, scratch, useBinaries, vello } from './helpers.ts';

useBinaries('deep-canvas-render');
const dir = scratch('cubic');
const asset = put(dir, checkerPng());

/** The criterion's tolerance: 2 levels per channel. A cubic sampler is not the linear one: Vello CPU's bicubic draw of
 * this checker is 15 levels from its bilinear one at the largest (measured while writing this test), and a
 * sharper kernel is further, so a path that ignores the field is more than 8 levels from the path that doesn't. */
const TOLERANCE = 2;
const NOT_LINEAR = 8;

describe('AC2 the checker with sampling cubic agrees between GPUI and Vello CPU raster within 2 levels per channel at every pixel', () => {
  it('AC2 GPUI and Vello CPU raster agree at every pixel, and each draws something other than linear', () => {
    const cubicOnGpui = gpui(dir, checkerDoc(asset, { sampling: 'cubic' }), { zoom: 1 }, 'GPUI render, cubic');
    const cubicOnVello = vello(dir, checkerDoc(asset, { sampling: 'cubic' }), { zoom: 1 }, 'Vello CPU raster, cubic');
    const linearOnGpui = gpui(dir, checkerDoc(asset), { zoom: 1 }, 'GPUI render, linear');
    const linearOnVello = vello(dir, checkerDoc(asset), { zoom: 1 }, 'Vello CPU raster, linear');

    // A renderer that ignores the field draws linear: cubic would then read the same as linear on its path.
    const onVello = largestDifference(cubicOnVello, linearOnVello);
    expect(onVello.levels, `Vello CPU: cubic is not the linear draw (largest difference ${onVello.levels} levels, at device pixel ${onVello.at.join(', ')})`).toBeGreaterThan(NOT_LINEAR);
    const onGpui = largestDifference(cubicOnGpui, linearOnGpui);
    expect(onGpui.levels, `GPUI: cubic is not the linear draw (largest difference ${onGpui.levels} levels, at device pixel ${onGpui.at.join(', ')})`).toBeGreaterThan(NOT_LINEAR);

    expect(firstBeyond(cubicOnGpui, cubicOnVello, TOLERANCE), 'GPUI and Vello CPU, cubic: the first device pixel where they differ by more than 2 levels').toBeNull();
  }, 300_000);
});
