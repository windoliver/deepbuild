// AC1: "For every field with a default in the full build's dump, the kind's example with the field left out and the
// same example with the field set to the default `op: field` prints give the same check result, built output hash and
// evaluated values. A planted reader that falls back to 2 where the line says 1 fails, naming the kind and the field. A
// planted run that compares the line with the dump only passes that reader and fails this test"
//
// asserts: the full build's `deep-show kinds --dump` (what `deep kinds --dump` runs) is walked field by field; for each
// field with a default, deep_kinds `{op: "field", path}` on `deep-show run` gives its line. The defaults run,
// `deep-show kinds --defaults`, answers one report: its verdict is PASS, and under each kind it lists every one of those
// fields with an entry showing the kind's example built with the field left out and with it set to the default the
// line prints (the entry's `default`), each build's check result, built output hash and evaluated values, the two the
// same (helpers.ts, comparisonFailures; each failure names the kind and the field). Over `--planted
// defaults_reader_falls_back_to_2` (puff@1's reader takes 2 for a radius left out, where the line says 1) the run's
// verdict is FAIL, it names puff@1 and radius outside its per-kind lists, and the check's failures are that field's
// alone. Over `--planted defaults_compared_with_dump_only` (the same reader, and a run that compares each line with the
// dump and builds nothing) the run's verdict is PASS, and this test's check fails on its report, naming puff@1.radius.
// The dump is always the unplanted build's.

import { describe, expect, it } from 'vitest';
import {
  PLANT_DUMP_ONLY, PLANT_READER_2, READER_FIELD, READER_KIND, READER_PATH, comparisonFailures, defaultsRun, dumpFields, failsNaming, hasDefault, linesFor,
  namesField, none, outsideKinds, show, useFullBuild, verdictOf, type DumpField, type JsonObject,
} from './helpers.ts';

const build = useFullBuild();

/** The full build's fields with a default and the line op: field prints for each, read once per file. */
let read: { fields: DumpField[]; lines: Map<string, JsonObject | string> } | undefined;
function defaulted(bin: string): { fields: DumpField[]; lines: Map<string, JsonObject | string> } {
  if (!read) {
    const fields = dumpFields(bin).filter(hasDefault);
    read = { fields, lines: linesFor(bin, fields) };
  }
  return read;
}

describe('AC1 each default the listing prints is built against the field left out', () => {
  it('AC1 for every field with a default in the full build\'s dump, the kind\'s example with the field left out and set to the default op: field prints gives the same check result, built output hash and evaluated values', () => {
    const bin = build();
    const { fields, lines } = defaulted(bin);
    expect(fields.length, 'the full build\'s dump lists fields with a default').toBeGreaterThan(0);
    none(comparisonFailures(fields, lines, defaultsRun(bin)), `the defaults run over the ${fields.length} fields with a default in the full build's dump`);
  }, 3_600_000);

  it('AC1 a planted reader that falls back to 2 where the line says 1 fails, naming the kind and the field', () => {
    const bin = build();
    const { fields, lines } = defaulted(bin);
    const line = lines.get(READER_PATH);
    expect(typeof line === 'object' && line['default'] === 1, `op: field prints ${READER_PATH}'s default as 1, where the planted reader takes 2: ${show(line ?? null, 600)}`).toBe(true);
    const report = defaultsRun(bin, PLANT_READER_2);
    expect(verdictOf(report), `the run over the planted reader fails: ${outsideKinds(report)}`).toBe('FAIL');
    expect(namesField(report, READER_KIND, READER_FIELD), `the failing run names ${READER_KIND} and ${READER_FIELD}: ${outsideKinds(report)}`).toBe(true);
    const failures = comparisonFailures(fields, lines, report).filter((f) => !f.startsWith('the run:'));
    failsNaming(failures, [`${READER_PATH}:`, 'different'], 'the run over the planted reader');
    expect(failures.filter((f) => !f.startsWith(`${READER_PATH}:`)), 'the plant changes that one reader and nothing else').toEqual([]);
  }, 3_600_000);

  it('AC1 a planted run that compares the line with the dump only passes that reader and fails this test', () => {
    const bin = build();
    const { fields, lines } = defaulted(bin);
    const report = defaultsRun(bin, PLANT_DUMP_ONLY);
    expect(verdictOf(report), `the run that compares each line with the dump only passes the planted reader: ${outsideKinds(report)}`).toBe('PASS');
    failsNaming(comparisonFailures(fields, lines, report), [`${READER_PATH}:`], 'the run that compares each line with the dump only');
  }, 3_600_000);
});
