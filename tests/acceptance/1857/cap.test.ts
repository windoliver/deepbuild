// AC1 #1857.b706b07a: "In a child process with a memory limit, a pack whose four recipes each repeat a nested recipe
// 1,024 times, the last repeating a mark, is refused at check in under 1 s with peak memory under 64 MB, naming the
// instance, the step where the count passes the cap, and the cap; a planted expansion that counts only after it
// expands runs out of time or memory and fails"
// AC2 #1857.2a469c19: "An instance whose input sets a nested step's repeat count to 1,024 is refused the same way,
// naming the input"
// AC3 #1857.0972fd24: "A step param holding `{repeat: {count: 1024, of: {repeat: {count: 1024, of: {repeat: {count:
// 1024, of: 1}}}}}}` is refused the same way, naming the param's path"
//
// Every child is one `deep-show run` under `bounded.mjs`: 60 s to answer and 1,024 MB of resident memory, stopped by
// PID past either (README: What bounds each child). It is given one board that names one test pack and holds one
// instance, shown by the agent's `deep_show` with its issues and the check's own time.
//
// asserts, for each board:
// 1. On any machine: the child ran to its own end inside its limits (never stopped, exit 0, one answer); the reply
//    is `refused`; and one `over_budget` error names all its criterion says: the instance in `ids`, the cap the
//    Recipe section states beside "at most 1,024 per repeat" anywhere in the issue, and in `actual` the count the
//    expansion would reach, a whole number past that cap; and
//    - AC1: in `path`, a step of the chain (`steps/floors`, `steps/rooms`, `steps/shelves` or `steps/books`);
//    - AC2: the input `per_side`, anywhere in the issue;
//    - AC3: in `path`, the param's path `steps/mat/params/threads`.
// 2. Where a time and a peak count (a reference Mac on mains power, Low Power Mode off, thermal state nominal, a
//    1-minute load under its cores): over five more children, each passing 1, the check's own time
//    `timing.check_ms` is under 1,000 ms and the child's peak memory footprint, as `/usr/bin/time -l` reports it,
//    is under 64 MB (64 x 2^20 bytes), by the design's rule: PASS when all five are under the limit, FAIL when all
//    five are over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. Anywhere else
//    the test ends INCONCLUSIVE after 1, as a skip that says so: never a pass, since the criterion's numbers were
//    not judged.
//
// The boards (README: Fixtures; each count is from the pack's files and the Recipe section's `<instance>.<step>.<index>`):
// - `t1`, a `tower.block@1`: the criterion's four recipes as written. 1,024 floors of 1,024 rooms of 1,024 shelves of
//   1,024 books would be 1,024 + 1,024^2 + 1,024^3 + 1,024^4 = 1,100,586,419,200 derived items. Its first book would
//   be `t1.floors.0.rooms.0.shelves.0.books.0`, an ID of nine segments where an ID holds eight, so no program expands
//   this board, and one that expands before it counts stops at that ID at once (README: Readings).
// - `f1`, a `tower.floor@1`: the same pack's last three recipes, the deepest chain whose IDs fit:
//   1,024 + 1,024^2 + 1,024^3 = 1,074,791,424 derived items. This is the board the planted expansion runs out on.
// - `d1`, a `dial.grid@1` with `per_side: 1024`: as `f1`, each count set by the input: 1,074,791,424 derived items.
// - `w1`, a `weave.mat@1`: one rect whose param `threads` is the criterion's value with the `as` the grammar asks
//   of a `{repeat}` list: 1,024 + 1,024^2 + 1,024^3 = 1,074,791,424 list elements.
//
// Wrong programs: the merge base, which has no cap: it refuses `t1` with `bad_id` and no `over_budget`, and expands
// `f1`, `d1` and `w1` until it is stopped; and the planted `expansion_counts_after` (README: Planted programs), which
// must run out of time or memory on `f1`, on any machine.

import { describe, expect, it, type TestContext } from 'vitest';
import { BLOCK, DIALLED, FLOOR, WOVEN, refusal, type Case } from './cases.ts';
import { failsBy, fitOrSkip, none, settle, useDir, useShow } from './helpers.ts';
import { CHECK_LIMIT_MS, PEAK_LIMIT_BYTES, checkMs, judgeRuns, ranOut, type Verdict } from './judge.ts';

// Each criterion's tag, a constant of this file, so a test's name reads whole from its source.
const AC1 = 'AC1 #1857.b706b07a';
const AC2 = 'AC2 #1857.2a469c19';
const AC3 = 'AC3 #1857.0972fd24';

const bin = useShow();
const dir = useDir();
const RUNS = 5;
const MB = 1024 * 1024;

/** The refusal of each board inside its child's limits, then, where they count, its time and its peak over five more children. */
function refusedWithinLimits(ctx: TestContext, cases: readonly Case[]): void {
  for (const c of cases) none(refusal(dir(), bin(), c).failures, c.what);
  fitOrSkip(ctx, `each board was refused as its criterion says, but "in under 1 s" and "under 64 MB" were not judged`);
  const verdicts: Verdict[] = [];
  for (const c of cases) {
    const times: number[] = [];
    const peaks: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const checked = refusal(dir(), bin(), c);
      none(checked.failures, `${c.what} (run ${r + 1} of ${RUNS})`);
      const time = checkMs(checked.reply!, c.what);
      expect(time.failure, `${c.what}: the check's own time is read`).toBeNull();
      times.push(time.ms!);
      // A peak that can't be read is unknown, never 0: the judge then has fewer than five runs and is INCONCLUSIVE.
      if (checked.run.footprintBytes !== null) peaks.push(checked.run.footprintBytes / MB);
      console.log(`${c.what}, run ${r + 1}: check ${time.ms!.toFixed(3)} ms; peak memory footprint ${checked.run.footprintBytes ?? 'unread'} bytes; maximum resident set size ${checked.run.peakBytes ?? 'unread'} bytes`);
    }
    verdicts.push(judgeRuns(`${c.what}: the check's time`, times, CHECK_LIMIT_MS, 'ms'));
    verdicts.push(judgeRuns(`${c.what}: the child's peak memory footprint`, peaks, PEAK_LIMIT_BYTES / MB, 'MB'));
  }
  settle(ctx, verdicts);
}

describe(`${AC1} a pack whose four recipes each repeat 1,024 times is refused at check in under 1 s with peak memory under 64 MB, naming the instance, the step and the cap`, () => {
  it(`${AC1} t1, the four-recipe chain, and f1, the deepest chain whose IDs fit, are each refused with over_budget inside the child's limits, naming the instance, a step of the chain and the cap, in under 1 s of check and under 64 MB`, (ctx) => {
    refusedWithinLimits(ctx, [BLOCK, FLOOR]);
  });

  it(`${AC1} a planted expansion that counts only after it expands runs out of time or memory on f1 and fails`, () => {
    failsBy(refusal(dir(), bin(), FLOOR, 'expansion_counts_after').failures, ranOut, 'running out of time or memory', 'the planted expansion_counts_after');
  });
});

describe(`${AC2} an instance whose input sets a nested step's repeat count to 1,024 is refused the same way, naming the input`, () => {
  it(`${AC2} d1 with per_side 1,024 is refused with over_budget inside the child's limits, naming d1, the input per_side and the cap, in under 1 s of check and under 64 MB`, (ctx) => {
    refusedWithinLimits(ctx, [DIALLED]);
  });
});

describe(`${AC3} a step param holding three {repeat} lists of 1,024, one in the other, is refused the same way, naming the param's path`, () => {
  it(`${AC3} w1 is refused with over_budget inside the child's limits, naming w1, steps/mat/params/threads and the cap, in under 1 s of check and under 64 MB`, (ctx) => {
    refusedWithinLimits(ctx, [WOVEN]);
  });
});
