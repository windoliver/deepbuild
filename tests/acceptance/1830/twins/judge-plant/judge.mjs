// The planted judge for #1830 AC2's runs on a reference Mac: scripts/benchmark.mjs as it is, with judgeLimit wrapped.
// Each call is appended to the file JUDGE_PLANT_LOG names, with the runs judged and what the real judgeLimit returned.
// With JUDGE_PLANT_OVER=1 each run is first moved over its limit by more than any margin (a program slower by twice
// the limit plus the runs' spread), so a right suite reads FAIL. The machine and the loads the suite gives pass through
// untouched. vitest.config.mjs and register.mjs put this module in place of scripts/benchmark.mjs.
import { appendFileSync } from 'node:fs';
import { judgeLimit as judge } from '../../../../../scripts/benchmark.mjs';

export * from '../../../../../scripts/benchmark.mjs';

export function judgeLimit(input) {
  const given = input?.runs;
  const over = process.env.JUDGE_PLANT_OVER === '1' && Array.isArray(given) && given.length > 0 && given.every(Number.isFinite);
  const runs = over ? given.map((run) => run + 2 * input.limit + (Math.max(...given) - Math.min(...given))) : given;
  const result = judge({ ...input, runs });
  if (process.env.JUDGE_PLANT_LOG) appendFileSync(process.env.JUDGE_PLANT_LOG, `${JSON.stringify({ input, runs, result })}\n`);
  return result;
}
