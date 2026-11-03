// AC11: "A path attached from A to B with bend 60 is an arc whose turning angle is 60° within 0.1° and whose ends land
// on the edges within 0.5 u, still so after B moves 80 u"
//
// Through `path`. A and B are rects (`box-a`, `box-b`); the path is attached from A to B at `edge` with `gap: 0`, so its ends land on the
// boxes' edges (the default gap of 4 px would hold them off; README: Readings). B's x is a channel that moves it
// 80 u over 1 s. At 0 and 1 s: the ends lie within 0.5 u of A's and B's box outlines where they are; the turning angle
// (the end tangent's direction less the start tangent's) is 60° ± 0.1° either way round; and every point of the path,
// flattened, lies within 0.5 u of the circle through its ends that turns 60° between them (radius = the chord).
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, angleDiff, angleOf, dist, figure, flatten, fl, item, keyed, none, pathFrames, pathItem, segmentsOf,
  useRenderBinary, type PathFrame, type Pt,
} from './helpers.ts';

useRenderBinary();
type Box = [number, number, number, number];
const A: Box = [60, 160, 80, 60];
const B: Box = [380, 120, 80, 60];
const doc = figure('bend', [560, 320], [
  item('box-a', 'rect@1', 'a0', { box: A, paint: { fill: { role: 'body' } } }),
  item('box-b', 'rect@1', 'a1', { box: B, paint: { fill: { role: 'body' } } }),
  pathItem('bow', 'a2', 'M 100 190 L 420 150', { attach: { start: 'box-a', end: 'box-b', gap: 0 }, bend: 60 }),
], { transport: { span: '2s' }, channels: { 'box-b-x': keyed('items/box-b/at/pos/0', [[0, 0], [1, 80]]) } });

/** The distance from a point to a box's outline. */
function toOutline(p: Pt, [x, y, w, h]: Box): number {
  const dx = Math.max(x - p[0], 0, p[0] - (x + w)); const dy = Math.max(y - p[1], 0, p[1] - (y + h));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p[0] - x, x + w - p[0], p[1] - y, y + h - p[1]);
}

function bowFailures(f: PathFrame, bx: number, when: string): string[] {
  const failures: string[] = [];
  if (f.subpaths.length !== 1) return [`${when}: ${f.subpaths.length} sub-paths, not 1`];
  const segs = segmentsOf(f.subpaths[0]!);
  const p0 = segs[0]![0]!; const p1 = segs[segs.length - 1]![segs[segs.length - 1]!.length - 1]!;
  const movedB: Box = [B[0] + bx, B[1], B[2], B[3]];
  if (!(toOutline(p0, A) <= 0.5)) failures.push(`${when}: the start (${p0.map((v) => v.toFixed(3)).join(', ')}) is ${toOutline(p0, A).toFixed(3)} u from A's edge`);
  if (!(toOutline(p1, movedB) <= 0.5)) failures.push(`${when}: the end (${p1.map((v) => v.toFixed(3)).join(', ')}) is ${toOutline(p1, movedB).toFixed(3)} u from B's edge at x ${movedB[0]}`);
  // Tangents: from the start toward its first distinct control point, and into the end from its last.
  const first = segs[0]!.find((q) => dist(q, p0) > 1e-6)!;
  const lastSeg = segs[segs.length - 1]!;
  const before = [...lastSeg].reverse().find((q) => dist(q, p1) > 1e-6)!;
  const turn = angleDiff(angleOf(p1[0] - before[0], p1[1] - before[1]), angleOf(first[0] - p0[0], first[1] - p0[1]));
  if (!(Math.abs(Math.abs(turn) - 60) <= 0.1)) failures.push(`${when}: the path turns ${turn.toFixed(4)}° between its ends, not 60° ± 0.1°`);
  // The circle through both ends that turns 60° between them: radius = chord ÷ (2 sin 30°) = chord.
  const c = dist(p0, p1); const mid: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const n: Pt = [-(p1[1] - p0[1]) / c, (p1[0] - p0[0]) / c];
  const off = c * Math.cos(Math.PI / 6);
  const pts = flatten(f.subpaths[0]!, 256);
  const fit = [1, -1].map((side) => { const o: Pt = [mid[0] + side * off * n[0], mid[1] + side * off * n[1]]; return Math.max(...pts.map((p) => Math.abs(dist(p, o) - c))); });
  const worst = Math.min(...fit);
  if (!(worst <= 0.5)) failures.push(`${when}: the path is ${worst.toFixed(3)} u off the 60° arc through its ends`);
  return failures;
}

describe('AC11 bend: an attached two-point path as an arc', () => {
  it('AC11 a path attached from A to B with bend 60 is an arc turning 60° within 0.1° whose ends land on the edges within 0.5 u, still so after B moves 80 u', () => {
    const [still, moved] = pathFrames({ doc, item: 'bow', times: [0, fl(1)] }, 'the bent path');
    none([...bowFailures(still!, 0, 'at 0 s'), ...bowFailures(moved!, 80, 'at 1 s, B moved 80 u')], 'the bent path, before and after B moves');
    const end = (f: PathFrame): Pt => { const s = segmentsOf(f.subpaths[0]!); const l = s[s.length - 1]!; return l[l.length - 1]!; };
    expect(dist(end(still!), end(moved!)), 'the arc is re-solved when B moves: its end moves with B').toBeGreaterThan(40);
  }, TIMEOUT);
});
