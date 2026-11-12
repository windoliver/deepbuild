// AC1: through `deep_claim` on a real hub, a claim whose final message says "1.8× faster than the merge base" and cites
// a timing check whose five repeats a side show 1.2× is FAIL, naming the stated speed (issue Scope: the hub judges each
// speed a claim states through `checkSpeed` on its timing check's two sides; #87: a stated speed is judged on five
// runs a side, as a timing result is). Wrong program it fails on: the merge base, where no stated speed is judged, so
// the claim passes and the failure names the claim.
//
// The repo holds a timing check (helpers.ts: TIMING_FILE) whose work is a wait read from bench.env: 6 s at the merge
// base, 5 s once the session's edit is made, so the change really is 1.2× faster, five repeats a side. The wait is the
// one cost a loaded machine can't stretch, so 1.2× decides FAIL, never INCONCLUSIVE (README: Fixtures).
import { afterAll, describe, it } from 'vitest';
import { AC1, SPEED_EDIT, SPEED_WORDS, STATED, TIMING_FILE, addToBase, claimWorld, claimed, cleanup, must, outcomeOf, sayVerdicts, speedFiles, startHub, stopHub, trustRepo } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC1} a stated speed its timing check doesn't show is FAIL`, () => {
  it(`${AC1} "${STATED} faster than the merge base" over a timing check showing 1.2× is FAIL and names ${STATED}`, async () => {
    const w = addToBase(claimWorld({ files: speedFiles(), deliverables: [SPEED_EDIT.file] }), {});
    await trustRepo(w, true);
    const hub = await startHub(w);
    try {
      const { claim, verdicts } = await claimed(hub, w, AC1, SPEED_EDIT, SPEED_WORDS, 900_000);
      must(verdicts.length > 0, `${AC1} ${claim}, stating ${STATED} faster, must be judged: no verdict was recorded`);
      must(!verdicts.some((v) => outcomeOf(v) === 'INCONCLUSIVE') || verdicts.some((v) => outcomeOf(v) === 'FAIL'), `BLOCKED: ${AC1} ${claim}'s timing was a reading (INCONCLUSIVE) on this machine, not a decision: ${sayVerdicts(verdicts)}`);
      const last = verdicts.at(-1)!;
      must(outcomeOf(last) === 'FAIL', `${AC1} ${claim} states "${STATED} faster than the merge base" and cites ${TIMING_FILE}, whose five repeats a side show 1.2×, so it is FAIL; the stated speed was not judged: ${sayVerdicts(verdicts)}`);
      must(JSON.stringify(last.data).includes(STATED), `${AC1} the FAIL on ${claim} names the stated speed ${STATED}: ${sayVerdicts([last])}`);
    } finally {
      await stopHub(hub);
    }
  }, 1_200_000);
});
