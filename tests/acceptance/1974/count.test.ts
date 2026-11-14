// AC2: "A fixture kind, `test.defaults@1`, whose four fields default to a number, a choice, a list of 3 numbers and an
// object has all four compared, and the run's count equals the dump's count of fields with a default. A planted run
// that skips fields typed `json` reports a lower count and is INVALID, naming the first field it skipped"
//
// asserts: the full build's `deep-show kinds --dump` lists test.defaults@1 with four fields, one each defaulting to a
// number (typed number), a choice (typed json; its default is one of at least two forms its `op: field` line prints),
// a list of 3 numbers (typed json) and an object (typed json) (helpers.ts, fixtureFailures). The defaults run,
// `deep-show kinds --defaults`, lists all four under test.defaults@1, each built with the field left out and set to
// the default its line prints, with the same check result, built output hash and evaluated values (helpers.ts,
// comparisonFailures); and its `count` equals the number of fields with a default in the dump, every registry walked.
// Over `--planted defaults_skip_json` (the run skips every field typed json) its count is lower than the dump's, its
// verdict is INVALID, and outside its per-kind lists it names the first field typed json with a default in the dump's
// order, the first one it skipped.

import { describe, expect, it } from 'vitest';
import {
  FIXTURE, PLANT_SKIP_JSON, comparisonFailures, defaultsRun, dumpFields, fixtureFailures, hasDefault, linesFor, namesField, outsideKinds, useFullBuild,
  verdictOf, type DumpField,
} from './helpers.ts';

const build = useFullBuild();

/** The full build's dump, field by field, read once per file. */
let dumped: DumpField[] | undefined;
const dump = (bin: string): DumpField[] => (dumped ??= dumpFields(bin));

describe('AC2 the run counts the fields it compared, and a skipped one makes it INVALID', () => {
  it('AC2 test.defaults@1, whose four fields default to a number, a choice, a list of 3 numbers and an object, has all four compared, and the run\'s count equals the dump\'s count of fields with a default', () => {
    const bin = build();
    const all = dump(bin);
    const defaulted = all.filter(hasDefault);
    const fixture = all.filter((f) => f.kind === FIXTURE);
    const lines = linesFor(bin, fixture);
    expect.soft(fixtureFailures(fixture, lines), `the full build's dump lists ${FIXTURE} with four fields defaulting to a number, a choice, a list of 3 numbers and an object`).toEqual([]);
    const report = defaultsRun(bin);
    expect.soft(comparisonFailures(fixture.filter(hasDefault), lines, report).filter((f) => !f.startsWith('the run:')), `the run compares each of ${FIXTURE}'s fields`).toEqual([]);
    expect(report['count'], `the run's count equals the dump's count of fields with a default, ${defaulted.length}: ${outsideKinds(report)}`).toBe(defaulted.length);
  }, 3_600_000);

  it('AC2 a planted run that skips fields typed json reports a lower count and is INVALID, naming the first field it skipped', () => {
    const bin = build();
    const defaulted = dump(bin).filter(hasDefault);
    const first = defaulted.find((f) => f.type === 'json');
    expect(first, 'the full build\'s dump lists a field typed json with a default').toBeDefined();
    const report = defaultsRun(bin, PLANT_SKIP_JSON);
    const count = report['count'];
    expect(typeof count === 'number' && count < defaulted.length, `the run that skips fields typed json reports a count lower than the dump's ${defaulted.length}: ${outsideKinds(report)}`).toBe(true);
    expect(verdictOf(report), `the run that skips fields typed json is INVALID: ${outsideKinds(report)}`).toBe('INVALID');
    expect(namesField(report, first!.kind, first!.field), `the INVALID run names the first field it skipped, ${first!.path}: ${outsideKinds(report)}`).toBe(true);
  }, 3_600_000);
});
