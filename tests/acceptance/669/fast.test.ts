// #669's fast tests: no model and no spend. The checkpoint runs on a temporary home with stand-ins only for what this
// repo doesn't own (launchd, systemctl, the `claude` binary, Claude Code running its user settings' hooks): `deep setup`
// in checkout-web, then a session whose hooks go through those settings into the real deep-hook and hub while its
// commands run for real (`npm test` on Vitest, the fix, the commit). Its first stop says "done" before the fix and is
// held and sent back; its stop after the fix passes; "all done?" is answered from the record. A second home runs
// AC3's and AC6's worlds: zero tests, a masked exit, and a check cut short by a hub restart. The planted wrong programs
// the issue's Proof names are twins (twins.json): each fails its criterion's test here, naming it.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, AC6, allDoneProblems, cleanup, cutAndZeroProblems, heldFailProblems, mainWorld, maskedProblems, passProblems, recordProblems,
  shared, sideWorld,
} from './helpers.ts';

afterAll(cleanup, 120_000);

const MINUTE = 60_000;
const main = shared(() => mainWorld('fast'));
const side = shared(() => sideWorld('fast'));

describe(`AC1 ${AC1} The first stop is held, the check runs, and the chat shows one verdict line reading FAIL with the failing test's file and line and the count of tests run; the session goes on with the send-back`, () => {
  it(`AC1 ${AC1} the stop that says done before the fix is held while \`npm test\` runs, shows one line reading FAIL with coupon.test.js:5 and 3 tests, and is sent back`, async () => {
    expect(heldFailProblems(await main()), `${AC1} the first stop`).toEqual([]);
  }, 15 * MINUTE);
});

describe(`AC2 ${AC2} The next stop, after the fix, reads PASS with its test count, and its verdict names the commit it judged`, () => {
  it(`AC2 ${AC2} the stop after the fix is committed reads PASS with 3 tests, and its PASS verdict names the fix's commit`, async () => {
    expect(passProblems(await main()), `${AC2} the stop after the fix`).toEqual([]);
  }, 15 * MINUTE);
});

describe(`AC3 ${AC3} A check cut short by a hub restart reads INCONCLUSIVE, and one that ran zero tests reads INVALID; neither line ever says PASS`, () => {
  it(`AC3 ${AC3} a check whose tests are all skipped reads INVALID at its stop, a check cut short by a hub restart reads INCONCLUSIVE, and no line of either says PASS`, async () => {
    expect(cutAndZeroProblems(await side()), `${AC3} zero tests and a hub restart`).toEqual([]);
  }, 20 * MINUTE);
});

describe(`AC4 ${AC4} Every verdict is a row in the record with the commit it judged, and \`deep status\` shows the same outcome as the chat`, () => {
  it(`AC4 ${AC4} each stop's line is a verdict row on its claim naming the commit it judged, every verdict names its claim's commit, and deep status shows the line's outcome`, async () => {
    expect(recordProblems(await main()), `${AC4} the record and deep status against the chat`).toEqual([]);
  }, 15 * MINUTE);
});

describe(`AC5 ${AC5} "all done?" typed into the session is answered from the record with no model call`, () => {
  it(`AC5 ${AC5} "all done?" typed after the PASS is blocked from the model and answered with the record's newest verdict`, async () => {
    expect(allDoneProblems(await main()), `${AC5} "all done?"`).toEqual([]);
  }, 15 * MINUTE);
});

describe(`AC6 ${AC6} A planted runner that reports PASS on a check whose command masks its exit status fails this test, naming the check`, () => {
  it(`AC6 ${AC6} the check \`npm test\`, whose package script masks Vitest's exit with \`|| true\`, is never PASS: its claim is INVALID (or FAIL) and no line says PASS`, async () => {
    expect(maskedProblems(await side()), `${AC6} the masked check`).toEqual([]);
  }, 20 * MINUTE);
});
