// AC4: a 60-frame draw of a moving image reads and decodes its asset once. The merge base does so 60 times.
//
// `deep-canvas-render frames` over 60 vsyncs at 60 Hz of one image moved 1 u a frame by a channel. Its item `adjust`
// inverts its colors, which GPUI's sprite can't draw, so its layer is drawn by the raster path's painter on Vello GPU
// (#385) every frame: the path that decodes per draw (README: Readings). Each vsync reports the store reads and the
// decodes it made (`images.reads`, `images.decodes`); over the 60 presented frames each must total 1. The last frame
// must show the picture where it has moved (helpers: `moving`). The wrong program: the merge base's per-draw decode,
// planted as `decodes_per_draw`.
import { describe, expect, it } from 'vitest';
import {
  MOVING_COLOR, MOVING_VSYNCS, RENDER_BUILD, flatPng, moving, onlyOnMacos, put, scratch, total, useBuild, where,
  type CountedVsync,
} from './helpers.ts';

const bin = useBuild(RENDER_BUILD, 'deep-canvas-render', 'debug', () => process.platform === 'darwin');
const dir = scratch('decode');
const asset = put(dir, flatPng(64, 64, MOVING_COLOR));

/** Null when the 60 frames read the asset from the store once and decoded it once; else the counts. */
function decodeFailure(vsyncs: readonly CountedVsync[]): string | null {
  const reads = total(vsyncs, 'reads');
  const decodes = total(vsyncs, 'decodes');
  if (reads === 1 && decodes === 1) return null;
  return `${MOVING_VSYNCS} frames of the moving picture read its asset ${reads} times (at vsyncs ${where(vsyncs, 'reads')}) and decoded it ${decodes} times (at vsyncs ${where(vsyncs, 'decodes')}), not once each`;
}

describe('AC4 a 60-frame draw of a moving image reads and decodes its asset once', () => {
  it('AC4 60 presented frames of the moving picture on its Vello GPU layer: one store read and one decode in all', (ctx) => {
    onlyOnMacos(ctx, 'frames');
    const run = moving(bin(), dir, asset);
    expect(decodeFailure(run.vsyncs), 'reads and decodes over the 60 frames').toBeNull();
  }, 900_000);

  it('AC4 planted decodes_per_draw (the merge base) reads and decodes it 60 times and fails the check', (ctx) => {
    onlyOnMacos(ctx, 'frames');
    const run = moving(bin(), dir, asset, 'decodes_per_draw');
    const found = decodeFailure(run.vsyncs);
    expect(found, 'the check fails on the per-draw decode').not.toBeNull();
    expect([total(run.vsyncs, 'reads'), total(run.vsyncs, 'decodes')], 'the per-draw decode reads and decodes at each of the 60 draws').toEqual([MOVING_VSYNCS, MOVING_VSYNCS]);
  }, 900_000);
});
