// #1899.40e3ec20: a stub timer whose p95 is drawn around 9.9 ms ± 0.2 against a 10 ms limit gives no FAIL over
// 1,000 seeds, only PASS or INCONCLUSIVE with the five runs attached, while stubs at 8 ms and 12 ms give PASS and
// FAIL every time; and a frame budget run under another machine's environment fingerprint, or on battery, is
// INCONCLUSIVE, never PASS or FAIL.
//
// `test-meter` build, wgpu's noop backend. The stub timer draws each of a seed's five runs' p95 uniformly within
// ± 0.2 ms of its centre; one process call takes all 1,000 seeds per centre. Each seed's verdict is also judged
// here against the design's rule on its own five attached runs. The environment half renders the showpiece on the
// stub meter at 3 ms and 14 ms (a PASS and a FAIL under the reference Mac: over-budget.test.ts) under another
// machine's fingerprint and under the reference Mac's on battery.
import { describe, expect, it } from 'vitest';
import {
  ON_BATTERY, OTHER_MACHINE, REFERENCE, RUNS, SHOWPIECE_GPU_MS, budgetCall, fiveRunRule, budgetOf, p95s, range, run, seedsOf, showpiece, useBuild, useOut,
  type Budget, type Fingerprint,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1899.40e3ec20';
const SEEDS = range(1, 1000);
const SPREAD = 0.2;
const SECONDS = 5;

/** Every seed's result: the five runs attached, each p95 within the stub's band, and the verdict the design's rule gives them. */
function seedProblems(results: Budget[], centre: number): string[] {
  const out: string[] = [];
  for (const [i, b] of results.entries()) {
    const seed = SEEDS[i]!;
    const at = `seed ${seed} at ${centre} ms`;
    if (b.gpu.runs.length !== RUNS || b.gpu.runs.some((r) => r.p95_ms === null)) { out.push(`${at}: the five runs aren't attached (${JSON.stringify(b.gpu.runs)})`); continue; }
    const runs = b.gpu.runs.map((r) => r.p95_ms!);
    const off = runs.find((p) => p < centre - SPREAD - 1e-9 || p > centre + SPREAD + 1e-9);
    if (off !== undefined) out.push(`${at}: a run's p95 ${off} is outside ${centre} ± ${SPREAD}`);
    const rule = fiveRunRule(runs, SHOWPIECE_GPU_MS);
    if (b.gpu.verdict !== rule.verdict || b.verdict !== rule.verdict) out.push(`${at}: ${b.verdict} (GPU ${b.gpu.verdict}) on runs ${runs.join(', ')}, where the five-run rule gives ${rule.verdict}`);
    if (b.gpu.margin === null || Math.abs(b.gpu.margin - rule.margin) > 1e-9) out.push(`${at}: margin ${b.gpu.margin}, not the larger of 5% and the runs' spread (${rule.margin})`);
  }
  return out;
}

describe(`${ID} five runs a verdict`, () => {
  it(`${ID} drawn around 9.9 ms ± 0.2 against 10 ms: no FAIL over 1,000 seeds, only PASS or INCONCLUSIVE with the five runs attached; at 8 ms and 12 ms PASS and FAIL every time`, () => {
    const doc = showpiece(out());
    const centres = [9.9, 8, 12];
    const replies = run(bin(), out(), centres.map((p95_ms) => budgetCall({
      doc, seconds: SECONDS, stub_environment: REFERENCE, stub_timer: { p95_ms, spread_ms: SPREAD, seeds: SEEDS },
    })));
    const [near, low, high] = replies.map((r, i) => seedsOf(r, SEEDS, `the stub timer at ${centres[i]} ms`)) as [Budget[], Budget[], Budget[]];

    const fails = near.flatMap((b, i) => (b.verdict === 'FAIL' ? [SEEDS[i]] : []));
    expect(fails, 'no seed FAILs at 9.9 ± 0.2 ms').toEqual([]);
    expect([...new Set(near.map((b) => b.verdict))].filter((v) => v !== 'PASS' && v !== 'INCONCLUSIVE'), 'only PASS or INCONCLUSIVE').toEqual([]);
    expect(seedProblems(near, 9.9), 'each seed\'s five runs attached and judged by the design\'s rule').toEqual([]);
    const drawn = near.flatMap((b) => p95s(b.gpu, 'a seed at 9.9 ms'));
    expect(Math.min(...drawn), 'the draws reach below 9.8 ms').toBeLessThan(9.8);
    expect(Math.max(...drawn), 'and above 10 ms, the limit').toBeGreaterThan(10);

    expect(low.flatMap((b, i) => (b.verdict === 'PASS' ? [] : [`seed ${SEEDS[i]}: ${b.verdict}`])), 'at 8 ms every seed PASSes').toEqual([]);
    expect(seedProblems(low, 8), 'at 8 ms').toEqual([]);
    expect(high.flatMap((b, i) => (b.verdict === 'FAIL' ? [] : [`seed ${SEEDS[i]}: ${b.verdict}`])), 'at 12 ms every seed FAILs').toEqual([]);
    expect(seedProblems(high, 12), 'at 12 ms').toEqual([]);
  }, 1_800_000);

  it.each([
    ['another machine\'s environment fingerprint (Mac14,6)', OTHER_MACHINE],
    ['the reference Mac\'s on battery', ON_BATTERY],
  ] as [string, Fingerprint][])(`${ID} a frame budget run under %s is INCONCLUSIVE with the five runs attached, never PASS or FAIL`, (_name, environment) => {
    const doc = showpiece(out());
    const timings = [3, 14];
    const replies = run(bin(), out(), timings.map((gpu_ms) => budgetCall({
      doc, seconds: SECONDS, stub_environment: environment, stub_meter: { frames: [{ from: 0, gpu_ms }] },
    })));
    replies.forEach((reply, i) => {
      const what = `${timings[i]} ms a frame under ${environment.model} on ${environment.power}`;
      const b = budgetOf(reply, what);
      expect(b.gpu.verdict, `${what}: the GPU limit`).toBe('INCONCLUSIVE');
      expect(b.verdict, `${what}: the check`).toBe('INCONCLUSIVE');
      for (const [k, p] of p95s(b.gpu, what).entries()) expect(p, `${what}: run ${k + 1}'s p95 attached`).toBeCloseTo(timings[i]!, 3);
    });
  }, 1_800_000);
});
