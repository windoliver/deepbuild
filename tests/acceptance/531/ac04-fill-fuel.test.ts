// Criterion 4: "With a fuel budget of 10,000,000, a step of nine fills of 1 MiB with memory.fill records at least
// 9,437,184 fuel"
//
// Through `deep-logic bake` (README: deep-logic): the bake's fuel per step. Step 1 of `nine_fills` (programs.ts)
// fills 1 MiB nine times; steps 0 and 2 fill nothing. Each memory.fill charges one unit per byte it touches before
// it runs (Logic: sandbox), so step 1 records at least 9 × 1,048,576 = 9,437,184 and, under its budget of
// 10,000,000, doesn't trap. Oracle: wasmtime tests/all/fuel.wast (a 100-byte memory.fill charged its bytes up front,
// assert_fuel 107) and fuel.rs custom_variable_operator_cost, the same rule; the 9,437,184 is the issue's.
import { describe, expect, it } from 'vitest';
import { AC, MIB, TIMEOUT, arrayAt, at, bakeCall, bakeOf, entryAt, logicBin, onMac, piece, prebuild, show } from './helpers.ts';
import { nineFills } from './programs.ts';

prebuild(() => { logicBin(); });

const BUDGET = 10_000_000;
const NINE_MIB = 9 * MIB;

describe(`${AC[4]} memory.fill is charged per byte`, () => {
  it(`${AC[4]} under a fuel budget of 10,000,000 a step of nine 1 MiB memory.fills records at least 9,437,184 fuel and doesn't trap`, () => {
    const [reply] = onMac([bakeCall(piece({
      seed: 531_04, items: { fill: { program: nineFills(), writes: { k: { type: 'i32' } }, budget: { fuel: BUDGET, memory: 16 } } },
    }), { steps: 3 })]);
    const b = bakeOf(reply!, 'the nine-fill bake');
    expect(entryAt(b.items!['fill']!.layout, 'writes', 'k').offset, 'nine_fills was built for k at offset 0 of its write region').toBe(0);
    expect(b.traps, `no step traps under a budget of ${BUDGET}: ${show(b.raw['traps'])}`).toEqual([]);
    const step1 = at(b.steps, 1, 'the bake').items['fill']!;
    expect(NINE_MIB, 'nine fills of 1 MiB are 9,437,184 bytes').toBe(9_437_184);
    expect(step1.fuel, `step 1 records at least ${NINE_MIB} fuel (it records ${step1.fuel})`).toBeGreaterThanOrEqual(NINE_MIB);
    expect(step1.fuel, 'step 1 stays within its budget').toBeLessThanOrEqual(BUDGET);
    expect(step1.failed, 'step 1 ran to its end').toBe(false);
    expect(arrayAt(b.steps, 2, 'fill.k', 'the bake'), 'step 2 ran after it').toEqual([2]);
    for (const k of [0, 2]) {
      const f = at(b.steps, k, 'the bake').items['fill']!.fuel;
      expect(f, `step ${k}, which fills nothing, records some fuel but far less than one fill (${f})`).toBeGreaterThan(0);
      expect(f, `step ${k} records far less than one 1 MiB fill`).toBeLessThan(MIB);
    }
  }, TIMEOUT);
});
