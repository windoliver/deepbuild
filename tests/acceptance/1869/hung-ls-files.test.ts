// #1869 AC2 #1869.c671af33: with git stubbed to hang on `ls-files`, the claim gets a verdict other than PASS before
// its stop hold ends, naming the timed-out read.
//
// The gate runner on this suite's bench (gate.ts), given a stop hold of 15 s (HOLD_MS) and core.ts's 10 s snapshot
// budget. The session's worktree edits the approved check's test file, as in AC1. Every `git ls-files` in the worktree
// hangs but the base-commit service's own (gate.ts says how they are told apart), so the snapshot and checkout are made
// and the gate runner's read of what the claim changed never returns. The stop is not awaited: from `stopAt` the claim's
// verdict is read every 50 ms, from the runner's `verdictOf` (past pending) or from what it handed `invalid` for the
// claim, until `stopAt + HOLD_MS`. One must have come by then, not PASS, with a line naming the timed-out ls-files. On
// the base `changesOf` has no deadline: the stop waits on the hung read, the claim is never registered, and no verdict
// comes before the hold ends.
import { describe, expect, it } from 'vitest';
import { EDITED_TEST, openBench, PRICE, shown, sleep, TEST_FILE, write, type Seen } from './gate.ts';

const AC2 = '#1869.c671af33';
const HOLD_MS = 15_000;

describe(`${AC2} with git stubbed to hang on ls-files, the claim gets a verdict other than PASS before its stop hold ends, naming the timed-out read`, () => {
  it(`${AC2} every git ls-files of the claim's changes hangs: a verdict other than PASS, naming the timed-out ls-files, comes within the ${HOLD_MS / 1000} s hold`, async () => {
    const b = await openBench({ hold_ms: HOLD_MS });
    try {
      write(b.repo, { [TEST_FILE]: EDITED_TEST });
      b.stub('hang-ls-files');
      const claim = 'claim:1869-ac2';
      const stopAt = Date.now();
      let thrown: unknown;
      void b.stop({ session: 'S1869c', claim, checks: [PRICE], stopAt }).catch((error: unknown) => { thrown = error; });
      let v: Seen | undefined;
      while (Date.now() < stopAt + HOLD_MS && thrown === undefined) {
        v = b.seen(claim);
        if (v) break;
        await sleep(50);
      }
      const hung = b.stubbed().filter((s) => s.did === 'hung');
      if (thrown !== undefined) throw Error(`BLOCKED: the stop threw (${thrown instanceof Error ? thrown.message : String(thrown)}) before any verdict`);
      if (!hung.length) throw Error(`BLOCKED: the stub hung no git ls-files in the worktree for ${claim}, so the criterion's read was never stubbed`);
      if (v && /snapshot over budget/i.test(v.reasons.join(' '))) throw Error(`BLOCKED: the base-commit service's own snapshot ran over its budget (${shown(v)}), so the stub hung the snapshot, not the read of what the claim changed`);

      const hungReads = hung.map((s) => `git ${s.args}`).join('; ');
      expect(v, `${AC2} git ls-files hung (${hungReads}); the claim must get a verdict before its stop hold ends at stopAt + ${HOLD_MS} ms, yet none came: verdictOf reads ${JSON.stringify(b.gate.verdictOf(claim)?.outcome ?? null)}, invalid was handed ${JSON.stringify(b.invalids)}`).toBeDefined();
      expect(v!.at - stopAt, `${AC2} the verdict came ${v!.at - stopAt} ms after the stop, past its ${HOLD_MS} ms hold`).toBeLessThan(HOLD_MS);
      expect(v!.outcome, `${AC2} git ls-files hung, yet the claim reads PASS: ${shown(v)}`).not.toBe('PASS');
      const line = v!.reasons.find((r) => /ls-files/.test(r) && /tim(e|ed)[ -]?out|deadline|took longer|too long|past|over ?ran|hung|stuck|no answer|never (returned|ended|answered)/i.test(r));
      expect(line, `${AC2} a line of the verdict must name the timed-out git ls-files; it reads ${shown(v)}`).toBeDefined();
    } finally {
      await b.close();
    }
  }, 90_000);
});
