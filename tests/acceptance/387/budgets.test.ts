// #387.5e573133: on the reference Mac in the local preflight, the scheduler allocates nothing per frame
// after warm-up and adds under 0.1 ms of CPU per frame for a 10,000-item document whose read sets didn't
// change; a frame with nothing changed runs no operator. `allocs` and `scheduler_ms` are the binary's own
// counts around the scheduler (`frames` call); five fresh processes after a warm-up, judged by the
// design's rule for timing results. Off a reference Mac, on battery, with Low Power Mode on or unknown, or
// with a thermal warning, both tests skip with an INCONCLUSIVE message; they never pass by skipping. The
// merge-base comparison belongs to the perf lane (README: Criteria to tests). At the base there is no
// `frames` call.
import { describe, expect, it } from 'vitest';
import {
  DOC, SCHEDULER_BUDGET_MS, arr, board, environmentProblem, framesCall, judge, num, obj, presented, rect, run, scenario, show, useBuilds, useEvidence,
  type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();
const problem = environmentProblem();

/** 10,000 rects on a 100 × 100 grid: nothing in it reads the time, so no read set changes from frame to frame. */
const BIG = board('Ten thousand', Array.from({ length: 10_000 }, (_, i) => rect(`r${i}`, [(i % 100) * 3.2, Math.floor(i / 100) * 2, 2.4, 1.5], `a${String(i).padStart(5, '0')}`, i % 7 === 0 ? 'ink' : 'muted')));
const FRAMES = 70;
const WARM_UP = 10;

interface Frame { t: number; ran: number; allocs: number; scheduler_ms: number }
function frames(): Frame[] {
  const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), [show(BIG), framesCall(DOC.a, FRAMES)])) as [JsonObject, JsonObject];
  presented(shown, 'the 10,000-item board');
  const list = arr(reply['frames'], 'frames').map((v, i): Frame => {
    const f = obj(v, `frames[${i}]`);
    return { t: num(f['t'], `frames[${i}].t`), ran: num(f['ran'], `frames[${i}].ran`), allocs: num(f['allocs'], `frames[${i}].allocs`), scheduler_ms: num(f['scheduler_ms'], `frames[${i}].scheduler_ms`) };
  });
  expect(list.length, `the frames call evaluates ${FRAMES} frames`).toBe(FRAMES);
  return list;
}
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };

describe('#387.5e573133 budgets on the reference Mac: no allocation per frame after warm-up and under 0.1 ms of scheduler CPU per frame for 10,000 unchanged items; a frame with nothing changed runs no operator', () => {
  it('#387.5e573133 a frame with nothing changed runs no operator, and after 10 warm-up frames no frame allocates', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const list = frames();
    expect(list[0]!.ran, 'the first frame of the session runs its operators').toBeGreaterThan(0);
    for (const [i, f] of list.entries()) {
      if (i >= 1) expect(f.ran, `frame ${i}: nothing changed since frame ${i - 1}, so no operator runs`).toBe(0);
      if (i >= WARM_UP) expect(f.allocs, `frame ${i}: the scheduler allocates nothing after warm-up`).toBe(0);
    }
  }, 600_000);

  it(`#387.5e573133 the scheduler adds under ${SCHEDULER_BUDGET_MS} ms of CPU per frame for the 10,000-item board (median of frames ${WARM_UP}–${FRAMES - 1}, five fresh processes after a warm-up)`, (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const warm = frames();
    console.log(`warm-up median ${median(warm.slice(WARM_UP).map((f) => f.scheduler_ms)).toFixed(4)} ms (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(median(frames().slice(WARM_UP).map((f) => f.scheduler_ms)));
    judge(ctx, '#387.5e573133 scheduler CPU per unchanged frame, 10,000 items (ms)', runs, SCHEDULER_BUDGET_MS);
  }, 1_800_000);
});
