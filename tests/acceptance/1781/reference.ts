// Worked values for the #1781 acceptance tests, each from the issue's text and the design, worked by hand or by
// the reviewed code below: the 36 attributes criterion 1's fixture box carries and how their values compare; a 1 m
// axis-aligned box's 26 places (8 corners, 12 edge midpoints, 6 face centres) and which corners each place is made
// from; and what the arrays of criteria 3, 4, 5, 7 and 8 must hold, judged element by element from each element's
// own position, so no judgement leans on the order a mesh numbers its points or corners in. Nothing here reads a
// binary or imports the test runner: every function takes the arrays a test read and returns what is wrong in them.

export type V3 = [number, number, number];

/** The tolerance float values are held to: `geometry.attributes`' own default, and the issue's "within 1e-6". */
const TOL = 1e-6;
export const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOL;
/** A number as a message shows it. */
export const fmt = (x: number): string => String(Number(x.toFixed(9)));
const at = (p: V3): string => `(${p.map(fmt).join(', ')})`;

// ---------------------------------------------------------------------------------------------------
// Criterion 1: one attribute for each of the 36 pairs of a mesh domain and a type, 450 values in all.

/** A mesh domain's element count on a 1 m box: 8 points, 12 edges, 6 faces, 24 corners. */
export const COUNTS = { point: 8, edge: 12, face: 6, corner: 24 } as const;
type Domain = keyof typeof COUNTS;
const DOMAINS: Domain[] = ['point', 'edge', 'face', 'corner'];
const TYPES = ['bool', 'i32', 'u32', 'f32', 'vec2', 'vec3', 'vec4', 'quat', 'color'] as const;
type Type = (typeof TYPES)[number];
/** One element's value: a number (bool as 0 or 1, i32, u32, f32), or a vector's components. */
type Value = number | number[];
/** One attribute as `test.attrs@1`'s params list it. */
export type Attribute = { name: string; domain: Domain; type: Type; values: Value[] };

/** The types compared exactly; the others are float types, compared within the tolerance. */
const WHOLE: readonly string[] = ['bool', 'i32', 'u32'];

/** Twelve unit quaternions [x, y, z, w], every component 0, ±0.5 or 1 (exact in f32), w never negative. */
const QUATS: number[][] = [
  [0, 0, 0, 1], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0],
  [0.5, 0.5, 0.5, 0.5], [-0.5, 0.5, 0.5, 0.5], [0.5, -0.5, 0.5, 0.5], [0.5, 0.5, -0.5, 0.5],
  [-0.5, -0.5, 0.5, 0.5], [-0.5, 0.5, -0.5, 0.5], [0.5, -0.5, -0.5, 0.5], [-0.5, -0.5, -0.5, 0.5],
];

/** The u32 the issue names: 16,777,217 = 2²⁴ + 1, which f32 can't hold; kept as f32 it reads 16,777,216. */
export const BIG = { attribute: 'point_u32', element: 3, value: 16_777_217, asF32: 16_777_216 } as const;

/**
 * Element `i`'s value in the attribute of domain number `d` (0 point, 1 edge, 2 face, 3 corner) and `type`. Every
 * number but `BIG.value` is exact in f32, so only that one differs on a mesh that keeps its values as f32.
 */
function valueOf(d: number, type: Type, i: number): Value {
  switch (type) {
    case 'bool': return (i + d) % 3 === 0 ? 1 : 0;
    case 'i32': return (i - 2) * 1001 - d;
    case 'u32': return 1000 * (d + 1) + i;
    case 'f32': return d - 1 + 0.125 * i;
    case 'vec2': return [i, d - 0.5 * i];
    case 'vec3': return [i + 0.25, d, 0 - i];
    case 'vec4': return [i, 0.5 * i, d, -2];
    case 'quat': return [...QUATS[(i + d) % QUATS.length]!];
    case 'color': return [i / 32, 0.25 * d, 1 - i / 32, 1];
  }
}

/** The 36 attributes, named `<domain>_<type>`: 9 types × (8 + 12 + 6 + 24) elements = 450 values. */
export const EVERY: Attribute[] = DOMAINS.flatMap((domain, d) => TYPES.map((type): Attribute => ({
  name: `${domain}_${type}`, domain, type,
  values: Array.from({ length: COUNTS[domain] }, (_, i) => (`${domain}_${type}` === BIG.attribute && i === BIG.element ? BIG.value : valueOf(d, type, i))),
})));

/**
 * The first element at which `got` differs from `want`, or −1: bool, i32 and u32 compare exactly, float types
 * within 1e-6 on each component; a value of another shape, or a list of another length, differs.
 */
export function firstDifference(type: string, got: readonly unknown[], want: readonly Value[]): number {
  const same = (g: unknown, w: number): boolean => typeof g === 'number' && (WHOLE.includes(type) ? g === w : near(g, w));
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    const [g, w] = [got[i], want[i]];
    if (w === undefined) return i;
    const ok = typeof w === 'number' ? same(g, w) : Array.isArray(g) && g.length === w.length && w.every((c, k) => same(g[k], c));
    if (!ok) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------------
// A 1 m axis-aligned box's places. After one level of `simple` subdivision its 26 points are its 8 corners, its
// 12 edge midpoints and its 6 face centres (V′ = V + E + F = 8 + 12 + 6).

/** Where a position stands on each axis of the box: −1 on its least side, +1 on its greatest, 0 half way. */
type Place = [number, number, number];
/** How many axes a place is half way on: 0 a corner, 1 an edge midpoint, 2 a face centre. */
const zerosOf = (place: Place): number => place.filter((s) => s === 0).length;
const keyOf = (place: Place): string => place.join(' ');
const KINDS = ['source point', 'edge point', 'face point'];

interface Lattice { lo: V3; places: Place[] }

/**
 * Each position's place on the box the positions span, or null with the reasons added to `out`: the positions
 * must span 1 m on each axis, and each must stand on a corner, an edge midpoint or a face centre, within 1e-6 m.
 */
function latticeOf(what: string, positions: V3[], out: string[]): Lattice | null {
  const along = (a: number): number[] => positions.map((p) => p[a]!);
  const lo = [0, 1, 2].map((a) => Math.min(...along(a))) as V3;
  const hi = [0, 1, 2].map((a) => Math.max(...along(a))) as V3;
  const before = out.length;
  for (const a of [0, 1, 2]) if (!near(hi[a]! - lo[a]!, 1)) out.push(`${what}: they span ${fmt(hi[a]! - lo[a]!)} m along ${'xyz'[a]}, not 1 m`);
  const places = positions.map((p, i) => {
    const place = p.map((x, a) => [-1, 0, 1].find((s) => near(x, lo[a]! + (s + 1) / 2)) ?? Number.NaN) as Place;
    if (place.some((s) => Number.isNaN(s))) out.push(`${what}: element ${i} at ${at(p)} is on no corner, edge midpoint or face centre of the box`);
    return place;
  });
  return out.length === before ? { lo, places } : null;
}

/** Where `place` is, on the box whose least corner is `lo`. */
const positionOf = (lo: V3, place: Place): V3 => place.map((s, a) => lo[a]! + (s + 1) / 2) as V3;

/** Why `places` aren't the box's `n` places, each once: its 8 corners, or with them its edge midpoints and face centres. */
function wholeProblems(what: string, places: Place[], n: 8 | 26): string[] {
  const want: string[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    const zeros = zerosOf([x, y, z]);
    if (n === 8 ? zeros === 0 : zeros < 3) want.push(keyOf([x, y, z]));
  }
  const seen = new Map<string, number>();
  for (const p of places) seen.set(keyOf(p), (seen.get(keyOf(p)) ?? 0) + 1);
  const out: string[] = [];
  for (const k of want) if (seen.get(k) !== 1) out.push(`${what}: ${seen.get(k) ?? 0} of them stand at place [${k}], not 1`);
  for (const [k, c] of seen) if (!want.includes(k)) out.push(`${what}: ${c} of them stand at [${k}], which is none of the box's ${n} places`);
  return out;
}

/** The corners a place is made from: itself for a corner, an edge's two ends, a face's four. */
const cornersOf = (place: Place): Place[] =>
  place.reduce<number[][]>((all, s) => all.flatMap((c) => (s === 0 ? [[...c, -1], [...c, 1]] : [[...c, s]])), [[]]) as Place[];

/**
 * The box whose `n` places `points` stand at, each once, or null with the reasons added to `out`. The slab box
 * (`slab@1 {size: [1, 1, 1]}`) has its points at x and z = ±0.5 m, as the issue says; `slab` holds it to that.
 */
function boxOf(what: string, points: V3[], n: 8 | 26, slab: boolean, out: string[]): Lattice | null {
  const before = out.length;
  const box = latticeOf(`${what}: its points`, points, out);
  if (!box) return null;
  out.push(...wholeProblems(`${what}: its points`, box.places, n));
  if (slab && (!near(box.lo[0], -0.5) || !near(box.lo[2], -0.5))) out.push(`${what}: its points lie from x = ${fmt(box.lo[0])} and z = ${fmt(box.lo[2])}, not at x and z = ±0.5 m`);
  return out.length === before ? box : null;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the corner field `normal.x + 2 * normal.y + 4 * normal.z` on the flat slab box. A corner of the face
// whose outward normal is ±x holds ±1, ±y ±2, ±z ±4, so the corners standing at one place hold one code for each face
// through it: 3 different codes at a source point; after the subdivide 4 corners at an edge point, 2 of each of
// its 2 faces, and 4 at a face point, all of its 1 face. Each code is held 4 times before, 4 + 4 × 2 + 4 = 16 after.

/** The codes of the faces through `place`: one for each axis the place is on a side of. */
const faceCodes = (place: Place): number[] => place.flatMap((s, a) => (s === 0 ? [] : [s * [1, 2, 4][a]!]));
const CODES = [-4, -2, -1, 1, 2, 4];

/** Why the corners standing at each labelled place don't hold one code per corner of each face through it. */
function heldProblems(labels: { label: string; place: Place }[], corners: Place[], values: number[]): string[] {
  const out: string[] = [];
  for (const { label, place } of labels) {
    const held = corners.flatMap((c, k) => (keyOf(c) === keyOf(place) ? [values[k]!] : [])).sort((a, b) => a - b);
    // A face through a source point has 1 corner there; through an edge point 2; a face point's own face 4.
    const each = [1, 2, 4][zerosOf(place)] ?? 0;
    const want = faceCodes(place).flatMap((code) => Array.from({ length: each }, () => code)).sort((a, b) => a - b);
    if (held.length !== want.length || held.some((v, k) => !near(v, want[k]!))) {
      out.push(`${label}: its corners hold [${held.map(fmt).join(', ')}], not [${want.join(', ')}], one for each corner of each face through it`);
    }
  }
  return out;
}
/** Why each of the six codes isn't held `each` times. */
const tallyProblems = (what: string, values: number[], each: number): string[] => CODES.flatMap((code) => {
  const n = values.filter((v) => near(v, code)).length;
  return n === each ? [] : [`${what}: ${n} corners hold ${code}, not ${each}`];
});

/** Before the subdivide: `n` at the 24 corners, each standing at `corners[k]`. What is wrong, or nothing. */
export function cornersBefore(n: number[], corners: V3[]): string[] {
  const out: string[] = [];
  const c = latticeOf('before the subdivide: the corners', corners, out);
  if (!c) return out;
  const stood = [...new Map(c.places.map((p) => [keyOf(p), p])).values()];
  return [
    ...wholeProblems('before the subdivide: the places its corners stand at', stood, 8),
    ...heldProblems(stood.map((place) => ({ label: `before the subdivide: the point at ${at(positionOf(c.lo, place))}`, place })), c.places, n),
    ...tallyProblems('before the subdivide', n, 4),
  ];
}

/**
 * After the subdivide: `n` at the 96 corners, each standing at `corners[k]`, and the 26 points at `points[i]`.
 * `shape` says why the points and corners aren't the subdivided box's; `points` holds one problem for each point
 * whose corners hold other values than its faces give, in point index order, each starting `point <i> at`;
 * `counts` says which code isn't held 16 times; `first` is the first point on more than one face.
 */
export function cornersAfter(n: number[], corners: V3[], points: V3[]): { shape: string[]; points: string[]; counts: string[]; first: number } {
  const shape: string[] = [];
  const box = boxOf('after the subdivide', points, 26, true, shape);
  const stood = latticeOf('after the subdivide: the corners', corners, shape);
  if (!box || !stood) return { shape, points: [], counts: [], first: -1 };
  return {
    shape,
    points: heldProblems(box.places.map((place, i) => ({ label: `point ${i} at ${at(positionOf(box.lo, place))}`, place })), stood.places, n),
    counts: tallyProblems('after the subdivide', n, 16),
    first: box.places.findIndex((p) => zerosOf(p) < 2),
  };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the point field `2 * position.x + 2 * position.z + 2` on the slab box, then a simple subdivide. The
// field is 0, 2, 2 and 4 at the corners (x, z) = (−0.5, −0.5), (0.5, −0.5), (−0.5, 0.5) and (0.5, 0.5), at both
// heights, so the 8 source points sum to 16. A ring edge (an edge of the top or the bottom outline) joins two
// corners whose values differ by 2, so its point holds 1 or 3; an upright edge joins two of one value. The 12 edge
// points sum to 2 × (1 + 3 + 3 + 1) + (0 + 2 + 2 + 4) = 24, the 6 face points to 2 + 2 + 1 + 3 + 1 + 3 = 12, and
// 16 + 24 + 12 = 52.

const ramp = (p: V3): number => 2 * p[0] + 2 * p[2] + 2;

/**
 * `f` at the 26 points standing at `points[i]`: the problems; the points that hold another value than the mean
 * of the field at the corners they were made from (which is the field at their own position), in index order,
 * each named `point <i> at`; the ring edges' points; and the points whose value no end copied could change (the
 * source points, and the upright edges' points, whose two ends hold one value).
 */
export function rampJudged(what: string, f: number[], points: V3[]): { problems: string[]; wrong: number[]; ring: number[]; kept: number[] } {
  const out = { problems: [] as string[], wrong: [] as number[], ring: [] as number[], kept: [] as number[] };
  const box = boxOf(what, points, 26, true, out.problems);
  if (!box) return out;
  box.places.forEach((place, i) => {
    const sources = cornersOf(place).map((c) => ramp(positionOf(box.lo, c)));
    const want = sources.reduce((s, v) => s + v, 0) / sources.length;
    // A ring edge runs along x or z, so its point is half way on one of them and on a side along y.
    if (zerosOf(place) === 1 && place[1] !== 0) out.ring.push(i);
    if (zerosOf(place) === 0 || (zerosOf(place) === 1 && place[1] === 0)) out.kept.push(i);
    if (!near(f[i]!, want) || !near(f[i]!, ramp(points[i]!))) {
      out.wrong.push(i);
      out.problems.push(`point ${i} at ${at(points[i]!)}, a ${KINDS[zerosOf(place)]}: holds ${fmt(f[i]!)}, not ${fmt(want)}, the mean of the field at the ${sources.length} it was made from`);
    }
  });
  const sum = f.reduce((s, v) => s + v, 0);
  if (Math.abs(sum - 52) > 26 * TOL) out.problems.push(`${what}: the 26 values sum to ${fmt(sum)}, not 52`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: a u32 point attribute holding 2, 4, 8, 16, 32, 64, 128 and 256 through a simple subdivide. Point i of
// the builder's box holds 2^(i + 1), so of any source points the lowest-indexed is the one whose value is least,
// wherever the builder stands its points. The mean of two different powers of two is a whole number and no power
// of two, so an edge point's average is never among the eight.

export const TAGS = [2, 4, 8, 16, 32, 64, 128, 256];

/**
 * `tag` at the 26 points standing at `points[i]`: the problems, each point's starting `point <i> at`, and the
 * points holding a value outside the eight, in index order. The 8 points at the box's corners must hold the eight
 * values, each once, and every other point the least of the values at the corners it was made from.
 */
export function tagsJudged(what: string, tag: number[], points: V3[]): { problems: string[]; outside: number[] } {
  const problems: string[] = [];
  const outside: number[] = [];
  const box = boxOf(what, points, 26, false, problems);
  if (!box) return { problems, outside };
  // The value each corner of the box holds, by its place.
  const atCorner = new Map(box.places.flatMap((place, i) => (zerosOf(place) === 0 ? [[keyOf(place), tag[i]!] as const] : [])));
  const corners = [...atCorner.values()].sort((a, b) => a - b);
  if (corners.join() !== TAGS.join()) problems.push(`${what}: its 8 source points hold [${corners.map(fmt).join(', ')}], not the eight values once each`);
  box.places.forEach((place, i) => {
    const label = `point ${i} at ${at(points[i]!)}, a ${KINDS[zerosOf(place)]}`;
    if (!TAGS.includes(tag[i]!)) {
      outside.push(i);
      problems.push(`${label}: holds ${fmt(tag[i]!)}, outside the eight values`);
      return;
    }
    const sources = cornersOf(place).map((c) => atCorner.get(keyOf(c)) ?? Number.NaN);
    const want = Math.min(...sources);
    if (tag[i] !== want) problems.push(`${label}: holds ${tag[i]}, not ${fmt(want)}, the value of the lowest-indexed source point it was made from (they hold ${sources.map(fmt).join(', ')})`);
  });
  return { problems, outside };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 7: on the slab box, `w` stored as −99, then as `10 * position.x + 20 * position.z` on part `top`. At
// (x, z) = (−0.5, −0.5), (0.5, −0.5), (−0.5, 0.5) and (0.5, 0.5) that field is −15, −5, 5 and 15. The 4 points of
// `top`, the slab's upper face, are the box's upper corners; the 4 others, its lower corners, keep −99.

const tilt = (p: V3): number => 10 * p[0] + 20 * p[2];

/**
 * `w` at the 8 points standing at `points[i]`: the problems, each point's starting `point <i> at`; the points
 * that hold another value than theirs, in index order; and the 4 points outside part `top`, in index order.
 */
export function partJudged(what: string, w: number[], points: V3[]): { problems: string[]; wrong: number[]; others: number[] } {
  const out = { problems: [] as string[], wrong: [] as number[], others: [] as number[] };
  const box = boxOf(what, points, 8, true, out.problems);
  if (!box) return out;
  box.places.forEach((place, i) => {
    const top = place[1] === 1;
    if (!top) out.others.push(i);
    const want = top ? tilt(points[i]!) : -99;
    if (!near(w[i]!, want)) {
      out.wrong.push(i);
      out.problems.push(`point ${i} at ${at(points[i]!)}, ${top ? 'of part top' : 'outside part top'}: holds ${fmt(w[i]!)}, not ${fmt(want)}`);
    }
  });
  const tops = box.places.flatMap((place, i) => (place[1] === 1 ? [w[i]!] : [])).sort((a, b) => a - b);
  if ([-15, -5, 5, 15].some((v, k) => !near(tops[k] ?? Number.NaN, v))) out.problems.push(`${what}: the 4 points of part top hold [${tops.map(fmt).join(', ')}], not −15, −5, 5 and 15`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 8: on the slab box, `sqrt(position.x)` with `fallback: 7`. The square root of −0.5 is not finite, so the
// 4 points with x = −0.5 m take the fallback; the other 4 hold the root of 0.5, which the issue gives as 0.7071068.

const ROOT_HALF = 0.7071068;

/**
 * `r` at the 8 points standing at `points[i]`: the problems, each point's starting `point <i> at`; the points
 * that hold another value than theirs, in index order; and the 4 points with x = −0.5 m, in index order.
 */
export function rootJudged(what: string, r: number[], points: V3[]): { problems: string[]; wrong: number[]; negative: number[] } {
  const out = { problems: [] as string[], wrong: [] as number[], negative: [] as number[] };
  const box = boxOf(what, points, 8, true, out.problems);
  if (!box) return out;
  box.places.forEach((place, i) => {
    const low = place[0] === -1;
    if (low) out.negative.push(i);
    if (!near(r[i]!, low ? 7 : ROOT_HALF)) {
      out.wrong.push(i);
      out.problems.push(`point ${i} at ${at(points[i]!)}: holds ${fmt(r[i]!)}, not ${low ? 'the fallback 7, its result not being finite' : `${ROOT_HALF}, the root of 0.5`}`);
    }
  });
  return out;
}
