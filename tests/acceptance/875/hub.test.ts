// #875: through a real hub (`deep hub run`, deep-hook and #29's Claude Code stand-in), a fix claim's base run proves the fix
// only when it failed on an assertion its check names. Each test makes the claim on #31's sample repo with a real Vitest run
// and reads the verdict from the record. A hub that can't start, the planted one included, is BLOCKED (the test throws),
// never a pass.
import { afterEach, describe, it } from 'vitest';
import { cleanup } from '../29/h-d.ts';
import { ADDED_FUNCTION, claimFix, HELPER, invalidNaming, mustFail, passes, PLANT, readAsProof, REAL, removeTemp } from './helpers.ts';

// Removing a world's cloned install takes a while on a loaded machine.
afterEach(async () => {
  await cleanup();
  removeTemp();
}, 180_000);

const BEFORE_TESTS = 'failed on the base before its tests ran';
const ELSEWHERE = 'failed on the base only elsewhere';
const LIMIT = 900_000;

describe("AC1 #875.15f7a4ab through a real hub, a fix claim whose test imports a helper only the fix adds is INVALID naming 'failed on the base before its tests ran'", () => {
  it(`AC1 test/cart.test.ts imports src/discount.ts, which only the fix adds: INVALID naming '${BEFORE_TESTS}'`, async () => {
    invalidNaming(await claimFix(HELPER), BEFORE_TESTS);
  }, LIMIT);
});

describe("AC2 #875.b3b1e7e3 through a real hub, a fix claim whose base run fails with a TypeError from a function the fix adds is INVALID naming 'failed on the base only elsewhere'", () => {
  it(`AC2 test/cart.test.ts's named expect calls discountedTotal, which only the fix adds: INVALID naming '${ELSEWHERE}'`, async () => {
    invalidNaming(await claimFix(ADDED_FUNCTION), ELSEWHERE);
  }, LIMIT);
});

describe("AC3 #875.efd89fb9 through a real hub, the sample repo's real fix, whose test fails its assertion on the base, is PASS", () => {
  it('AC3 the real fix, whose test/cart.test.ts:5 expect fails on the base (100, not 90), is PASS', async () => {
    passes(await claimFix(REAL));
  }, LIMIT);
});

describe('AC4 #875.758d1556 a hub that counts any non-zero base exit as proof fails these tests', () => {
  it(`AC4 (wrong program ${PLANT}) the helper the fix adds reads as proof, and AC1's judgement fails`, async () => {
    const r = await claimFix(HELPER, { plant: PLANT });
    readAsProof(r);
    await mustFail(`${PLANT} on AC1's claim`, () => invalidNaming(r, BEFORE_TESTS), ['INVALID']);
  }, LIMIT);

  it(`AC4 (wrong program ${PLANT}) the TypeError from the function the fix adds reads as proof, and AC2's judgement fails`, async () => {
    const r = await claimFix(ADDED_FUNCTION, { plant: PLANT });
    readAsProof(r);
    await mustFail(`${PLANT} on AC2's claim`, () => invalidNaming(r, ELSEWHERE), ['INVALID']);
  }, LIMIT);

  it(`AC4 (wrong program ${PLANT}) the real fix stays PASS: the plant changes only what a base exit proves`, async () => {
    passes(await claimFix(REAL, { plant: PLANT }));
  }, LIMIT);
});
