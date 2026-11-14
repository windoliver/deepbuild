// AC1 #223.532d1014: "A 21 × 21 line grid from a path fn `grid`, warped by `complex {f: cmul(z, z)}` at mix 1, lies
// within 0.5 px of the analytic image at 10,000 points per line, with no cubic cut more than 64 ways; a planted warp
// that maps only the original anchors is more than 5 px off on the line x = 1 and fails"
//
// The grid: `fn: {grid: {x: [300, 500, 10], y: [200, 400, 10]}}` on an 800 × 600 figure, a child of group `g` whose
// warp is `complex {f: "cmul(z, z)"}`, mix 1, plane origin (400, 300) u, unit 100 u, y up: the plane's square
// [−1, 1]², 21 vertical and 21 horizontal lines. The same grid in a plain group (no warp) is the twin: its 42
// sub-paths must be the 42 lines, each one straight segment from end to end (the grid's anchors are its lines' ends),
// and its sub-path i names the line the warped sub-path i draws.
// The judge, on `deep-canvas-render path` of the grid item: the warped grid has the twin's 42 sub-paths, each drawn in
// cubics; every cubic is cut into n equal pieces, one n for all (warped segments = n × the twin's, sub-path by
// sub-path), n a power of two, at most 64; and for each line, 10,000 points of its analytic image (its points
// p = toPlane(s) taken evenly from end to end, mapped by z ↦ z², back on screen) each lie within 0.5 u (px at zoom 1)
// of the drawn sub-path, and the drawn sub-path (each cubic at 32 steps) within 0.5 u of the image.
// Wrong programs: the base (no fn grid, no warp: the check refuses the fn); the planted `warp_maps_anchors_only`
// (`path`'s planted value), which maps each line's two ends and nothing between, so the line x = 1, whose image is
// the parabola (1 − y², 2y) from −2i to 2i, draws as the chord from (0, −2) to (0, 2): 100 u off at its middle; it
// must be more than 5 px off there and fail the judge, a failure naming the line x = 1. A cut count that differs
// between cubics, or passes 64, fails the cut rule.
import { describe, expect, it } from 'vitest';
import {
  AC, PLANE, TIMEOUT, Z_SQUARED, bothWays, cmul, dist, expectClean, failsNaming, flatten, gridDoc, gridLines, GRID_X, GRID_Y, imageOf, none,
  onScreen, pathAll, segmentsOf, short, toPlane, toPolyline, useBins, vertices, type PathFrame, type Pt,
} from './helpers.ts';

const bin = useBins(['render']);
const TWIN = gridDoc('warp-grid-plain', null);
const WARPED = gridDoc('warp-grid-z-squared', Z_SQUARED(1));
const PLANT = 'warp_maps_anchors_only';
const z2 = onScreen(PLANE, (q) => cmul(q, q));
const PER_LINE = 10_000;

interface Line { name: string; ends: [Pt, Pt] }
/** The plain grid's sub-paths as the lines they draw, in sub-path order; failures where it isn't the 21 × 21 grid. */
function linesOf(twin: PathFrame): { lines: Line[]; failures: string[] } {
  const failures: string[] = [];
  const want = gridLines(GRID_X, GRID_Y);
  if (twin.subpaths.length !== want.length) failures.push(`the plain grid draws ${twin.subpaths.length} sub-paths, not the 42 lines of a 21 × 21 grid`);
  const seen = new Set<number>();
  const lines = twin.subpaths.map((sp, i): Line => {
    const v = vertices(sp);
    if (v.length !== 2 || segmentsOf(sp).length !== 1) failures.push(`the plain grid's sub-path ${i} is not one straight segment from end to end (${v.length} anchors)`);
    const a = v[0] ?? [0, 0]; const b = v[v.length - 1] ?? a;
    const k = want.findIndex((w) => (dist(w[0]!, a) < 1e-6 && dist(w[1]!, b) < 1e-6) || (dist(w[0]!, b) < 1e-6 && dist(w[1]!, a) < 1e-6));
    if (k < 0) failures.push(`the plain grid's sub-path ${i} from (${a.map(short).join(', ')}) to (${b.map(short).join(', ')}) is none of the grid's lines`);
    else if (seen.has(k)) failures.push(`the plain grid draws the line from (${a.map(short).join(', ')}) twice`);
    seen.add(k);
    const p = toPlane(PLANE, a);
    return { name: a[0] === b[0] ? `x = ${short(p[0])}` : `y = ${short(p[1])}`, ends: [a, b] };
  });
  return { lines, failures };
}

/** The judge: the warped grid against the analytic image, line by line, and the cut rule. */
function judgeGrid(twin: PathFrame, warped: PathFrame, lines: Line[]): string[] {
  const failures: string[] = [];
  if (warped.subpaths.length !== twin.subpaths.length) return [`the warped grid draws ${warped.subpaths.length} sub-paths, not the grid's ${twin.subpaths.length}`];
  const n = warped.segments / twin.segments;
  if (!Number.isInteger(n) || n < 1 || (n & (n - 1)) !== 0) failures.push(`the warped grid's ${warped.segments} segments are not the grid's ${twin.segments} each cut into one power of two of pieces`);
  if (n > 64) failures.push(`a cubic is cut ${n} ways, more than 64`);
  warped.subpaths.forEach((sp, i) => {
    const name = lines[i]?.name ?? `sub-path ${i}`;
    if (sp.verbs.some((v, k) => (k === 0 ? v !== 'M' : v !== 'C'))) failures.push(`line ${name}: the warped line is not drawn in cubics (${sp.verbs.slice(0, 6).join(' ')} …)`);
    const pieces = segmentsOf(sp).length; const own = segmentsOf(twin.subpaths[i]!).length;
    if (pieces !== n * own) failures.push(`line ${name}: its ${own} segment(s) are cut into ${pieces} pieces, not ${n} each as every other cubic is`);
    const line = lines[i];
    if (line) failures.push(...bothWays([flatten(sp, 32)], [imageOf(line.ends, z2, PER_LINE)], 0.5, `line ${name} under cmul(z, z)`));
  });
  return failures;
}

describe(`${AC[1]} a 21 × 21 grid warped by cmul(z, z) lies on its analytic image`, () => {
  it(`${AC[1]} the grid fn's 42 lines warped by cmul(z, z) at mix 1 lie within 0.5 px of the analytic image at 10,000 points per line, no cubic cut more than 64 ways`, () => {
    expectClean(bin('render'), WARPED, 'the grid warped by cmul(z, z)');
    const [twin, warped] = pathAll(bin('render'), [{ doc: TWIN, item: 'grid' }, { doc: WARPED, item: 'grid' }], 'the grid, plain and warped').map((f) => f[0]!);
    const { lines, failures } = linesOf(twin!);
    none(failures, 'the path fn grid draws the 21 × 21 grid, each line one sub-path');
    none(judgeGrid(twin!, warped!, lines), 'the grid warped by cmul(z, z) lies on its analytic image');
  }, TIMEOUT);

  it(`${AC[1]} a planted warp that maps only the original anchors is more than 5 px off on the line x = 1 and fails`, () => {
    const [twin, planted] = pathAll(bin('render'), [{ doc: TWIN, item: 'grid' }, { doc: WARPED, item: 'grid', planted: PLANT }], `the grid, plain and under ${PLANT}`).map((f) => f[0]!);
    const { lines, failures } = linesOf(twin!);
    none(failures, 'the path fn grid draws the 21 × 21 grid, each line one sub-path');
    const k = lines.findIndex((l) => l.name === 'x = 1');
    expect(k, 'the grid has the line x = 1').toBeGreaterThanOrEqual(0);
    const drawn = flatten(planted!.subpaths[k]!, 32);
    const off = Math.max(...imageOf(lines[k]!.ends, z2, PER_LINE).map((p) => toPolyline(p, drawn)));
    expect(off, `under ${PLANT} the line x = 1 is more than 5 px off its image (it is ${off.toFixed(2)} px off)`).toBeGreaterThan(5);
    failsNaming(judgeGrid(twin!, planted!, lines), ['x = 1'], `the judge on ${PLANT}`);
  }, TIMEOUT);
});
