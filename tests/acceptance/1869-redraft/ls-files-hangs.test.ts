import { describe, expect, it } from 'vitest';
import { CODE, EDITED_CODE, openBench, shown, STOP_HOLD_MS, TOTAL } from './bench.ts';

const AC2 = '#1869.c671af33';

describe(`${AC2} with git ls-files hanging, the claim gets a verdict other than PASS before its stop hold ends, naming the timed-out read`, () => {
  it(`${AC2} git ls-files hangs in the worktree: before the ${STOP_HOLD_MS / 1000} s stop hold ends, a verdict other than PASS naming the ls-files read`, async () => {
    const control = await openBench({ [CODE]: EDITED_CODE });
    try {
      const claim = 'claim:01K9C0NTR0L000000000000000';
      const { replied } = await control.stop({ session: 'session:control', claim });
      const v = control.verdict(claim);
      if (!replied || v?.outcome !== 'PASS') throw Error(`BLOCKED: with git unstubbed, the claim that edits ${CODE} alone should read PASS; it read ${shown(v)} (replied: ${replied}, runs: ${control.outcomes.join(', ') || 'none'})`);
    } finally {
      await control.close();
    }

    const b = await openBench({ [CODE]: EDITED_CODE });
    try {
      b.arm('ls-files-hangs');
      const claim = 'claim:01K9L5F1LE5000000000000000';
      const { replied } = await b.stop({ session: 'session:ls-files', claim });
      const v = b.verdict(claim);
      const hung = b.stubbed().filter((s) => s.did === 'hung');
      if (!hung.length) throw Error(`BLOCKED: the gate never listed tracked files with git ls-files in the session's worktree, so the stub hung nothing (runs: ${b.outcomes.join(', ') || 'none'})`);
      const reads = hung.map((s) => s.args).join('; ');
      expect(replied, `${AC2} the claim got no verdict before its ${STOP_HOLD_MS / 1000} s stop hold ended: the stop was still waiting on the hung read (${reads}); it reads ${shown(v)}`).toBe(true);
      expect(v?.outcome, `${AC2} the claim has no verdict at the end of its stop: ${shown(v)}`).not.toBe('pending');
      expect(v?.outcome, `${AC2} the claim read ${shown(v)}: the hung read (${reads}) was taken as no change, so ${TOTAL.check} passed it`).not.toBe('PASS');
      const line = v?.reasons.find((r) => /\bls-files\b/.test(r));
      expect(line, `${AC2} no line of the verdict names the timed-out read (${reads}): ${shown(v)}`).toBeDefined();
    } finally {
      await b.close();
    }
  }, 300_000);
});
