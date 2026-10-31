// #857.4: with a 4-replica playtest batch and a light bake running, a work-product view on the reference Mac
// keeps its p95 frame CPU inside its 4 ms class; a planted batch at the live view's priority pushes it past,
// naming the frames. The view is a work-product board whose moving rects change every frame, evaluated by the
// `frames` call with the pool its class sets (no `threads` override: 4); the load is the scenario's
// `background` (README: Surfaces this suite defines): four playtest replicas of a work-product piece and a
// bake of a figure, each evaluating its document frame after frame through the scheduler on threads at the
// platform's background priority from the run's start to its end. A frame's CPU is its `frame_ms`. One run is
// one fresh process: 60 frames of warm-up, then 300 timed frames (the design's floor for a p95 a frame-time
// limit gates), the run's p95 over those 300; five runs judged by the design's rule. The planted batch
// (`planted: "background_at_live_priority"`) runs the same jobs at the live view's priority; caught when all
// five runs are over 4 ms by more than the margin, each run naming its frames over 4 ms. The timing tests run
// on a release build on a reference Mac, else skip as INCONCLUSIVE; power, heat and load are printed beside
// each result. The wrong programs: the base (no `background`, `threads` or `frame_ms`), background work at the
// live view's priority, and background jobs that do no work.
import { describe, expect, it } from 'vitest';
import {
  DOC, WORK_PRODUCT_CPU_MS, WORK_PRODUCT_THREADS, framesCall, framesOf, framesOver, judge, judgeOver, movingBoard, p95, presented, referenceMacProblem,
  run, scenario, show, useBuilds, useEvidence, withExtra, type Build, type FramesReply, type Job,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const RELEASE: Build = { set: 'full', release: true };
const problem = referenceMacProblem();
const builds = useBuilds(problem ? [FULL] : [FULL, RELEASE]);
const evidence = useEvidence();

/**
 * The live view: a work product of 84 rects that move every frame, the most its class admits (the check's
 * estimate is about 45 µs a moving rect against the class's 4 ms, and the check refuses a work product past it).
 */
const VIEW = movingBoard('Work product view', 'work_product', 84, 0, 0);
/**
 * The load: a playtest batch of four replicas of a piece of 600 moving rects, and a light bake of 300. Both
 * are offline work, so their documents are of class export (no frame cap, so the check admits their size; its
 * pool is the machine's performance cores).
 */
const PIECE = movingBoard('Playtest piece', 'export', 600, 0, 0);
const BAKED = movingBoard('Light bake', 'export', 300, 0, 0);
const BACKGROUND: Job[] = [{ job: 'playtest', replicas: 4, document: PIECE }, { job: 'bake', document: BAKED }];
const WARM_UP = 60;
const TIMED = 300;

/** The background jobs' progress: four replicas and a bake, each having evaluated at least one frame by the reply. */
function loadRan(reply: FramesReply, what: string): void {
  const replicas = reply.background.filter((b) => b.job === 'playtest').map((b) => b.replica).sort();
  expect(replicas, `${what}: the playtest batch reports its four replicas`).toEqual([1, 2, 3, 4]);
  expect(reply.background.filter((b) => b.job === 'bake').length, `${what}: the bake reports itself`).toBe(1);
  for (const b of reply.background) expect(b.frames, `${what}: ${b.job}${b.replica ? ` replica ${b.replica}` : ''} evaluated frames from its start to this reply`).toBeGreaterThan(0);
}

/** One run of the view under the load: its 300 timed frames. */
function viewRun(build: Build, planted?: string): FramesReply {
  const calls = [show(VIEW), framesCall(DOC.a, WARM_UP, '0s'), framesCall(DOC.a, TIMED, '1s')];
  const replies = run(builds.bin(build), withExtra(scenario(evidence(), calls), { background: BACKGROUND, planted }));
  presented(replies[0]!, 'the work-product view');
  const what = `the view's timed frames${planted ? ` under ${planted}` : ''}`;
  const timed = framesOf(replies[2]!, what);
  expect(timed.threads, `${what}: a work product's pool is ${WORK_PRODUCT_THREADS} threads`).toBe(WORK_PRODUCT_THREADS);
  expect(timed.frames.length, `${what}: ${TIMED} frames`).toBe(TIMED);
  for (const [i, f] of timed.frames.entries()) expect(f.ran, `${what}: frame ${i} runs the moving rects' nodes`).toBeGreaterThan(0);
  loadRan(timed, what);
  return timed;
}

describe('#857.4 with a 4-replica playtest batch and a light bake running, a work-product view on the reference Mac keeps its p95 frame CPU inside its 4 ms class; a planted batch at the live view\'s priority pushes it past, naming the frames', () => {
  it('#857.4 the work-product view runs on its class\'s pool of 4 threads while the playtest batch\'s four replicas and the bake each evaluate frames', () => {
    const calls = [show(VIEW), framesCall(DOC.a, 120, '0s')];
    const replies = run(builds.bin(FULL), withExtra(scenario(evidence(), calls), { background: BACKGROUND }));
    presented(replies[0]!, 'the work-product view');
    const reply = framesOf(replies[1]!, 'the view\'s frames');
    expect(reply.threads, `a work product's pool is ${WORK_PRODUCT_THREADS} threads, its class's setting`).toBe(WORK_PRODUCT_THREADS);
    expect(reply.frames.length, 'the frames call evaluates 120 frames').toBe(120);
    loadRan(reply, 'the view\'s frames');
  }, 1_800_000);

  it(`#857.4 under the load, the view's p95 frame CPU over ${TIMED} frames stays within ${WORK_PRODUCT_CPU_MS} ms (five runs on a release build)`, (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const timed = viewRun(RELEASE);
      const over = framesOver(timed.frames, WORK_PRODUCT_CPU_MS);
      runs.push(p95(timed.frames.map((f) => f.frame_ms)));
      console.log(`#857.4 run ${r + 1}: p95 ${runs[r]!.toFixed(3)} ms; ${over.length} frames over ${WORK_PRODUCT_CPU_MS} ms${over.length ? `: ${over.slice(0, 5).join('; ')}` : ''}; background ${JSON.stringify(timed.background)}`);
    }
    judge(ctx, '#857.4 the work-product view\'s p95 frame CPU under the load (ms)', runs, WORK_PRODUCT_CPU_MS);
  }, 7_200_000);

  it(`#857.4 a planted batch at the live view's priority pushes the view's p95 frame CPU past ${WORK_PRODUCT_CPU_MS} ms in all five runs, each run naming its frames over it`, (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const runs: number[] = [];
    const named: string[][] = [];
    for (let r = 0; r < 5; r++) {
      const timed = viewRun(RELEASE, 'background_at_live_priority');
      named.push(framesOver(timed.frames, WORK_PRODUCT_CPU_MS));
      runs.push(p95(timed.frames.map((f) => f.frame_ms)));
      console.log(`#857.4 planted run ${r + 1}: p95 ${runs[r]!.toFixed(3)} ms; frames over ${WORK_PRODUCT_CPU_MS} ms: ${named[r]!.length}: ${named[r]!.slice(0, 8).join('; ')}`);
    }
    judgeOver(ctx, '#857.4 the work-product view\'s p95 frame CPU under a batch at its own priority (ms)', runs, WORK_PRODUCT_CPU_MS);
    for (const [r, list] of named.entries()) expect(list.length, `planted run ${r + 1} names the frames over ${WORK_PRODUCT_CPU_MS} ms`).toBeGreaterThan(0);
  }, 7_200_000);
});
