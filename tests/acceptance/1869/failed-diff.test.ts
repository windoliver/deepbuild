// #1869 AC1 #1869.2a6f926a: with git stubbed to fail on `diff` for a claim that edits an approved check's test file,
// the claim does not read PASS, and the check's line names the failed read. A runner that treats the error as no change
// passes the claim and fails this test, naming the check.
//
// The gate runner on this suite's bench (gate.ts). The merge base holds an approved definition check, price-approved,
// whose test file test/price.check.cjs passes. The session's worktree edits that test file (one more line; it still
// passes). First, with no stub, the claim must already be judged on its check as the agent's own (design: Whose checks
// count), or the scenario never reached the criterion (BLOCKED). Then a second bench, the same scenario, with every
// `git diff` in the worktree failing: the claim must not read PASS, and a line of its verdict naming price-approved
// must name the failed `git diff`. On the base `changesOf` reads the failed diff as an empty list, the edit is never
// seen, and the claim passes: the test fails naming price-approved.
import { describe, expect, it } from 'vitest';
import { EDITED_TEST, openBench, PRICE, shown, TEST_FILE, write, type Bench } from './gate.ts';

const AC1 = '#1869.2a6f926a';

/** The claim of a stop on a worktree that edited the approved check's test file, with the stub as given. */
async function judged(stub: 'off' | 'fail-diff'): Promise<{ b: Bench; claim: string }> {
  const b = await openBench({ hold_ms: 60_000 });
  write(b.repo, { [TEST_FILE]: EDITED_TEST });
  b.stub(stub);
  const claim = `claim:1869-ac1-${stub}`;
  await b.stop({ session: `S1869${stub === 'off' ? 'a' : 'b'}`, claim, checks: [PRICE], stopAt: Date.now() });
  b.stub('off');
  if (b.invalids.some((i) => i.claim === claim && /snapshot|budget/i.test(i.reason))) throw Error(`BLOCKED: the base-commit service gave ${claim} no snapshot (${JSON.stringify(b.invalids)}), so its check never ran`);
  if (stub === 'off' && b.outcomes.join() !== 'passed') throw Error(`BLOCKED: ${PRICE.check} ran as ${b.outcomes.join(', ') || 'nothing'} for ${claim}, not one passing run`);
  return { b, claim };
}

describe(`${AC1} with git stubbed to fail on diff for a claim that edits an approved check's test file, the claim does not read PASS, and the check's line names the failed read`, () => {
  it(`${AC1} every git diff in the worktree fails: the claim is not PASS, and ${PRICE.check}'s line names the failed git diff`, async () => {
    // The scenario reaches the criterion: with git as it is, the edit makes the approved check the agent's own.
    const control = await judged('off');
    try {
      const v = control.b.seen(control.claim);
      if (!v || v.outcome === 'PASS' || !v.reasons.some((r) => r.includes(PRICE.check) && r.includes(TEST_FILE))) {
        throw Error(`BLOCKED: with no stub, the claim that edits ${TEST_FILE} reads ${shown(v)}, not judged on ${PRICE.check} as the agent's own, so the scenario never reaches the criterion`);
      }
    } finally {
      await control.b.close();
    }

    const { b, claim } = await judged('fail-diff');
    try {
      const failed = b.stubbed().filter((s) => s.did === 'failed');
      if (!failed.length) throw Error(`BLOCKED: the stub failed no git diff in the worktree for ${claim}, so the criterion's read was never stubbed`);
      const v = b.seen(claim);
      expect(v?.outcome, `${AC1} ${PRICE.check}: git diff failed (${failed.map((s) => `git ${s.args}`).join('; ')}) for a claim that edits ${PRICE.check}'s test file ${TEST_FILE}, so the claim must not read PASS; it reads ${shown(v)}`).toBeDefined();
      expect(v!.outcome, `${AC1} ${PRICE.check}: git diff failed for a claim that edits ${PRICE.check}'s test file ${TEST_FILE}, yet the claim reads PASS, as if it changed nothing: ${shown(v)}`).not.toBe('PASS');
      const line = v!.reasons.find((r) => r.includes(PRICE.check) && /\bgit diff\b|\bdiff\b/i.test(r) && /fail|error|could ?n[o']?t|unread|exit|fatal/i.test(r));
      expect(line, `${AC1} ${PRICE.check}'s line must name the failed git diff; the verdict reads ${shown(v)}`).toBeDefined();
    } finally {
      await b.close();
    }
  }, 120_000);
});
