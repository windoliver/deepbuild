// #1802.18e8cff0: "A fixture release removes a method, with a break file that quotes the removal, and a later commit
// restores the method. The step fails, naming the file and the quoted line that no longer occurs. A planted step that
// only prints the line passes and fails this test"
//
// asserts: R1 is recorded with the stable method deep.gone. The fixture release R2 removes it: with no break file the
// step fails naming deep.gone, and with contracts/breaks/R1_R2/1802.txt, which quotes
// `diff: R1_R2 api:deep.gone / removed` and a workaround, it passes, naming that file as the one it used. A later
// commit restores deep.gone as it was. The step on R2 then fails, and one FAIL line holds the file's path and the
// quoted line. The planted step (plants/reports-only.mjs: the same step, which prints each failure as a warning and
// exits 0) prints a line holding both, passes, and fails this criterion's check, naming the file and the line.
// Wrong programs: `reports-only`; the merge base, whose step asks only whether each break has a file and passes the
// restored tree.

import { expect, it } from 'vitest';
import { GONE_FILE, GONE_LINE, REPORTS_ONLY, STEP, check, failedNaming, failsNaming, none, restoredTree, shown } from './helpers.ts';

/** The criterion's check on a step: with deep.gone restored it fails, one FAIL line naming the break file and the line it quotes. */
function staleLineFailures(program: string): string[] {
  const r = check(restoredTree(), 'R2', program);
  return failedNaming(r, GONE_FILE, GONE_LINE) ? [] : [`with deep.gone restored, the step doesn't fail naming ${GONE_FILE} and the line it quotes that R1_R2's diff no longer holds, ${GONE_LINE}: ${shown(r)}`];
}

it('#1802.18e8cff0 a release removes a method with a break file that quotes the removal, a later commit restores it, and the step fails naming the file and the quoted line', () => {
  none(staleLineFailures(STEP), 'the step on R2 with deep.gone restored');
}, 300_000);

it('#1802.18e8cff0 a planted step that only prints the line passes, and this test fails it', () => {
  none(staleLineFailures(STEP), 'the shipped step, held to the same check first');
  const printed = check(restoredTree(), 'R2', REPORTS_ONLY);
  expect(printed.code, `the planted step passes R2 with deep.gone restored\n${shown(printed)}`).toBe(0);
  expect(printed.out.split('\n').filter((l) => l.includes(GONE_FILE) && l.includes(GONE_LINE)).length, `and prints a line naming the file and the quoted line\n${shown(printed)}`).toBeGreaterThan(0);
  failsNaming(staleLineFailures(REPORTS_ONLY), [GONE_FILE, GONE_LINE], 'a step that only prints the line');
}, 300_000);
