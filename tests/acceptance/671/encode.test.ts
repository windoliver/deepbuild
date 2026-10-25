// AC2: during the orbit each batch is encoded once, in the first frame, counted on the noop lane; moving one box
// encodes nothing again. Proof: a planted worker that encodes every batch each frame must fail the encode-count
// criterion, naming the batch.
// The scene and its label go through `deep show` (two test agents' processes) and the hub's current revision is
// read back (`read`, #96) and handed to the GPU layer's view (#378's `view3d`) on wgpu's noop backend
// (`deep-gpu run --backend noop`), with counts: 330 frames at 60 fps, the camera orbiting once over frames
// 0–299 and holding still from frame 300, and box-17-08 moved 0.6 m by its agent's patch before frame 310. The
// planted worker is #378's `--planted encodes_every_frame`. At the base the hub refuses the scene (its orbit
// channel's target "reaches nothing"), so nothing reaches the view.
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, MOVE_FRAME, RUN_FRAMES, SHOW_BIN, FPS, LOOK, SIZE, drawn3d, encodeProblems, everyFrame, keepProof, movePatch, runGpu, useBins, useOut,
  view3d, view3Reply, viaDeepShow, type Startup, type View3,
} from './helpers.ts';

const bins = useBins([SHOW_BIN, GPU_BIN]);
const out = useOut();

/** The checkpoint's frames on the noop lane, with counts, from the document deep show left in the hub. */
function countedRun(startup: Startup): View3 {
  const what = `the orbit on noop${startup.planted ? ` with --planted ${startup.planted}` : ''}`;
  const hub = viaDeepShow(bins.bin(SHOW_BIN), out(), what);
  const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: hub.path, look: LOOK, size: SIZE, frames: RUN_FRAMES, fps: FPS, patches: [movePatch(hub.sceneWriter)], counts: true })], startup);
  const v = view3Reply(reply!, what);
  everyFrame(v, RUN_FRAMES, what);
  expect(v.frames.filter((f) => f.pixel_hash !== null).map((f) => f.frame).slice(0, 5), `${what}: the noop backend makes no pixels`).toEqual([]);
  return v;
}

const counts = (v: View3): unknown => v.frames.map((f) => ({ frame: f.frame, encoded: (f.encoded ?? []).map((b) => ({ batch: b.batch, items: b.items.length })), replayed: f.replayed, instances_written: f.instances_written }));

describe('AC2 during the orbit each batch is encoded once, in the first frame, counted on the noop lane; moving one box encodes nothing again', () => {
  it('AC2 on the noop lane frame 0 encodes each batch once, holding every box, the ground plane and the beacon; no frame of the 5 s orbit after it, nor the move of box-17-08 or the frames after, encodes any batch again', () => {
    const v = countedRun({ backend: 'noop' });
    keepProof('ac2-encode-counts', counts(v));
    // A worker that encodes a batch again on a later frame (a camera that moves, a move that rebuilds its batch)
    // fails here, naming the frame and the batch; one that never draws a box, or ignores the move, fails too.
    expect(encodeProblems(v.frames, drawn3d(), 'the orbit on noop'), 'the encode counts').toEqual([]);
    expect(v.frames[0]!.encoded!.length, 'frame 0 encodes at least one batch').toBeGreaterThan(0);
  }, 1_800_000);

  it('AC2 a planted worker that encodes every batch each frame (--planted encodes_every_frame) fails the encode count, naming each batch', () => {
    const v = countedRun({ backend: 'noop', planted: 'encodes_every_frame' });
    const problems = encodeProblems(v.frames, drawn3d(), 'the planted worker');
    keepProof('ac2-planted-encode-counts', counts(v));
    keepProof('ac2-planted-failures', problems);
    expect(problems.length, 'the encode-count check fails on the planted worker').toBeGreaterThan(0);
    const batches = (v.frames[0]!.encoded ?? []).map((b) => b.batch);
    expect(batches.length, 'the planted worker encodes its batches in frame 0 too').toBeGreaterThan(0);
    for (const b of batches) {
      expect(problems.some((p) => p.startsWith(`the planted worker: frame 1 encodes batch ${b} again`)), `the failure names batch ${b} at frame 1`).toBe(true);
    }
    expect(problems.some((p) => p.startsWith(`the planted worker: frame ${MOVE_FRAME} encodes batch `)), `and at the move's frame, ${MOVE_FRAME}`).toBe(true);
  }, 1_800_000);
});
