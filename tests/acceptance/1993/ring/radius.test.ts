// #1993.c7c8c280: "A 128 × 128 height grid with 1 cm cells, 60 steps a second and wave speed 0.24 m/s takes one drop
// at its centre. The ring's radius is 20, 40 and 60 cells at steps 50, 100 and 150, each within one cell, and one
// step costs under 0.5 ms of GPU on the reference Mac, or the budget part reads INCONCLUSIVE. A planted step that
// only diffuses keeps its peak at the centre and fails the radius at step 50"
//
// The water (helpers.ts: waterOp) is one stepped compute operator, `water`, 60 steps a second, whose height and its
// rate of change are two carried 128 × 128 `r32float` textures (the issue's Fields: `carry` on a `texture` output),
// each read as the previous step left it (`from.texture: {op, output, step: previous}`), with `stepped.bound: {speed:
// 0.24, cell: 0.01}`. Step 0 writes the drop: height 1 at the four cells round the grid's centre, falling off as a
// Gaussian of σ 1 cell, at rest. Each later step is the explicit wave equation. Through #378's `view3d` at 60 frames
// a second, so frame k shows step k (#252's `carried` row, here a carried texture's), with #483's `read` of the
// height at frames 0, 50, 100 and 150.
//
// The radius line. A ring leaves the drop at the wave speed: 0.24 m/s × (k ÷ 60) s ÷ 0.01 m = 0.4 k cells, so 20, 40
// and 60 cells at steps 50, 100 and 150. The ring's radius is read off the height grid as the whole number of cells r
// whose annulus (the cells within half a cell of r cells from the centre) has the largest mean height: the crest.
// Each is within one cell of the issue's number.
//
// The budget part. One step's GPU time is what the frame that runs it reports for the operator (#380's `timings`:
// `passes_ms["op.water"]`), at one step a frame. A run plays steps 1 to 600 and its value is their 95th percentile
// (the design: a limit takes its p95 over a run of at least 300 frames); the design's judge takes five runs after a
// warm-up one on a reference Mac, PASS when all five are within 0.5 ms, FAIL when all five are over by more than the
// margin on a machine that isn't loaded, otherwise INCONCLUSIVE; off a reference Mac it reads INCONCLUSIVE.
//
// The planted step is a wrong document, not a wrong binary: the same operator, except that each step adds the push
// straight to the height and keeps no rate of change (helpers.ts: waterOp, onlyDiffuses), which is the heat
// equation. The drop then only spreads where it is: its highest cell stays one of the four at the centre, no ring
// leaves, and the radius line fails on it at step 50.
//
// At the base (9550dc0f) the check reads past a texture output's `carry`, a texture input's `step: previous` and
// `stepped.bound`, and a stepped operator that writes a texture doesn't run: no frame carries `water.height`.
import { describe, expect, it } from 'vitest';
import {
  AC, AT_CENTRE, DROP_HEIGHT, HEIGHT, RING, dropProblems, heights, inconclusive, judge, p95, peak, play, radiusProblems, refusal, requireGpu, requireReferenceMac, run, useBin, useOut,
  view3dCall, view3dFrames, waterDoc, waterOp, type V3Frame,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
/** The steps the height is read at: the drop, then the criterion's three. */
const READ_AT = [0, ...RING.map(([step]) => step)];
const LAST = Math.max(...READ_AT);
/** "Under 0.5 ms of GPU", over a run of 600 steps. */
const STEP_MS = 0.5;
const TIMED_STEPS = 600;

interface Played { problem: string; frames: V3Frame[]; grids: Map<number, Float32Array | string> }
/** The water played to step 150 at one frame a step, its height read at READ_AT. */
function played(name: string, onlyDiffuses: boolean): Played {
  const dir = out();
  const { problem, frames } = play(bin(), dir, name, waterOp({ onlyDiffuses }), { frames: LAST + 1, capture: READ_AT, read: [HEIGHT] });
  const grids = new Map(READ_AT.map((k) => [k, heights(dir, frames.find((f) => f.frame === k), `step ${k}`)]));
  return { problem, frames, grids };
}
/** The step each frame read shows, null where a frame carries no height. */
const stepsShown = (p: Played): (number | null)[] => READ_AT.map((k) => p.frames.find((f) => f.frame === k)?.step ?? null);
/** Step 0's problems as the drop, each a sentence. */
function dropOf(p: Played): string[] {
  const h = p.grids.get(0)!;
  return typeof h === 'string' ? [h] : dropProblems(h);
}

describe(`${AC[1]} a drop at the centre of a 128 × 128 height grid leaves as a ring at the wave speed`, () => {
  it(`${AC[1]} at 0.24 m/s the ring's radius is 20, 40 and 60 cells at steps 50, 100 and 150, each within one cell; a planted step that only diffuses keeps its peak at the centre and fails the radius at step 50`, () => {
    requireGpu();
    const water = played('water', false);
    expect(water.problem, 'the water checks and view3d draws it').toBe('');
    expect(stepsShown(water), `frames ${READ_AT.join(', ')} show the carried height (${HEIGHT}) at steps ${READ_AT.join(', ')}`).toEqual(READ_AT);
    expect(dropOf(water), 'the grid takes one drop at its centre: step 0 is the drop').toEqual([]);
    expect(radiusProblems(water.grids), 'the radius line: the ring is 20, 40 and 60 cells out at steps 50, 100 and 150, each within one cell').toEqual([]);

    // The planted step: the same operator, only diffusing.
    const planted = played('water-only-diffuses', true);
    expect(planted.problem, 'the planted water checks and view3d draws it').toBe('');
    expect(stepsShown(planted), `the planted water's frames ${READ_AT.join(', ')} show its carried height at steps ${READ_AT.join(', ')}`).toEqual(READ_AT);
    expect(dropOf(planted), 'the planted grid takes the same drop').toEqual([]);
    const peaks = RING.map(([step]) => {
      const h = planted.grids.get(step)!;
      expect(typeof h, `the planted water's height at step ${step} is read (${typeof h === 'string' ? h : 'read'})`).not.toBe('string');
      return peak(h as Float32Array);
    });
    for (const [i, p] of peaks.entries()) {
      expect(p.distance, `the planted step keeps its peak at the centre: at step ${RING[i]![0]} its highest cell is ${p.distance} cells from it`).toBeLessThan(AT_CENTRE);
    }
    expect(peaks[0]!.height, 'the planted step diffuses: at step 50 its peak is still above the still surface').toBeGreaterThan(0);
    expect(peaks[0]!.height, 'the planted step diffuses: at step 50 its peak is lower than the drop').toBeLessThan(DROP_HEIGHT);
    const failed = radiusProblems(planted.grids);
    expect(failed[0] ?? '', 'the planted step fails the radius line at step 50, naming the step and the radius').toMatch(/^at step 50 the ring's radius is \d+ cells, not within one cell of 20$/);
  }, 1_200_000);

  it(`${AC[1]} one step costs under ${STEP_MS} ms of GPU on the reference Mac (five runs of ${TIMED_STEPS} steps after a warm-up), or the budget part reads INCONCLUSIVE`, () => {
    requireReferenceMac();
    const dir = out();
    const { problem, doc } = waterDoc(bin(), dir, 'water', waterOp());
    expect(problem, 'the water checks').toBe('');
    const call = view3dCall({ doc, frames: TIMED_STEPS + 1, timings: true });
    const ran = run(bin().bin, dir, Array.from({ length: 6 }, () => call));
    expect(ran.failed, 'six timed runs of the water answered').toBe('');
    const runs = ran.replies.map((reply, n) => {
      const frames = view3dFrames(reply);
      expect(frames.length, `timed run ${n} drew ${TIMED_STEPS + 1} frames (${refusal(reply)})`).toBe(TIMED_STEPS + 1);
      const timed = frames.filter((f) => f.frame >= 1);
      expect(timed.filter((f) => f.step !== f.frame).slice(0, 5).map((f) => `frame ${f.frame} shows step ${String(f.step)}`), `timed run ${n}: each frame k ran step k of ${HEIGHT}`).toEqual([]);
      expect(timed.filter((f) => f.stepMs === null).slice(0, 5).map((f) => `frame ${f.frame}`), `timed run ${n}: each frame's passes_ms reports the step's GPU time, op.water`).toEqual([]);
      return p95(timed.map((f) => f.stepMs!));
    });
    const verdict = judge(`the 128 × 128 water at 0.24 m/s, GPU ms a step (p95 of ${TIMED_STEPS} steps)`, runs.slice(1), STEP_MS);
    if (verdict.verdict === 'INCONCLUSIVE') inconclusive(verdict.line);
    expect(verdict.verdict, verdict.line).toBe('PASS');
  }, 1_200_000);
});
