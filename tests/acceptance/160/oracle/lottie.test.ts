// The Lottie oracle (the oracle map's lottie-spec and lottie-web rows, criteria AC1, AC3 and AC5): our ops against
// the Lottie specification's constructions and lottie-web's modifiers, on the spec's own example files.
//
// - AC1, AC5 (trim): vendor/lottie-spec-4b55957472/docs/static/examples/trim_path.json is read at run time. Its four
//   shapes (a star, an ellipse, a rectangle and a triangle) are built here by the spec's own rendering instructions
//   (docs/specs/shapes.md: PolyStar, Ellipse, Rectangle), in f64, written into one path@1 as four sub-paths in the
//   spec's vertex order, and trimmed by our `trim` with the file's start, end and offset. The expected output is the
//   spec's Trim Path rule: offset = o ÷ 360 less its whole turns, start and end cut along the actual length, `m: 1`
//   (parallel) trimming each shape on its own (our `each: true`) and `m: 2` (sequential) all shapes as one length in
//   render order (our `each: false`).
// - AC5 (round_corners): rounded_corners.json's star through lottie-web's RoundCornersModifier.processPath (each
//   corner cut min(side ÷ 2, r) along both sides, joined by a cubic whose handles reach toward the old vertex by the
//   spec's elliptical constant).
// - AC5 (pucker): pucker_bloat.json's pentagon through the spec's pucker_bloat algorithm (vertices to the centre by
//   a, handles away from it by a; a = the file's 50 ÷ 100, our `amount`).
// - AC3, AC5 (zigzag): lottie-web's ZigZagModifier.processPath, point for point, on a closed 4-segment square with
//   5 ridges per segment: 24 segments, ridges at k ÷ 6 of each side `size` off it, alternating, and each corner moved
//   `size` along the normal of the line from its previous to its next vertex (Lottie's corner rule).
//
// Every comparison is within 0.01 u (the criterion's bound for AC1 and AC5), as Hausdorff distances both ways
// (sampled every 0.25 u) or as vertex sets, and each is shown to fail on the planted `moved:<op>` (the parent
// suite's README: Planted values): that op's output moved 0.02 u along +x.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, bezier, dist, failsNaming, figure, flatten, hausdorff, none, pathAt, pathItem, useRenderBinary, vertices,
  type JsonObject, type JsonValue, type PathFrame, type Pt,
} from '../helpers.ts';

useRenderBinary();
const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, 'vendor', 'lottie-spec-4b55957472', 'docs', 'static', 'examples');
const TOL = 0.01;

// ---------------------------------------------------------------------------------------------------
// The Lottie files, read as they are

type L = { [key: string]: JsonValue };
const lottie = (name: string): L => JSON.parse(readFileSync(join(SPEC, name), 'utf8')) as L;
const asL = (v: JsonValue | undefined, what: string): L => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw Error(`${what} is not an object`);
  return v;
};
const list = (v: JsonValue | undefined, what: string): JsonValue[] => {
  if (!Array.isArray(v)) throw Error(`${what} is not an array`);
  return v;
};
/** A static property's value (`{a: 0, k}`). */
function k(shape: L, key: string): JsonValue {
  const p = asL(shape[key], `${String(shape['nm'])}.${key}`);
  if (p['a'] !== 0) throw Error(`${String(shape['nm'])}.${key} is animated; the oracle reads static values`);
  return p['k'] as JsonValue;
}
const kn = (shape: L, key: string): number => Number(k(shape, key));
const kv = (shape: L, key: string): Pt => { const v = list(k(shape, key), key).map(Number); return [v[0]!, v[1]!]; };

/** The layer's shapes, or its one group's items, after checking every transform on the way is the identity. */
function layerShapes(file: L): L[] {
  const layer = asL(list(file['layers'], 'layers')[0], 'layers[0]');
  const identity = (t: L, what: string): void => {
    const a = kv(t, 'a'); const p = kv(t, 'p'); const s = kv(t, 's');
    expect([a[0] - p[0], a[1] - p[1], s[0], s[1], kn(t, 'r')], `${what} is the identity (anchor at the position, scale 100, no turn)`).toEqual([0, 0, 100, 100, 0]);
  };
  identity(asL(layer['ks'], 'ks'), 'the layer transform');
  const shapes = list(layer['shapes'], 'shapes').map((s, i) => asL(s, `shapes[${i}]`));
  if (shapes.length === 1 && shapes[0]!['ty'] === 'gr') {
    const items = list(shapes[0]!['it'], 'it').map((s, i) => asL(s, `it[${i}]`));
    identity(items.find((s) => s['ty'] === 'tr')!, 'the group transform');
    return items.filter((s) => s['ty'] !== 'tr');
  }
  return shapes;
}

// ---------------------------------------------------------------------------------------------------
// The spec's Bézier shapes (docs/specs/shapes.md), in f64: vertices with in and out tangents relative to them.

interface Bez { v: Pt[]; i: Pt[]; o: Pt[]; closed: boolean }
const ELLIPSE_CONSTANT = 0.5519150244935105707435627; // shapes.md, "Approximating Ellipses with Cubic Bezier"
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ZERO: Pt = [0, 0];

function newBez(): Bez { return { v: [], i: [], o: [], closed: true }; }
function vertex(b: Bez, p: Pt, inT: Pt = ZERO, outT: Pt = ZERO): void { b.v.push(p); b.i.push(inT); b.o.push(outT); }

/** shapes.md `polystar`. */
function polystar(shape: L): Bez {
  const p = kv(shape, 'p'); const pt = kn(shape, 'pt'); const r = kn(shape, 'r'); const or = kn(shape, 'or');
  const os = kn(shape, 'os'); const sy = Number(shape['sy']);
  const ir = sy === 1 ? kn(shape, 'ir') : 0; const is = sy === 1 ? kn(shape, 'is') : 0;
  const points = Math.round(pt);
  const alpha = (-r * Math.PI) / 180 - Math.PI / 2;
  const theta = -Math.PI / points;
  const tanOut = ((2 * Math.PI * or) / (4 * points)) * (os / 100);
  const tanIn = ((2 * Math.PI * ir) / (4 * points)) * (is / 100);
  const b = newBez();
  for (let n = 0; n < points; n++) {
    const beta = alpha + n * theta * 2;
    const vOut: Pt = [or * Math.cos(beta), or * Math.sin(beta)];
    if (os !== 0 && or !== 0) { const t: Pt = [(vOut[0] * tanOut) / or, (vOut[1] * tanOut) / or]; vertex(b, add(p, vOut), [-t[1], t[0]], [t[1], -t[0]]); } else vertex(b, add(p, vOut));
    if (sy === 1) {
      const vIn: Pt = [ir * Math.cos(beta + theta), ir * Math.sin(beta + theta)];
      if (is !== 0 && ir !== 0) { const t: Pt = [(vIn[0] * tanIn) / ir, (vIn[1] * tanIn) / ir]; vertex(b, add(p, vIn), [-t[1], t[0]], [t[1], -t[0]]); } else vertex(b, add(p, vIn));
    }
  }
  return b;
}

/** shapes.md `ellipse`: from the top quadrant point, clockwise. */
function ellipse(shape: L): Bez {
  const p = kv(shape, 'p'); const s = kv(shape, 's');
  const r: Pt = [s[0] / 2, s[1] / 2]; const t: Pt = [r[0] * ELLIPSE_CONSTANT, r[1] * ELLIPSE_CONSTANT];
  const b = newBez();
  vertex(b, [p[0], p[1] - r[1]], [-t[0], 0], [t[0], 0]);
  vertex(b, [p[0] + r[0], p[1]], [0, -t[1]], [0, t[1]]);
  vertex(b, [p[0], p[1] + r[1]], [t[0], 0], [-t[0], 0]);
  vertex(b, [p[0] - r[0], p[1]], [0, t[1]], [0, -t[1]]);
  return b;
}

/** shapes.md `rectangle` (its r <= 0 branch, the example's: from the top right, clockwise). */
function rectangle(shape: L): Bez {
  const p = kv(shape, 'p'); const s = kv(shape, 's');
  expect(kn(shape, 'r'), 'the example rectangle has no roundness').toBe(0);
  const [l, r, t, bm] = [p[0] - s[0] / 2, p[0] + s[0] / 2, p[1] - s[1] / 2, p[1] + s[1] / 2];
  const b = newBez();
  for (const q of [[r, t], [r, bm], [l, bm], [l, t]] as Pt[]) vertex(b, q);
  return b;
}

function shapeOf(shape: L): Bez {
  if (shape['ty'] === 'sr') return polystar(shape);
  if (shape['ty'] === 'el') return ellipse(shape);
  if (shape['ty'] === 'rc') return rectangle(shape);
  throw Error(`no construction for shape type ${String(shape['ty'])}`);
}

/** The control polygons of a Bézier's segments, the closing one included (a line where both tangents are zero). */
function bezSegments(b: Bez): Pt[][] {
  const n = b.v.length; const out: Pt[][] = [];
  for (let s = 0; s < (b.closed ? n : n - 1); s++) {
    const j = (s + 1) % n;
    const straight = b.o[s]![0] === 0 && b.o[s]![1] === 0 && b.i[j]![0] === 0 && b.i[j]![1] === 0;
    out.push(straight ? [b.v[s]!, b.v[j]!] : [b.v[s]!, add(b.v[s]!, b.o[s]!), add(b.v[j]!, b.i[j]!), b.v[j]!]);
  }
  return out;
}

/** An SVG `d` for a Bézier in its own vertex order: a closing line is Z's, a closing curve a C back to the start. */
function dOf(b: Bez): string {
  const f = (p: Pt): string => `${p[0]} ${p[1]}`;
  const segs = bezSegments(b);
  const last = b.closed && segs[segs.length - 1]!.length === 2 ? segs.length - 1 : segs.length;
  const body = segs.slice(0, last).map((s) => (s.length === 2 ? `L ${f(s[1]!)}` : `C ${f(s[1]!)} ${f(s[2]!)} ${f(s[3]!)}`));
  return `M ${f(b.v[0]!)} ${body.join(' ')}${b.closed ? ' Z' : ''}`;
}

/** A Bézier flattened to a polyline, its closing segment included, each curve cut into `n` steps. */
function polyline(b: Bez, n = 256): Pt[] {
  const out: Pt[] = [b.v[0]!];
  for (const s of bezSegments(b)) { const steps = s.length === 2 ? 1 : n; for (let q = 1; q <= steps; q++) out.push(bezier(s, q / steps)); }
  return out;
}

const cumulative = (pts: Pt[]): number[] => { const c = [0]; for (let q = 1; q < pts.length; q++) c.push(c[q - 1]! + dist(pts[q - 1]!, pts[q]!)); return c; };
const lengthOf = (pts: Pt[]): number => cumulative(pts)[pts.length - 1]!;
/** The part of a polyline between arc lengths a and b (0 <= a <= b <= its length). */
function between(pts: Pt[], a: number, b: number): Pt[] {
  const c = cumulative(pts);
  const at = (s: number): Pt => { let q = 1; while (q < pts.length - 1 && c[q]! < s) q++; const d = c[q]! - c[q - 1]!; return lerp(pts[q - 1]!, pts[q]!, d === 0 ? 0 : (s - c[q - 1]!) / d); };
  const out: Pt[] = [at(a)];
  for (let q = 1; q < pts.length; q++) if (c[q]! > a && c[q]! < b) out.push(pts[q]!);
  out.push(at(b));
  return out;
}

/** The spec's Trim Path start and end, as fractions (s and e in percent, o in degrees). */
function trimWindow(s: number, e: number, o: number): [number, number] {
  const offset = o >= 0 ? o / 360 - Math.floor(o / 360) : o / 360 - Math.ceil(o / 360);
  const clamp = (x: number): number => Math.min(1, Math.max(0, x));
  return [offset + clamp(Math.min(s, e) / 100), offset + clamp(Math.max(s, e) / 100)];
}

/** A window [start, end] (fractions, possibly past 1 or below 0) on a closed polyline: one piece, or two if it wraps. */
function closedWindow(pts: Pt[], start: number, end: number): Pt[][] {
  const L = lengthOf(pts);
  if (end - start >= 1) return [pts];
  const turns = Math.floor(start); const a = start - turns; const b = end - turns;
  return b <= 1 ? [between(pts, a * L, b * L)] : [between(pts, a * L, L), between(pts, 0, (b - 1) * L)];
}

// ---------------------------------------------------------------------------------------------------
// Comparing our output

const traced = (f: PathFrame): Pt[][] => f.subpaths.map((sp) => flatten(sp, 256));
function hausdorffFailures(f: PathFrame, reference: Pt[][], what: string): string[] {
  const h = hausdorff(traced(f), reference);
  return h.d <= TOL ? [] : [`${what}: ${h.d.toFixed(4)} u from the Lottie reference (${h.side}, at (${h.at[0].toFixed(2)}, ${h.at[1].toFixed(2)}))`];
}
const strokeOf = (file: L): number => { const st = layerShapes(file).find((s) => s['ty'] === 'st'); return st ? kn(st, 'w') : 4; };
const docOf = (file: L, id: string, d: string, ops: JsonValue[]): JsonObject => figure(id, [Number(file['w']), Number(file['h'])], [
  pathItem('shape', 'a0', d, { ops, paint: { stroke: { role: 'ink', width: strokeOf(file) } } }),
]);

// ---------------------------------------------------------------------------------------------------
// AC1, AC5: trim_path.json

const TRIM_FILE = lottie('trim_path.json');
const trimShapes = layerShapes(TRIM_FILE);
const tm = trimShapes.find((s) => s['ty'] === 'tm')!;
const beziers = trimShapes.filter((s) => s['ty'] === 'sr' || s['ty'] === 'el' || s['ty'] === 'rc').map(shapeOf);

/** The file's shapes as one path, in `order`, its trim as our op with `o` in place of the file's offset. */
function trimDoc(o: number, each: boolean, order: Bez[]): JsonObject {
  return docOf(TRIM_FILE, 'oracle-lottie-trim', order.map(dOf).join(' '), [{ trim: { start: kn(tm, 's') / 100, end: kn(tm, 'e') / 100, offset: o, each } }]);
}

/** m = 1 (parallel): each shape trimmed on its own by the spec's window. */
function parallelReference(o: number): Pt[][] {
  const [start, end] = trimWindow(kn(tm, 's'), kn(tm, 'e'), o);
  return beziers.flatMap((b) => closedWindow(polyline(b), start, end));
}

describe('AC1 AC5 Lottie Trim Path on the spec\'s trim_path.json', () => {
  it('AC1 AC5 the example as it is (start 0, end 50, offset 0, m 1): each shape trimmed to the first half of its actual length, within 0.01 u', () => {
    expect([trimShapes.length, Number(tm['m']), beziers.length], 'the file: four shapes, a trim with m 1 (parallel), a stroke').toEqual([6, 1, 4]);
    const f = pathAt(trimDoc(kn(tm, 'o'), true, beziers), 'shape', 'trim_path.json, each');
    none(hausdorffFailures(f, parallelReference(kn(tm, 'o')), 'trim 0..0.5, each'), 'the trimmed shapes against the spec\'s Trim Path');
  }, TIMEOUT);

  it('AC1 the spec\'s offset rule: offsets 90°, 450° and −270° all give the window 0.25..0.75 of each shape, and 270° wraps through the start', () => {
    const failures: string[] = [];
    for (const o of [90, 450, -270, 270]) {
      const f = pathAt(trimDoc(o, true, beziers), 'shape', `trim_path.json at offset ${o}°`);
      failures.push(...hausdorffFailures(f, parallelReference(o), `offset ${o}°`));
    }
    none(failures, 'the trims at each offset against the spec\'s window');
    // A trim that ignores its offset draws 0..0.5 instead, a quarter of each shape's length away; one that doesn't
    // take the offset modulo a turn (450°), or treats a negative one otherwise, fails the same way.
  }, TIMEOUT);

  it('AC1 m 2 (sequential, our each: false): the shapes in render order, last first, trimmed as one length', () => {
    const order = [...beziers].reverse(); // shapes.md: shapes are rendered in reverse order, bottom to top
    const f = pathAt(trimDoc(0, false, order), 'shape', 'trim_path.json, sequential');
    const [start, end] = trimWindow(kn(tm, 's'), kn(tm, 'e'), 0);
    const lengths = order.map((b) => lengthOf(polyline(b)));
    const total = lengths.reduce((s, x) => s + x, 0);
    const reference: Pt[][] = [];
    let before = 0;
    order.forEach((b, q) => {
      const a = Math.max(start * total, before); const z = Math.min(end * total, before + lengths[q]!);
      if (z > a) reference.push(between(polyline(b), a - before, z - before));
      before += lengths[q]!;
    });
    expect(reference.length, 'the window covers the first shape in render order and part of the next').toBeGreaterThan(1);
    none(hausdorffFailures(f, reference, 'trim 0..0.5 over all shapes as one'), 'the sequential trim against the spec\'s Trim Path');
  }, TIMEOUT);

  it('AC5 a planted change in trim\'s output (moved:trim) fails the Lottie reference', () => {
    const f = pathAt(trimDoc(kn(tm, 'o'), true, beziers), 'shape', 'trim_path.json under moved:trim', 0, { planted: 'moved:trim' });
    failsNaming(hausdorffFailures(f, parallelReference(kn(tm, 'o')), 'trim'), ['trim'], 'moved:trim against the Lottie reference');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC5: rounded_corners.json, through lottie-web's RoundCornersModifier.processPath

const ROUND_FILE = lottie('rounded_corners.json');
const roundShapes = layerShapes(ROUND_FILE);
const star = shapeOf(roundShapes.find((s) => s['ty'] === 'sr')!);
const rd = kn(roundShapes.find((s) => s['ty'] === 'rd')!, 'r');

/** lottie-web RoundCornersModifier.processPath on a closed path whose vertices have no tangents. */
function roundCorners(b: Bez, round: number): Bez {
  const out = newBez(); const n = b.v.length;
  for (let q = 0; q < n; q++) {
    const v = b.v[q]!;
    for (const [closer, first] of [[b.v[(q - 1 + n) % n]!, true], [b.v[(q + 1) % n]!, false]] as [Pt, boolean][]) {
      const distance = dist(v, closer);
      const perc = distance ? Math.min(distance / 2, round) / distance : 0;
      const p = lerp(v, closer, perc);
      const handle = sub(lerp(p, v, ELLIPSE_CONSTANT), p); // toward the old vertex, E_t of the way
      if (first) vertex(out, p, ZERO, handle); else vertex(out, p, handle, ZERO);
    }
  }
  return out;
}

const roundDoc = (): JsonObject => docOf(ROUND_FILE, 'oracle-lottie-round', dOf(star), [{ round_corners: { radius: rd } }]);

describe('AC5 Lottie Rounded Corners on the spec\'s rounded_corners.json', () => {
  it('AC5 the example\'s star (5 points, radii 222.7 and 111.4, turned 358.67°) with radius 50 matches lottie-web\'s rounded corners within 0.01 u', () => {
    expect([star.v.length, rd], 'the file: a 10-vertex star, rounded by 50').toEqual([10, 50]);
    const f = pathAt(roundDoc(), 'shape', 'rounded_corners.json');
    none(hausdorffFailures(f, [polyline(roundCorners(star, rd))], 'round_corners 50'), 'the rounded star against lottie-web\'s');
    // A circular fillet of radius 50 tangent to both sides of a spike meets them r ÷ tan(half the corner's angle)
    // back from the vertex, not 50 u, and fails by units.
  }, TIMEOUT);

  it('AC5 a planted change in round_corners\'s output (moved:round_corners) fails the Lottie reference', () => {
    const f = pathAt(roundDoc(), 'shape', 'rounded_corners.json under moved:round_corners', 0, { planted: 'moved:round_corners' });
    failsNaming(hausdorffFailures(f, [polyline(roundCorners(star, rd))], 'round_corners'), ['round_corners'], 'moved:round_corners against the Lottie reference');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC5: pucker_bloat.json, through the spec's pucker_bloat algorithm

const PUCKER_FILE = lottie('pucker_bloat.json');
const puckerShapes = layerShapes(PUCKER_FILE);
const pentagon = shapeOf(puckerShapes.find((s) => s['ty'] === 'sr')!);
const pbA = kn(puckerShapes.find((s) => s['ty'] === 'pb')!, 'a');

/** shapes.md `pucker_bloat` (a in percent). */
function puckerBloat(b: Bez, a: number): Bez {
  const amount = a / 100; const out = newBez();
  const c: Pt = [b.v.reduce((s, p) => s + p[0], 0) / b.v.length, b.v.reduce((s, p) => s + p[1], 0) / b.v.length];
  b.v.forEach((p, q) => {
    const v = lerp(p, c, amount);
    vertex(out, v, sub(lerp(add(p, b.i[q]!), c, -amount), v), sub(lerp(add(p, b.o[q]!), c, -amount), v));
  });
  return out;
}

const puckerDoc = (): JsonObject => docOf(PUCKER_FILE, 'oracle-lottie-pucker', dOf(pentagon), [{ pucker: { amount: pbA / 100 } }]);

describe('AC5 Lottie Pucker / Bloat on the spec\'s pucker_bloat.json', () => {
  it('AC5 the example\'s pentagon (radius 160) at amount 50 (our 0.5) matches the spec\'s pucker_bloat within 0.01 u', () => {
    expect([pentagon.v.length, pbA], 'the file: a pentagon, amount 50').toEqual([5, 50]);
    const f = pathAt(puckerDoc(), 'shape', 'pucker_bloat.json');
    none(hausdorffFailures(f, [polyline(puckerBloat(pentagon, pbA))], 'pucker 0.5'), 'the bloated pentagon against the spec\'s');
    // A pucker with its sign the other way pushes the vertices out and pulls the edges in, and fails by tens of units.
  }, TIMEOUT);

  it('AC5 a planted change in pucker\'s output (moved:pucker) fails the Lottie reference', () => {
    const f = pathAt(puckerDoc(), 'shape', 'pucker_bloat.json under moved:pucker', 0, { planted: 'moved:pucker' });
    failsNaming(hausdorffFailures(f, [polyline(puckerBloat(pentagon, pbA))], 'pucker'), ['pucker'], 'moved:pucker against the Lottie reference');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC3, AC5: lottie-web's ZigZagModifier.processPath (corner points, pointType 1) on a closed square

const SQUARE: Pt[] = [[100, 100], [200, 100], [200, 200], [100, 200]];
const SIZE = 10; const RIDGES = 5;
const zigDoc = figure('oracle-lottie-zigzag', [300, 300], [
  pathItem('shape', 'a0', `M ${SQUARE.map((p) => p.join(' ')).join(' L ')} Z`, { ops: [{ zigzag: { size: SIZE, ridges: RIDGES, points: 'corner' } }] }),
]);

/**
 * ZigZagModifier.processPath on a closed polygon (`sense` −1 for its mirror image). setPoint moves a point by
 * direction × amplitude along (vy, −vx) ÷ |v|: for a corner v runs from its previous vertex to its next
 * (getPerpendicularVector's −90° turn), for a ridge along its segment (the segment's normal). Ridges sit at
 * (r + 1) ÷ (ridges + 1) of each side, the direction flipping after each; each side starts on the opposite of the
 * corner before it, and each corner takes the direction the side before it ended on.
 */
function zigzagLottie(v: Pt[], amplitude: number, frequency: number, sense: 1 | -1): { ridges: Pt[]; corners: Pt[] } {
  const n = v.length;
  const move = (p: Pt, from: Pt, to: Pt, direction: number): Pt => {
    const vx = to[0] - from[0]; const vy = to[1] - from[1]; const l = Math.hypot(vx, vy);
    return [p[0] + (sense * direction * amplitude * vy) / l, p[1] - (sense * direction * amplitude * vx) / l];
  };
  const corner = (cur: number, direction: number): Pt => move(v[cur % n]!, v[cur === 0 ? n - 1 : cur - 1]!, v[(cur + 1) % n]!, direction);
  const ridges: Pt[] = []; const corners: Pt[] = [];
  let direction = -1;
  corners.push(corner(0, direction));
  for (let s = 0; s < n; s++) {
    let d = -direction;
    const a = v[s]!; const b = v[(s + 1) % n]!;
    for (let r = 0; r < frequency; r++) { ridges.push(move(lerp(a, b, (r + 1) / (frequency + 1)), a, b, d)); d = -d; }
    direction = d;
    if (s < n - 1) corners.push(corner(s + 1, direction)); // corner n is corner 0 again on a closed path
  }
  return { ridges, corners };
}

/** Each expected point has an output vertex within the tolerance. */
function missing(got: Pt[], want: Pt[], what: string): string[] {
  return want.flatMap((w) => { const d = Math.min(...got.map((g) => dist(g, w))); return d <= TOL ? [] : [`${what}: no vertex within ${TOL} u of (${w[0].toFixed(3)}, ${w[1].toFixed(3)}); the nearest is ${d.toFixed(4)} u away`]; });
}
/** The sense (which side the first ridge goes) read from the output: the one whose ridges it matches better. */
function senseOf(got: Pt[]): 1 | -1 {
  const miss = (s: 1 | -1): number => zigzagLottie(SQUARE, SIZE, RIDGES, s).ridges.reduce((t, w) => t + Math.min(...got.map((g) => dist(g, w))), 0);
  return miss(1) <= miss(-1) ? 1 : -1;
}

describe('AC3 AC5 lottie-web\'s zig zag on a closed 4-segment square', () => {
  it('AC3 AC5 5 ridges per segment build the 24 segments computed before the build, the ridges where lottie-web puts them within 0.01 u', () => {
    const f = pathAt(zigDoc, 'shape', 'the zig zag');
    expect(f.declared, 'declared: (5 + 1) × 4').toBe(24);
    expect(f.segments, 'segments built').toBe(24);
    const got = f.subpaths.flatMap(vertices);
    expect(got.length, 'lottie-web\'s 1 + 4 × (5 + 1) points, the last the first again: 24 vertices').toBe(24);
    const { ridges } = zigzagLottie(SQUARE, SIZE, RIDGES, senseOf(got));
    none(missing(got, ridges, 'ridge'), 'the 20 ridges against lottie-web\'s, at k ÷ 6 of each side, 10 u off it, alternating');
  }, TIMEOUT);

  it('AC5 each corner moves as lottie-web\'s corner rule moves it: size along the normal of its neighbours\' chord, keeping the alternation', () => {
    const got = pathAt(zigDoc, 'shape', 'the zig zag').subpaths.flatMap(vertices);
    const { corners } = zigzagLottie(SQUARE, SIZE, RIDGES, senseOf(got));
    none(missing(got, corners, 'corner'), 'the 4 corners against lottie-web\'s, each 10 u along its diagonal');
  }, TIMEOUT);

  it('AC5 a planted change in zigzag\'s output (moved:zigzag) fails the lottie-web reference', () => {
    const got = pathAt(zigDoc, 'shape', 'the zig zag under moved:zigzag', 0, { planted: 'moved:zigzag' }).subpaths.flatMap(vertices);
    const { ridges, corners } = zigzagLottie(SQUARE, SIZE, RIDGES, senseOf(got));
    failsNaming([...missing(got, ridges, 'zigzag ridge'), ...missing(got, corners, 'zigzag corner')], ['zigzag'], 'moved:zigzag against lottie-web');
  }, TIMEOUT);
});
