// #2694.b3f057c6: "`tests/acceptance/806/` and `tests/acceptance/393/` pass unchanged, and the side's resident memory
// after the 14,400 reads is within 4 MB of its value after the first show"
//
// The suites clause, for #393's folder, run as the lanes run it (suites.ts). #806's folder runs in ac5-806.test.ts, each
// in a file of its own so each has a file's whole time; ac5-memory.test.ts holds the memory clause.
import { describe, test } from 'vitest';
import { AC, TIMEOUT } from './helpers.ts';
import { folderPasses, useSuiteBuilds } from './suites.ts';

const built = useSuiteBuilds();

describe(`${AC[5]} the canvas side's own suites still pass`, () => {
  test(`${AC[5]} tests/acceptance/393/ passes unchanged`, async () => {
    built();
    await folderPasses('tests/acceptance/393/');
  }, TIMEOUT);
});
