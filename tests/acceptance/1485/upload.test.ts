// AC5: a Vello GPU layer with one image over 60 frames uploads once, by the renderer's count.
//
// The same 60 frames as AC4 (`deep-canvas-render frames`, one inverted image moved 1 u a frame, its layer drawn by
// Vello GPU each frame; helpers: `moving`). Each vsync reports the images Vello GPU's renderer uploaded in it
// (`images.uploads`, each `upload_image` call); over the 60 presented frames they must total 1, and the last frame must
// show the picture where it has moved. The wrong program: an upload per frame, freed after each draw, as the merge
// base's `Vello2d::draw` does, planted as `uploads_per_frame`.
import { describe, expect, it } from 'vitest';
import {
  MOVING_COLOR, MOVING_VSYNCS, RENDER_BUILD, flatPng, moving, onlyOnMacos, put, scratch, total, useBuild, where,
  type CountedVsync,
} from './helpers.ts';

const bin = useBuild(RENDER_BUILD, 'deep-canvas-render', 'debug', () => process.platform === 'darwin');
const dir = scratch('upload');
const asset = put(dir, flatPng(64, 64, MOVING_COLOR));

/** Null when the 60 frames uploaded the image to Vello GPU once; else the count. */
function uploadFailure(vsyncs: readonly CountedVsync[]): string | null {
  const uploads = total(vsyncs, 'uploads');
  if (uploads === 1) return null;
  return `Vello GPU uploaded the image ${uploads} times over ${MOVING_VSYNCS} frames (at vsyncs ${where(vsyncs, 'uploads')}), not once`;
}

describe('AC5 a Vello GPU layer with one image over 60 frames uploads once, by the renderer\'s count', () => {
  it('AC5 60 presented frames of the moving picture on its Vello GPU layer: one upload in all', (ctx) => {
    onlyOnMacos(ctx, 'frames');
    const run = moving(bin(), dir, asset);
    expect(uploadFailure(run.vsyncs), 'Vello GPU uploads over the 60 frames').toBeNull();
  }, 900_000);

  it('AC5 planted uploads_per_frame uploads 60 times and fails the check', (ctx) => {
    onlyOnMacos(ctx, 'frames');
    const run = moving(bin(), dir, asset, 'uploads_per_frame');
    expect(uploadFailure(run.vsyncs), 'the check fails on an upload per frame').not.toBeNull();
    expect(total(run.vsyncs, 'uploads'), 'one upload at each of the 60 frames').toBe(MOVING_VSYNCS);
  }, 900_000);
});
