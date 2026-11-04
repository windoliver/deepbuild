// AC "A finding whose quote isn't in the diff at its cited line, and one whose rule isn't a line of the wiki's rubric,
// are each dropped and counted, and neither sends the claim back; a check that keeps every finding with a file, line,
// rule and quote sends the clean twin back and fails this test, naming the finding."
// On the clean twin, the reviewer answers two complete findings: one quoting `parseOrder(body)`, which the diff adds
// at line 8, cited at line 9; and one quoting line 8 exactly under `naming`, a rule the wiki's rubric doesn't hold.
import { describe, expect, it } from 'vitest';
import { ORDERS, ordersChange, recorded, reviewSpec, runReview, shown } from './helpers.ts';

const offLine = { title: '[P2] Parse result is not checked', body: 'Validate before use.', file: ORDERS, line: 9, rule: 'unchecked-parse', quote: 'parseOrder(body)' };
const offRubric = { title: '[P3] Name the variable for what it holds', body: 'Prefer `parsed`.', file: ORDERS, line: 8, rule: 'naming', quote: 'const order = parseOrder(body);' };
const named = (f: { file: string; line: number; rule: string; quote: string }): string => `${f.rule} at ${f.file}:${f.line} quoting "${f.quote}"`;

describe("AC a finding quoting text not at its cited line, and one citing a rule not in the wiki's rubric, are each dropped and counted", () => {
  it('both are dropped and counted, and the clean twin is not sent back', async () => {
    const twin = ordersChange('twin');
    const answer = { findings: [offLine, offRubric], overall_correctness: 'patch is incorrect', overall_explanation: 'Two concerns.', overall_confidence_score: 0.6 };
    const result = await runReview(recorded(answer).reviewer, reviewSpec(twin.sha.base!, twin.sha.A!), twin.checkout);

    const sent = JSON.stringify(result.sendBack?.items ?? []);
    for (const f of [offLine, offRubric]) {
      expect(sent.includes(f.quote), `${named(f)} sends the clean twin back: ${shown(result)}`).toBe(false);
      const kept = result.dropped.some((d) => d.finding.rule === f.rule && d.finding.line === f.line && d.finding.quote === f.quote);
      expect(kept, `${named(f)} is dropped and counted: ${shown(result)}`).toBe(true);
    }
    expect(result.dropped.length, shown(result)).toBe(2);
    expect(result.sendBack, shown(result)).toBeNull();
    expect(result.outcome, shown(result)).not.toBe('failed');
  }, 60_000);
});
