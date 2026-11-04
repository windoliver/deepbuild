// AC7: "A path drawn on by a trim from 0 to 1 over 1 s with an arrow at its end has the arrow's tip at the trim's end
// within 0.1 u at 0.25, 0.5 and 1 s, pointing along the tangent there within 1°, and an end attached with a 4 px gap to
// a 100 × 40 u box at (200, 100), from a start at (0, 120), ends at (196, 120)"
// AC10: "An arrow 20 u long at stroke 3 with size 4 draws a head 5 u long, not 12"
// AC12: "An arrow attached at `outline` to a circle of radius 50 u from 45° stops 4 px (its gap) from the circle within
// 0.5 px; at `edge` it stops 4 px before the box corner, 24.7 u short of the circle"
//
// Through `path`: a frame's `ends.end` (the head as drawn: `tip`, `angle` as atan2(dy, dx) in document u with y down,
// `length` along the tangent and `width` across it, in u) and its `subpaths` (the path after its ops and its
// attachment). Expected points come from the paths' own lines, in f64; the figures draw at zoom 1, so px are u.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, angleDiff, angleOf, dist, figure, fl, item, keyed, none, pathAt, pathFrames, pathItem, useRenderBinary,
  vertices, type PathFrame, type Pt,
} from './helpers.ts';

useRenderBinary();

function endOf(f: PathFrame, what: string): NonNullable<PathFrame['ends']>[string] {
  expect(f.ends?.['end'], `${what}: the frame reports its end's head`).toBeDefined();
  return f.ends!['end']!;
}
const lastPoint = (f: PathFrame): Pt => { const v = vertices(f.subpaths[f.subpaths.length - 1]!); return v[v.length - 1]!; };

// ---------------------------------------------------------------------------------------------------
// AC7

// Three straight runs: 160 u east, 80√2 u north-east, 80 u north (353.137 u in all).
const RUNS: [Pt, Pt][] = [[[40, 200], [200, 200]], [[200, 200], [280, 120]], [[280, 120], [280, 40]]];
const TOTAL = RUNS.reduce((s, [a, b]) => s + dist(a, b), 0);
/** The point and tangent angle a fraction f of the way along the runs. */
function along(f: number): { p: Pt; angle: number } {
  let left = f * TOTAL;
  for (const [a, b] of RUNS) {
    const d = dist(a, b);
    if (left <= d + 1e-12) return { p: [a[0] + ((b[0] - a[0]) * left) / d, a[1] + ((b[1] - a[1]) * left) / d], angle: angleOf(b[0] - a[0], b[1] - a[1]) };
    left -= d;
  }
  throw Error('past the end');
}

const drawOn = figure('ends-draw-on', [320, 240], [
  pathItem('draw', 'a0', 'M 40 200 L 200 200 L 280 120 L 280 40', { ops: [{ trim: { start: 0, end: 0 } }], ends: { end: 'arrow' } }),
], { transport: { span: '2s' }, channels: { 'draw-end': keyed('items/draw/params/ops/0/end', [[0, 0], [1, 1]]) } });

describe('AC7 an arrow rides a trim, and an attached end stops short of its box', () => {
  it('AC7 a path drawn on by a trim from 0 to 1 over 1 s has its arrow\'s tip at the trim\'s end within 0.1 u at 0.25, 0.5 and 1 s, along the tangent within 1°', () => {
    const times = [fl(0.25), fl(0.5), fl(1)];
    const frames = pathFrames({ doc: drawOn, item: 'draw', times }, 'the drawn-on path');
    const failures: string[] = [];
    frames.forEach((f, i) => {
      const s = [0.25, 0.5, 1][i]!;
      const want = along(s);
      const end = endOf(f, `at ${s} s`);
      const d = dist(end.tip, want.p);
      if (!(d <= 0.1)) failures.push(`at ${s} s the arrow's tip is at (${end.tip[0].toFixed(3)}, ${end.tip[1].toFixed(3)}), ${d.toFixed(3)} u from the trim's end (${want.p[0].toFixed(3)}, ${want.p[1].toFixed(3)})`);
      const off = Math.abs(angleDiff(end.angle, want.angle));
      if (!(off <= 1)) failures.push(`at ${s} s the arrow points at ${end.angle.toFixed(3)}°, ${off.toFixed(3)}° from the tangent's ${want.angle}°`);
      if (end.kind !== 'arrow') failures.push(`at ${s} s the end is ${end.kind}, not an arrow`);
    });
    none(failures, 'the arrow at the trim\'s end');
  }, TIMEOUT);

  it('AC7 an end attached with a 4 px gap to a 100 × 40 u box at (200, 100), from a start at (0, 120), ends at (196, 120)', () => {
    const doc = figure('ends-attach', [320, 240], [
      item('box', 'rect@1', 'a0', { box: [200, 100, 100, 40], paint: { fill: { role: 'body' } } }),
      pathItem('link', 'a1', 'M 0 120 L 250 120', { attach: { end: 'box', gap: 4 } }),
    ]);
    const f = pathAt(doc, 'link', 'the attached link');
    const first = vertices(f.subpaths[0]!)[0]!;
    expect(dist(first, [0, 120]), `the link starts at (0, 120), got (${first.join(', ')})`).toBeLessThanOrEqual(0.01);
    const end = lastPoint(f);
    expect(dist(end, [196, 120]), `the link ends at (196, 120), 4 px short of the box's west edge; got (${end.join(', ')})`).toBeLessThanOrEqual(0.01);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC10

describe('AC10 a head is at most a quarter of its path', () => {
  it('AC10 an arrow 20 u long at stroke 3 with size 4 draws a head 5 u long, not 12; on a 100 u path the same head is 12', () => {
    const doc = figure('ends-heads', [200, 160], [
      pathItem('short', 'a0', 'M 20 50 L 40 50', { ends: { end: 'arrow', size: 4 }, paint: { stroke: { role: 'ink', width: 3 } } }),
      pathItem('long', 'a1', 'M 20 100 L 120 100', { ends: { end: 'arrow', size: 4 }, paint: { stroke: { role: 'ink', width: 3 } } }),
    ]);
    const short = endOf(pathAt(doc, 'short', 'the 20 u arrow'), 'the 20 u arrow');
    expect(Math.abs(short.length - 5), `the head on a 20 u path is a quarter of it, 5 u long (not 3 × 4 = 12); got ${short.length}`).toBeLessThanOrEqual(0.01);
    expect(Math.abs(short.width - 5), `it scales down whole: its width 12 × 5 ÷ 12 = 5 u; got ${short.width}`).toBeLessThanOrEqual(0.01);
    expect(dist(short.tip, [40, 50]), 'its tip is still at the path\'s end').toBeLessThanOrEqual(0.1);
    const long = endOf(pathAt(doc, 'long', 'the 100 u arrow'), 'the 100 u arrow');
    expect([Math.abs(long.length - 12) <= 0.01, Math.abs(long.width - 12) <= 0.01], `on a 100 u path the head is 3 × 4 = 12 u long and wide; got ${long.length} × ${long.width}`).toEqual([true, true]);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC12

describe('AC12 attach at the true outline, or at the box', () => {
  const C: Pt = [300, 300];
  function probe(at: string): Pt {
    const doc = figure(`ends-${at}`, [420, 420], [
      item('ring', 'circle@1', 'a0', { center: C, r: 50, paint: { fill: { role: 'body' } } }),
      pathItem('probe', 'a1', 'M 100 100 L 300 300', { attach: { end: 'ring', at }, ends: { end: 'arrow' }, paint: { stroke: { role: 'ink', width: 2 } } }),
    ]);
    const tip = endOf(pathAt(doc, 'probe', `the probe at ${at}`), `the probe at ${at}`).tip;
    // On the 45° line from (100, 100) toward the centre.
    expect(Math.abs(tip[0] - tip[1]), `the tip lies on the 45° line, got (${tip.join(', ')})`).toBeLessThanOrEqual(0.5);
    return tip;
  }

  it('AC12 an arrow attached at outline to a circle of radius 50 u from 45° stops 4 px (its gap) from the circle within 0.5 px', () => {
    const tip = probe('outline');
    const gap = dist(tip, C) - 50;
    expect(Math.abs(gap - 4), `the tip is ${gap.toFixed(3)} u from the circle, not its 4 px gap`).toBeLessThanOrEqual(0.5);
  }, TIMEOUT);

  it('AC12 at edge the same arrow stops 4 px before the box corner, 24.7 u short of the circle', () => {
    const tip = probe('edge');
    const corner: Pt = [250, 250];
    expect(Math.abs(dist(tip, corner) - 4), `the tip is ${dist(tip, corner).toFixed(3)} u from the box corner (250, 250), not 4`).toBeLessThanOrEqual(0.5);
    const short = dist(tip, C) - 50; // 50√2 + 4 − 50 = 24.71
    expect(Math.abs(short - (50 * Math.SQRT2 + 4 - 50)), `the tip is ${short.toFixed(3)} u short of the circle, not 24.7`).toBeLessThanOrEqual(0.5);
  }, TIMEOUT);
});
