// The Proof line's "one requirement the drafter turned into an early question": the drafting job's proposals, one per
// requirement, become checks only where a registered kind serves the kind proposed; a requirement no kind can check
// becomes an early question, quoting it, instead of a guess. Here R5's money check comes with bills (#106), so no
// R2 kind serves it.
import { describe, expect, it } from 'vitest';
import type { CheckSpec } from '../../../packages/conformance/src/index.ts';
import { KINDS, piece, work } from './helpers.ts';

const TEXT: Record<string, string> = {
  service: 'The order endpoint answers its users within 100 ms',
  data: 'East orders total 150 and west orders 90',
  document: 'Every figure in the sales report matches its source',
  message: 'The customer received and opened the shipping mail',
};
const MONEY = 'The October invoice total reconciles with the bank statement';

describe('Proof: a requirement no kind can check becomes an early question', () => {
  it('Proof drafting: R1-R4 get checks of their kinds; R5, a money check no registered kind serves, becomes one early question quoting it', async () => {
    const w = await work();
    const kinds = KINDS.map((k) => w.workFill(k));
    const pieces = await Promise.all(KINDS.map((k) => piece(k, 'fix')));
    const money: CheckSpec = { kind: 'money', runner: 'statement', inputs: ['bills/october.csv'], depth: 'unit', oracle: 'code', contract: null };
    const draft = w.draftChecks([
      ...pieces.map((p, i) => ({ req: `R${i + 1}`, text: TEXT[p.kind]!, check: p.spec as CheckSpec })),
      { req: 'R5', text: MONEY, check: money },
    ], kinds);

    expect(draft.checks.map((c) => [c.req, c.spec.kind])).toEqual(KINDS.map((k, i) => [`R${i + 1}`, k]));
    expect(draft.questions.map((q) => q.req), `questions: ${JSON.stringify(draft.questions)}`).toEqual(['R5']);
    expect(draft.questions[0]!.question).toContain(MONEY);
  }, 60_000);
});
