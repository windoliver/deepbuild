// #2694.b3f057c6: "`tests/acceptance/806/` and `tests/acceptance/393/` pass unchanged, and the side's resident memory
// after the 14,400 reads is within 4 MB of its value after the first show"
//
// The suites clause, for #806's folder, run as the lanes run it (suites.ts): without live.test.ts and unbound.test.ts,
// which scripts/lanes.mjs keeps for a run by hand (unbound.test.ts's blind redraft, 806-redraft-ac3/, runs in its place).
// #393's folder runs in ac5-393.test.ts; ac5-memory.test.ts holds the memory clause.
import { describe, test } from 'vitest';
import { AC, TIMEOUT } from './helpers.ts';
import { folderPasses, useSuiteBuilds } from './suites.ts';

const built = useSuiteBuilds();

describe(`${AC[5]} the canvas side's own suites still pass`, () => {
  test(`${AC[5]} tests/acceptance/806/ passes unchanged`, async () => {
    built();
    await folderPasses('tests/acceptance/806/');
  }, TIMEOUT);
});
