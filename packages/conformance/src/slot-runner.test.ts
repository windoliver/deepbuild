// A slot kit's requirement set is frozen per revision (technical-design.md, the registry row): a fill declaring a
// revision the kit doesn't have yet is judged on the kit's cases, but the later revision's requirements never ran,
// so its run can't pass. The adapter runner says INCONCLUSIVE; the slot runner must too.
import { describe, expect, it } from 'vitest';
import { cleanFills, runKit, slotKits } from './index.js';
import type { SlotCase, SlotFill, SlotKitImpl } from './slot-types.js';

interface BoomFill extends SlotFill { boom(): Promise<void> }

describe('the slot runner on a fill whose step rejects', () => {
  it('closes the judge, so its cleanup runs before the case is reported', async () => {
    const cleaned: string[] = [];
    const fill: BoomFill = { slot: 'boom@1', revision: 1, boom: async () => { throw Error('the fill broke'); } };
    const kit: SlotKitImpl<BoomFill> = {
      slot: 'boom@1', fills: 'one', revision: 1, rules: [], fixtures: [{ id: 'one', input: null, expected: null }], planted: [],
      clean: () => [fill], generate: () => [],
      *judge(f: BoomFill, c: SlotCase) { try { yield () => f.boom(); } finally { cleaned.push(c.id); } },
    };
    const report = await runKit(kit, fill, { parts: ['fixed'] });
    expect(cleaned).toEqual(['one']);
    expect(report.cases.map((c) => [c.id, c.outcome, c.message])).toEqual([['one', 'FAIL', 'the fill threw: Error: the fill broke']]);
  });
});

describe('the slot runner on a fill newer than its kit', () => {
  it('reads INCONCLUSIVE, with no case failing', async () => {
    for (const kit of slotKits().filter((k) => k.slot === 'source@1' || k.slot === 'index@1')) {
      const fill = cleanFills(kit)[0]!;
      const report = await runKit(kit, { ...fill, revision: kit.revision + 1 }, { seed: 7 });
      expect(report.cases.filter((c) => c.outcome !== 'PASS'), `${kit.slot}: the kit's own cases still pass`).toEqual([]);
      expect(report.verdict, `${kit.slot}: a revision the kit can't test never passes`).toBe('INCONCLUSIVE');
      expect(report.revision, `${kit.slot}: the report names the kit's revision`).toBe(kit.revision);
    }
  });
});
