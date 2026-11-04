// A review job whose own output names no model counts neither way: the runner records the model as unknown, the
// review check leaves the run uncounted naming "model unknown", and the claim is never PASS on it.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../../159/helpers.ts';
import { AT, changeSession, claimVerdict, review, reviewJob, shown, world } from './helpers.ts';

afterAll(cleanup, 30_000);

describe('#87 a review whose output names no model is uncounted, "model unknown"', () => {
  it('a review job whose output names no model is an uncounted run naming "model unknown", and the claim is never PASS on it', async () => {
    const { reviewJobRun } = await review();
    const change = await changeSession('claude-opus-4-1');
    const w = await world();
    try {
      const job = await reviewJob(w, 'nameless');
      expect(job.model, 'the runner\'s record of a job whose output names no model').toBe('unknown');
      const r = reviewJobRun(job, change, AT);
      expect(r.independence, JSON.stringify(r)).toMatchObject({ answered: 'unknown', counted: false, reason: 'model unknown', note: null });
      expect(r.run.outcome).toBe('uncounted');
      const v = claimVerdict(r.run);
      expect(v.outcome, shown(v)).not.toBe('PASS');
    } finally {
      await w.close();
    }
  }, 300_000);
});
