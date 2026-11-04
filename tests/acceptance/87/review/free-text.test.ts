// AC "A finding without a file, line, rule and quoted text is dropped, and the reviewer's free text never reaches the
// working agent". On the planted-bug change, the reviewer answers one complete finding wrapped in prose (a title, a
// body carrying an instruction, an overall explanation) and four findings each missing one of the four fields. The
// four are dropped and counted; the complete one comes back as the one item. What reaches the working agent (the
// send-back, the run's failures, the open items, the follow-ups and the verdict line) holds none of the prose.
import { describe, expect, it } from 'vitest';
import { BUG_LINE, items, ORDERS, ordersChange, PROSE, recorded, reviewSpec, runReview, shown } from './helpers.ts';

const complete = { file: ORDERS, line: BUG_LINE, rule: 'unchecked-parse', quote: 'JSON.parse(body)' };
const without = (field: keyof typeof complete): Record<string, unknown> => {
  const f: Record<string, unknown> = { title: '[P2] Same parse, cited again', body: PROSE.body, ...complete };
  delete f[field];
  return f;
};

describe("AC a finding without a file, line, rule and quoted text is dropped, and the reviewer's free text never reaches the working agent", () => {
  it('four findings each missing one field are dropped and counted; the complete one is sent back with none of the prose', async () => {
    const h = ordersChange('bug');
    const answer = {
      findings: [
        { title: PROSE.title, body: PROSE.body, priority: 1, confidence_score: 0.82, ...complete },
        without('file'), without('line'), without('rule'), without('quote'),
      ],
      overall_correctness: 'patch is incorrect', overall_explanation: PROSE.overall, overall_confidence_score: 0.8,
    };
    const result = await runReview(recorded(answer).reviewer, reviewSpec(h.sha.base!, h.sha.A!), h.checkout);

    expect(items(result.sendBack?.items), shown(result)).toEqual([{ rule: 'unchecked-parse', sites: [[ORDERS, BUG_LINE, 'JSON.parse(body)']] }]);
    expect(result.dropped.length, `the four incomplete findings are dropped and counted: ${shown(result)}`).toBe(4);

    const toAgent = JSON.stringify({ sendBack: result.sendBack, failures: result.failures, open: result.open, followUps: result.followUps, line: result.verdictLine });
    for (const prose of [PROSE.title, PROSE.body, PROSE.overall, '[P2] Same parse, cited again']) {
      expect(toAgent.includes(prose), `the reviewer's prose "${prose}" reaches the working agent: ${toAgent}`).toBe(false);
    }
  }, 60_000);
});
