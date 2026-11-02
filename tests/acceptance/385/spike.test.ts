// Criterion 5, the spike itself: a second 2D handoff (a 2D writer layer drawn by Vello GPU on the GPU layer's device
// into a GPU surface of its own beside the GPU layer's, shown in the app's window) costs under 1 ms a frame, at the
// GPU layer's handoff size, 1936 × 1584. The design's budget rule (Numbers version 0 has to hold; Every task carries its
// own budgets): five fresh processes after a warm-up one, a p95 over every frame of a run of 600 (at least 300), PASS
// when all five are within 1 ms, FAIL when all five are over it by more than the margin (the larger of 5% and the
// spread), else INCONCLUSIVE. It counts only on a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state
// nominal) on a quiet machine; anywhere else it fails INCONCLUSIVE, never passing. The times are the binary's own
// (`spike2d`, README); the p95 is taken here. At the base there is no `spike2d` call.
import { describe, expect, it } from 'vitest';
import { DEEP_GPU, LOOK, arr, gpuReplies, inconclusive, judge, loadProblem, lockedVersions, num, obj, p95, referenceMacProblem, spikeDoc, useBuilds, useDir } from './helpers.ts';

const builds = useBuilds([DEEP_GPU]);
const dir = useDir('deep-385-spike-');
const FRAMES = 600;

function run(): number {
  const [reply] = gpuReplies(builds.bin(DEEP_GPU), dir(), [{ call: 'spike2d', doc: spikeDoc(), look: LOOK, frames: FRAMES }]);
  expect(obj(reply!['renderer'], 'spike2d: renderer'), 'the spike measures Vello GPU at the version Cargo.lock holds').toEqual({ name: 'vello_gpu', version: lockedVersions('vello_gpu')[0] });
  expect(reply!['size'], 'at 1936 × 1584').toEqual([1936, 1584]);
  const frames = arr(reply!['frames'], 'spike2d: frames').map((f, i) => num(obj(f, `frame ${i}`)['handoff_ms'], `frame ${i}: handoff_ms`));
  expect(frames.length, 'every frame of the run is reported').toBe(FRAMES);
  return p95(frames);
}

describe('C5 the spike: a second 2D handoff under 1 ms a frame, on the reference Mac', () => {
  it('C5 five runs of 600 frames of Vello GPU through its own surface: each p95 handoff within 1 ms', () => {
    const why = referenceMacProblem() ?? loadProblem();
    if (why) inconclusive(`the spike's handoff budget counts on a quiet reference Mac only (${why})`);
    run(); // warm-up
    const runs = [...Array(5).keys()].map(() => run());
    const verdict = judge(runs, 1);
    const shown = `p95 handoff per run: ${runs.map((r) => r.toFixed(3)).join(', ')} ms against 1 ms`;
    console.log(shown);
    if (verdict === 'INCONCLUSIVE') inconclusive(shown);
    expect(verdict, shown).toBe('PASS');
  }, 3_600_000);
});
