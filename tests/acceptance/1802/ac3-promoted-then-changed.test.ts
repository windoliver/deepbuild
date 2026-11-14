// #1802.0d11e259: "A fixture entry promoted and then changed in the same release fails the break diff, naming the field"
//
// asserts: deep.trial is a preview since R1 whose `decide_by` is R3, in the fixture releases R1 and R2, its one param
// `threshold` an integer. In the candidate R3, promoted to stable with the shape it had as a preview, it passes the
// preflight's contract step. Then, in the same candidate, its `threshold` is retyped to a string: the step fails, a
// FAIL line names deep.trial and `threshold`, and the break diff's line for the pair R2_R3 names the entry and the
// field, as it does for any stable entry reshaped since R2 (#139).
// Wrong program: the merge base, whose step leaves an entry out of the break diff when it was a preview in the
// earlier release, so the promoted and reshaped entry passes.

import { expect, it } from 'vitest';
import { TRIAL, check, expectFailNaming, expectPass, promote, retypeThreshold, shown, trialTree } from './helpers.ts';

it('#1802.0d11e259 an entry promoted and then changed in the same release fails the break diff, naming the field', () => {
  const t = trialTree();
  promote(t, TRIAL);
  expectPass(check(t, 'R3'), 'deep.trial promoted in R3 with the shape it had as a preview');
  retypeThreshold(t, TRIAL);
  const r = check(t, 'R3');
  expectFailNaming(r, 'deep.trial promoted in R3 and then reshaped in R3', TRIAL, 'threshold');
  const diff = r.out.split('\n').filter((l) => l.startsWith(`diff: R2_R3 api:${TRIAL} `));
  expect(diff.some((l) => l.includes('threshold')), `the break diff of R2_R3 has a line for deep.trial that names threshold\n${shown(r)}`).toBe(true);
}, 120_000);
