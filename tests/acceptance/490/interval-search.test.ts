// Criterion 3: "A seeded search for counterexamples finds none: each function's interval form holds every value its
// point form gives at 1,000 seeded points inside each of 10,000 seeded ranges, ranges across a jump, a pole or an
// extremum included, and a planted sin form that bounds a range by its ends alone fails on [0, 3], where it misses
// the peak of 1 at π/2"
//
// Through `deep-show run`'s `fn` call in the `core` build (README: `fn`). For each function of the closed list that
// reads a number (each written as an expression over x, vector and complex ones through a swizzle), 10,000 seeded
// ranges inside its domain, its named ranges across a jump, a pole or an extremum first; the binary evaluates the
// interval form on each and the point form at 1,000 points per range drawn from mulberry32(seed + range index), and
// answers each range's bound with its least and greatest point values. The tests recompute every point of five
// seeded ranges per function and read them through the point form (`at`), so the reported extremes are the point
// form's at the seeded points, and check those values against an f64 reference where JavaScript has one. A bound may
// be unbounded or an estimate only on a range that holds a pole. Also the outward-rounding fixtures (Proof line):
// a degenerate range's bound holds the real value, not only its rounded f64. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  EASES, TIMEOUT, boundsOf, failsNaming, fnReplies, holdsAny, nextDown, none, rangesFor, scalars, searchFailures, searchOf, searchPoints,
  useEvidence, useShow, type Fn, type SearchRow,
} from './helpers.ts';

const CORE = 'core';
const shows = useShow([CORE]);
const evidence = useEvidence();
const POINTS = 1000;
const RANGES = 10_000;

const PI = Math.PI;
const tanPoles = Array.from({ length: 7 }, (_, k) => PI / 2 + (k - 3) * PI);
const gammaPoles = [0, -1, -2, -3, -4, -5];
const fact = (n: number): number => { let p = 1; for (let k = 2; k <= n; k++) p *= k; return p; };
const binom = (n: number, k: number): number => { let p = 1; for (let i = 1; i <= k; i++) p = (p * (n - k + i)) / i; return p; };
const roundAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
const csqrtRe = (a: number, b: number): number => Math.sqrt((Math.hypot(a, b) + a) / 2);
const cpowRe = (a: number, b: number, p: number): number => Math.hypot(a, b) ** p * Math.cos(p * Math.atan2(b, a));

/** The closed function list's number-valued functions, grouped as the design's table groups them. */
const GROUPS: Record<string, Fn[]> = {
  'arithmetic and logic': [
    { expr: 'x * x - 3 * x', domain: [-10, 10], special: [[1, 2]], ref: (x) => x * x - 3 * x },
    { expr: '1 / x', domain: [-10, 10], poles: holdsAny([0]), special: [[-0.1, 0.1], [0.5, 2]], ref: (x) => 1 / x },
    { expr: 'x % 1.5', domain: [-10, 10], special: [[1.4, 1.6]], ref: (x) => x % 1.5 },
    { expr: 'x ^ 3', domain: [-10, 10], special: [[-1, 1]], ref: (x) => x ** 3 },
    { expr: 'x < 1 ? x * x : 3 - x', domain: [-5, 5], special: [[0.9, 1.1]], ref: (x) => (x < 1 ? x * x : 3 - x) },
    { expr: '(x >= 0.5) && (x <= 2)', domain: [-5, 5], special: [[0.4, 0.6]], ref: (x) => (x >= 0.5 && x <= 2 ? 1 : 0) },
    { expr: '(x < -1) || !(x < 1)', domain: [-5, 5], special: [[-1.1, -0.9]], ref: (x) => (x < -1 || !(x < 1) ? 1 : 0) },
    { expr: 'x == 0.5', domain: [-5, 5], special: [[0, 1]], ref: (x) => (x === 0.5 ? 1 : 0) },
    { expr: 'x != 0.5', domain: [-5, 5], special: [[0, 1]], ref: (x) => (x !== 0.5 ? 1 : 0) },
    { expr: 'x > 2', domain: [-5, 5], special: [[1.9, 2.1]], ref: (x) => (x > 2 ? 1 : 0) },
    { expr: 'min(x, 1)', domain: [-10, 10], special: [[0, 2]], ref: (x) => Math.min(x, 1) },
    { expr: 'max(x * x, 2)', domain: [-10, 10], special: [[-2, 2]], ref: (x) => Math.max(x * x, 2) },
    { expr: 'clamp(x, -1, 2)', domain: [-10, 10], special: [[-2, 3]], ref: (x) => Math.min(Math.max(x, -1), 2) },
    { expr: 'abs(x - 1)', domain: [-10, 10], special: [[0, 2]], ref: (x) => Math.abs(x - 1) },
    { expr: 'sign(x - 0.5)', domain: [-10, 10], special: [[0, 1]], ref: (x) => Math.sign(x - 0.5) },
    { expr: 'floor(x)', domain: [-10, 10], special: [[0.9, 1.1]], ref: Math.floor },
    { expr: 'ceil(x)', domain: [-10, 10], special: [[0.9, 1.1]], ref: Math.ceil },
    { expr: 'fract(x)', domain: [-10, 10], special: [[0.9, 1.1], [-0.1, 0.1]], ref: (x) => x - Math.floor(x) },
    { expr: 'round(x)', domain: [-10, 10], special: [[0.4, 0.6], [-2.6, -2.4]], ref: roundAway },
    { expr: 'mod(x, 2.5)', domain: [-10, 10], special: [[2.4, 2.6], [-0.1, 0.1]] },
  ],
  'powers and angles': [
    { expr: 'sqrt(x)', domain: [0, 100], special: [[0, 1]], ref: Math.sqrt },
    { expr: 'pow(x, 1.7)', domain: [0, 10], special: [[0, 1]], ref: (x) => x ** 1.7 },
    { expr: 'pow(2, x)', domain: [-20, 20], special: [[-1, 1]], ref: (x) => 2 ** x },
    { expr: 'exp(x)', domain: [-20, 20], special: [[-1, 1]], ref: Math.exp },
    { expr: 'log(x)', domain: [0.001, 100], special: [[0.5, 2]], ref: Math.log },
    { expr: 'sin(x)', domain: [-20, 20], special: [[0, 3], [1, 2], [4, 5], [-2, -1]], ref: Math.sin },
    { expr: 'cos(x)', domain: [-20, 20], special: [[-1, 1], [3, 3.3]], ref: Math.cos },
    { expr: 'tan(x)', domain: [-10, 10], poles: holdsAny(tanPoles), special: [[1.5, 1.7], [-0.5, 0.5]], ref: Math.tan },
    { expr: 'asin(x)', domain: [-1, 1], special: [[-1, -0.9]], ref: Math.asin },
    { expr: 'acos(x)', domain: [-1, 1], special: [[0.9, 1]], ref: Math.acos },
    { expr: 'atan(x)', domain: [-100, 100], special: [[-1, 1]], ref: Math.atan },
    { expr: 'atan2(x, 1.5)', domain: [-10, 10], special: [[-1, 1]], ref: (x) => Math.atan2(x, 1.5) },
    { expr: 'atan2(1, x)', domain: [-10, 10], special: [[-1, 1]], ref: (x) => Math.atan2(1, x) },
    { expr: 'deg(x)', domain: [-10, 10], ref: (x) => (x * 180) / PI },
    { expr: 'rad(x)', domain: [-1000, 1000], ref: (x) => (x * PI) / 180 },
    { expr: 'pi * x + tau', domain: [-10, 10], ref: (x) => PI * x + 2 * PI },
  ],
  'hyperbolic and special': [
    { expr: 'sinh(x)', domain: [-10, 10], ref: Math.sinh },
    { expr: 'cosh(x)', domain: [-10, 10], special: [[-1, 1]], ref: Math.cosh },
    { expr: 'tanh(x)', domain: [-10, 10], ref: Math.tanh },
    { expr: 'asinh(x)', domain: [-100, 100], ref: Math.asinh },
    { expr: 'acosh(x)', domain: [1, 100], special: [[1, 1.1]], ref: Math.acosh },
    { expr: 'atanh(x)', domain: [-0.999, 0.999], ref: Math.atanh },
    { expr: 'log2(x)', domain: [0.001, 100], ref: Math.log2 },
    { expr: 'log10(x)', domain: [0.001, 100], ref: Math.log10 },
    { expr: 'log1p(x)', domain: [-0.999, 100], special: [[-1e-9, 1e-9]], ref: Math.log1p },
    { expr: 'expm1(x)', domain: [-20, 20], special: [[-1e-9, 1e-9]], ref: Math.expm1 },
    { expr: 'hypot(x, 2)', domain: [-10, 10], special: [[-1, 1]], ref: (x) => Math.hypot(x, 2) },
    { expr: 'cbrt(x)', domain: [-100, 100], special: [[-1, 1]], ref: Math.cbrt },
    { expr: 'sinc(x)', domain: [-20, 20], special: [[-1e-9, 1e-9], [-1, 1], [4, 5]], ref: (x) => (x === 0 ? 1 : Math.sin(x) / x) },
    { expr: 'erf(x)', domain: [-6, 6], special: [[-0.5, 0.5]] },
    { expr: 'erfc(x)', domain: [-6, 6], special: [[-0.5, 0.5]] },
    { expr: 'gamma(x)', domain: [-5.5, 10], poles: holdsAny(gammaPoles), special: [[1, 2], [-0.5, 0.5], [-2.9, -2.1]] },
    { expr: 'lgamma(x)', domain: [0.001, 50], special: [[1, 3]] },
    { expr: 'factorial(floor(x))', domain: [0, 170.5], special: [[2.5, 3.5]], ref: (x) => fact(Math.floor(x)) },
    { expr: 'binom(30, floor(x))', domain: [0, 30.5], special: [[14.5, 15.5]], ref: (x) => binom(30, Math.floor(x)) },
  ],
  'interpolation, vectors and sums': [
    { expr: 'mix(1, 5, x)', domain: [-2, 3], ref: (x) => 1 + (5 - 1) * x },
    { expr: 'smoothstep(0, 1, x)', domain: [-1, 2], special: [[-0.1, 0.1], [0.9, 1.1]], ref: (x) => { const t = Math.min(Math.max(x, 0), 1); return t * t * (3 - 2 * t); } },
    { expr: 'remap(x, 0, 1, 10, 20)', domain: [-5, 5], ref: (x) => 10 + x * 10 },
    { expr: 'length(vec2(x, 2))', domain: [-10, 10], special: [[-1, 1]], ref: (x) => Math.hypot(x, 2) },
    { expr: 'distance(vec2(x, 1), vec2(0, 0))', domain: [-10, 10], special: [[-1, 1]], ref: (x) => Math.hypot(x, 1) },
    { expr: 'dot(vec2(x, 1), vec2(2, 3))', domain: [-10, 10], ref: (x) => 2 * x + 3 },
    { expr: 'cross(vec3(x, 1, 2), vec3(3, x, 1)).y', domain: [-10, 10], ref: (x) => 6 - x },
    { expr: 'normalize(vec2(x, 1)).x', domain: [-10, 10], ref: (x) => x / Math.hypot(x, 1) },
    { expr: 'angle(vec2(1, 0), vec2(x, 1))', domain: [-10, 10], ref: (x) => Math.atan2(1, x) },
    { expr: 'vec3(x, 2 * x, 3).y', domain: [-10, 10], ref: (x) => 2 * x },
    { expr: 'sum(k, 0, 10, x ^ k / factorial(k))', domain: [-3, 3], ref: (x) => { let s = 0; for (let k = 0; k <= 10; k++) s += x ** k / fact(k); return s; } },
    { expr: 'prod(k, 1, 5, x - k)', domain: [0, 6], special: [[1.2, 1.8]], ref: (x) => (x - 1) * (x - 2) * (x - 3) * (x - 4) * (x - 5) },
    { expr: 'hash(x)', domain: [-100, 100] },
    ...EASES.map((name): Fn => ({ expr: `ease(${name}, x)`, domain: [0, 1], special: [[0, 1]] })),
  ],
  'complex, as vec2': [
    { expr: 'cmul(vec2(x, 1), vec2(2, x)).x', domain: [-10, 10], ref: (x) => 2 * x - x },
    { expr: 'cmul(vec2(x, 1), vec2(2, x)).y', domain: [-10, 10], special: [[-1, 1]], ref: (x) => x * x + 2 },
    { expr: 'cdiv(vec2(1, x), vec2(x, 2)).x', domain: [-10, 10], special: [[1, 3]], ref: (x) => (3 * x) / (x * x + 4) },
    { expr: 'cexp(vec2(x, 0.7)).y', domain: [-5, 5], ref: (x) => Math.exp(x) * Math.sin(0.7) },
    { expr: 'clog(vec2(x, 1)).x', domain: [-10, 10], special: [[-1, 1]], ref: (x) => Math.log(Math.hypot(x, 1)) },
    { expr: 'clog(vec2(x, 1)).y', domain: [-10, 10], ref: (x) => Math.atan2(1, x) },
    { expr: 'cpow(vec2(x, 1), 2.5).x', domain: [-10, 10], special: [[-1, 1]], ref: (x) => cpowRe(x, 1, 2.5) },
    { expr: 'csqrt(vec2(x, 0.5)).x', domain: [-10, 10], ref: (x) => csqrtRe(x, 0.5) },
    { expr: 'csin(vec2(x, 0.3)).x', domain: [-10, 10], special: [[1, 2]], ref: (x) => Math.sin(x) * Math.cosh(0.3) },
    { expr: 'ccos(vec2(0.3, x)).y', domain: [-5, 5], ref: (x) => -Math.sin(0.3) * Math.sinh(x) },
    { expr: 'conj(vec2(2, x)).y', domain: [-10, 10], ref: (x) => -x },
    { expr: 'cabs(vec2(x, 3))', domain: [-10, 10], special: [[-1, 1]], ref: (x) => Math.hypot(x, 3) },
    { expr: 'carg(vec2(x, 1))', domain: [-10, 10], ref: (x) => Math.atan2(1, x) },
  ],
};

/** The search on every function of a group, in one scenario; and the five recomputed ranges of each, through `at`. */
function groupFailures(bin: string, fns: Fn[], seed: number): string[] {
  const ranges = fns.map((f, n) => rangesFor(f, seed + 1000 * n, RANGES));
  const replies = fnReplies(bin, evidence(), fns.map((f, n) => ({ expr: f.expr, search: { ranges: ranges[n]!, points: POINTS, seed: seed + n } })));
  const failures: string[] = [];
  fns.forEach((f, n) => {
    const rows = searchOf(replies[n]!, ranges[n]!, f.expr);
    failures.push(...searchFailures(f, rows));
    failures.push(...recomputed(bin, f, rows, seed + n));
  });
  return failures;
}
/** Five seeded ranges' 1,000 points, read through the point form: the search's extremes are theirs, and they match the reference. */
function recomputed(bin: string, f: Fn, rows: readonly SearchRow[], seed: number): string[] {
  const picks = [0, 1, 2, 3, 4].map((k) => Math.floor(((k + 0.5) / 5) * rows.length));
  const pts = picks.map((i) => searchPoints(rows[i]!.range[0], rows[i]!.range[1], i, seed, POINTS));
  const replies = fnReplies(bin, evidence(), pts.map((xs) => ({ expr: f.expr, at: xs })));
  const failures: string[] = [];
  picks.forEach((i, k) => {
    const xs = pts[k]!;
    const ys = scalars(replies[k]!, xs.length, `${f.expr} at range ${i}'s points`);
    let min: { x: number; y: number } | null = null; let max: { x: number; y: number } | null = null;
    xs.forEach((x, j) => {
      const y = ys[j];
      if (y === null || y === undefined) return;
      if (!min || y < min.y) min = { x, y };
      if (!max || y > max.y) max = { x, y };
      if (f.ref) {
        const want = f.ref(x);
        if (Number.isFinite(want) && !(Math.abs(y - want) <= 1e-9 * Math.max(1, Math.abs(want)))) failures.push(`${f.expr}: the point form reads ${y} at x = ${x}, the reference ${want}`);
      }
    });
    const row = rows[i]!;
    const same = (a: { x: number; y: number } | null, b: { x: number; y: number } | null): boolean => (a === null ? b === null : b !== null && a.x === b.x && a.y === b.y);
    if (!same(min, row.min) || !same(max, row.max)) failures.push(`${f.expr}: range ${i} [${row.range[0]}, ${row.range[1]}]: the search reports min ${JSON.stringify(row.min)} and max ${JSON.stringify(row.max)}, its seeded points read min ${JSON.stringify(min)} and max ${JSON.stringify(max)}`);
  });
  return failures;
}

describe('criterion 3: a seeded search for counterexamples to the interval forms finds none', () => {
  Object.entries(GROUPS).forEach(([group, fns], g) => {
    it(`criterion 3: ${group}: every interval form holds every point value at 1,000 seeded points in each of 10,000 seeded ranges, across jumps, poles and extrema`, () => {
      none(groupFailures(shows.bin(CORE), fns, 490_300 + 100_000 * g), `the counterexample search over ${group}`);
    }, TIMEOUT);
  });

  it('criterion 3: a planted sin form that bounds a range by its ends alone fails on [0, 3], missing the peak of 1 at π/2', () => {
    const bin = shows.bin(CORE);
    const sin: Fn = { expr: 'sin(x)', domain: [0, 3] };
    const ranges: [number, number][] = [[0, 3]];
    const [planted, real] = fnReplies(bin, evidence(), [
      { expr: 'sin(x)', search: { ranges, points: POINTS, seed: 490_399 }, planted: 'sin_bounds_by_ends' },
      { expr: 'sin(x)', search: { ranges, points: POINTS, seed: 490_399 } },
    ]);
    const rows = searchOf(planted!, ranges, 'the planted sin form');
    expect(rows[0]!.max?.y ?? 0, 'the seeded points reach the peak near 1').toBeGreaterThan(0.9999);
    expect(Math.abs((rows[0]!.max?.x ?? 0) - Math.PI / 2), 'the greatest point lies near π/2').toBeLessThan(0.02);
    expect(rows[0]!.hi ?? 2, 'the planted form bounds [0, 3] by its ends, sin 0 and sin 3').toBeLessThan(0.15);
    failsNaming(searchFailures(sin, rows), ['range [0, 3]'], 'the search on the planted sin form');
    none(searchFailures(sin, searchOf(real!, ranges, 'sin')), 'the real sin form on [0, 3]');
  }, TIMEOUT);

  it('criterion 3: the forms round outward: a degenerate range\'s bound holds the real value, not only its rounded f64, and stays within 1e-12', () => {
    const bin = shows.bin(CORE);
    const one: [number, number][] = [[0.1, 0.1]];
    const [sum, product, sin, sinAt] = fnReplies(bin, evidence(), [
      { expr: 'x + 0.2', over: one },
      { expr: 'x * 3', over: one },
      { expr: 'sin(x)', over: [[1, 1]] },
      { expr: 'sin(x)', at: [1] },
    ]);
    const sin1 = scalars(sinAt!, 1, 'sin(1)')[0] ?? NaN;
    const failures: string[] = [];
    // 0.1 + 0.2 and 0.1 × 3 are 0.3000000000000000166… in the reals; both round to 0.30000000000000004, above it.
    for (const [name, r] of [['0.1 + 0.2', sum!], ['0.1 × 3', product!]] as const) {
      const [b] = boundsOf(r, 1, name);
      if (b!.lo === null || b!.hi === null) { failures.push(`${name}: unbounded`); continue; }
      if (!(b!.lo <= nextDown(0.30000000000000004))) failures.push(`${name}: the bound's lower end ${b!.lo} lies above the real value 0.30000000000000001665…`);
      if (!(b!.hi >= 0.30000000000000004)) failures.push(`${name}: the bound's upper end ${b!.hi} lies below the rounded value`);
      if (!(b!.hi - b!.lo <= 1e-12)) failures.push(`${name}: the bound [${b!.lo}, ${b!.hi}] is wider than 1e-12`);
    }
    const [s] = boundsOf(sin!, 1, 'sin(1)');
    if (s!.lo === null || s!.hi === null || !(s!.lo < sin1 && sin1 < s!.hi)) failures.push(`sin over [1, 1]: the bound [${s!.lo}, ${s!.hi}] isn't widened past the point form's sin(1) = ${sin1} by the error bound on both sides`);
    else if (!(s!.hi - s!.lo <= 1e-12)) failures.push(`sin over [1, 1]: the bound [${s!.lo}, ${s!.hi}] is wider than 1e-12`);
    none(failures, 'the outward-rounding fixtures');
  }, TIMEOUT);
});
