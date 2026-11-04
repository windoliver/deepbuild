// AC "A planted reviewer that returns one finding on every diff sends back the clean twin of the planted-bug diff and
// fails this test. A requirement whose only oracle is a model is INCONCLUSIVE with one ask, never PASS."
// The review with a reviewer that reads the diff by rule sends the planted bug back and nothing on its clean twin. The
// planted reviewer, a test-side twin that flags the first added line of every diff, sends the clean twin back, so the
// clean-twin assertion here is the one it fails. On the clean twin, where the review sends nothing back, the claim's
// requirement resting on the model alone is INCONCLUSIVE with exactly one ask, naming it, and never PASS.
import { describe, expect, it } from 'vitest';
import { flagsEveryDiff, judge, ordersChange, REQUIREMENT, reviewSpec, ruleReviewer, runReview, shown } from './helpers.ts';

describe('AC the clean twin of the planted-bug diff is not sent back, and a requirement resting on a model alone is INCONCLUSIVE with one ask', () => {
  it('the planted bug is sent back and its clean twin is not; the planted reviewer sends the twin back', async () => {
    const bug = ordersChange('bug');
    const twin = ordersChange('twin');

    const onBug = await runReview(ruleReviewer().reviewer, reviewSpec(bug.sha.base!, bug.sha.A!), bug.checkout);
    expect(onBug.sendBack, `the planted bug: ${shown(onBug)}`).not.toBeNull();

    const onTwin = await runReview(ruleReviewer().reviewer, reviewSpec(twin.sha.base!, twin.sha.A!), twin.checkout);
    expect(onTwin.sendBack, `the clean twin: ${shown(onTwin)}`).toBeNull();
    expect(onTwin.outcome, shown(onTwin)).not.toBe('failed');

    // The wrong program: a reviewer that returns one finding on every diff. The clean-twin assertion above fails on it.
    const planted = await runReview(flagsEveryDiff().reviewer, reviewSpec(twin.sha.base!, twin.sha.A!), twin.checkout);
    expect(planted.sendBack, `the planted reviewer on the clean twin: ${shown(planted)}`).not.toBeNull();
  }, 60_000);

  it('a requirement whose only oracle is the review, a model, is INCONCLUSIVE with one ask naming it, never PASS', async () => {
    const twin = ordersChange('twin');
    const onTwin = await runReview(ruleReviewer().reviewer, reviewSpec(twin.sha.base!, twin.sha.A!), twin.checkout);
    const v = judge(onTwin, twin.sha.A!);
    expect(v.outcome, `${shown(onTwin)}; reasons: ${v.reasons.join(' | ')}`).toBe('INCONCLUSIVE');
    expect(v.asks.length, `asks: ${JSON.stringify(v.asks)}`).toBe(1);
    expect(v.asks[0]!.req, `asks: ${JSON.stringify(v.asks)}`).toBe(REQUIREMENT);
  }, 60_000);
});
