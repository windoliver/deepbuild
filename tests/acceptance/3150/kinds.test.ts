// #3150.b8d82393: "`deep_kinds` prints both forms."
//
// asserts: deep_kinds `{op: "field", path: "cut.words@1.<field>"}` on the full build's `deep-show run` answers one line,
// the field's row, typed json, whose `forms` (what deep_kinds prints for a structured field, #1973) are exactly the
// form the issue's fix declares: `name` for `recording`, `[index | [first: index, last: index]]` for `keep`. On the base
// both declarations don't read, so each row prints no form (BASE-FAILURE.txt).

import { describe, expect, it } from 'vitest';
import { KEEP_FORM, KIND, RECORDING_FORM, fieldCall, lineOf, run, show, useFullBuild } from './helpers.ts';

const ID = '#3150.b8d82393';
const build = useFullBuild();

function printed(field: string): unknown {
  const [reply] = run(build(), [fieldCall(`${KIND}.${field}`)]);
  const line = lineOf(reply!);
  expect(typeof line, `${ID}: deep_kinds op: field for ${KIND}.${field} answers one line: ${show(line)}`).not.toBe('string');
  const row = line as Record<string, unknown>;
  expect(row['type'], `${ID}: ${KIND}.${field} is a structured field: ${show(row)}`).toBe('json');
  return row['forms'];
}

describe(`${ID} deep_kinds prints both cut.words@1 forms`, () => {
  it(`${ID} deep_kinds prints cut.words@1.recording's form, name`, () => {
    expect(printed('recording'), `${ID}: the forms deep_kinds prints for ${KIND}.recording`).toEqual([RECORDING_FORM]);
  }, 3_600_000);

  it(`${ID} deep_kinds prints cut.words@1.keep's form, [index | [first: index, last: index]]`, () => {
    expect(printed('keep'), `${ID}: the forms deep_kinds prints for ${KIND}.keep`).toEqual([KEEP_FORM]);
  }, 3_600_000);
});
