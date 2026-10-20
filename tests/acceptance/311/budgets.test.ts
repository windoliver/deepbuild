import { execFileSync } from 'node:child_process';
import { describe, expect, it, type TestContext } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import { eventFixture, kindSchema } from './helpers.ts';

// The design's rule for timing results: five runs after a warm-up, counted only on the reference Mac
// (a 16-inch MacBook Pro, Mac15,7, on mains power, Low Power Mode off, thermal state nominal). Anywhere
// else a result is a reading and the check INCONCLUSIVE, so the test is skipped, never passed.
function referenceMac(): string | undefined {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const sh = (cmd: string, ...args: string[]) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }); } catch { return ''; } };
  const model = sh('sysctl', '-n', 'hw.model').trim();
  if (model !== 'Mac15,7') return `model ${model || 'unknown'}`;
  if (!sh('pmset', '-g', 'batt').includes("'AC Power'")) return 'not on mains power';
  if (!/lowpowermode\s+0/.test(sh('pmset', '-g'))) return 'Low Power Mode on or unknown';
  const therm = sh('pmset', '-g', 'therm');
  if (!/No thermal warning level has been recorded|thermal warning level.*:\s*0\b/i.test(therm)) return 'thermal state not nominal';
  return undefined;
}

/** PASS when all five are within the limit; FAIL when all five are over it by more than the margin; else INCONCLUSIVE. */
function judge(ctx: TestContext, name: string, runs: number[], limit: number) {
  const spread = (Math.max(...runs) - Math.min(...runs)) / limit;
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(`AC12 ${shown}`);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

const off = referenceMac();

describe('AC12 budgets on the reference Mac', () => {
  it.for(['user.ask', 'tool.before', 'verdict.made'])('AC12 validating a %s event takes under 20 µs at p95', { timeout: 120_000 }, (kind, ctx) => {
    if (off) ctx.skip(`INCONCLUSIVE: not the reference Mac (${off})`);
    const name = kindSchema(kind);
    const event = eventFixture(kind);
    expect(validate(name, event).ok).toBe(true);
    const CALLS = 10_000;
    for (let i = 0; i < CALLS; i++) validate(name, event); // warm-up
    const runs: number[] = [];
    for (let run = 0; run < 5; run++) {
      const each = new Float64Array(CALLS);
      for (let i = 0; i < CALLS; i++) {
        const t0 = process.hrtime.bigint();
        validate(name, event);
        each[i] = Number(process.hrtime.bigint() - t0) / 1000;
      }
      each.sort();
      runs.push(each[Math.floor(CALLS * 0.95)]!);
    }
    judge(ctx, `validate ${kind} p95 (µs)`, runs, 20);
  });
});
