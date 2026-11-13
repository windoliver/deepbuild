// AC2: "An object path returns as many lines as the dump lists params for that kind, in the dump's order; a planted
// answer in another order fails, naming the first line out of place"
//
// asserts: for every kind the full build's `deep-show kinds --dump` lists with at least one param, deep_kinds
// `{op: "field", path: "<kind>@<major>"}` on `deep-show run` answers as many lines as the dump lists params for it,
// each naming one of its fields (by name or path), in the dump's order (helpers.ts, objectFailures). The same check
// over `--planted field_object_by_name` (an object path answers its lines in field-name order) fails on test.slab@3,
// whose dump order is width, height, label, corner: the failure says "out of place" and names corner, the first line
// out of place, while the planted answer still holds all four lines.

import { afterAll, describe, expect, it } from 'vitest';
import { SLAB, cleanup, dumpOf, entryIn, fieldCall, kindsWithFields, none, objectFailures, run, useFullBuild, type Dump } from './helpers.ts';

const build = useFullBuild();
afterAll(cleanup, 60_000);

let dumped: Dump | undefined;
const dump = (bin: string): Dump => (dumped ??= dumpOf(bin));
/** AC2's check over the object path of every kind with params, on the build or a planted twin. */
function walk(bin: string, planted?: string): string[] {
  const kinds = kindsWithFields(dump(bin));
  return objectFailures(kinds, run(bin, kinds.map((k) => fieldCall(k.name)), planted));
}

describe('AC2 an object path answers every field of its kind, one line each, in the dump\'s order', () => {
  it('AC2 an object path returns as many lines as the dump lists params for that kind, in the dump\'s order', () => {
    const bin = build();
    const d = dump(bin);
    expect(entryIn(d, SLAB).fields.map((f) => f.field), 'the dump lists test.slab@3\'s params in its order').toEqual(['width', 'height', 'label', 'corner']);
    none(walk(bin), `the object paths of the ${kindsWithFields(d).length} kinds the dump lists with params`);
  }, 3_600_000);

  it('AC2 a planted answer in another order fails, naming the first line out of place', () => {
    const failures = walk(build(), 'field_object_by_name');
    failsOnSlab(failures);
  }, 3_600_000);
});

/** The planted order fails on test.slab@3 as an order, not a count: "out of place", naming corner. */
function failsOnSlab(failures: string[]): void {
  const slab = failures.filter((f) => f.startsWith(`${SLAB}:`));
  expect(slab.length, `the answer in field-name order fails on ${SLAB}; the failures were:\n  ${failures.join('\n  ')}`).toBeGreaterThan(0);
  expect(slab.some((f) => f.includes('out of place') && f.includes('line 1 is corner')), `the failure on ${SLAB} names corner, the first line out of place:\n  ${slab.join('\n  ')}`).toBe(true);
}
