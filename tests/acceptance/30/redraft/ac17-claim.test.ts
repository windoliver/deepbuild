// AC17, the claim's half (a blind redraft; the run's half is in ../retries.test.ts): a suite whose tool retries a
// failed test inside one run counts every attempt the tool's report lists, so a test that fails and then passes on
// its retry is a pass and a fail on that commit, and its check is INCONCLUSIVE naming the test. A tool whose report
// can't list attempts runs with its own retries off, by its flag, which the record names; then the test failed the
// run and the claim is FAIL naming it (README, Readings: Retries; either reading passes, as retries.test.ts accepts).
// The run is made for real through @deepbuild/checks-command and judged through @deepbuild/gate's claimVerdict.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../../packages/checks-command/src/index.ts';
import { claimVerdict } from '../../../../packages/gate/src/index.ts';
import type { Verdict } from '../../../../packages/verdicts/src/index.ts';
import { claimOf, command, openWorld, outputOf, project, REQ, VITEST, type World } from '../helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** The fixture's retried test (fixtures/retry/test/order.test.ts: fails its first attempt, passes its retry). */
const TEST = 'settles the order';
const CHECK = 'retry-suite';

const reasons = (v: Verdict): string => v.reasons.join('\n');
const claim = (r: CommandRun) => claimOf({ check: CHECK, command: VITEST, runs: [r] });

/**
 * The criterion's assertion on the claim judged from the retry suite's run. With the tool's report listing both
 * attempts (`retries` null), "settles the order" failed and passed on the commit, so the check and the claim are
 * INCONCLUSIVE; with the tool's retries turned off by the flag `retries` names, it failed the run, so they are FAIL.
 * Never PASS either way, and a reason names the test. The first assertion's message carries the test's name itself:
 * a planted gate that lets the claim through makes a verdict whose reasons name nothing, so that message is the only
 * place the name can come from when it fails (tests/acceptance/29/REDRAFT.md, the floor tests).
 */
function claimCountsEveryAttempt(r: CommandRun, v: Verdict): void {
  const expected = r.retries === null ? 'INCONCLUSIVE' : 'FAIL';
  const how = r.retries === null
    ? `the tool's report lists its attempts, so "${TEST}" is a pass and a fail on this commit`
    : `the tool's retries were off by ${r.retries}, so "${TEST}" failed the run`;
  const check = v.checks.find((c) => c.check === CHECK);
  expect(check?.outcome, `${how}: the check is ${expected}, never PASS (attempts: ${JSON.stringify(r.attempts)}; checks: ${JSON.stringify(v.checks.map((c) => [c.check, c.outcome]))}; reasons: ${reasons(v)})`).toBe(expected);
  expect(v.outcome, `the claim is ${expected} with its only check: ${reasons(v)}`).toBe(expected);
  expect(v.requirements.find((q) => q.req === REQ)?.outcome, `the requirement the check covers is ${expected}`).toBe(expected);
  expect(v.reasons.some((why) => why.includes(TEST)), `a reason names "${TEST}": ${reasons(v)}`).toBe(true);
}

describe('AC17 #30.a06dc35a a test that fails and passes on its retry within one run makes the claim INCONCLUSIVE naming it, or FAIL with the tool\'s retries off (the claim\'s half; the run\'s is in retries.test.ts)', () => {
  it(`AC17 the claim on the retry suite's run, where "${TEST}" fails once and passes on its retry, is INCONCLUSIVE naming the test (FAIL naming it when the run turned the tool's retries off by its flag), never PASS`, async () => {
    const r = await runCommandCheck(command(world.sup, project('retry'), VITEST));
    expect(r.retries === null || typeof r.retries === 'string', `the record says whether the tool's retries were turned off: ${JSON.stringify(r.retries)}`).toBe(true);
    if (r.retries !== null) expect(r.retries, 'the flag that turned the tool\'s retries off').toMatch(/\S/);
    const v = claimVerdict(claim(r));
    claimCountsEveryAttempt(r, v);
  }, 180_000);

  it(`AC17 (wrong program) a runner that reads only each test's last attempt passes the fixture test that fails once and passes on its retry, so its claim passes and fails this test, naming "${TEST}"`, async () => {
    const r = await runCommandCheck(command(world.sup, project('retry'), VITEST, { plant: 'last-attempt-only' }));
    if (r.outcome !== 'passed') throw Error(`BLOCKED: the planted runner didn't pass the retried test (outcome ${r.outcome}), so the wrong program wasn't shown: ${outputOf(r).slice(0, 800)}`);
    // The verdict is made outside the expectation: a claim that can't be made (a run that never started) is BLOCKED, never a match.
    const v = claimVerdict(claim(r));
    expect(v.outcome, `the last-attempt runner's claim passes (the wrong program must itself run): ${reasons(v)}`).toBe('PASS');
    expect(() => claimCountsEveryAttempt(r, v)).toThrow(new RegExp(TEST));
  }, 180_000);
});
