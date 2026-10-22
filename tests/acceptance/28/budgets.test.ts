// #28 AC22: a verdict from 1,000 runs is computed in under 10 ms, on the reference Mac.
// Judged by the design's rule for timing results: five runs after a warm-up; PASS when all are within the limit,
// FAIL when all are over it by more than the margin (the larger of 5% and the runs' spread), otherwise
// INCONCLUSIVE. Off a reference Mac (Mac15,7 or Mac15,12), on battery, with Low Power Mode on or unknown, or with
// a thermal warning, the result is a reading only and the test skips; it never passes by skipping. The merge
// base has no verdict engine, so the comparison with it has nothing to compare (README: Open points).
import { execFileSync } from 'node:child_process';
import { describe, expect, it, type TestContext } from 'vitest';
import { verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, Run } from '../../../packages/verdicts/src/index.ts';
import { check, claim, COMMIT, commitOf, failure, reqId, requirement, run } from './helpers.ts';

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

/** A claim with 20 checks and 1,000 runs among them: carried runs, key mismatches, flaky and failing checks. */
function bigClaim() {
  const C = commitOf('budget-C');
  const checks: ClaimCheck[] = [];
  const runs: Run[] = [];
  for (let i = 0; i < 20; i++) {
    const c = check(`check${i}`, { covers: [reqId(1 + (i % 5))], inputs: [i % 2 ? 'src/**' : 'docs/**'], accept: '10%' });
    checks.push(c);
    for (let k = 0; k < 50; k++) {
      const outcome = i === 3 && k === 7 ? 'failed' : i === 5 && k < 3 ? 'failed' : 'passed';
      runs.push(run(c, k % 3 ? COMMIT : C, outcome, outcome === 'failed' ? { failures: [failure(`t${i}.test.ts › holds`)], reads: ['src/a.ts'] } : { reads: ['src/a.ts'] }));
    }
  }
  return claim({ requirements: [1, 2, 3, 4, 5].map((n) => requirement(n)), checks, runs, changes: [{ from: C, paths: ['docs/guide.md'] }] });
}

describe('AC22 budgets on the reference Mac', () => {
  it('AC22 a verdict from 1,000 runs is computed in under 10 ms', (ctx) => {
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const c = bigClaim();
    expect(c.runs).toHaveLength(1000);
    for (let i = 0; i < 20; i++) verdict(c);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      const v = verdict(c);
      runs.push(performance.now() - t0);
      expect(v.checks).toHaveLength(20);
    }
    judge(ctx, 'AC22 verdict from 1,000 runs (ms)', runs, 10);
  }, 60_000);
});
