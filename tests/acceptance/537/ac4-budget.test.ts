// AC4 #537.3f91633c: In 1,000 tanks of hull, turret and barrel whose logic writes turret yaw and barrel pitch, every
// barrel tip lies within 1e-4 m of an f64 reference at 20 sampled steps, whether seeked or played; a step that turns one
// turret uploads one slot; 2,000 units with 3 parts stay within the showpiece class's 10 ms of GPU at 1080p; and a planted
// pose applied in world space instead of the parent's fails, naming the unit
//
// This file is the criterion's GPU budget alone, a timed file (README: Run them). `horde` (fixtures.ts) is 2,000 of the
// tank (hull, turret and barrel: 3 parts) fed by `army` (programs.ts `armyProgram(HORDE)`, every turret and barrel
// moving at every step), in the showpiece class (`budget: {class: showpiece}`), drawn at 1920 × 1080, 120 frames with
// `timings`. A warm-up run first shows the frame draws them: the camera's view holds indirect draws of `tanks` in at
// least three batches (one per part's mesh), and every frame carries its GPU time. Then, as the perf lane judges
// (scripts/benchmark.mjs's judgeLimit, imported): five runs after the warm-up, each run's reading the median `gpu_ms`
// of frames 10 to 119, against 10 ms; PASS when all five are within it, FAIL when all five are over it by more than the
// margin, INCONCLUSIVE otherwise and off a reference Mac or under load (the load read at each run's start and end),
// never a pass. On a machine the rule can't judge, the five runs aren't taken.
import { describe, expect, it } from 'vitest';
import { HORDE, armyProgram } from './programs.ts';
import { BUDGET_SIZE, hordeSession, tankGltf } from './fixtures.ts';
import {
  AC, TIMEOUT, arr, binOf, frameAt, framesOf, hwModel, inconclusive, isObject, judgeLimit, load, median, prebuild, putAsset, requireMetal,
  runGpu, show, str, useTemp, view3dCall, writeJson, type Frame, type JsonObject,
} from './helpers.ts';

prebuild(['deep-gpu']);
const temp = useTemp();
const LIMIT_MS = 10;
const FRAMES = 120;
const RUNS = 5;

describe(`${AC[4]} 2,000 units with 3 parts in the showpiece class's GPU budget at 1080p`, () => {
  it(`${AC[4]} 2,000 units with 3 parts stay within the showpiece class's 10 ms of GPU at 1080p, by the perf lane's five-run rule`, async () => {
    requireMetal();
    const out = temp();
    const program = armyProgram(HORDE);
    const gltf = tankGltf();
    const assets = { ...putAsset(out, program.bytes, 'wasm'), ...putAsset(out, gltf.bytes, 'gltf') };
    const doc = writeJson(out, 'horde', hordeSession(program, gltf.sha));
    const timed = (warm: boolean): JsonObject => view3dCall({ doc, size: BUDGET_SIZE, frames: FRAMES, timings: true, ...(warm ? { counts: true } : {}), assets });
    const reading = (frames: Frame[], what: string): number => {
      expect(frames.length, `${what}: ${FRAMES} frames`).toBe(FRAMES);
      return median(frames.filter((f) => f.frame >= 10).map((f) => { expect(f.gpuMs, `${what}: frame ${f.frame} carries its GPU time (gpu_ms)`).not.toBeNull(); return f.gpuMs!; }));
    };

    // The warm-up: the units are drawn, each part instanced, and every frame timed.
    const [warm] = runGpu(binOf('deep-gpu'), out, [timed(true)], 'AC4 the 2,000 units (warm-up)');
    const frames = framesOf(warm!, 'the 2,000 units');
    const draws = arr(frameAt(frames, 0, 'the 2,000 units').raw['indirect_draws'], 'frame 0\'s indirect_draws (counts)')
      .filter((d) => isObject(d) && d['item'] === 'tanks' && d['view'] === 'view').map((d) => str((d as JsonObject)['batch'], 'a batch'));
    expect(new Set(draws).size, `frame 0 draws the 2,000 units in the camera's view by indirect draws in at least 3 batches, one per part's mesh: ${show(frameAt(frames, 0, 'w').raw['indirect_draws'])}`).toBeGreaterThanOrEqual(3);
    console.log(`${AC[4]}: the warm-up's median GPU time ${reading(frames, 'the warm-up').toFixed(3)} ms on ${hwModel()}`);

    const gate = await judgeLimit(LIMIT_MS, Array.from({ length: RUNS }, () => 0), Array.from({ length: RUNS }, () => ({ start: load(), end: load() })));
    if (gate['status'] !== 'PASS') inconclusive(`the GPU budget can't be judged on this machine now: ${String(gate['reason'])}`);
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let r = 0; r < RUNS; r++) {
      const start = load();
      const [reply] = runGpu(binOf('deep-gpu'), out, [timed(false)], `AC4 the 2,000 units (run ${r + 1})`);
      loads.push({ start, end: load() });
      runs.push(reading(framesOf(reply!, `run ${r + 1}`), `run ${r + 1}`));
    }
    const verdict = await judgeLimit(LIMIT_MS, runs, loads);
    console.log(`${AC[4]}: 2,000 units with 3 parts at 1080p, median gpu_ms per run ${runs.map((x) => x.toFixed(3)).join(', ')} against ${LIMIT_MS} ms → ${String(verdict['status'])}`);
    expect(verdict['status'], `the GPU time against ${LIMIT_MS} ms: ${JSON.stringify(verdict)}`).not.toBe('FAIL');
    if (verdict['status'] !== 'PASS') inconclusive(`the GPU time against ${LIMIT_MS} ms: ${JSON.stringify(verdict)}`);
  }, 2 * TIMEOUT);
});
