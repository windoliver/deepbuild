// #380.c9214bdc: on the reference Mac, a window-sized 3D scene with glow, shadows and outlines costs under
// 2 ms of GPU time per frame, measured with wgpu-profiler.
// The scene: `effectScene(['glow', 'shadow', 'outline'])` at 1936 × 1584 (the reference window the design's
// GPU-surface numbers use) with twelve more boxes, the look's bloom, the sun casting, three boxes selected
// (their outlines), and the camera orbiting at 36° a second for 10 s, so no frame repeats the one before
// it. No other effect is on: the criterion's scene has these three. `view3d` with `timings: true` gives each frame's GPU time as wgpu-profiler's
// timestamp queries measure it (`gpu_ms`) and each pass's (`passes_ms`). The design's rule (Every task
// carries its own budgets): five fresh processes after a warm-up one, 600 frames each (at least 300), PASS
// when all five are within the limit, FAIL when all five are over it by more than the margin (the larger of
// 5% and their spread), else INCONCLUSIVE. "Per frame" is each run's worst frame, as #377's suite reads it.
// Off a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal; on battery or mains,
// by the owner's rule that mains power never gates) the judged tests skip as INCONCLUSIVE; none passes by
// skipping. The first test checks the measure itself on any Mac. The planted `slow_glow` shows the measure
// sees the glow's pass. The per-effect timings it prints are the issue's proof line. At the base the view3d
// call gives no timings and draws none of these effects.
import { describe, expect, it } from 'vitest';
import {
  FRAME_GPU_MS, OPERATORS, cargoMetadata, binaryPackage, effectScene, environmentProblem, expectJudgedFail, judge, normalClosure, operatorsReply,
  p95, requireGpu, run, shippedEffects, useBin, useOut, view3Reply, view3d, writeJson, type Planted, type View3,
} from './helpers.ts';

const bins = useBin();
const out = useOut();
const problem = environmentProblem();
const SIZE: [number, number] = [1936, 1584];
const FRAMES = 600;
const RUNS = 5;
const SCENE = effectScene(['glow', 'shadow', 'outline'], { size: SIZE, boxes: 12, span: 10, rate: 36 });
const SELECTION = ['lamp', 'block', 'crate'];

interface Timed { view: View3; worst: number; perPass: Map<string, number[]>; opsByEffect: Map<string, string> }
function timedRun(planted?: Planted): Timed {
  const doc = writeJson(out(), 'budget-scene.json', SCENE.doc);
  const [ops, reply] = run(bins.bin(), out(), [OPERATORS, view3d({ doc, look: SCENE.look, size: SIZE, frames: FRAMES, fps: 60, selection: SELECTION, timings: true })], planted ? { planted } : {});
  const byEffect = shippedEffects(operatorsReply(ops!), 'the operators call');
  const view = view3Reply(reply!, 'the budget scene');
  expect(view.frames.map((f) => f.frame), 'every frame of the run is drawn, in order').toEqual(Array.from({ length: FRAMES }, (_, i) => i));
  const gpu = view.frames.map((f, i) => { expect(f.gpu_ms, `frame ${i} carries its GPU time`).not.toBeNull(); return f.gpu_ms!; });
  const perPass = new Map<string, number[]>();
  for (const f of view.frames) for (const [p, ms] of f.passes_ms ?? []) perPass.set(p, [...(perPass.get(p) ?? []), ms]);
  return { view, worst: Math.max(...gpu), perPass, opsByEffect: new Map([...byEffect].map(([e, o]) => [e, o.name])) };
}
const cache = new Map<string, Timed[]>();
/** One warm-up process, discarded, then five fresh ones. */
function runs(planted?: Planted): Timed[] {
  const key = planted ?? '';
  if (!cache.has(key)) { timedRun(planted); cache.set(key, Array.from({ length: RUNS }, () => timedRun(planted))); }
  return cache.get(key)!;
}

describe('#380.c9214bdc on the reference Mac, a window-sized 3D scene with glow, shadows and outlines costs under 2 ms of GPU time per frame, measured with wgpu-profiler', () => {
  it('#380.c9214bdc the measure is wgpu-profiler\'s, in the GPU layer\'s build, and it times every frame and the glow\'s, the shadows\' and the outlines\' passes in each', () => {
    requireGpu();
    const t = timedRun();
    expect(t.view.profiler?.name, 'the GPU times come from wgpu-profiler').toBe('wgpu-profiler');
    const meta = cargoMetadata();
    const bin = binaryPackage(meta);
    expect(bin, 'a workspace crate has the deep-gpu binary').toBeDefined();
    const closure = normalClosure(meta, bin!.id);
    const profiler = meta.packages.filter((p) => p.name === 'wgpu-profiler' && closure.has(p.id));
    expect(profiler.map((p) => p.version), 'wgpu-profiler is in the binary\'s normal dependency tree, at the version the reply names').toContain(t.view.profiler!.version);
    for (const effect of ['glow', 'shadow', 'outline'] as const) {
      const op = t.opsByEffect.get(effect)!;
      const pass = t.view.passes.find((p) => p.operator === op);
      expect(pass, `a pass of the frame runs the ${effect} operator ${op}`).toBeDefined();
      const times = t.perPass.get(pass!.name) ?? [];
      expect(times.length, `the ${effect} pass ${pass!.name} is timed in every frame`).toBe(FRAMES);
      expect(times.every((ms) => ms > 0), `the ${effect} pass takes GPU time in every frame`).toBe(true);
    }
    t.view.frames.forEach((f, i) => {
      const sum = [...(f.passes_ms ?? new Map()).values()].reduce((a, b) => a + b, 0);
      expect(sum, `frame ${i}: its passes' times fit inside the frame's GPU time`).toBeLessThanOrEqual(f.gpu_ms! * 1.05 + 0.05);
    });
  }, 3_600_000);

  it('#380.c9214bdc the window-sized scene with glow, shadows and outlines costs under 2 ms of GPU time in its worst frame of 600, in five runs', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const r = runs();
    // The proof line: GPU time per effect on the reference Mac (p95 over each run's frames).
    for (const [effect, op] of r[0]!.opsByEffect) {
      const pass = r[0]!.view.passes.find((p) => p.operator === op);
      if (pass) console.log(`GPU time, ${effect} (${op}, pass ${pass.name}): p95 ${r.map((t) => p95(t.perPass.get(pass.name) ?? [0]).toFixed(3)).join(', ')} ms`);
    }
    judge(ctx, '#380.c9214bdc worst frame GPU time (ms)', r.map((t) => t.worst), FRAME_GPU_MS);
  }, 3_600_000);

  it('#380.c9214bdc the measure sees the glow: a planted glow that blurs at full resolution 64 times (--planted slow_glow) is judged FAIL', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    expectJudgedFail('#380.c9214bdc slow_glow, worst frame GPU time (ms)', runs('slow_glow').map((t) => t.worst), FRAME_GPU_MS);
  }, 3_600_000);
});
