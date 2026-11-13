// AC2 #503.c6bbfb83: "A depth video draws as points: a 640 × 480, 30 fps depth video drawn in a showpiece by
// `mark.point {from: video {asset: its hash, near: 1, far: 5, fov: [60°, 45°]}}` at step 1 places 307,200 points, and
// at three sampled frames each point, read back by the test harness, sits within 1e-4 m of the unprojection computed
// in f64 from the decoded frame's own value d at its pixel (z = 5 − 4d, x = ((u + 0.5) ÷ 640 − 0.5) × 2z × tan 30°,
// y = (0.5 − (v + 0.5) ÷ 480) × 2z × tan 22.5°, at −z); the frame at t places the same points seeked or played, by
// hash on one machine; a 1,920 × 1,080 video at step 1, 2,073,600 points, is refused at check in a showpiece, naming
// the item, while step 2 (518,400) checks; the set's evaluated data holds its bounds from near, far and fov, x within
// ±2.887 m, y within ±2.071 m and z from −5 to −1 m, and none of its points; and a planted operator that keeps the
// frame decoded before a seek places the old frame's depths and fails, naming the frame"
//
// This file holds the points, seek against play and the plant, through `deep-gpu run`'s `view3d` with `read` (README:
// view3d). points-check.test.ts holds the check, step 2 and the evaluated bounds. The decoded frame's d is read from
// FFmpeg's decode of the same H.264 file (H.264 decoding is exact by the standard, #499's reference), a gray
// full-range video, so the frame's R′G′B′ is its Y′ at every pixel.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AC, DEPTH, LICENSE, POINTS, TIMEOUT, arr, depthDocument, depthFrame, depthsOf, failsNaming, frameAt, framesOf, grayVideo, none, obj, pointFailures,
  pointsOf, referenceFrames, requireMac, runGpu, sha256, useFileTemp, useGpu, useTemp, view3d, writeJson, type JsonObject, type Points,
} from './helpers.ts';

const gpu = useGpu();
const fileTemp = useFileTemp('depth');
const temp = useTemp();
const SIZE: [number, number] = [DEPTH.w, DEPTH.h];

let video = { path: '', sha: '' };
const depths = new Map<number, Float64Array>();
beforeAll(() => {
  if (process.platform !== 'darwin') return;
  const dir = fileTemp();
  const path = join(dir, 'depth.mp4');
  grayVideo(path, SIZE, DEPTH.count, (k) => depthFrame(k));
  video = { path, sha: sha256(readFileSync(path)) };
  const refs = referenceFrames(path, DEPTH.w, DEPTH.h, DEPTH.count);
  for (const k of [10, 45, 80]) depths.set(k, depthsOf(refs[k]!, DEPTH.w, DEPTH.h, `frame ${k}`));
}, TIMEOUT);

/** The showpiece drawn by `view3d` (README: view3d) and each captured frame's read-back points. */
function draw(out: string, call: JsonObject & { capture: number[] }, what: string, planted?: 'point_video_keeps_frame_before_seek'): Map<number, Points> {
  const doc = writeJson(out, 'depth', depthDocument(video.sha));
  const [reply] = runGpu(gpu(), out, [view3d({ doc, size: [320, 240], read: [POINTS], targets: ['final'], assets: { [video.sha]: video.path }, licenses: { [video.sha]: LICENSE }, ...call })], what, planted);
  const frames = framesOf(reply!, what);
  const raw = arr(reply!['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  const points = new Map<number, Points>();
  for (const k of call.capture) {
    frameAt(frames, k, what);
    points.set(k, pointsOf(out, raw.find((x) => x['frame'] === k)!, `${what}: frame ${k}`));
  }
  return points;
}

describe(`${AC[2]} a depth video drawn as points`, () => {
  it(`${AC[2]} at step 1 the showpiece places 307,200 points, and at frames 10, 45 and 80 each point read back sits within 1e-4 m of the unprojection of the decoded frame's d at its pixel`, () => {
    requireMac('the depth showpiece');
    const out = temp();
    const pts = draw(out, { from: 0, frames: 81, capture: [10, 45, 80] }, 'the depth video played from 0');
    const failures: string[] = [];
    for (const k of [10, 45, 80]) {
      const p = pts.get(k)!;
      expect(p.count, `frame ${k}: 640 × 480 points at step 1`).toBe(307_200);
      failures.push(...pointFailures(p, depths.get(k)!, SIZE, 1, k));
    }
    none(failures, 'every point at its unprojection');
    // The check fails a wrong frame: frame 45's points against frame 10's depths.
    failsNaming(pointFailures(pts.get(45)!, depths.get(10)!, SIZE, 1, 45, 10), /frame 45/, 'frame 45 judged against frame 10');
  }, TIMEOUT);

  it(`${AC[2]} the frame at t places the same points seeked or played, by hash: played from 0, opened at the frame, and seeked to it from another frame in the same session`, () => {
    requireMac('the depth showpiece');
    const played = draw(temp(), { from: 0, frames: 46, capture: [45] }, 'played from 0 to frame 45').get(45)!;
    const opened = draw(temp(), { from: 45, frames: 1, capture: [45] }, 'a session opened at frame 45').get(45)!;
    const seeked = draw(temp(), { from: 0, frames: 12, seeks: [{ after: 10, to: 45 }], capture: [45] }, 'drawn to frame 10, then seeked to 45').get(45)!;
    expect(opened.file, 'frame 45 opened by a seek places the points it places played (the read-back bytes, by SHA-256)').toBe(played.file);
    expect(seeked.file, 'frame 45 seeked to from frame 10 places the points it places played').toBe(played.file);
    none(pointFailures(played, depths.get(45)!, SIZE, 1, 45), 'frame 45 played');
  }, TIMEOUT);

  it(`${AC[2]} planted: an operator that keeps the frame decoded before a seek places the old frame's depths and fails, naming the frame`, () => {
    requireMac('the depth showpiece');
    const p = draw(temp(), { from: 0, frames: 12, seeks: [{ after: 10, to: 45 }], capture: [45] }, 'drawn to frame 10, then seeked to 45', 'point_video_keeps_frame_before_seek').get(45)!;
    none(pointFailures(p, depths.get(10)!, SIZE, 1, 45, 10), 'the planted operator places frame 10\'s depths at frame 45');
    failsNaming(pointFailures(p, depths.get(45)!, SIZE, 1, 45), /frame 45/, 'the operator that keeps the frame decoded before a seek');
  }, TIMEOUT);
});
