// #1637.5eb3096a: "It pays: on the reference Mac at 1920 × 1080, the fixture's GPU time at p95 falls by at least 30%
// against frustum-only culling, and the pyramid pass's declared cost lands within 25% of its measurement, both recorded
// by the perf lane"
//
// The fixture is criterion 1's walk (`helpers.ts: cityDoc({camera: 'walk', shadows: false, size: HD})`), drawn at
// 1920 × 1080 over its 10 s at 30 frames a second, frames 0 to 300, with `timings` and nothing captured. A run is one
// process drawing the walk twice, the shipped path and `occlusion: 'off'` (frustum-only culling), their order
// alternating from run to run; one warm-up run, then five. In each run:
//   - the GPU time's fall: p95 of the shipped walk's `gpu_ms` ÷ p95 of occlusion: 'off''s, which must be at most 0.7;
//   - the pyramid pass `scene3d.depth_pyramid`: every shipped frame times it in `passes_ms` and prices it in
//     `declared_ms`; |median declared − median measured| ÷ median measured must be at most 0.25 (medians, since the
//     declaration is a typical frame's price; README: Readings).
// Each is judged by the perf lane's own `judgeLimit` (scripts/benchmark.mjs) over the five runs, with each run's load
// at its start and end: PASS only on a reference Mac (the lane's list: Mac15,7, Mac15,12 or Mac17,10) on mains power,
// Low Power Mode off, thermal state nominal and unloaded, with all five within the limit; anywhere else INCONCLUSIVE,
// which fails here and never passes. The lane's verdict for this machine is read first, so a machine that can't judge
// says so before it draws anything.
//
// The second test is the recording: benchmarks/budgets.json holds a task whose reason names #1637, which the perf lane
// runs beside the merge base, and scripts/lanes.mjs lists this file in `timed`, the local preflight's perf step.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, HD, REPO, cityDoc, framesOf, inconclusive, judgeLimit, load, median, p95, requireGpu, run, useGpu, useOut, view3dCall, writeJson, type Drawn, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const PYRAMID = 'scene3d.depth_pyramid';
const FPS = 30;
const FRAMES = 301;
const FALL = 0.7;
const DECLARED = 0.25;
const RUNS = 5;

function timedWalk(doc: string, off: boolean): JsonObject {
  return view3dCall({ doc, size: HD, fps: FPS, frames: FRAMES, capture: [], timings: true, ...(off ? { occlusion: 'off' as const } : {}) });
}
function gpuTimes(frames: Drawn[], what: string): number[] {
  expect(frames.length, `${what}: every frame of the walk is reported`).toBe(FRAMES);
  return frames.map((f) => { expect(f.gpuMs, `${what}: frame ${f.frame} has its GPU time`).not.toBeNull(); return f.gpuMs!; });
}
/** One run: the fall in p95 GPU time, and the pyramid's declared cost against its measurement. */
function oneRun(k: number): { fall: number; declared: number } {
  const out = dir();
  const doc = writeJson(out, 'city', cityDoc({ camera: 'walk', shadows: false, size: HD }));
  const offFirst = k % 2 === 1;
  const replies = run(bin(), out, offFirst ? [timedWalk(doc, true), timedWalk(doc, false)] : [timedWalk(doc, false), timedWalk(doc, true)]);
  const [onReply, offReply] = offFirst ? [replies[1]!, replies[0]!] : [replies[0]!, replies[1]!];
  const on = framesOf(onReply, `run ${k}, the shipped path`);
  const off = framesOf(offReply, `run ${k}, occlusion: 'off'`);
  const fall = p95(gpuTimes(on, `run ${k}, the shipped path`)) / p95(gpuTimes(off, `run ${k}, occlusion: 'off'`));
  const measured = on.map((f) => f.passesMs?.get(PYRAMID) ?? null);
  const declared = on.map((f) => f.declaredMs?.get(PYRAMID) ?? null);
  expect(measured.every((m) => m !== null && m > 0), `run ${k}: every shipped frame times ${PYRAMID} in passes_ms`).toBe(true);
  expect(declared.every((d) => d !== null && d > 0), `run ${k}: every shipped frame prices ${PYRAMID} in declared_ms`).toBe(true);
  const m = median(measured as number[]);
  return { fall, declared: Math.abs(median(declared as number[]) - m) / m };
}

describe(`${AC[5]} occlusion pays for itself on the reference Mac`, () => {
  it(`${AC[5]} at 1920 × 1080 the walk's p95 GPU time falls by at least 30% against occlusion: 'off', and the pyramid pass's declared cost is within 25% of its measurement (five runs after warm-up)`, async () => {
    requireGpu();
    const here = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: RUNS }, () => ({ start: 0, end: 0 })));
    if (here['status'] !== 'PASS') inconclusive(`this machine can't judge a timing: ${String(here['reason'])}`);
    oneRun(0);
    const runs: { fall: number; declared: number }[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= RUNS; k++) {
      const start = load();
      runs.push(oneRun(k));
      loads.push({ start, end: load() });
    }
    const fall = await judgeLimit(FALL, runs.map((r) => r.fall), loads);
    const declared = await judgeLimit(DECLARED, runs.map((r) => r.declared), loads);
    console.log(`#1637 walk at 1920 × 1080: p95 GPU time, shipped ÷ occlusion: 'off', per run: ${runs.map((r) => r.fall.toFixed(3)).join(', ')} → ${String(fall['status'])}`);
    console.log(`#1637 ${PYRAMID}: |declared − measured| ÷ measured, per run: ${runs.map((r) => r.declared.toFixed(3)).join(', ')} → ${String(declared['status'])}`);
    for (const [name, v] of [['the GPU time\'s fall (shipped ÷ frustum-only p95, at most 0.7)', fall], [`${PYRAMID}'s declared cost against its measurement (at most 0.25 off)`, declared]] as const) {
      expect(v['status'], `${name}: ${JSON.stringify(v)}`).not.toBe('FAIL');
    }
    for (const v of [fall, declared]) if (v['status'] !== 'PASS') inconclusive(JSON.stringify(v));
  }, 7_200_000);

  it(`${AC[5]} the perf lane records it: benchmarks/budgets.json has a task for #1637, and this file runs in lanes.mjs's timed list`, async () => {
    const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; command?: string[]; initialReason?: string }[] };
    const mine = budgets.tasks.filter((t) => /#1637\b/.test(t.initialReason ?? ''));
    expect(mine.length, 'benchmarks/budgets.json has a task whose reason names #1637').toBeGreaterThan(0);
    expect(mine.every((t) => Array.isArray(t.command) && t.command.length > 0), "each #1637 task has a command the lane runs").toBe(true);
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, 'scripts/lanes.mjs runs tests/acceptance/1637/budgets.test.ts as a timed file').toContain('tests/acceptance/1637/budgets.test.ts');
  });
});
