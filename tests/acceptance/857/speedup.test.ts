// #857.2: on the reference Mac that frame (the 10,000-item board's frame with every item changed) runs at least
// 2.5 times faster at 4 threads than at 1 on an optimized build, and a frame with one item changed is no slower
// at 4 than at 1. Timed on a release build of `deep-show` (`cargo build --release`), by the `eval` reply's
// `frame_ms` (the binary's own clock around the frame's phases, every pool thread's work included). One run
// is one fresh process: the board shown and framed twice as warm-up, then eight revisions each followed by a
// frame, the run's time the median of those eight. Five runs at 1 thread and five at 4, taken in turn (1, 4,
// 1, 4, …) so a change in the machine's load reaches both sides; run k's ratio is its 4-thread time over its
// 1-thread time, judged by the design's rule (PASS all five within; FAIL all five over by more than the
// margin; else INCONCLUSIVE, a skip that says so). Off a reference Mac both tests skip as INCONCLUSIVE and the
// release build isn't made; power, heat and load are printed beside each result (README: Readings). The wrong
// programs: the base (no `threads`, no `frame_ms`), a pool that adds overhead without dividing the work, and a
// pool whose dispatch makes a small frame slower.
import { describe, expect, it } from 'vitest';
import {
  DOC, bigBoard, bigBoardOneMoved, evalCall, median, presented, referenceMacProblem, run, scenario, show, threaded, useBuilds, useEvidence,
  withExtra, judge, type Build, type JsonObject,
} from './helpers.ts';

const RELEASE: Build = { set: 'full', release: true };
const problem = referenceMacProblem();
const builds = useBuilds(problem ? [] : [RELEASE]);
const evidence = useEvidence();

/** The speedup the criterion asks of 4 threads over 1 on the every-item frame: a 4-thread time at most 1/2.5 of the 1-thread time. */
const SPEEDUP = 2.5;
const WARM_UP = 2;
const TIMED = 8;

/** One run: the median `frame_ms` of the frames after the timed revisions, in a fresh process with a pool of `threads`. */
function timedRun(threads: number, revision: (k: number) => JsonObject): number {
  const calls: JsonObject[] = [];
  for (let k = 0; k < WARM_UP + TIMED; k++) calls.push(show(revision(k)), evalCall(DOC.a));
  const replies = run(builds.bin(RELEASE), withExtra(scenario(evidence(), calls), { threads }));
  const times: number[] = [];
  for (let k = 0; k < WARM_UP + TIMED; k++) {
    presented(replies[2 * k]!, `revision ${k}`);
    const frame = threaded(replies[2 * k + 1]!, `the frame after revision ${k} at ${threads} thread(s)`);
    expect(frame.threads, `the frame given ${threads} thread(s) reports a pool of ${threads}`).toBe(threads);
    if (k >= WARM_UP) times.push(frame.frame_ms);
  }
  return median(times);
}

/** Five paired runs at 1 and 4 threads, in turn; each pair's ratio, 4 threads over 1. */
function ratios(revision: (k: number) => JsonObject, name: string): number[] {
  const out: number[] = [];
  for (let r = 0; r < 5; r++) {
    const one = timedRun(1, revision);
    const four = timedRun(4, revision);
    console.log(`${name}, run ${r + 1}: ${one.toFixed(3)} ms at 1 thread, ${four.toFixed(3)} ms at 4 threads (${(one / four).toFixed(2)}x)`);
    out.push(four / one);
  }
  return out;
}

describe('#857.2 on the reference Mac the 10,000-item frame with every item changed runs at least 2.5 times faster at 4 threads than at 1 on an optimized build, and a frame with one item changed is no slower at 4 than at 1', () => {
  it('#857.2 the frame with every item changed: at 4 threads it takes at most 1/2.5 of its time at 1 thread (five paired runs on a release build)', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    // Revision k is the board's variant k: every item changes from one revision to the next.
    const runs = ratios((k) => bigBoard(k), 'every item changed');
    judge(ctx, '#857.2 every item changed, time at 4 threads over time at 1', runs, 1 / SPEEDUP);
  }, 7_200_000);

  it('#857.2 the frame with one item changed: at 4 threads it takes no longer than at 1 thread (five paired runs on a release build)', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    // Revision 0 is the board; revision k moves one rect to a place no earlier revision put it.
    const runs = ratios((k) => (k === 0 ? bigBoard(0) : bigBoardOneMoved(0.5 * k)), 'one item changed');
    judge(ctx, '#857.2 one item changed, time at 4 threads over time at 1', runs, 1);
  }, 7_200_000);
});
