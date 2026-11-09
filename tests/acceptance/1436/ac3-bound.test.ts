// Criterion 3 (README: Criteria to tests): "A halo bound to a recorded token rate changes with the record and shows its
// source. A planted literal value fails, naming the param."
// `halo.soft` around a card, its first ranged param (from the pack check's listing) bound to `reading:tokens#s-1436`,
// over a record holding one `reading.recorded` of that token rate. Drawn over two records whose rates sit a quarter and
// three quarters into the param's range, the halo's pixels differ, and each frame shows the bound param with its source,
// the recorded value and its as-of time (chrome.json's `bound`).
// The planted case is input: the same bind given a literal number in place of a reading, refused naming the param.
import { describe, expect, it } from 'vitest';
import { AC, AS_OF, HALO, READING, device, halo, operatorOf, region, replica, useBuild, useShipped, type Obj } from './helpers.ts';

const bin = useBuild('replica');
const shipped = useShipped(bin);

function bound(): { param: string; low: number; high: number } {
  const op = operatorOf(shipped(), 'halo.soft');
  const p = op.params.find((q) => Array.isArray(q.range) && q.range[0] < q.range[1]);
  expect(p, `halo.soft has a param with a range: ${JSON.stringify(op.params)}`).toBeDefined();
  const [lo, hi] = p!.range;
  return { param: p!.name, low: lo + (hi - lo) / 4, high: lo + (3 * (hi - lo)) / 4 };
}
const shown = (report: Obj): Obj[] => ((report['bound'] as Obj[] | undefined) ?? []).filter((b) => b['effect'] === 'halo');

describe(`#1436 AC3 ${AC[3]} a halo bound to a recorded token rate changes with the record and shows its source`, () => {
  it('AC3 the halo follows the recorded token rate, and shows the param\'s source, value and as-of time', () => {
    const { param, low, high } = bound();
    const draws = [low, high].map((v) => ({ v, drawn: replica(bin(), halo({ [param]: READING }, v), { at: [1] }) }));
    for (const { v, drawn } of draws) {
      expect(drawn.refusals, 'nothing is refused').toEqual([]);
      const entries = shown(drawn.report);
      expect(entries.length, `the frame shows the halo's one bound param over a record of ${v}: ${JSON.stringify(drawn.report['bound'])}`).toBe(1);
      expect(entries[0], 'with its source, the recorded value and its as-of time').toMatchObject({ param, source: READING, value: v, as_of: AS_OF });
    }
    const rect = device(HALO, 1);
    expect(region(draws[0]!.drawn.pngs[0]!, rect).equals(region(draws[1]!.drawn.pngs[0]!, rect)), `the halo at a token rate of ${low} against ${high}`).toBe(false);
  }, 3_600_000);

  it('AC3 a planted literal value in place of the reading is refused, naming the param', () => {
    const { param, low } = bound();
    const drawn = replica(bin(), halo({ [param]: low }, low), { at: [1] });
    const refusal = drawn.refusals.find((r) => r['effect'] === 'halo');
    expect(refusal, `the literal bind is refused: ${JSON.stringify(drawn.refusals)}`).toBeDefined();
    expect(refusal!['code'], 'as a literal where a reading is bound').toBe('chrome_fx_bind_literal');
    expect(refusal!['param'], 'naming the param').toBe(param);
    expect(refusal!['operator'], 'and the operator').toBe('halo.soft');
  }, 3_600_000);
});
