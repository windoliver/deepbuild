// AC2: each kind passes check.kind@1, whose planted runners, one that reports passed after its deadline and one
// that drops a crashed run's output, each fail it with their own message. The kit is the kind's own, run by the
// conformance package's one runner; its planted runners carry the core kit's names for the same faults.
import { describe, expect, it } from 'vitest';
import { runKit } from '../../../packages/conformance/src/index.ts';
import { KINDS, listed, work } from './helpers.ts';

const KIT_TEST = 300_000;
const PLANTED = ['past-deadline', 'dropped-output'] as const;

describe.each(KINDS)('AC2 the %s kind passes check.kind@1, and its two planted runners each fail it with their own message', (kind) => {
  it(`AC2 ${kind}: the kind passes its kit, fixed and seeded; past-deadline and dropped-output each fail it with their own message`, async () => {
    const w = await work();
    const kit = w.workKit(kind);
    expect(kit.slot).toBe('check.kind@1');

    const report = await runKit(kit, w.workFill(kind));
    expect(report.cases.some((c) => c.part === 'seeded'), `${kind}'s kit has a seeded part`).toBe(true);
    expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`), `seed ${report.seed}`).toEqual([]);
    expect(report.verdict).toBe('PASS');

    const messages: string[] = [];
    for (const name of PLANTED) {
      const p = kit.planted.find((x) => x.name === name);
      expect(p, `${kind}'s planted runners: ${kit.planted.map((x) => x.name).join(', ')}`).toBeDefined();
      expect(p!.fill.kind).toBe(kind);
      expect(p!.message.length).toBeGreaterThan(0);
      const wrong = await runKit(kit, p!.fill, { parts: ['fixed'] });
      expect(wrong.verdict, `${name} on ${kind}'s kit`).toBe('FAIL');
      expect(wrong.cases.some((c) => c.outcome === 'FAIL' && c.message.includes(p!.message)), `a FAIL carries "${p!.message}" (${listed(wrong)})`).toBe(true);
      messages.push(p!.message);
    }
    expect(new Set(messages).size, `each planted runner has its own message: ${messages.join(' / ')}`).toBe(PLANTED.length);
  }, KIT_TEST);
});
