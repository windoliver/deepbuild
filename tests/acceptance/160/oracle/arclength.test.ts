// The arc-length oracles (the oracle map's kurbo and Godot rows, criteria AC1, AC7 and AC13): lengths and points by
// arc length, read through `path`'s `#length` and `#at:<f>` anchors, a trim's ends and a trimmed arrow's tip.
//
// - kurbo (vendor/kurbo-9366cda80e/kurbo/src): cubicbez_arclen and cubicbez_inv_arclen's cubic for y = x² (whose
//   true length kurbo states as 0.5√5 + 0.25 ln(2 + √5)), quadbez_arclen's quadratic for the same parabola,
//   cubicbez_inv_arclen_accuracy's cubic and its point at arc length 0.5, line_arclen's line with its point at a
//   third of its length, and quadbez_arclen_pathological's quadratic that runs past its end and back. Each is
//   scaled by 100 (cubicbez_inv_arclen's own scale; at kurbo's unit size our 0.01 u bound would be 0.7% of the
//   curve) and moved by (50, 50) onto the figure ((100, 50) for the last). Expected points by arc length are
//   computed here in f64 (Gauss–Legendre quadrature of |B′| and bisection on t), as kurbo's inv_arclen asks.
// - Godot (vendor/godot-ed1daf0bf0/tests/scene): PathFollow2D's square of four 100 u lines sampled by progress
//   ratio and by progress (progress p is `#at:` p ÷ `#length`), its removal-of-a-point case, and Curve2D's baked
//   length, its samples on a straight line, its sample_baked_with_rotation lines (point and angle; Godot's rotation
//   is atan2 in y-down space, as our angle is) and its sample Bézier, which Godot checks only as longer than 50 and
//   which is held here to its integrated length. Curve2D's lines start at the origin and run to negative
//   coordinates, so they are moved by (100, 100); the square stays where Godot puts it.
//
// Bounds are the criteria's: `#length` within 0.01 u and `#at` within 0.1 u (AC13), a trim within 0.01 u (AC1), an
// arrow's tip within 0.1 u and its direction within 1° (AC7); an anchor's tangent angle within 1°, as the parent
// suite reads it. No planted value reaches an anchor (the parent suite's planted values move ops, merges and
// repeaters), so the anchor tests' wrong program is the base, which has no `path` (BASE-FAILURE.txt); the trim test
// fails on `moved:trim`.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, angleDiff, angleOf, arr, bezier, dist, failsNaming, figure, flatten, hausdorff, none, num, obj, pathAt,
  pathItem, useRenderBinary, type JsonObject, type PathFrame, type Pt,
} from '../helpers.ts';

useRenderBinary();

// ---------------------------------------------------------------------------------------------------
// Arc length in f64

/** The derivative of a Bézier (2, 3 or 4 control points) at u. */
function derivative(seg: Pt[], u: number): Pt {
  const n = seg.length - 1;
  const d = seg.slice(1).map((p, i) => [n * (p[0] - seg[i]![0]), n * (p[1] - seg[i]![1])] as Pt);
  return d.length === 1 ? d[0]! : bezier(d, u);
}
const GL: [number, number][] = [ // 5-point Gauss–Legendre nodes and weights on [−1, 1]
  [0, 0.5688888888888889], [-0.5384693101056831, 0.4786286704993665], [0.5384693101056831, 0.4786286704993665],
  [-0.9061798459386640, 0.2369268850561891], [0.9061798459386640, 0.2369268850561891],
];
/** The arc length of a Bézier from 0 to u (200 panels of 5-point Gauss–Legendre). */
function arc(seg: Pt[], u: number): number {
  const panels = 200; let s = 0;
  for (let q = 0; q < panels; q++) {
    const a = (u * q) / panels; const b = (u * (q + 1)) / panels;
    for (const [x, w] of GL) { const d = derivative(seg, (a + b) / 2 + ((b - a) / 2) * x); s += ((b - a) / 2) * w * Math.hypot(d[0], d[1]); }
  }
  return s;
}
/** The parameter at arc length s (bisection). */
function inverseArc(seg: Pt[], s: number): number {
  let lo = 0; let hi = 1;
  for (let q = 0; q < 60; q++) { const m = (lo + hi) / 2; if (arc(seg, m) < s) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** The point and tangent angle a fraction f of the way along a Bézier by arc length. */
function byArc(seg: Pt[], f: number): { point: Pt; angle: number } {
  const u = inverseArc(seg, f * arc(seg, 1));
  const d = derivative(seg, u);
  return { point: bezier(seg, u), angle: angleOf(d[0], d[1]) };
}

// ---------------------------------------------------------------------------------------------------
// Reading anchors

const fmt = (p: Pt): string => `(${p[0].toFixed(4)}, ${p[1].toFixed(4)})`;
const lengthOf = (f: PathFrame, what: string): number => num(obj(f.anchors, `${what}: anchors`)['#length'], `${what}: #length`);
function atOf(f: PathFrame, name: string, what: string): { point: Pt; angle: number } {
  const a = obj(obj(f.anchors, `${what}: anchors`)[name], `${what}: ${name}`);
  const p = arr(a['point'], `${what}: ${name}.point`).map((v) => num(v, 'point'));
  return { point: [p[0]!, p[1]!], angle: num(a['angle'], `${what}: ${name}.angle`) };
}
const anchorName = (f: number): string => `#at:${f}`;
function pointFailures(f: PathFrame, cases: { f: number; point: Pt; angle?: number }[], what: string): string[] {
  return cases.flatMap((c) => {
    const got = atOf(f, anchorName(c.f), what); const out: string[] = [];
    const d = dist(got.point, c.point);
    if (!(d <= 0.1)) out.push(`${what} ${anchorName(c.f)} at ${fmt(got.point)}, ${d.toFixed(4)} u from ${fmt(c.point)}`);
    if (c.angle !== undefined && !(Math.abs(angleDiff(got.angle, c.angle)) <= 1)) out.push(`${what} ${anchorName(c.f)} points ${got.angle.toFixed(3)}°, not ${c.angle.toFixed(3)}° ± 1°`);
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------
// kurbo's curves, ×100, moved by (50, 50)

const at50 = (pts: Pt[]): Pt[] => pts.map((p) => [p[0] * 100 + 50, p[1] * 100 + 50] as Pt);
const KURBO: Record<string, { seg: Pt[]; length: number; source: string }> = {
  cubic: { // cubicbez_arclen, cubicbez_inv_arclen: y = x²
    seg: at50([[0, 0], [1 / 3, 0], [2 / 3, 1 / 3], [1, 1]]), length: 100 * (0.5 * Math.sqrt(5) + 0.25 * Math.log(2 + Math.sqrt(5))), source: 'cubicbez_arclen',
  },
  quad: { // quadbez_arclen: the same parabola as a quadratic
    seg: at50([[0, 0], [0, 0.5], [1, 1]]), length: 100 * (0.5 * Math.sqrt(5) + 0.25 * Math.log(2 + Math.sqrt(5))), source: 'quadbez_arclen',
  },
  accuracy: { // cubicbez_inv_arclen_accuracy
    seg: at50([[0.2, 0.73], [0.35, 1.08], [0.85, 1.08], [1.0, 0.73]]), length: Number.NaN, source: 'cubicbez_inv_arclen_accuracy',
  },
  line: { // line_arclen
    seg: at50([[0, 0], [1, 1]]), length: 100 * Math.SQRT2, source: 'line_arclen',
  },
  pathological: { // quadbez_arclen_pathological: a quadratic that runs past its end and back (×100, moved by (100, 50))
    seg: [[0, 50], [203, 50], [200, 50]], length: 100 * 2.0008737864167325, source: 'quadbez_arclen_pathological',
  },
};
KURBO['accuracy']!.length = arc(KURBO['accuracy']!.seg, 1);
const dOf = (seg: Pt[]): string => `M ${seg[0]!.join(' ')} ${seg.length === 2 ? 'L' : seg.length === 3 ? 'Q' : 'C'} ${seg.slice(1).map((p) => p.join(' ')).join(' ')}`;
const kurboDoc = figure('oracle-kurbo', [300, 300], Object.entries(KURBO).map(([id, c], i) => pathItem(id, `a${i}`, dOf(c.seg))));

describe('AC13 kurbo\'s arc-length cases through #length and #at', () => {
  it('AC13 #length of kurbo\'s cubic, quadratic, accuracy cubic, line and pathological quadratic is each one\'s true arc length within 0.01 u', () => {
    expect(Math.abs(arc(KURBO['cubic']!.seg, 1) - KURBO['cubic']!.length), 'this file\'s quadrature agrees with kurbo\'s closed form').toBeLessThan(1e-9);
    expect(Math.abs(arc(KURBO['pathological']!.seg, 1) - KURBO['pathological']!.length), 'and with kurbo\'s empirical length of its pathological quadratic').toBeLessThan(1e-3);
    const failures = Object.entries(KURBO).flatMap(([id, c]) => {
      const got = lengthOf(pathAt(kurboDoc, id, `kurbo's ${c.source}`, 0, { anchors: ['#length'] }), id);
      return Math.abs(got - c.length) <= 0.01 ? [] : [`${id} (${c.source}): #length ${got.toFixed(5)}, not ${c.length.toFixed(5)} ± 0.01`];
    });
    none(failures, 'each #length against its arc length');
    // A length read from the curve flattened at the design's 0.1 px is about (0.1 ÷ 3) × its turn short: 0.037 u on
    // the parabola, past the bound.
  }, TIMEOUT);

  it('AC13 cubicbez_inv_arclen: #at:j/10 on the parabola, as a cubic and as a quadratic, lies j/10 of its arc length along it within 0.1 u, along its tangent within 1°', () => {
    const failures: string[] = [];
    for (const id of ['cubic', 'quad']) {
      const seg = KURBO[id]!.seg;
      const cases = Array.from({ length: 11 }, (_, j) => ({ f: j / 10, ...byArc(seg, j / 10) }));
      const f = pathAt(kurboDoc, id, `kurbo's ${id}`, 0, { anchors: cases.map((c) => anchorName(c.f)) });
      failures.push(...pointFailures(f, cases, id));
    }
    none(failures, 'the points by arc length');
    // #at by the curve's parameter instead puts #at:0.5 of the cubic at (100, 75), 16.6 u from (111.07, 87.30).
  }, TIMEOUT);

  it('AC13 cubicbez_inv_arclen_accuracy and line_arclen: the point 50 u along kurbo\'s accuracy cubic, and a third of the way along its line', () => {
    const acc = KURBO['accuracy']!; const line = KURBO['line']!;
    const accCase = { f: 50 / acc.length, ...byArc(acc.seg, 50 / acc.length) };
    const lineCase = { f: 1 / 3, point: bezier(line.seg, 1 / 3), angle: 45 }; // kurbo: inv_arclen(len ÷ 3) is t = 1/3
    const failures = [
      ...pointFailures(pathAt(kurboDoc, 'accuracy', 'kurbo\'s accuracy cubic', 0, { anchors: [anchorName(accCase.f)] }), [accCase], 'accuracy'),
      ...pointFailures(pathAt(kurboDoc, 'line', 'kurbo\'s line', 0, { anchors: [anchorName(lineCase.f)] }), [lineCase], 'line'),
    ];
    none(failures, 'the points by arc length');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC1 and AC7 on kurbo's cubic: a trim's ends and an arrow's tip by arc length

const PARABOLA = KURBO['cubic']!.seg;
const trimmed = (start: number, end: number, extra: JsonObject = {}): JsonObject => figure('oracle-kurbo-trim', [300, 300], [
  pathItem('curve', 'a0', dOf(PARABOLA), { ops: [{ trim: { start, end } }], ...extra }),
]);
/** The parabola between fractions a and b of its arc length, as a fine polyline. */
function piece(a: number, b: number): Pt[] {
  const ua = inverseArc(PARABOLA, a * arc(PARABOLA, 1)); const ub = inverseArc(PARABOLA, b * arc(PARABOLA, 1));
  return Array.from({ length: 2049 }, (_, q) => bezier(PARABOLA, ua + ((ub - ua) * q) / 2048));
}
function trimFailures(f: PathFrame, what: string): string[] {
  const h = hausdorff(f.subpaths.map((sp) => flatten(sp, 512)), [piece(0.25, 0.75)]);
  return h.d <= 0.01 ? [] : [`${what}: ${h.d.toFixed(4)} u from the parabola between 0.25 and 0.75 of its arc length (${h.side}, at ${fmt(h.at)})`];
}

describe('AC1 AC7 a trim and a trimmed arrow on kurbo\'s cubic, by its arc length', () => {
  it('AC1 trim 0.25..0.75 of the parabola covers it from a quarter to three quarters of its arc length within 0.01 u', () => {
    none(trimFailures(pathAt(trimmed(0.25, 0.75), 'curve', 'the trimmed parabola'), 'trim 0.25..0.75'), 'the trim against kurbo\'s arc length');
    // A trim by the curve's parameter instead ends 13.4 u from where it should at 0.75, and starts 11.0 u off.
  }, TIMEOUT);

  it('AC1 a planted change in trim\'s output (moved:trim) fails the arc-length reference', () => {
    const f = pathAt(trimmed(0.25, 0.75), 'curve', 'the trimmed parabola under moved:trim', 0, { planted: 'moved:trim' });
    failsNaming(trimFailures(f, 'trim'), ['trim'], 'moved:trim against the arc-length reference');
  }, TIMEOUT);

  it('AC7 an arrow at the end of the parabola trimmed to 0.25, 0.5 and 1 has its tip at that fraction of its arc length within 0.1 u, along the tangent within 1°', () => {
    const failures: string[] = [];
    for (const end of [0.25, 0.5, 1]) {
      const f = pathAt(trimmed(0, end, { ends: { end: 'arrow' } }), 'curve', `the parabola trimmed to ${end} with an arrow`);
      const tip = f.ends?.['end'];
      if (tip === undefined) { failures.push(`trim to ${end}: no end arrow in the frame`); continue; }
      const want = byArc(PARABOLA, end);
      if (!(dist(tip.tip, want.point) <= 0.1)) failures.push(`trim to ${end}: the tip at ${fmt(tip.tip)}, ${dist(tip.tip, want.point).toFixed(4)} u from ${fmt(want.point)}`);
      if (!(Math.abs(angleDiff(tip.angle, want.angle)) <= 1)) failures.push(`trim to ${end}: the arrow points ${tip.angle.toFixed(3)}°, not ${want.angle.toFixed(3)}° ± 1°`);
    }
    none(failures, 'the trimmed arrow against kurbo\'s arc length');
    // moved:trim moves the tip 0.02 u, inside this criterion's 0.1 u, so no planted value fails this test.
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// Godot's PathFollow2D and Curve2D cases

const godotDoc = figure('oracle-godot', [300, 300], [
  pathItem('square', 'a0', 'M 0 0 L 100 0 L 100 100 L 0 100 L 0 0'), // PathFollow2D: Sampling with progress (ratio)
  pathItem('three', 'a1', 'M 0 0 L 100 0 L 100 100'), // Removal of a point in curve: before
  pathItem('two', 'a2', 'M 0 0 L 100 100'), // ... after point 1 is removed
  pathItem('down', 'a3', 'M 100 100 L 100 150'), // Curve2D: Baked straight line, Sampling (moved by (100, 100))
  pathItem('east', 'a4', 'M 100 100 L 150 100'), // sample_baked_with_rotation's four lines
  pathItem('south', 'a5', 'M 100 100 L 100 150'),
  pathItem('west', 'a6', 'M 100 100 L 50 100'),
  pathItem('north', 'a7', 'M 100 100 L 100 50'),
  pathItem('bezier', 'a8', 'M 100 100 C 150 100 50 150 100 150'), // add_sample_curve_points
]);
const RATIO: [number, Pt][] = [[0, [0, 0]], [0.125, [50, 0]], [0.25, [100, 0]], [0.375, [100, 50]], [0.5, [100, 100]], [0.625, [50, 100]], [0.75, [0, 100]], [0.875, [0, 50]], [1, [0, 0]]];
const PROGRESS: [number, Pt][] = [[0, [0, 0]], [50, [50, 0]], [100, [100, 0]], [150, [100, 50]], [200, [100, 100]], [250, [50, 100]], [300, [0, 100]], [350, [0, 50]], [400, [0, 0]]];

describe('AC13 Godot\'s PathFollow2D and Curve2D cases through #at and #length', () => {
  it('AC13 PathFollow2D: the square of four 100 u lines has #length 400, and by progress ratio and by progress each point lies where Godot puts it within 0.1 u (progress 150 is 50 u into the second side)', () => {
    const anchors = ['#length', ...new Set([...RATIO.map(([f]) => anchorName(f)), ...PROGRESS.map(([p]) => anchorName(p / 400))])];
    const f = pathAt(godotDoc, 'square', 'Godot\'s square', 0, { anchors });
    const length = lengthOf(f, 'the square');
    expect(Math.abs(length - 400), `the square's #length is 400 ± 0.01; got ${length}`).toBeLessThanOrEqual(0.01);
    none([
      ...pointFailures(f, RATIO.map(([r, p]) => ({ f: r, point: p })), 'progress ratio'),
      ...pointFailures(f, PROGRESS.map(([p, q]) => ({ f: p / 400, point: q })), 'progress'),
    ], 'the square sampled as Godot samples it');
  }, TIMEOUT);

  it('AC13 PathFollow2D, removal of a point: #at:0.5 of (0,0) (100,0) (100,100) is (100, 0), and of (0,0) (100,100) is (50, 50)', () => {
    none([
      ...pointFailures(pathAt(godotDoc, 'three', 'three points', 0, { anchors: ['#at:0.5'] }), [{ f: 0.5, point: [100, 0] }], 'three points'),
      ...pointFailures(pathAt(godotDoc, 'two', 'two points', 0, { anchors: ['#at:0.5'] }), [{ f: 0.5, point: [50, 50] }], 'two points'),
    ], 'the follower\'s point before and after the removal');
  }, TIMEOUT);

  it('AC13 Curve2D: a 50 u line\'s #length is 50 and it samples (0, 0), (0, 25), (0, 50); sample_baked_with_rotation at 25 gives each line\'s midpoint and its angle, 0°, 90°, 180° and −90°', () => {
    const down = pathAt(godotDoc, 'down', 'the straight line', 0, { anchors: ['#length', '#at:0', '#at:0.5', '#at:1'] });
    expect(Math.abs(lengthOf(down, 'the straight line') - 50), 'the baked length').toBeLessThanOrEqual(0.01);
    const failures = pointFailures(down, [{ f: 0, point: [100, 100] }, { f: 0.5, point: [100, 125] }, { f: 1, point: [100, 150] }], 'the straight line');
    const rot: [string, Pt, number][] = [['east', [125, 100], 0], ['south', [100, 125], 90], ['west', [75, 100], 180], ['north', [100, 75], -90]];
    for (const [id, p, a] of rot) failures.push(...pointFailures(pathAt(godotDoc, id, `the ${id} line`, 0, { anchors: ['#at:0.5'] }), [{ f: 0.5, point: p, angle: a }], id));
    none(failures, 'Curve2D\'s samples');
  }, TIMEOUT);

  it('AC13 Curve2D\'s sample Bézier is longer than its 50 u chord, as Godot checks, and its #length and #at:0.5 are its arc length\'s within 0.01 u and 0.1 u', () => {
    const seg: Pt[] = [[100, 100], [150, 100], [50, 150], [100, 150]];
    const f = pathAt(godotDoc, 'bezier', 'Godot\'s sample Bézier', 0, { anchors: ['#length', '#at:0.5'] });
    const length = lengthOf(f, 'the Bézier');
    expect(length, 'longer than a straight between its points').toBeGreaterThan(50);
    expect(Math.abs(length - arc(seg, 1)), `#length ${length} against the integrated ${arc(seg, 1).toFixed(5)}`).toBeLessThanOrEqual(0.01);
    none(pointFailures(f, [{ f: 0.5, ...byArc(seg, 0.5) }], 'the Bézier'), 'its midpoint by arc length');
  }, TIMEOUT);
});
