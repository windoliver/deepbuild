// AC1 and AC11's timing (README: The bench). The release replica, built with the `frame-clocks` feature, hovers 200 rows
// at 1936 × 1584, then draws 30 complete frames (a refresh each: every view renders, which is what every hover frame is
// at the merge base). Each run's p95 of CPU per frame is taken over every frame of the clock in the 200 hover steps
// (400 frames, at least 300), and a complete frame's CPU is the median of the 30. A blank arm, an empty window in the
// same harness, takes the same pointer moves and refreshes and is printed beside each run. The same hover over the list
// at 10,000 rows runs in each run too. After one warm-up run, five runs are judged by scripts/benchmark.mjs's
// judgeLimit: off a reference Mac on mains power, Low Power Mode off, thermal state nominal and unloaded, every result
// reads INCONCLUSIVE, which fails here and never passes.
import { afterAll, describe, expect, it } from 'vitest';
import {
  HOVERS, ROWS, ROWS_10K, SCALE, SIZE, Replica, cleanup, drawnOf, dropRelease, framesOf, hover, hoverPoints, judgeAll, load, percentile,
  releaseDrive, requireMacos, rowsFixture, rowsOnScreen,
} from './helpers.ts';

afterAll(async () => { await cleanup(); dropRelease(); }, 60_000);
const LONG = 7_200_000;
const RUNS = 5;
/** Complete frames a run draws after its hover. */
const COMPLETE = 30;
/** "under 2 ms at p95"; "under 25% of a complete frame's"; "within the lane's margin of it" (5%, README). */
const P95_MS = 2;
const SHARE = 0.25;
const SAME = 1.05;

interface Arm { hoverP95: number; complete: number }
type Points = [number, number][];

/** One arm in a fresh release process: the hover and the complete frames, read from the frames report. */
async function arm(bin: string, what: 'list-1k' | 'list-10k' | 'blank', given?: Points): Promise<{ arm: Arm; points: Points }> {
  const launch = what === 'blank'
    ? { arm: 'blank' as const, from: 'empty', size: SIZE, scale: SCALE }
    : { from: 'fixture', fixture: rowsFixture(what === 'list-1k' ? ROWS : ROWS_10K), size: SIZE, scale: SCALE };
  const r = await Replica.open({ bin, launch });
  try {
    const points = given ?? hoverPoints(rowsOnScreen(await r.see()));
    const steps = await hover(r, points);
    const complete: number[] = [];
    for (let k = 0; k < COMPLETE; k++) {
      await r.refresh();
      complete.push(r.steps);
    }
    const report = await r.close();
    const frames = framesOf(report, steps);
    const drawn = frames.filter((f) => f.drawn);
    expect(frames.length, `${what}: the hover's frames of the clock, at least 300 for a p95`).toBeGreaterThanOrEqual(300);
    expect(frames.filter((f) => typeof f.cpu_ms !== 'number' || !Number.isFinite(f.cpu_ms) || f.cpu_ms < 0).map((f) => f.frame), `${what}: every frame has its CPU time`).toEqual([]);
    expect(drawn.filter((f) => typeof f.gpu_ms !== 'number' || typeof f.allocations !== 'number').map((f) => f.frame), `${what}: every drawn frame reports its GPU time and its allocations`).toEqual([]);
    const full = drawnOf(report, complete);
    expect(full.length, `${what}: each refresh draws one complete frame`).toBe(COMPLETE);
    expect(full.every((f) => f.refreshed), `${what}: the complete frames are refreshes`).toBe(true);
    return { arm: { hoverP95: percentile(frames.map((f) => f.cpu_ms!), 0.95), complete: percentile(full.map((f) => f.cpu_ms!), 0.5) }, points };
  } finally {
    await r.stop();
  }
}

interface Measured { k1: Arm[]; k10: Arm[]; blank: Arm[]; loads: { start: number; end: number }[] }
let measured: Promise<Measured> | undefined;
/** One warm-up run, then five, each with the three arms in a rotating order; run once for the file. */
function measure(): Promise<Measured> {
  return measured ??= (async () => {
    requireMacos();
    const bin = releaseDrive();
    const { points } = await arm(bin, 'list-1k');
    await arm(bin, 'list-10k', points);
    await arm(bin, 'blank', points);
    const m: Measured = { k1: [], k10: [], blank: [], loads: [] };
    const order = ['list-1k', 'list-10k', 'blank'] as const;
    for (let i = 0; i < RUNS; i++) {
      const start = load();
      for (let k = 0; k < order.length; k++) {
        const what = order[(i + k) % order.length]!;
        const { arm: a } = await arm(bin, what, points);
        (what === 'list-1k' ? m.k1 : what === 'list-10k' ? m.k10 : m.blank).push(a);
      }
      m.loads.push({ start, end: load() });
      const [a, b, c] = [m.k1.at(-1)!, m.k10.at(-1)!, m.blank.at(-1)!];
      console.log(`run ${i + 1}: 1,000 rows p95 ${a.hoverP95.toFixed(3)} ms, complete ${a.complete.toFixed(3)} ms; 10,000 rows p95 ${b.hoverP95.toFixed(3)} ms; blank p95 ${c.hoverP95.toFixed(3)} ms, complete ${c.complete.toFixed(3)} ms; load ${start.toFixed(1)} to ${load().toFixed(1)}`);
    }
    return m;
  })();
}

describe('#1482 the release replica journey, timed', () => {
  it(`AC1 hovering ${HOVERS} rows at 1936 × 1584: CPU per frame under 2 ms at p95, under 25% of a complete frame's, judged at the lane's margin`, async () => {
    const m = await measure();
    console.log(`AC1 blank arm beside it: p95 ${m.blank.map((b) => b.hoverP95.toFixed(3)).join(', ')} ms; complete ${m.blank.map((b) => b.complete.toFixed(3)).join(', ')} ms`);
    await judgeAll([
      { what: 'AC1 CPU per hover frame at p95 (ms)', limit: P95_MS, runs: m.k1.map((a) => a.hoverP95) },
      { what: 'AC1 CPU per hover frame at p95 over a complete frame\'s', limit: SHARE, runs: m.k1.map((a) => a.hoverP95 / a.complete) },
    ], m.loads);
  }, LONG);

  it('AC11 the same hover over 10,000 rows: CPU per frame within the lane\'s margin of 1,000 rows', async () => {
    const m = await measure();
    await judgeAll([
      { what: 'AC11 hover p95 at 10,000 rows over 1,000 rows', limit: SAME, runs: m.k10.map((a, i) => a.hoverP95 / m.k1[i]!.hoverP95) },
    ], m.loads);
  }, LONG);
});
