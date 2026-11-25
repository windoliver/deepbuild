// #3150.6627b6c0: "The test's `scripts/known-failures.json` entry is gone."
//
// asserts: scripts/known-failures.json still reads as JSON with its `failures` object, and no key of `failures` names
// deep-show's kinds::tests::every_structured_field_prints_forms_that_take_its_own_values. On the base its entry is
// `cargo -p deep-show --bin deep-show › kinds::tests::every_structured_field_prints_forms_that_take_its_own_values`
// (BASE-FAILURE.txt).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, UNIT_TEST, isObject, type JsonValue } from './helpers.ts';

const ID = '#3150.6627b6c0';

describe(`${ID} the test's known-failures entry is gone`, () => {
  it(`${ID} scripts/known-failures.json lists no entry for deep-show's ${UNIT_TEST}`, () => {
    const file = JSON.parse(readFileSync(join(REPO, 'scripts', 'known-failures.json'), 'utf8')) as JsonValue;
    expect(isObject(file) && isObject(file['failures']), `${ID}: scripts/known-failures.json holds its failures object`).toBe(true);
    const failures = (file as Record<string, JsonValue>)['failures'] as Record<string, JsonValue>;
    const named = Object.keys(failures).filter((key) => key.includes(UNIT_TEST));
    expect(named, `${ID}: the entries of scripts/known-failures.json naming ${UNIT_TEST}`).toEqual([]);
  });
});
