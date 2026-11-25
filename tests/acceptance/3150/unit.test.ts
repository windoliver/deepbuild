// #3150.c7594389: "The test passes." (deep-show's kinds::tests::every_structured_field_prints_forms_that_take_its_own_values)
//
// asserts: `cargo test --locked -p deep-show --bin deep-show -- --exact <the test>` in the checkout exits 0 and reports
// that one test `ok`, with 1 passed and 0 failed. The test is run as it stands; this file never reads or changes it. On
// the base it fails naming cut.words@1.recording and cut.words@1.keep (BASE-FAILURE.txt).

import { describe, expect, it } from 'vitest';
import { UNIT_TEST, cargo, cargoErrors } from './helpers.ts';

const ID = '#3150.c7594389';

describe(`${ID} deep-show's every-structured-field test passes`, () => {
  it(`${ID} deep-show's ${UNIT_TEST} passes`, () => {
    const r = cargo(['test', '--locked', '-p', 'deep-show', '--bin', 'deep-show', '--', '--exact', UNIT_TEST]);
    const out = r.stdout;
    const failed = out.match(/---- [\s\S]*?(?=\n\nfailures:|\n\ntest result)/)?.[0] ?? cargoErrors(r);
    expect(out, `${ID}: cargo test ran ${UNIT_TEST} and it passed (exit ${String(r.status)}):\n${failed.slice(0, 4000)}`).toContain(`test ${UNIT_TEST} ... ok`);
    expect(out, `${ID}: the run's result is one test passed, none failed`).toMatch(/test result: ok\. 1 passed; 0 failed/);
    expect(r.status, `${ID}: cargo test exits 0`).toBe(0);
  }, 7_200_000);
});
