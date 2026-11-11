// #484.31f1249b: "Instancers draw from counts the GPU wrote: a forest of 100,000 trees, culled on the GPU for the view
// and each of 4 cascades, draws by indexed indirect draws with no count read back; over a 10 s orbit every frame equals
// by pixel hash on one machine the frame drawn from the CPU's f64 cull of the same elements, and the GPU's kept set
// always contains the CPU's; a seek from 10 s back to 2 s draws what playing draws; the worker culls no element on the
// CPU, by its counter; and a planted cull that tests element centers instead of bounds drops a tree whose crown enters
// the frame, and a planted path that reads the count back draws the previous frame's count after the seek, each
// failing, naming the element or the frame"
//
// The forest is `helpers.ts: forest`. The orbit is sampled at 6 frames a second: frames 0 to 60, t = n ÷ 6 s, all of
// 0 to 10 s, 61 full frames at 960 × 540 (README: Readings). Three `view3d` calls in one process, so one machine:
//
//   plain     the shipped path, with `counts`, no cull report: it plays frames 0 to 60, seeks from frame 60 (10 s) to
//             frame 12 (2 s) in the same session (`seeks`) and draws that frame; its counters are the proof of no read
//             back and no CPU cull, with nothing else reading the cull's buffers
//   reported  the shipped path with `cull_report`: what the GPU kept, per view and cascade
//   cpu       `cull: 'cpu'`, the same document drawn from the CPU's f64 cull, with `cull_report`: what it kept
//
// Every frame's pixel hash in `plain` and `reported` equals `cpu`'s. In each of the five views the GPU's kept set holds
// all of the CPU's, and neither keeps every tree (a cull that keeps all would pass the rest). `plain` has one indirect
// draw per batch for the view at every frame, and for each cascade at frame 0, its `cpu_culled` and `counts_read_back`
// are 0 at every frame, and frame 0 draws 4 shadow maps; `cpu` reports `cpu_culled` of at least one full pass over the
// trees at every frame, so the two paths are two paths. The seek's frame hashes as playing's frame 12 did, and frame
// 12 keeps more trees than frame 60, which is what lets a stale count show. The crown tree's pixel names it at frame 0.
//
// `--planted gpu_cull_by_center` fails naming the crown tree and frame 0. `--planted count_read_back` fails naming
// frame 12. Each plant's run is the same call as its control's, so only the plant differs.
//
// Since #1637 the orbit test and the `gpu_cull_by_center` twin live in redraft-1637/forest.test.ts (a blind
// redraft); this file keeps the `count_read_back` twin.
import { describe, expect, it } from 'vitest';
import {
  AC, FOREST_SIZE, ORBIT, failsNaming, forest, framesOf, requireGpu, run, useGpu, useOut, view3dCall, writeJson,
  type Planted,
} from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const SIZE = FOREST_SIZE;
const TEN_S = 60;
const TWO_S = 12;
const SEEK = { after: TEN_S, to: TWO_S };

/** The hash of the frame a seek from 10 s to 2 s draws; the run opens at 10 s, so the frame before the seek is that frame. */
function afterSeek(planted?: Planted): string | null {
  const out = dir();
  const doc = writeJson(out, 'forest', forest().doc);
  const [reply] = run(bin(), out, [view3dCall({ doc, size: SIZE, fps: ORBIT.fps, from: TEN_S, frames: 2, seeks: [SEEK] })], planted);
  const f = framesOf(reply!, 'the seek');
  expect(f.map((x) => x.frame), 'the run draws frame 60, then frame 12').toEqual([TEN_S, TWO_S]);
  return f[1]!.hash;
}

describe(`${AC[1]} instancers draw from counts the GPU wrote`, () => {
  // The criterion's orbit test and its `gpu_cull_by_center` twin were swapped for their blind redraft after #1637
  // (occlusion culls the camera's kept set): redraft-1637/forest.test.ts, its REDRAFT.md says what changed.

  it(`${AC[1]} a planted path that reads the count back (--planted count_read_back) draws the previous frame's count after the seek, and fails naming the frame`, () => {
    requireGpu();
    const want = afterSeek();
    expect(want, 'the seek\'s frame has a pixel hash').toBeTruthy();
    const got = afterSeek('count_read_back');
    const problems = got === want ? [] : [`frame ${TWO_S} (2 s), after the seek from frame ${TEN_S} (10 s): it hashes ${String(got)}, the correct program's ${String(want)}`];
    failsNaming(problems, [`frame ${TWO_S}`], '--planted count_read_back');
  }, 3_600_000);
});
