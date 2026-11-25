// AC4 #1857.df51c34e: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a document
// of 5,000 items holding one instance whose step repeats a nested recipe 1,024 times checks in under 1 s; a planted
// expansion that copies the document's items for each nested instance takes longer and fails"
//
// Every child is one `deep-show run` under `bounded.mjs`: 300 s to answer and 4,096 MB of resident memory, stopped by
// PID past either (README: What bounds each child). It is given the board of 4,999 rects and `g1`, a rows.sheet@1,
// 5,000 items, shown by the agent's `deep_show` with its issues and the check's own time.
//
// asserts:
// 1. On any machine: the child ran to its own end inside its limits, and the board checks whole: no error is
//    `over_budget`, and `g1`'s expansion holds exactly its 2,048 derived items, `g1.rows.0` to `g1.rows.1023` and
//    each one's `.dot` (rows.sheet@1's step `rows` repeats rows.row@1 1,024 times; rows.row@1's one step is `dot`).
//    The board isn't required to be presented (README: Readings).
// 2. Where a time counts (a reference Mac on mains power, Low Power Mode off, thermal state nominal, a 1-minute load
//    under its cores): over five more children, each passing 1, the check's own time `timing.check_ms` is under
//    1,000 ms by the design's rule (PASS all five under; FAIL all five over by more than the margin, the larger of
//    5% and their spread; else INCONCLUSIVE). Anywhere else the test ends INCONCLUSIVE after 1, as a skip that says
//    so, never a pass.
// 3. Under the planted `expansion_copies_items`, where a time counts, the same budget check fails: a child out of
//    time, or all five runs over 1,000 ms by more than the margin. Anywhere else, INCONCLUSIVE.
//
// "Compared with the merge base" is the budget window's, on the task of `benchmarks/budgets.json` that names
// #1857.df51c34e (README: What the implementer adds outside the folder); this file is the criterion's own number,
// read on the binary the tests build.
//
// Wrong programs: the merge base, where each of g1's 1,024 nested instances copies the board's item map of 5,000
// items and more; the planted `expansion_copies_items`.

import { describe, expect, it } from 'vitest';
import { SHEET_WHAT, sheetCheck } from './cases.ts';
import { fitOrSkip, none, settle, useDir, useShow, type Planted } from './helpers.ts';
import { CHECK_LIMIT_MS, OUT_OF_TIME, judgeRuns, type Verdict } from './judge.ts';

// The criterion's tag, a constant of this file, so a test's name reads whole from its source.
const AC4 = 'AC4 #1857.df51c34e';

const bin = useShow();
const dir = useDir();
const RUNS = 5;

/** Five children's check times, judged; 'out of time' if one of them had to be stopped at its deadline. */
function budget(planted?: Planted): Verdict | 'out of time' {
  const times: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const checked = sheetCheck(dir(), bin(), planted);
    if (checked.failures.some((f) => f.includes(OUT_OF_TIME))) return 'out of time';
    none(checked.failures, `${SHEET_WHAT}${planted ? `, planted ${planted}` : ''} (run ${r + 1} of ${RUNS})`);
    times.push(checked.ms!);
  }
  return judgeRuns(`${SHEET_WHAT}: the check's time${planted ? `, planted ${planted}` : ''}`, times, CHECK_LIMIT_MS, 'ms');
}

describe(`${AC4} a document of 5,000 items holding one instance whose step repeats a nested recipe 1,024 times checks in under 1 s`, () => {
  it(`${AC4} the board checks whole inside the child's limits, g1 expanding to its 1,024 nested rows and their 1,024 dots, and its check takes under 1 s`, (ctx) => {
    none(sheetCheck(dir(), bin()).failures, SHEET_WHAT);
    fitOrSkip(ctx, 'the board checked whole, but "in under 1 s" was not judged');
    const verdict = budget();
    expect(verdict, `${SHEET_WHAT} ran out of time: a child had to be stopped at its deadline`).not.toBe('out of time');
    settle(ctx, [verdict as Verdict]);
  });

  it(`${AC4} a planted expansion that copies the document's items for each nested instance takes longer and fails`, (ctx) => {
    fitOrSkip(ctx, 'whether the planted expansion takes longer than 1 s was not judged');
    // The warm-up: the planted program is there, and either checks the board whole or is already out of time.
    const first = sheetCheck(dir(), bin(), 'expansion_copies_items');
    if (first.failures.some((f) => f.includes(OUT_OF_TIME))) return;
    none(first.failures, `${SHEET_WHAT}, planted expansion_copies_items`);
    const verdict = budget('expansion_copies_items');
    if (verdict === 'out of time') return;
    console.log(`${verdict.status} ${verdict.shown}`);
    if (verdict.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${verdict.shown}; this is not a pass`);
    expect(verdict.status, `the planted expansion_copies_items fails the budget, its check taking longer than 1 s: ${verdict.shown}`).toBe('FAIL');
  });
});
