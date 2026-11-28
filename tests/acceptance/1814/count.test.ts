import { afterAll, describe, expect, it } from 'vitest';
import { ID, LINT, PLANTED_WORD, SECOND, USAGE_ANCHOR, cleanup, lint, lintLaneRuns, plantUsageLine, scratchCheckout } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

describe(`${ID.count} the lint lane holds the count of top-level words`, () => {
  it(`${ID.count} the count's check passes over this checkout and runs in the lint lane`, async () => {
    const { status, output, fails } = lint();
    expect(fails, `the count's check (${LINT}) over this checkout must find nothing:\n${output}`).toEqual([]);
    expect(status, `the count's check (${LINT}) over this checkout must pass:\n${output}`).toBe(0);
    expect(await lintLaneRuns(LINT), `the lint lane (scripts/lanes.mjs checks, name lint) runs ${LINT}`).toBe(true);
  }, 900 * SECOND);

  it(`${ID.count} a planted new top-level command with no entry in the count's list fails it, naming the command`, () => {
    const at = scratchCheckout();
    const control = lint(at);
    expect(control.status, `the count's check passes on the unplanted copy before it is held to the plant:\n${control.output}`).toBe(0);
    const planted = plantUsageLine(at, PLANTED_WORD);
    if (!planted.length) throw Error(`BLOCKED: no file under packages/cli/src or packages/cli/dist holds the usage line ${USAGE_ANCHOR}... to plant deep ${PLANTED_WORD} beside`);
    const { status, output, fails } = lint(at);
    expect(fails.some((fail) => new RegExp(`\\b${PLANTED_WORD}\\b`).test(fail)), `the lint must fail the planted deep ${PLANTED_WORD} (in ${planted.join(', ')}) on a FAIL line naming it:\n${output}`).toBe(true);
    expect(status, `the lint exits 1 on the planted command:\n${output}`).toBe(1);
  }, 900 * SECOND);
});
