// The review half of the budgets criterion: a review check stays within its priced budget. The check declares its
// budget per run, the wall time it may take and what it may cost (KindBudget, as #68's kinds declare theirs); a
// review, from submitting its job through the runner to its run record, keeps to both, its cost the one the job's
// own output reported. "On the reference Mac in the local preflight, compared with the merge base" is the
// preflight's budget window (README, Readings): the merge base has no review check, so there is no base side.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../../159/helpers.ts';
import { AT, changeSession, review, reviewJob, world } from './helpers.ts';

afterAll(cleanup, 30_000);

describe('#87 a review check stays within its priced budget', () => {
  it('the review check declares a time and a cost budget, and a review, job and run record, keeps to both', async () => {
    const { reviewBudget, reviewJobRun } = await review();
    expect(Number.isFinite(reviewBudget?.time_ms) && reviewBudget.time_ms > 0, `the review's time budget: ${JSON.stringify(reviewBudget)}`).toBe(true);
    expect(Number.isFinite(reviewBudget?.cost_usd) && reviewBudget.cost_usd > 0, `the review's priced cost: ${JSON.stringify(reviewBudget)}`).toBe(true);

    const change = await changeSession('claude-opus-4-1');
    const w = await world();
    try {
      const started = Date.now();
      const job = await reviewJob(w, 'codex');
      const r = reviewJobRun(job, change, AT);
      const took = Date.now() - started;
      expect(r.independence?.counted, JSON.stringify(r.independence)).toBe(true);
      expect(typeof job.cost_usd, `the job's reported cost: ${JSON.stringify(job)}`).toBe('number');
      expect(job.cost_usd!, `the review cost $${job.cost_usd} against its $${reviewBudget.cost_usd} budget`).toBeLessThanOrEqual(reviewBudget.cost_usd);
      expect(took, `the review took ${took} ms against its ${reviewBudget.time_ms} ms budget`).toBeLessThanOrEqual(reviewBudget.time_ms);
    } finally {
      await w.close();
    }
  }, 300_000);
});
