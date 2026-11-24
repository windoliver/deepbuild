// #1869 #1869.2a6f926a: with git stubbed to fail on `diff` for a claim that edits an approved check's test file, the
// claim does not read PASS, and the check's line names the failed read. A runner that treats the error as no change
// passes the claim and fails this test, naming the check.
//
// The hub's GateRunner on the bench (bench.ts): the session's worktree edits `test/total.check.cjs`, the own test file
// of the approved check `total`, so it still passes. The control, on a bench of its own with git unstubbed, must read
// that claim as not PASS with a line naming the check as the agent's own (else the bench can't see the edit: BLOCKED).
// Then the same claim on a fresh bench, every `git diff` in the worktree failing: it must not read PASS, and a line of
// its verdict must name both the check and the failed `diff` read.
import { describe, expect, it } from 'vitest';
import { EDITED_TEST, openBench, shown, TEST_FILE, TOTAL } from './bench.ts';

const AC1 = '#1869.2a6f926a';

describe(`${AC1} a claim that edits an approved check's test file, with git diff failing, does not read PASS, and the check's line names the failed read`, () => {
  it(`${AC1} git diff fails in the worktree for a claim that edits ${TEST_FILE}: not PASS, ${TOTAL.check}'s line names the failed diff`, async () => {
    // The control: the edit, read whole, makes the approved check the agent's own.
    const control = await openBench({ [TEST_FILE]: EDITED_TEST });
    try {
      const { replied } = await control.stop({ session: 'session:control', claim: 'claim:01K9C0NTR0L000000000000000' });
      const v = control.verdict('claim:01K9C0NTR0L000000000000000');
      if (!replied || !v || v.outcome === 'PASS' || v.outcome === 'pending' || !v.reasons.some((r) => r.includes(TOTAL.check) && r.includes(TEST_FILE)))
        throw Error(`BLOCKED: with git unstubbed, the claim that edits ${TEST_FILE} should read other than PASS, naming ${TOTAL.check} as the agent's own; it read ${shown(v)} (replied: ${replied}, runs: ${control.outcomes.join(', ') || 'none'})`);
    } finally {
      await control.close();
    }

    const b = await openBench({ [TEST_FILE]: EDITED_TEST });
    try {
      b.arm('diff-fails');
      const claim = 'claim:01K9D1FF0000000000000000000';
      const { replied } = await b.stop({ session: 'session:diff', claim });
      const failed = b.stubbed().filter((s) => s.did === 'failed');
      if (!failed.length) throw Error(`BLOCKED: the gate never ran git diff in the session's worktree, so the stub failed nothing (runs: ${b.outcomes.join(', ') || 'none'})`);
      if (!b.outcomes.includes('passed')) throw Error(`BLOCKED: ${TOTAL.check} never ran to a pass on the claim (runs: ${b.outcomes.join(', ') || 'none'}), so a PASS could not be told from the failed read`);
      const v = b.verdict(claim);
      const reads = failed.map((s) => s.args).join('; ');
      expect(replied, `${AC1} the stop never replied within its hold, the stub having failed ${reads}`).toBe(true);
      expect(v?.outcome, `${AC1} the claim read ${shown(v)}: approved check ${TOTAL.check} passed it though the claim edits ${TEST_FILE}, its own test file, because the failed read (${reads}) was taken as no change`).not.toBe('PASS');
      expect(v?.outcome, `${AC1} the claim has no verdict yet: ${shown(v)}`).not.toBe('pending');
      const line = v?.reasons.find((r) => r.includes(TOTAL.check) && /\bdiff\b/.test(r));
      expect(line, `${AC1} no line of the verdict names both ${TOTAL.check} and the failed read (${reads}): ${shown(v)}`).toBeDefined();
    } finally {
      await b.close();
    }
  }, 300_000);
});
