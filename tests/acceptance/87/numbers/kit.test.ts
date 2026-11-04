// The numbers kind passes check.kind@1 (#13), whose planted runners, one that reports passed after its deadline and
// one that drops a crashed run's output, each fail it with their own message. The kit is the kind's own, run by the
// conformance package's one runner; its planted runners carry the core kit's names for the same faults.
import { describe, expect, it } from 'vitest';
import { runKit } from '../../../../packages/conformance/src/index.ts';
import { numbers } from './helpers.ts';

const KIT_TEST = 300_000;
const PLANTED = ['past-deadline', 'dropped-output'] as const;

describe('the numbers kind passes check.kind@1, and its two planted runners each fail it with their own message', () => {
  it('numbers: the kind passes its kit, fixed and seeded; past-deadline and dropped-output each fail it with their own message', async () => {
    const n = await numbers();
    const kit = n.numbersKit();
    expect(kit.slot).toBe('check.kind@1');

    const report = await runKit(kit, n.numbersFill());
    expect(report.cases.some((c) => c.part === 'seeded'), 'the kit has a seeded part').toBe(true);
    expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`), `seed ${report.seed}`).toEqual([]);
    expect(report.verdict).toBe('PASS');

    const messages: string[] = [];
    for (const name of PLANTED) {
      const p = kit.planted.find((x) => x.name === name);
      expect(p, `the kit's planted runners: ${kit.planted.map((x) => x.name).join(', ')}`).toBeDefined();
      expect(p!.fill.kind).toBe('numbers');
      expect(p!.message.length).toBeGreaterThan(0);
      const wrong = await runKit(kit, p!.fill, { parts: ['fixed'] });
      expect(wrong.verdict, `${name} on the numbers kit`).toBe('FAIL');
      const listed = wrong.cases.map((c) => `${c.id}: ${c.outcome} ${c.message}`).join(' | ');
      expect(wrong.cases.some((c) => c.outcome === 'FAIL' && c.message.includes(p!.message)), `a FAIL carries "${p!.message}" (${listed})`).toBe(true);
      messages.push(p!.message);
    }
    expect(new Set(messages).size, `each planted runner has its own message: ${messages.join(' / ')}`).toBe(PLANTED.length);
  }, KIT_TEST);
});
