// #1899.3bcb7572: a frame-budget run of a showpiece whose passes take 14 ms of GPU at p95 FAILs with the ladder
// free to act, the meter's rung log showing the base rung on every frame; a planted run that lets the ladder step
// to 30 Hz reports p95 under 10 ms and fails this criterion, naming the rung.
//
// The stub meter (`test-meter` build, wgpu's noop backend, the virtual clock) under a reference Mac's environment:
// every frame's passes cover 14 ms at any rung but 30 Hz, where they cover 7 ms. Nothing turns the ladder off:
// the run's frames over budget are what a live view's ladder steps on (30 frames a rung), and 150 warm-up frames
// give it room to reach 30 Hz before the first timed frame. The planted run is `--planted ladder_acts_in_budget_run`.
import { describe, expect, it } from 'vitest';
import { FPS, REFERENCE, RUNS, budgetCall, budgetOf, p95s, run, rungProblems, showpiece, useBuild, useOut, type Budget, type Planted } from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1899.3bcb7572';
const SECONDS = 5;
const PER_RUN = SECONDS * FPS;
const WARMUP = 150;

function slow(planted?: Planted): Budget {
  const doc = showpiece(out());
  const [reply] = run(bin(), out(), [budgetCall({
    doc, seconds: SECONDS, warmup: WARMUP, report: ['frames'], stub_environment: REFERENCE,
    stub_meter: { frames: [{ from: 0, gpu_ms: 14, by_rung: { '30hz': 7 } }] },
  })], planted);
  return budgetOf(reply!, planted ? `the 14 ms showpiece, planted ${planted}` : 'the 14 ms showpiece');
}

describe(`${ID} the ladder held at its base rung`, () => {
  it(`${ID} a showpiece whose passes take 14 ms of GPU at p95 FAILs, the rung log showing base on every frame, warm-up included`, () => {
    const b = slow();
    expect(b.verdict, 'the check fails').toBe('FAIL');
    expect(b.gpu.verdict, 'on its GPU limit').toBe('FAIL');
    for (const [i, p] of p95s(b.gpu, 'the 14 ms showpiece').entries()) expect(p, `run ${i + 1}'s p95`).toBeCloseTo(14, 3);
    expect(b.frames, 'the rung log (report: ["frames"])').not.toBeNull();
    expect(b.frames!.length, 'a row per frame: the warm-up and five runs').toBe(WARMUP + RUNS * PER_RUN);
    expect(rungProblems(b.frames!, WARMUP, PER_RUN), 'every frame at the base rung').toEqual([]);
  }, 1_800_000);

  it(`${ID} a planted run that lets the ladder step to 30 Hz reports p95 under 10 ms and fails this criterion, naming the rung`, () => {
    const b = slow('ladder_acts_in_budget_run');
    for (const [i, p] of p95s(b.gpu, 'the planted run').entries()) expect(p, `the planted run's run ${i + 1} reports p95 under 10 ms`).toBeLessThan(10);
    expect(b.frames, 'the rung log (report: ["frames"])').not.toBeNull();
    const problems = rungProblems(b.frames!, WARMUP, PER_RUN);
    expect(problems.length, 'it fails the criterion').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the rung').toMatch(/\b30hz\b/);
  }, 1_800_000);
});
