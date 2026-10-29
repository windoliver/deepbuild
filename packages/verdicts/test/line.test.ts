// The verdict line (#83): the goldens' states give their lines within 80 columns, the cause gives way first, and
// what wasn't verified comes before any count.
import { describe, expect, it } from 'vitest';
import { LINE_WIDTH, verdictLine, type LineRequirement } from '../src/index.js';

const R = (n: number, outcome: LineRequirement['outcome'], extra: Partial<LineRequirement> = {}): LineRequirement =>
  ({ req: `req:01K74G0A1B2C3D4E5F6G7H8J9K#R${n}`, outcome, smallest: null, points_to: null, ...extra });
const width = (s: string) => [...s].length;

describe('verdictLine', () => {
  it('says done while nothing ran, with the checks running and the longest expected time', () => {
    expect(verdictLine({ outcome: null, requirements: [R(1, 'pending'), R(2, 'pending'), R(3, 'pending')], running: [{ check: 'unit', about_s: 30 }, { check: 'typecheck', about_s: 45 }, { check: 'journey:checkout', about_s: 240 }] }))
      .toBe('says done · 3 checks running · about 4 min · next: DeepBuild · receipt');
    expect(verdictLine({ outcome: null, requirements: [R(1, 'PASS'), R(2, 'PASS'), R(3, 'pending'), R(4, 'pending')], running: [{ check: 'a', about_s: 240 }, { check: 'b', about_s: 200 }] }))
      .toBe('says done 2/4 · 2 checks running · about 4 min · next: DeepBuild · receipt');
    expect(verdictLine({ outcome: null, requirements: [], running: [{ check: 'a', about_s: 20 }] })).toBe('says done · 1 check running · about 20 s · next: DeepBuild · receipt');
    expect(verdictLine({ outcome: null, requirements: [], running: [{ check: 'a', about_s: null }] })).toBe('says done · 1 check running · next: DeepBuild · receipt');
    expect(verdictLine({ outcome: null, requirements: [], running: [] })).toBe('says done · next: DeepBuild · receipt');
  });
  it('a send-back carries its round, the smallest case and where it points, and the agent owns the next step', () => {
    expect(verdictLine({ outcome: 'FAIL', round: 1, requirements: [R(1, 'FAIL', { smallest: 'receipt shows $18.00', points_to: 'total.ts:42' }), R(2, 'PASS'), R(3, 'PASS')], running: [] }))
      .toBe('sent back 1/3: receipt shows $18.00 · total.ts:42 · next: agent · receipt');
  });
  it('PASS and BLOCKED count their requirements; BLOCKED names what was not verified first and its cause', () => {
    expect(verdictLine({ outcome: 'PASS', requirements: [R(1, 'PASS'), R(2, 'PASS'), R(3, 'PASS'), R(4, 'PASS')], running: [] })).toBe('PASS 4/4 · next: you · receipt');
    expect(verdictLine({ outcome: 'BLOCKED', requirements: [R(1, 'BLOCKED', { smallest: 'secret STRIPE_KEY missing' }), R(2, 'PASS'), R(3, 'PASS'), R(4, 'PASS')], running: [] }))
      .toBe('not verified: R1 · BLOCKED 3/4: secret STRIPE_KEY missing · next: you · receipt');
    expect(verdictLine({ outcome: 'INCONCLUSIVE', requirements: [R(1, 'PASS'), R(2, 'INCONCLUSIVE'), R(3, 'PASS')], running: [] })).toBe('not verified: R2 · INCONCLUSIVE 2/3 · next: DeepBuild · receipt');
  });
  it('a long cause is cut from its end, marked, and the rest of the line stays', () => {
    const cause = 'receipt shows $18.00 where $17.64 was expected after the 2% member discount on the subtotal of $18.00 before tax, with tax then added at 8% on the discounted amount';
    const line = verdictLine({ outcome: 'FAIL', round: 2, requirements: [R(1, 'FAIL', { smallest: cause, points_to: 'total.ts:42' }), R(2, 'INCONCLUSIVE'), R(3, 'PASS')], running: [] });
    expect(width(line)).toBeLessThanOrEqual(LINE_WIDTH);
    expect(line).toMatch(/^not verified: R2 · sent back 2\/3: receipt show[^·]*… · total\.ts:42 · next: agent/);
    expect(line).not.toContain(cause);
  });
  it('with no cause to cut, the receipt, where it points and the owner give way before the outcome does', () => {
    const three = [R(1, 'INCONCLUSIVE'), R(2, 'INCONCLUSIVE'), R(3, 'INCONCLUSIVE')];
    expect(verdictLine({ outcome: 'INCONCLUSIVE', requirements: three, running: [] }, 50)).toBe('not verified: R1, R2, R3 · INCONCLUSIVE 0/3');
    expect(verdictLine({ outcome: 'INCONCLUSIVE', requirements: three, running: [] }, 65)).toBe('not verified: R1, R2, R3 · INCONCLUSIVE 0/3 · next: DeepBuild');
    // Narrower than its own first parts, the line keeps them whole: nothing else is left to give.
    expect(width(verdictLine({ outcome: 'INCONCLUSIVE', requirements: three, running: [] }, 20))).toBe(width('not verified: R1, R2, R3 · INCONCLUSIVE 0/3'));
  });
});
