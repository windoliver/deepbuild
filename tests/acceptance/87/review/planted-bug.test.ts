// AC "A planted bug found by the review comes back as one send-back", and the Proof's planted-bug review run. The
// orders change plants an unchecked JSON.parse at src/orders.ts:8; a reviewer that reads the diff by rule finds it.
// The review run sends it back as one send-back holding one item, that rule at that site, and the core's verdict on
// the claim it alone covers is FAIL with that one send-back.
import { describe, expect, it } from 'vitest';
import { BUG_LINE, items, judge, ORDERS, ordersChange, reviewSpec, ruleReviewer, runReview, shown } from './helpers.ts';

describe('AC a planted bug found by the review comes back as one send-back', () => {
  it('the planted unchecked JSON.parse comes back as one send-back with one item at src/orders.ts:8, and the claim is FAIL with one send-back', async () => {
    const h = ordersChange('bug');
    const reviewer = ruleReviewer();
    const result = await runReview(reviewer.reviewer, reviewSpec(h.sha.base!, h.sha.A!), h.checkout);

    expect(reviewer.requests.length, 'the second model is asked once').toBe(1);
    expect(result.outcome, shown(result)).toBe('failed');
    expect(result.sendBack, shown(result)).not.toBeNull();
    expect(items(result.sendBack!.items), shown(result)).toEqual([
      { rule: 'unchecked-parse', sites: [[ORDERS, BUG_LINE, 'const order = JSON.parse(body);']] },
    ]);

    const v = judge(result, h.sha.A!);
    expect(v.outcome, v.reasons.join(' | ')).toBe('FAIL');
    expect(v.send_backs.length, JSON.stringify(v.send_backs)).toBe(1);
  }, 60_000);
});
