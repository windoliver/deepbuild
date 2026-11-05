// #429.bb5bf037: test code holds a CPU interpreter of the step graph in f64, through the one ops module, and every
// shipped operator, fx@1's graphs and 10,000 seeded random well-typed graphs of up to 64 steps, with repeats,
// selects and swizzles, land on the GPU within the bound their steps' references give; a planted emitter that drops
// a swizzle's last component passes every shipped operator that never uses one and fails on a generated graph,
// naming its seed.
//
// The `interp_suite` call (README) runs each graph through the core's check, emitter and this GPU, and through the
// step graph's CPU interpreter in f64 (#380's, the one CPU references are built on), comparing every output within
// the bound its steps' references give; it reports each shipped and fx@1 graph, whether it uses a swizzle, and the
// generated graphs: how many, the largest, how many hold a repeat, a select and a swizzle, and each outside its
// bound with its seed. The planted emitter is `--planted drops_swizzle_last`. At the base there is no such call and
// no fx@1 pack.
import { describe, expect, it } from 'vitest';
import { answered, num, obj, objs, requireGpu, run1, shown, useBins, useOut, type JsonObject, type Planted } from './helpers.ts';

const bins = useBins();
const out = useOut();

interface Suite { shipped: JsonObject[]; fx: JsonObject[]; generated: JsonObject; outside: JsonObject[] }
function suite(planted?: Planted): Suite {
  const r = answered(run1(bins.bin(), out(), { call: 'interp_suite', generated: 10000, max_steps: 64, seed: 1 }, planted, 3_500_000), 'interp_suite');
  const generated = obj(r['generated'], 'generated');
  return { shipped: objs(r['shipped'], 'shipped'), fx: objs(r['fx'], 'fx'), generated, outside: objs(generated['outside'], 'generated.outside') };
}
const outsideOf = (rows: JsonObject[]): string[] => rows.filter((o) => o['outcome'] !== 'within').map((o) => `${String(o['operator'])}: ${shown(o)}`);

describe('#429.bb5bf037 the emitter is held to the graph by an f64 interpreter', () => {
  it('#429.bb5bf037 every shipped operator, fx@1\'s graphs and 10,000 seeded graphs of up to 64 steps with repeats, selects and swizzles land within their bounds', () => {
    requireGpu();
    const s = suite();
    expect(s.shipped.length, 'the shipped operators are run').toBeGreaterThan(0);
    expect(s.fx.length, 'fx@1\'s graphs are run').toBeGreaterThan(0);
    expect(outsideOf(s.shipped), 'every shipped operator within its bound').toEqual([]);
    expect(outsideOf(s.fx), 'every fx@1 graph within its bound').toEqual([]);
    expect(num(s.generated['count'], 'generated.count'), '10,000 generated graphs').toBe(10000);
    expect(num(s.generated['max_steps'], 'generated.max_steps'), 'of up to 64 steps').toBeLessThanOrEqual(64);
    for (const k of ['with_repeat', 'with_select', 'with_swizzle']) expect(num(s.generated[k], k), `some generated graphs hold ${k.slice(5)}s`).toBeGreaterThan(0);
    expect(s.outside, 'no generated graph lands outside its bound').toEqual([]);
  }, 3_600_000);

  it('#429.bb5bf037 a planted emitter that drops a swizzle\'s last component (--planted drops_swizzle_last) passes every shipped operator without a swizzle and fails on a generated graph, naming its seed', () => {
    requireGpu();
    const s = suite('drops_swizzle_last');
    expect(outsideOf([...s.shipped, ...s.fx].filter((o) => o['uses_swizzle'] === false)), 'every shipped and fx@1 graph that uses no swizzle still lands within its bound').toEqual([]);
    expect(s.outside.length, 'a generated graph lands outside its bound').toBeGreaterThan(0);
    for (const o of s.outside) expect(typeof o['seed'], `each one outside names its seed: ${shown(o)}`).toBe('number');
  }, 3_600_000);
});
