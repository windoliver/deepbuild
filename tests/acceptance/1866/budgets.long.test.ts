// #1866 AC1, AC5 and AC6, the budgets: the benchmark's default run, 5,000 cycles after warm-up, on a reference Mac in a fit
// state, with the merge base's reading beside it, driven through the same cycles; and the same with `--killed`. Anywhere
// else it is a reading, skipped as INCONCLUSIVE, never passed. Long: run by hand (README, What the lanes need). AC1 and AC5
// judge one run, whose cycles hold both criteria's parts.
import { execFileSync } from 'node:child_process';
import { afterAll, describe, it, type TestContext } from 'vitest';
import { AC1, AC5, AC6, bench, CLAIM_PARTS, cleanup, cyclesOf, ENDED, environmentProblem, expectParts, KILLED, MINUTE, REPO, SESSION_PARTS, underBudget, WARMUP, type Ran } from './helpers.ts';

afterAll(cleanup, MINUTE);

const LONG = 16 * 60 * MINUTE;
const TOTAL = WARMUP + 5000;
const mergeBase = (): string => execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
let run: Promise<Ran> | undefined;
const ended = (): Promise<Ran> => (run ??= bench({ args: ['--merge-base'], timeoutMs: LONG }));
async function fit(ctx: TestContext): Promise<void> {
  const problem = await environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
}

describe(`${AC1} Over 5,000 churn cycles after warm-up that each make one claim judged to PASS and one deep_show, the hub's retained heap grows under 1 MB compared with the merge base, on the reference Mac, and the reading names the growth per 1,000 cycles`, () => {
  it(`${AC1} the default run: 5,000 cycles, each a claim judged to PASS and one deep_show, heap growth under 1 MB, the growth per 1,000 cycles named beside the merge base's`, async (ctx) => {
    await fit(ctx);
    const r = await ended();
    underBudget(r, mergeBase());
    expectParts(await cyclesOf(r), TOTAL, CLAIM_PARTS, ENDED);
  }, LONG + 10 * MINUTE);
});

describe(`${AC5} Over the same 5,000 cycles, each also starting a Claude Code session whose stop carries usage, raising one permission prompt and one held plug-in action that are answered, recording one commit and ending the session, the hub's retained heap still grows under 1 MB. A planted hub that keeps one usage tail per ended session, and one that keeps every prompt's ask, each fail the benchmark, naming the growth: the budget`, () => {
  it(`${AC5} the same run: every cycle has the session's parts too, and the heap still grows under 1 MB`, async (ctx) => {
    await fit(ctx);
    const r = await ended();
    underBudget(r, mergeBase());
    expectParts(await cyclesOf(r), TOTAL, SESSION_PARTS, ENDED);
  }, LONG + 10 * MINUTE);
});

describe(`${AC6} The same cycles with each session's agent process killed and no SessionEnd sent grow the retained heap under 1 MB. A planted hub that keeps a gone session's routes fails the benchmark, naming the growth: the budget`, () => {
  it(`${AC6} 5,000 cycles with --killed: every session's process gone and no SessionEnd, heap growth under 1 MB`, async (ctx) => {
    await fit(ctx);
    const r = await bench({ args: ['--merge-base', '--killed'], timeoutMs: LONG });
    underBudget(r, mergeBase());
    expectParts(await cyclesOf(r), TOTAL, CLAIM_PARTS, SESSION_PARTS, KILLED);
  }, LONG + 10 * MINUTE);
});
