// AC1: "For every field in a `deep kinds --dump` of the full build, `op: field` with that field's path returns exactly
// one line under 512 bytes, its type, unit, range and default equal to the dump's; a planted listing that leaves one
// field out fails, naming the kind and the field, and a planted 600-byte line fails, naming it"
//
// asserts: the full build's `deep-show kinds --dump` (what `deep kinds --dump` runs) is walked field by field; for each
// field, deep_kinds `{op: "field", path: "<kind>@<major>.<field>"}` on `deep-show run` answers exactly one line, under
// 512 bytes, whose type, unit, range and default equal the dump's (helpers.ts, oneFieldFailures; each failure names
// the kind and the field). The same walk over `--planted field_listing_without_corner` (the listing op: field prints
// from leaves out test.slab@3's corner) fails, naming test.slab@3 and corner and no other field; over
// `--planted field_line_600_bytes` (test.slab@3.width's line padded to 600 bytes) it fails, naming test.slab@3.width
// and no other line. The dump is always the unplanted build's.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, dumpOf, failsNaming, fieldCall, none, oneFieldFailures, run, useFullBuild, type Dump } from './helpers.ts';

const build = useFullBuild();
afterAll(cleanup, 60_000);

/** The full build's dump, read once per file. */
let dumped: Dump | undefined;
const dump = (bin: string): Dump => (dumped ??= dumpOf(bin));
/** AC1's check over every dumped field, on the build or one of its planted twins. */
function walk(bin: string, planted?: string): string[] {
  const d = dump(bin);
  const replies = run(bin, d.fields.map((f) => fieldCall(f.path)), planted);
  return oneFieldFailures(d.fields, replies);
}

describe('AC1 op: field answers each dumped field in one line under 512 bytes, its values the dump\'s', () => {
  it('AC1 for every field in the full build\'s dump, op: field with its path returns exactly one line under 512 bytes, its type, unit, range and default equal to the dump\'s', () => {
    const bin = build();
    const d = dump(bin);
    expect(d.fields.length, 'the full build\'s dump lists fields to walk').toBeGreaterThan(0);
    expect(d.fields.map((f) => f.path), 'the dump lists test.slab@3\'s fields').toEqual(expect.arrayContaining(['test.slab@3.width', 'test.slab@3.corner']));
    none(walk(bin), `op: field over the ${d.fields.length} fields of the dump`);
  }, 3_600_000);

  it('AC1 a planted listing that leaves test.slab@3\'s corner out fails, naming the kind and the field', () => {
    const failures = walk(build(), 'field_listing_without_corner');
    failsNaming(failures, ['test.slab@3', 'corner'], 'the listing without corner');
    expect(failures.filter((f) => !f.startsWith('test.slab@3.corner ')), 'the planted listing leaves out that one field and nothing else').toEqual([]);
  }, 3_600_000);

  it('AC1 a planted 600-byte line for test.slab@3.width fails, naming it', () => {
    const failures = walk(build(), 'field_line_600_bytes');
    failsNaming(failures, ['test.slab@3.width', 'bytes, not under 512'], 'the 600-byte line');
    expect(failures.filter((f) => !f.startsWith('test.slab@3.width ')), 'the plant pads that one line and changes nothing else').toEqual([]);
  }, 3_600_000);
});
