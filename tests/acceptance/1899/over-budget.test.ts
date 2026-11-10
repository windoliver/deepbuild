// #1899.f1c79d5d: a frame over budget fails with its timing.
//
// A showpiece's frame-budget run on the stub meter (`test-meter` build, wgpu's noop backend, the virtual clock),
// under a reference Mac's environment: every frame's passes cover 14 ms of GPU against the class's 10 ms, so all
// five runs are over by more than the 5% margin and the check fails, its GPU limit carrying each run's p95. Its
// twin, the same run at 3 ms a frame, passes, so the failure is the timing's.
import { describe, expect, it } from 'vitest';
import { REFERENCE, RUNS, SHOWPIECE_GPU_MS, budgetCall, budgetOf, p95s, run, showpiece, useBuild, useOut } from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1899.f1c79d5d';
/** 300 frames a run, the design's floor for a frame-time p95. */
const SECONDS = 5;

describe(`${ID} a frame over budget fails with its timing`, () => {
  it(`${ID} a showpiece whose frames take 14 ms of GPU fails against its 10 ms, each of the five runs' p95 attached; at 3 ms the same run passes`, () => {
    const doc = showpiece(out());
    const call = (gpu_ms: number) => budgetCall({ doc, seconds: SECONDS, stub_meter: { frames: [{ from: 0, gpu_ms }] }, stub_environment: REFERENCE });
    const [over, within] = run(bin(), out(), [call(14), call(3)]).map((r, i) => budgetOf(r, i === 0 ? 'the 14 ms run' : 'the 3 ms run'));

    expect(over!.verdict, 'the 14 ms run fails').toBe('FAIL');
    expect(over!.gpu.verdict, 'on its GPU limit').toBe('FAIL');
    expect(over!.gpu.limit_ms, 'the showpiece class\'s GPU limit').toBe(SHOWPIECE_GPU_MS);
    const timing = p95s(over!.gpu, 'the 14 ms run');
    expect(timing.length).toBe(RUNS);
    for (const [i, p] of timing.entries()) expect(p, `run ${i + 1}'s p95 is its timing, 14 ms`).toBeCloseTo(14, 3);
    expect(over!.gpu.margin, 'five equal runs: the margin is 5%').toBeCloseTo(0.05, 9);
    expect(over!.gpu.runs.every((r) => r.invalid.length === 0), 'no frame is invalid').toBe(true);

    expect(within!.verdict, 'the 3 ms twin passes').toBe('PASS');
    for (const [i, p] of p95s(within!.gpu, 'the 3 ms run').entries()) expect(p, `run ${i + 1}'s p95`).toBeCloseTo(3, 3);
  }, 1_800_000);
});
