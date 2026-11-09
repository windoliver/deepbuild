// Criterion 7 (README: Criteria to tests, Readings): budgets on the reference Mac, against the frame the merge base draws.
// `deep-app --chrome <fixture> --frames 360` draws the app's real window 360 frames back to back, the whole tree repainted
// each frame, and reports each frame's UI-thread time and its command buffers' GPU time. A frame's cost is their sum,
// and a run's is the p95 over its last 300 frames (the first 60 are warm-up). The merge base has no chrome layers, so its
// frame is the same fixture with the primitive taken out (README: Readings); what a primitive adds is its run's p95 less
// its twin's. Two budgets, each over five runs after a warm-up pair, judged by scripts/benchmark.mjs's judgeLimit:
//   - a 960,000 px layer (600 × 400 pt at scale 2, opacity 0.8, radii 12) adds under 1 ms a frame;
//   - a backdrop read of the same 960,000 px (scale 1, read by frost@1 at σ 0) adds under 1.5 ms a frame.
// PASS only on a reference Mac on mains power, Low Power Mode off, thermal state nominal and unloaded, with all five runs
// within the limit; anywhere else INCONCLUSIVE, which fails here and never passes. A display that isn't at scale 2 can't
// make 960,000 px from the fixture: INCONCLUSIVE too. Runs only with DEEP_1434_LIVE=1, on the local preflight's perf step.
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixture, judge, live, load, p95, requireLive, useBuild, type Obj } from './helpers.ts';

const bin = useBuild('app');
const FRAMES = 360;
const WARM = 60;

/** The fixture with the measured node's primitive taken out: its layer, or its backdrop and the effect that reads it. */
function twin(fx: Obj): Obj {
  const copy = structuredClone(fx);
  const node = (copy['nodes'] as Obj[]).find((n) => n['id'] === 'measured')!;
  delete node['layer']; delete node['backdrop']; delete node['effect'];
  return copy;
}
function frameCost(fx: Obj): number {
  const { report, dir } = live(bin(), fx, ['--frames', String(FRAMES)]);
  rmSync(dir, { recursive: true, force: true });
  expect(report['mode'], 'the frames report').toBe('frames');
  if (report['scale'] !== 2) expect.fail(`INCONCLUSIVE: the window drew at scale ${String(report['scale'])}; the fixture makes 960,000 px only at scale 2`);
  const frames = report['frames'] as { frame: number; cpu_ms: number; gpu_ms: number }[];
  expect(frames.length, 'every frame asked for is reported').toBe(FRAMES);
  const measured = frames.slice(WARM);
  expect(measured.every((f) => f.cpu_ms > 0 && f.gpu_ms > 0), 'every frame has UI-thread and GPU time').toBe(true);
  return p95(measured.map((f) => f.cpu_ms + f.gpu_ms));
}

async function budget(name: string, limit: number): Promise<void> {
  requireLive('the budget run');
  const fx = fixture(name);
  const node = (fx['nodes'] as Obj[]).find((n) => n['id'] === 'measured')!;
  const [, , w, h] = node['rect'] as number[];
  expect(w! * h! * 4, 'the measured node covers 960,000 px at scale 2').toBe(960_000);
  const off = twin(fx);
  frameCost(fx); frameCost(off);
  const added: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const start = load();
    // Alternate which side runs first.
    let on: number; let base: number;
    if (i % 2 === 0) { on = frameCost(fx); base = frameCost(off); } else { base = frameCost(off); on = frameCost(fx); }
    loads.push({ start, end: load() });
    added.push(Math.max(0, on - base));
  }
  const verdict = await judge(limit, added, loads);
  expect(verdict['status'], `${name}: what the primitive adds to a frame's p95, five runs, against ${limit} ms: ${JSON.stringify(verdict)}`).toBe('PASS');
}

describe('#1434 AC7 budgets on the reference Mac, compared with the merge base', () => {
  it('AC7 a 960,000 px layer adds under 1 ms a frame', () => budget('budget-layer.json', 1), 3_600_000);
  it('AC7 a backdrop read adds under 1.5 ms a frame', () => budget('budget-backdrop.json', 1.5), 3_600_000);
});
