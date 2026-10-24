// The timing parts, on the reference Mac (technical design: Every task carries its own budgets): each
// result comes from five fresh processes after a warm-up one, PASS when all five are within the limit,
// FAIL when all five are over it by more than the margin (the larger of 5% and their spread), else
// INCONCLUSIVE; a p95 is taken over every frame of a run, 600 frames here (at least 300). Off a reference
// Mac (Mac15,7 or Mac15,12, on mains, Low Power Mode off, thermal state nominal) every test here skips as
// INCONCLUSIVE; none passes by skipping. The times are the binary's own (README: Timings):
// - #377.756c6dce: the handoff costs at most 1 ms at p95 at 1936 × 1584, with at most 0.1 ms on the UI thread;
// - #377.f6925067: the UI thread spends at most 0.1 ms per frame on the GPU layer;
// - #377.8131b7ba: compiling a document's pipelines on the compile thread never stalls the UI thread for
//   more than 2 ms.
// The merge-base comparison belongs to the perf lane. At the base there is no `deep-gpu` binary.
import { describe, expect, it } from 'vitest';
import {
  COMPILE_STALL_MS, HANDOFF_P95_MS, SCENES, UI_MS, arr, compileCall, environmentProblem, expectJudgedFail, framesCall, framesReply, judge, loadScene,
  num, obj, p95, run, scenario, str, useBuilds, useOut, type Planted,
} from './helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();
const problem = environmentProblem();
const SCENE = loadScene(SCENES.handoff);
const RUNS = 5;

interface Timed { handoffP95: number; uiP95: number; uiMax: number }
function timedRun(path: 'zero_copy' | 'copy', planted?: Planted): Timed {
  const [reply] = run(builds.bin(), scenario(out(), [framesCall({ scene: SCENES.handoff, path, timings: true })]), planted ? { planted } : {});
  const frames = framesReply(reply!, `the ${path} timing run`).frames;
  expect(frames.length, 'a timing run presents every frame of the fixture, at least 300').toBe(SCENE.frames);
  expect(frames.every((f) => f.size[0] === 1936 && f.size[1] === 1584 && f.path === path), `every frame is 1936 × 1584 on the ${path} path`).toBe(true);
  const handoff = frames.map((f, i) => num(f.handoff_ms, `frame ${i}: handoff_ms`));
  const ui = frames.map((f, i) => num(f.ui_ms, `frame ${i}: ui_ms`));
  return { handoffP95: p95(handoff), uiP95: p95(ui), uiMax: Math.max(...ui) };
}
const cache = new Map<string, Timed[]>();
/** One warm-up process, discarded, then five fresh ones. */
function runs(path: 'zero_copy' | 'copy', planted?: Planted): Timed[] {
  const key = `${path}:${planted ?? ''}`;
  if (!cache.has(key)) {
    timedRun(path, planted);
    cache.set(key, Array.from({ length: RUNS }, () => timedRun(path, planted)));
  }
  return cache.get(key)!;
}

interface Compiled { stall: number; keys: number; thread: string; ui: string; ticks: number }
function compileRun(planted?: Planted): Compiled {
  const [reply] = run(builds.bin(), scenario(out(), [compileCall(SCENES.pipelines)]), planted ? { planted } : {});
  const c = obj(reply!, 'compile');
  return {
    stall: num(c['ui_max_stall_ms'], 'compile: ui_max_stall_ms'), keys: arr(c['pipelines'], 'compile: pipelines').length,
    thread: str(c['thread'], 'compile: thread'), ui: str(c['ui_thread'], 'compile: ui_thread'), ticks: num(c['ui_ticks'], 'compile: ui_ticks'),
  };
}
function compileRuns(planted?: Planted): Compiled[] {
  compileRun(planted);
  return Array.from({ length: RUNS }, () => compileRun(planted));
}

describe('#377.756c6dce the handoff at 1936 × 1584 costs at most 1 ms at p95, with at most 0.1 ms on the UI thread', () => {
  it('#377.756c6dce the zero-copy handoff\'s p95 over 600 frames is at most 1 ms in five runs', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    judge(ctx, '#377.756c6dce handoff p95 (ms)', runs('zero_copy').map((r) => r.handoffP95), HANDOFF_P95_MS);
  }, 3_600_000);

  it('#377.756c6dce the handoff\'s UI-thread time at p95 over 600 frames is at most 0.1 ms in five runs', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    judge(ctx, '#377.756c6dce handoff UI-thread p95 (ms)', runs('zero_copy').map((r) => r.uiP95), UI_MS);
  }, 3_600_000);

  it('#377.756c6dce the measure sees the handoff: the copy through memory costs more than the zero-copy handoff in every run', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const zero = runs('zero_copy').map((r) => r.handoffP95);
    const copy = runs('copy').map((r) => r.handoffP95);
    console.log(`handoff p95 (ms): zero copy ${zero.map((x) => x.toFixed(3)).join(', ')}; copy ${copy.map((x) => x.toFixed(3)).join(', ')}`);
    expect(Math.min(...copy) > Math.max(...zero), 'every copy run\'s p95 is above every zero-copy run\'s').toBe(true);
  }, 3_600_000);
});

describe('#377.f6925067 the UI thread spends at most 0.1 ms per frame on the GPU layer', () => {
  it('#377.f6925067 no frame of 600 spends more than 0.1 ms of the UI thread on the GPU layer, in five runs', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    judge(ctx, '#377.f6925067 UI-thread time on the GPU layer, worst frame (ms)', runs('zero_copy').map((r) => r.uiMax), UI_MS);
  }, 3_600_000);

  it('#377.f6925067 a planted UI thread that waits on the GPU\'s fence each frame (--planted waits_on_gpu) is judged FAIL', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    expectJudgedFail('#377.f6925067 waits_on_gpu, worst frame (ms)', runs('zero_copy', 'waits_on_gpu').map((r) => r.uiMax), UI_MS);
  }, 3_600_000);
});

describe('#377.8131b7ba compiling a document\'s pipelines on the compile thread never stalls the UI thread for more than 2 ms on the reference Mac', () => {
  it('#377.8131b7ba compiling parity/gpu/pipelines.scene\'s 48 pipelines on the compile thread stalls the UI thread at most 2 ms, in five runs', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const r = compileRuns();
    for (const c of r) {
      expect(c.keys, 'the document\'s 48 pipelines were compiled').toBe(48);
      expect(c.thread, 'on a thread other than the UI thread').not.toBe(c.ui);
      expect(c.ticks, 'the UI thread ran its frames while the compile ran').toBeGreaterThan(0);
    }
    judge(ctx, '#377.8131b7ba longest UI-thread stall while compiling (ms)', r.map((c) => c.stall), COMPILE_STALL_MS);
  }, 3_600_000);

  it('#377.8131b7ba a planted compile on the UI thread (--planted compiles_on_ui_thread) is judged FAIL: the fixture\'s pipelines take long enough to show a stall', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    expectJudgedFail('#377.8131b7ba compiles_on_ui_thread, longest stall (ms)', compileRuns('compiles_on_ui_thread').map((c) => c.stall), COMPILE_STALL_MS);
  }, 3_600_000);
});
