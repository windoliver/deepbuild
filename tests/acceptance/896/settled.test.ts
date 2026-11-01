// #896.b89e4aff: Patch to settled frame holds 4 ms at p95 over 200 one-item patches on a 10,000-item board, CPU plus
// GPU, on the reference Mac, judged by #854's `canvas-patch-settled` task (moved here from #854's first criterion); a
// planted session that reloads the whole revision on each patch fails, naming the stage that took the time.
//
// The task is #854's `node benchmarks/canvas.mjs patch-settled`, its report and judge as #854's README defines them;
// this issue adds each sample's `stages` (README: The surface under test), so a failure can name the stage that took
// the time, and the planted session `--planted reloads_revision`. The 4 ms hold is judged on a reference Mac only
// (elsewhere INCONCLUSIVE, a skip that says so); #854's patch.test.ts keeps the same hold in its last block. The wrong
// programs: the base (every stage costs in proportion to the board, and no sample carries its stages); a session that
// reloads the whole revision on each patch; stages that don't add up to the patch's time; a judge that never fails,
// or fails without naming the stage, or names a stage that didn't take the time.
import { describe, expect, it } from 'vitest';
import {
  ID, ITEMS, SETTLED, costliest, judgeOver, judgeWithin, judged, laneVerdict, p50, percentile, record, referenceMacProblem, requireMac,
  sampleProblems, settledReading, settledRuns, stageNaming, str, targetOf, type JsonObject, type Sample,
} from './helpers.ts';

let shipped: JsonObject | undefined;
let planted: JsonObject | undefined;
const shippedRuns = (): Sample[][] => settledRuns((shipped ??= record(SETTLED.mode, SETTLED.id)), SETTLED.id);
const plantedRuns = (): Sample[][] => settledRuns((planted ??= record(SETTLED.mode, SETTLED.id, SETTLED.planted)), `--planted ${SETTLED.planted}`);
const p95s = (runs: Sample[][]): number[] => runs.map((s) => percentile(s.map((x) => x.ms), 0.95));

describe(`${ID.settled} patch to settled frame holds 4 ms at p95 over 200 one-item patches on a 10,000-item board, CPU plus GPU, on the reference Mac; a planted session that reloads the whole revision on each patch fails, naming the stage that took the time`, () => {
  it(`${ID.settled} canvas-patch-settled times each one-item patch by stage (patch, session, frame, present, gpu) adding up to its CPU plus GPU, and on the reference Mac each run's p95 is within 4 ms (five runs after warm-up) and the lane's judge passes it`, (ctx) => {
    requireMac(ctx);
    const runs = shippedRuns();
    expect(runs.flatMap((s, r) => sampleProblems(s, `run ${r + 1}`)), 'every patch is timed to its own settled frame, its stages adding up to its time').toEqual([]);
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    judgeWithin(ctx, `${SETTLED.id} p95 ms`, p95s(runs), SETTLED.limit);
    const verdict = judged(shipped!);
    const target = targetOf(verdict, 'settled_p95_ms');
    expect(target.limit, 'the judge holds the task to 4 ms').toBe(SETTLED.limit);
    target.runs.forEach((v, i) => expect(v, `the judge judges run ${i + 1}'s p95`).toBeCloseTo(p95s(runs)[i]!, 3));
    laneVerdict(ctx, verdict, 'PASS');
  }, 3_600_000);

  it(`${ID.settled} a planted session that reloads the whole revision on each patch spends at least 5 times the shipped session's stage on each one-item patch, and on the reference Mac the lane fails it past 4 ms, naming for each run the stage that took the most of its slowest patch`, (ctx) => {
    requireMac(ctx);
    const runs = plantedRuns();
    expect(runs.flatMap((s, r) => sampleProblems(s, `--planted ${SETTLED.planted}: run ${r + 1}`)), 'the planted runs are recorded like the shipped ones').toEqual([]);
    const base = shippedRuns();
    const cheap = runs.flatMap((s, r) => {
      const [took, ships] = [p50(s.map((x) => x.stages.session)), p50(base[r]!.map((x) => x.stages.session))];
      return took >= 5 * ships ? [] : [`run ${r + 1}: the session stage took ${took} ms at p50, against the shipped ${ships} ms`];
    });
    expect(cheap, `the planted session takes the whole ${ITEMS}-item revision on each patch, not the one item`).toEqual([]);
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    judgeOver(ctx, `--planted ${SETTLED.planted} p95 ms`, p95s(runs), SETTLED.limit);
    const verdict = judged(planted!);
    laneVerdict(ctx, verdict, 'FAIL');
    expect(targetOf(verdict, 'settled_p95_ms').status, 'the failing target is patch to settled frame').toBe('FAIL');
    expect(stageNaming(str(verdict['reason'], 'verdict.reason'), runs), 'the failure names the stage that took the time').toEqual([]);
  }, 3_600_000);

  it(`${ID.settled} the lane's judge fails a reading past 4 ms in all five runs, naming for each run the stage that took the most of its slowest patch and no stage that didn't, and passes its twin within 4 ms`, () => {
    const within = judged(settledReading(() => ({ ms: 1 })));
    expect(within['status'], `a reading within 4 ms on a reference Mac passes: ${JSON.stringify(within).slice(0, 1500)}`).toBe('PASS');
    const tops = ['session', 'frame', 'present', 'gpu', 'session'] as const;
    const report = settledReading((run, k) => (k > 180 ? { ms: 9 + run + k / 1000, costliest: tops[run - 1]! } : { ms: 2 }));
    const verdict = judged(report);
    expect(verdict['status'], `p95 at 9 ms or more in every run fails: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('FAIL');
    expect(targetOf(verdict, 'settled_p95_ms').status, 'the failing target is patch to settled frame').toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    const runs = settledRuns(report, 'the made-up reading');
    expect(runs.map((s) => costliest(s.at(-1)!)), 'the made-up slowest patches').toEqual([...tops]);
    expect(stageNaming(reason, runs), 'the failure names each run\'s stage that took the time').toEqual([]);
    expect(reason, 'and not the patch path, which took the least of every slowest patch').not.toMatch(/\bstage\s+patch\b/);
  }, 600_000);
});
