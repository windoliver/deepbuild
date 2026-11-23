// #2218 AC2: a spec check with `accept: 10%` is given 29 runs, the least n with 0.9ⁿ ≤ 0.05. A hub that reads no
// `accept` gives it 1 (issue: Scope, "A spec check's `runs` and `accept` reach the claim's check, and the verdict rules
// count its clean runs against them as they do for a definition's check"; design: How runs become one of five
// verdicts, "runs needed for a check that may be flaky: n = ceil(ln(0.05) / ln(1 − p)), p = 10% → 29 clean runs", and
// "a check with runs still to come ... is pending until they end").
//
// The spec's one check, `suite`, runs tests/suite.js, three tests that always pass, with `accept: 10%`. The session
// types the change, makes the fix and stops. Every run of the check is clean, so the runs the hub gives it on the
// claim are the runs it needs: 29, each a run the record holds for the claim. Then the Scope's second half: the
// verdict rules counted them, so no PASS was made on the claim before its 29th clean run had ended. A run of the
// suite that didn't pass is BLOCKED (thrown): the scenario never reached the criterion.
import { afterEach, describe, expect, it } from 'vitest';
import { AC2, claimed, cleanup, fixture, shop, shownClaim, shownRun } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The least n with 0.9ⁿ ≤ 0.05: 0.9²⁸ ≈ 0.0523, 0.9²⁹ ≈ 0.0471. */
const NEEDED = 29;

describe(`${AC2} a spec check's accept reaches the claim's check`, () => {
  it(`${AC2} with accept: 10%, a check whose every run is clean is given ${NEEDED} runs on the claim, and the claim passes on no fewer`, async () => {
    const clean = (runs: { check: string; outcome: string | null }[]): number => runs.filter((r) => r.check === 'suite' && r.outcome === 'passed').length;
    const c = await claimed(AC2, await shop({ spec: fixture('accept.yaml') }), { done: (r) => clean(r.runs) >= NEEDED });
    const runs = c.runs.filter((r) => r.check === 'suite');
    expect(runs.length, `${AC2} the trusted repo's spec check suite must run on the claim: ${shownClaim(c)}`).toBeGreaterThan(0);
    const unclean = runs.filter((r) => r.outcome !== 'passed');
    if (unclean.length) throw Error(`BLOCKED: ${AC2} the fixture's suite always passes, so every run of it must have ended passed: ${unclean.map(shownRun).join('; ')}`);
    expect(runs.length, `${AC2} the spec gives suite accept: 10%, so it needs ${NEEDED} clean runs, the least n with 0.9ⁿ ≤ 0.05; the hub gave it ${runs.length}, not ${NEEDED}: ${shownClaim(c)}`).toBe(NEEDED);
    const ended = runs.map((r) => r.finished!.log_pos).sort((a, b) => a - b);
    const early = c.verdicts.filter((v) => v.data.outcome === 'PASS' && v.log_pos < ended[NEEDED - 1]!);
    expect(early.length, `${AC2} the verdict rules count suite's clean runs against the ${NEEDED} it needs, so the claim can't pass on fewer: a PASS was made at log position ${early[0]?.log_pos} with ${ended.filter((at) => at < (early[0]?.log_pos ?? 0)).length} clean runs ended`).toBe(0);
  }, 2_400_000);
});
