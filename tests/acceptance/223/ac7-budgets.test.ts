// AC7 #223.955a0bbf: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a moving warp
// costs at most 40 ns a point, the design's estimate, and a still one costs nothing per frame"
//
// Through `deep-canvas-render path` with `timing: true` (README: what this suite adds): each frame of an item under a
// warp reports `warp_points`, the points the warp mapped for the item in that frame (0 when it reused them), and
// `warp_ms`, the binary's own wall time spent mapping them, its splitting included (0 when it mapped none). A play is
// one line of 70 frames at 60 fps.
// The moving warp: criterion 1's grid under cmul(z, z), its mix keyed from 0 to 1 over 2 s, so every frame maps anew.
// Per frame, warp_ms × 10⁶ ÷ warp_points is its cost in ns a point; the median over frames 10–69 of one play is a run.
// The still warp: the same grid under cmul(z, z) at mix 1 while a dot beside it moves, so frames are drawn: after
// frame 0 every frame maps no point and spends no time.
// Each budget is read once with the debug build, so a missing surface fails anywhere; then, on a reference Mac
// (Mac15,7 or Mac15,12, Low Power Mode off, no thermal warning) only, five fresh processes of the release build after a
// warm-up are judged by the design's rule (PASS when every run is within the budget, FAIL when every run is over it by
// more than the margin, else INCONCLUSIVE). Elsewhere each test skips with a message starting INCONCLUSIVE; it never
// passes by skipping. "Compared with the merge base": the merge base has no warp, so it has no timing to compare; these
// tests judge the issue's absolute budgets (README: Readings).
// Wrong programs: the base (no warp, no warp_points); a warp that remaps every frame while still; one that costs more
// than 40 ns a point.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, Z_SQUARED, environmentProblem, gridDoc, judge, keyed, median, pathAll, pathItem, useBins, type JsonObject, type PathFrame,
} from './helpers.ts';

const bin = useBins(['render'], ['render-release']);
const problem = environmentProblem();
const TIMES = Array.from({ length: 70 }, (_, k) => Math.round((k * FLICKS) / 60));
const MOVING = gridDoc('warp-budget-moving', Z_SQUARED(0), { transport: { span: '2s' }, channels: { mix: keyed('items/g/params/warp/mix', [[0, 0], [2, 1]]) } });
const STILL = gridDoc('warp-budget-still', Z_SQUARED(1), { transport: { span: '2s' }, channels: { dot: keyed('items/dot/at/pos/0', [[0, 0], [2, 100]]) } }, [
  pathItem('dot', 'a2', 'M 600 550 L 604 550', 4),
]);

function play(path: string, doc: JsonObject, what: string): PathFrame[] {
  const frames = pathAll(path, [{ doc, item: 'grid', times: TIMES, timing: true }], what)[0]!;
  frames.forEach((f, i) => {
    expect(typeof f.warpPoints, `${what}: frame ${i} reports warp_points`).toBe('number');
    expect(typeof f.warpMs, `${what}: frame ${i} reports warp_ms`).toBe('number');
  });
  return frames;
}
/** One run: the median cost in ns a point over frames 10–69, each of which must have mapped the grid anew. */
function nsPerPoint(path: string): number {
  const frames = play(path, MOVING, 'the moving warp');
  const costs = frames.slice(10).map((f, i) => {
    expect(f.warpPoints!, `the moving warp maps the grid anew at frame ${i + 10}`).toBeGreaterThan(0);
    return (f.warpMs! * 1e6) / f.warpPoints!;
  });
  return median(costs);
}
/** One run: the still warp's mapped points and time over frames 1–69 (its first frame maps the grid). */
function stillCost(path: string): { points: number; ms: number } {
  const frames = play(path, STILL, 'the still warp');
  expect(frames[0]!.warpPoints!, 'the still warp maps the grid in its first frame').toBeGreaterThan(0);
  return frames.slice(1).reduce((s, f) => ({ points: s.points + f.warpPoints!, ms: s.ms + f.warpMs! }), { points: 0, ms: 0 });
}

describe(`${AC[7]} warp budgets on the reference Mac`, () => {
  it(`${AC[7]} a moving warp costs at most 40 ns a point (median of frames 10–69 at 60 fps, five fresh release processes after a warm-up)`, (ctx) => {
    const reading = nsPerPoint(bin('render'));
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, debug build, ${reading.toFixed(1)} ns a point): ${problem}`);
    const release = bin('render-release');
    nsPerPoint(release);
    judge(ctx, 'AC7: a moving warp, per mapped point (ns)', Array.from({ length: 5 }, () => nsPerPoint(release)), 40);
  }, 2 * TIMEOUT);

  it(`${AC[7]} a still warp costs nothing per frame (no point mapped and no time spent after its first frame, five fresh release processes)`, (ctx) => {
    const reading = stillCost(bin('render'));
    expect(reading.points, 'a still warp maps no point after its first frame').toBe(0);
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, debug build, ${reading.ms.toFixed(3)} ms over 69 still frames): ${problem}`);
    const release = bin('render-release');
    stillCost(release);
    expect(Array.from({ length: 5 }, () => stillCost(release)), 'the still frames map nothing and spend nothing').toEqual(Array.from({ length: 5 }, () => ({ points: 0, ms: 0 })));
  }, 2 * TIMEOUT);
});
