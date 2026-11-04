// AC "Passes check.kind@1 (#13), whose planted runners, one that reports passed after its deadline and one that
// drops a crashed run's output, each fail it with their own message", for the review kind. The kit is the kind's own,
// run by the conformance package's one runner; its cases carry their reviewer's recorded answers, which its judge
// gives the fill through `review`, so the fill's own reviewer is never asked.
import { describe, expect, it } from 'vitest';
import { runKit } from '../../../../packages/conformance/src/index.ts';
import { review } from './helpers.ts';

const KIT_TEST = 300_000;
const PLANTED = ['past-deadline', 'dropped-output'] as const;
const listed = (r: { cases: { id: string; outcome: string; message: string }[] }): string =>
  r.cases.map((c) => `${c.id}: ${c.outcome} ${c.message}`).join(' | ');

describe('AC the review kind passes check.kind@1, and its two planted runners each fail it with their own message', () => {
  it('the review kind passes its kit, fixed and seeded; past-deadline and dropped-output each fail it with their own message', async () => {
    const r = await review();
    const kit = r.reviewKit();
    expect(kit.slot).toBe('check.kind@1');

    const fill = r.reviewFill(() => { throw new Error('the kit runs each case on its recorded answer, never the fill\'s own reviewer'); });
    expect(fill.kind).toBe('review');
    const report = await runKit(kit, fill);
    expect(report.cases.some((c) => c.part === 'seeded'), 'the review kit has a seeded part').toBe(true);
    expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`), `seed ${report.seed}`).toEqual([]);
    expect(report.verdict).toBe('PASS');

    const messages: string[] = [];
    for (const name of PLANTED) {
      const p = kit.planted.find((x) => x.name === name);
      expect(p, `the review kit's planted runners: ${kit.planted.map((x) => x.name).join(', ')}`).toBeDefined();
      expect(p!.fill.kind).toBe('review');
      expect(p!.message.length).toBeGreaterThan(0);
      const wrong = await runKit(kit, p!.fill, { parts: ['fixed'] });
      expect(wrong.verdict, `${name} on the review kit`).toBe('FAIL');
      expect(wrong.cases.some((c) => c.outcome === 'FAIL' && c.message.includes(p!.message)), `a FAIL carries "${p!.message}" (${listed(wrong)})`).toBe(true);
      messages.push(p!.message);
    }
    expect(new Set(messages).size, `each planted runner has its own message: ${messages.join(' / ')}`).toBe(PLANTED.length);
  }, KIT_TEST);
});
