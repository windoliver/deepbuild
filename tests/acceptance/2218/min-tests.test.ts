// #2218 AC3: a spec check with `min_tests: 5` whose suite runs 3 tests is INVALID, naming 3 and 5, and with
// `min_tests: 3` it passes. A hub that reads no `min_tests` passes both and fails this test (issue: Scope, "`min_tests`
// is read: a run that counted fewer tests than it names is INVALID, naming both counts"; design: Check health, "Each
// run records how many tests actually ran"; How runs become one of five verdicts, INVALID names which check and why).
//
// The fixture repo is trusted, and its spec names one check, `suite`: `node --test tests/suite.js`, three tests that
// pass on the base commit and after the session's fix. In each world a session types the change, makes the fix and
// stops; the handed definition's one requirement passes, so the claim's verdict turns on the spec's check alone. The
// passing half comes first: with `min_tests: 3` the suite's run passes and so does the claim, on the base commit too.
// Then the same repo with `min_tests: 5`. That each run counted 3 tests is read from the run's own record first: a
// fixture that counted otherwise is BLOCKED (thrown), not judged.
import { afterEach, describe, expect, it } from 'vitest';
import { AC3, claimed, cleanup, counts, fixture, names, shop, shownClaim, shownRun, wordsOf, type Claimed } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The claim of a session in a repo whose spec gives `suite` this `min_tests`, with each run of the suite counted at 3 tests. */
async function suiteClaim(min: 3 | 5, who: string, done: string): Promise<Claimed> {
  const c = await claimed(who, await shop({ spec: fixture(`min-tests-${min}.yaml`) }), { done: (r) => r.outcome === done });
  const runs = c.runs.filter((r) => r.check === 'suite');
  expect(runs.length, `${who} the trusted repo's spec check suite must run on the claim: ${shownClaim(c)}`).toBeGreaterThan(0);
  const miscounted = runs.filter((r) => r.outcome === null || r.tests !== 3);
  if (miscounted.length) throw Error(`BLOCKED: ${who} the fixture's suite holds 3 tests, and each run of it must have counted 3: ${miscounted.map(shownRun).join('; ')}`);
  return c;
}

describe(`${AC3} a spec check's min_tests is read`, () => {
  it(`${AC3} a suite that runs 3 tests passes with min_tests: 3, and with min_tests: 5 is INVALID, naming the check, 3 and 5`, async () => {
    const met = await suiteClaim(3, `${AC3} [min_tests: 3]`, 'PASS');
    expect(met.runs.filter((r) => r.check === 'suite').every((r) => r.outcome === 'passed'), `${AC3} [min_tests: 3] the suite check counted 3 tests and its spec names min_tests: 3, so its run passes: ${shownClaim(met)}`).toBe(true);
    expect(met.outcome, `${AC3} [min_tests: 3] the suite check counted the 3 tests min_tests names and the definition's requirement passed, so the claim passes: ${shownClaim(met)}`).toBe('PASS');
    await cleanup();

    const who = `${AC3} [min_tests: 5]`;
    const c = await suiteClaim(5, who, 'INVALID');
    expect(c.outcome, `${who} the suite check counted 3 tests and its spec names min_tests: 5, so the claim must be INVALID, naming 3 and 5; the hub read no min_tests and judged it ${c.outcome ?? 'with no verdict'}, as it judged the same suite with min_tests: 3 (${met.outcome}): ${shownClaim(c)}`).toBe('INVALID');
    const said = wordsOf(c.last).filter((text) => names(text, 'suite'));
    expect(said.length, `${who} the INVALID verdict must name the check, suite: ${JSON.stringify(wordsOf(c.last))}`).toBeGreaterThan(0);
    expect(said.some((text) => counts(text, 3) && counts(text, 5)), `${who} the INVALID verdict must name both counts, the 3 tests the run counted and the 5 that min_tests names: ${JSON.stringify(said)}`).toBe(true);
  }, 3_000_000);
});
