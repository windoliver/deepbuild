// The review's second model runs through the runner, and waits when the account's window is down to your reserve;
// meanwhile the claim shows BLOCKED with the cause plan window (design: Plan usage per account and per task, "Turns
// DeepBuild causes"). The runner and its window readings are #159's; the review check turns the waiting job into
// its run, which the core's verdict reads.
import { afterAll, describe, expect, it } from 'vitest';
import { ACCOUNT, cleanup, sleep } from '../../159/helpers.ts';
import { claudeLimits } from '../../159/world.ts';
import { AT, CLAIM, changeSession, claimVerdict, review, reviewSpec, shown, world } from './helpers.ts';

afterAll(cleanup, 30_000);

describe('#87 at your reserve the review waits, and the claim shows BLOCKED: plan window', () => {
  it('with the window at your reserve, the review waits and the claim shows BLOCKED with the cause plan window', async () => {
    const { reviewJobRun } = await review();
    const change = await changeSession('claude-opus-4-1');
    const w = await world({ reservePct: 10 });
    try {
      // The account's 5-hour window at 92% used, against a 10% reserve.
      await w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: claudeLimits(92, w.clock.now() + 2 * 3_600_000) });
      const submitted = await w.runner.submit(reviewSpec('codex'));
      await sleep(1500);
      const job = await w.runner.status(submitted.job);
      expect(job.state, `the review job waits: ${JSON.stringify(job)}`).toBe('waiting');
      expect(job.pid, 'the review job started a process at your reserve').toBeUndefined();
      expect(job.blocked).toMatchObject({ status: 'BLOCKED', cause: 'plan window', owner: 'you' });

      const r = reviewJobRun(job, change, AT);
      expect(r.run.outcome, JSON.stringify(r.run)).toBe('missing');
      expect(r.run.missing).toMatchObject({ cause: 'plan window', owner: 'you' });
      expect(r.run.claim).toBe(CLAIM);
      const v = claimVerdict(r.run);
      expect(v.outcome, shown(v)).toBe('BLOCKED');
      expect(v.reasons.join(' | '), 'the verdict names its cause').toContain('plan window');
    } finally {
      await w.close();
    }
  }, 300_000);
});
