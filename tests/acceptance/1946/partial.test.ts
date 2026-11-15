// AC3 #1946.525c8ef7, its last clause: an undo stopped after the first of its three steps records the step it undid
// and the two left.
//
// One world on dh-ubuntu (README, The worlds), a throwaway user there with lingering on, so no host change for
// lingering is recorded and the three changes below are all Remove it undoes. helpers.ts's judgePartial: one remote run
// as you writes p1/file, p2/file and p3/file in the test's folder, each its own change with its undo (`rm -f`); the
// harness then makes p2 read-only as root, so the second undo fails as you while every file still matches what was
// written; `deep host remove dh-ubuntu`; the record's host.undone (grant you) must be partial, list one step undone (the
// first or the third, whichever end the undo starts from) and the other two left, and the host must agree.
import { describe, expect, test } from 'vitest';
import { AC, judgePartial, openWorld, proof, redact } from './helpers.ts';

describe(AC[3], () => {
  test('an undo stopped after the first of its three steps records the step it undid and the two left', async () => {
    const w = await openWorld('deep-ubuntu');
    const { failures, seen } = await judgePartial(w);
    proof('ac3-partial.json', { failures, seen, answered: w.answered });
    expect(failures.map(redact), 'the judge finds nothing wrong').toEqual([]);
  }, 1_800_000);
});
