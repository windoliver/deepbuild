// Criterion 9 (README: Criteria to tests, Readings): "Budgets, on the reference Mac in the local preflight, per operator
// at 960,000 covered px: under 1 ms, or under 2 ms for `edge.flame`, `fill.liquid_metal` and `warp.haze`; everything
// visible at once under 3 ms a frame."
// `deep-app --chrome <fixture> --frames 360` draws the app's real window 360 frames back to back and reports each frame's
// UI-thread time and its command buffers' GPU time (#1434's frames mode). A frame's cost is their sum, a run's the p95
// over its last 300 frames. What an operator costs is its run's p95 less its twin's, the same window with the effect and
// its backdrop taken out (the frame the merge base draws). Per operator: a 600 × 400 pt node at scale 2, 960,000 px,
// covered by the operator at its defaults. Everything at once: the grid of all 24 against the grid with none. Each over
// five runs after a warm-up pair, alternating which side goes first, judged by scripts/benchmark.mjs's judgeLimit: PASS
// only on a reference Mac on mains power, Low Power Mode off, thermal state nominal and unloaded, all five within the
// limit; anywhere else INCONCLUSIVE, which fails here and never passes. A window off scale 2 is INCONCLUSIVE too. The
// budget table (each case's five readings and verdict) is printed and written to docs/evidence/1436/budgets.json for the
// PR. Runs only with DEEP_1436_LIVE=1, on the local preflight's perf step.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC, OPERATORS, REPO, SLOW, budget, grid, judge, live, load, p95, requireLive, useBuild, withoutEffects, type Obj } from './helpers.ts';

const bin = useBuild('app');
const FRAMES = 360;
const WARM = 60;
const table: Obj[] = [];

function frameCost(fx: Obj): number {
  const report = live(bin(), fx, ['--frames', String(FRAMES)]);
  expect(report['mode'], 'the frames report').toBe('frames');
  if (report['scale'] !== 2) expect.fail(`INCONCLUSIVE: the window drew at scale ${String(report['scale'])}; the fixture makes 960,000 px only at scale 2`);
  const frames = report['frames'] as { frame: number; cpu_ms: number; gpu_ms: number }[];
  expect(frames.length, 'every frame asked for is reported').toBe(FRAMES);
  const measured = frames.slice(WARM);
  expect(measured.every((f) => f.cpu_ms > 0 && f.gpu_ms > 0), 'every frame has UI-thread and GPU time').toBe(true);
  return p95(measured.map((f) => f.cpu_ms + f.gpu_ms));
}

async function added(name: string, fx: Obj, limit: number): Promise<void> {
  requireLive('the budget run');
  const off = withoutEffects(fx);
  frameCost(fx); frameCost(off);
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const start = load();
    let on: number; let base: number;
    if (i % 2 === 0) { on = frameCost(fx); base = frameCost(off); } else { base = frameCost(off); on = frameCost(fx); }
    loads.push({ start, end: load() });
    runs.push(Math.max(0, on - base));
  }
  const verdict = await judge(limit, runs, loads);
  table.push({ case: name, limit_ms: limit, runs_ms: runs.map((r) => Math.round(r * 1000) / 1000), status: verdict['status'], reason: verdict['reason'] ?? null });
  expect(verdict['status'], `${name}: what it adds to a frame's p95, five runs, against ${limit} ms: ${JSON.stringify(verdict)}`).toBe('PASS');
}

afterAll(() => {
  if (table.length === 0) return;
  console.table(table);
  const dir = join(REPO, 'docs', 'evidence', '1436');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'budgets.json'), `${JSON.stringify({ criterion: AC[9], cases: table }, null, 2)}\n`);
});

describe(`#1436 AC9 ${AC[9]} budgets on the reference Mac`, () => {
  it.each(OPERATORS.map((op) => [op, SLOW.includes(op) ? 2 : 1] as const))('AC9 %s at 960,000 covered px adds under %s ms a frame', async (op, limit) => {
    const fx = budget(op);
    const [, , w, h] = ((fx['nodes'] as Obj[])[0]!['rect']) as number[];
    expect(w! * h! * 4, 'the operator covers 960,000 px at scale 2').toBe(960_000);
    await added(op, fx, limit);
  }, 3_600_000);

  it('AC9 all 24 operators visible at once add under 3 ms a frame', () => added('all 24 at once', grid(), 3), 3_600_000);
});
