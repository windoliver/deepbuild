// #305.66cabd55: on the reference Mac in the local preflight, registration and the seal take under
// 50 ms at startup, and nothing runs per frame. The seal's own time comes from the `registry`
// reply's `seal: {ms, runs}`, measured by the binary around registration and the seal at startup;
// five fresh processes after a warm-up, judged by the design's rule for timing results (PASS when
// all are within the limit, FAIL when all are over it by more than the margin, else INCONCLUSIVE).
// Off a reference Mac, on battery, with Low Power Mode on or unknown, or with a thermal warning the
// test skips with an INCONCLUSIVE message; it never passes by skipping. The merge-base comparison
// belongs to the perf lane (README: Criteria to tests, #305.66cabd55).
import { describe, expect, it } from 'vitest';
import { CORE_ONLY, SEAL_BUDGET_MS, environmentProblem, judge, registry, run, scenario, sealed, show, useBuilds, useEvidence, type Build, type JsonObject } from './helpers.ts';

/** A set with work in it: the full build plus both test canvas modules. */
const FULL_AB: Build = { set: 'full', with: ['test-a', 'test-b'] };
const builds = useBuilds([FULL_AB]);
const evidence = useEvidence();
const problem = environmentProblem();

describe('#305.66cabd55 budgets on the reference Mac: registration and the seal under 50 ms at startup, and nothing per frame', () => {
  it(`#305.66cabd55 registration and the seal take under ${SEAL_BUDGET_MS} ms at startup (five fresh processes after a warm-up)`, (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const bin = builds.bin(FULL_AB);
    const warm = sealed(bin, evidence());
    // Measured only what was sealed: a seal that registers nothing is fast and wrong.
    expect(warm.modules, 'the timed seal registered the test canvas modules').toEqual(expect.arrayContaining(['test.a', 'test.b']));
    expect(warm.seal.runs, 'registration and the seal ran once at startup').toBe(1);
    console.log(`warm-up seal ${warm.seal.ms.toFixed(2)} ms (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(sealed(bin, evidence()).seal.ms);
    judge(ctx, '#305.66cabd55 registration + seal at startup (ms)', runs, SEAL_BUDGET_MS);
  }, 600_000);

  it('#305.66cabd55 nothing runs per frame: after six frames at six times the seal has still run once, with the same time', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const frames = ['0s', '1s', '2s', '3s', '4s', '5s'].map((t) => show(CORE_ONLY, { pixels: true, t }));
    const { replies } = run(builds.bin(FULL_AB), scenario(evidence(), [{ call: 'registry' }, ...frames, { call: 'registry' }]));
    const before = registry(replies[0]!);
    const after = registry(replies[replies.length - 1]!);
    for (const [i, reply] of replies.slice(1, -1).entries()) expect((reply as JsonObject)['outcome'], `frame ${i} is presented`).toBe('presented');
    expect(after.seal.runs, 'registration and the seal ran once, before the first document, and never per frame').toBe(1);
    expect(after.seal.ms, 'the seal\'s time is the startup\'s, unchanged by frames').toBe(before.seal.ms);
    expect(after.set_digest).toBe(before.set_digest);
  }, 600_000);
});
