// Criterion 4 (Oracle lane, port): "A linear table with x 0, 1, 2, 4 and y 0, 1, 1.5, 1.75 reads 1.625 at 3, 0 at
// −1 and 1.75 at 5 … and in monotone mode, 1,000 samples between each pair of knots stay between those knots'
// values". The Oracle page links NumPy a3d0ef1df0's numpy/lib/tests/test_function_base.py, TestInterp ("np.interp,
// piecewise-linear interpolation that holds the end values below the first x and past the last
// (test_right_left_behavior), the rule of a linear function table"), and SciPy e4e854eaa8's
// scipy/interpolate/tests/test_polyint.py, TestPCHIP test_overshoot and test_monotone ("the bound our monotone mode
// states. SciPy takes Fritsch and Butland's slopes, so only the bound applies, not the values").
//
// Each ported case names its upstream test. Tables reach `table(<pack>.<name>, x)` through a pack given on the
// `fn` call (`packs: [{name, tables}]`), in the driver context. NumPy and SciPy are BSD-3-Clause; the values below
// are copied from (or, for SciPy's random data, regenerated exactly as) those tests.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, linspace, none, randomState, refused, runFns, show, useShowCore, valuesOf, type FnReply, type JsonValue, type Table } from './helpers.ts';

const show_ = useShowCore();
const PACK = 'oracle';

/** `table(oracle.t, x)` at `xs` over the one table `t`. */
function tableAt(t: Table, xs: number[]): FnReply {
  return runFns(show_.bin(), [{ expr: `table(${PACK}.t, x)`, context: 'driver', packs: [{ name: PACK, tables: { t } }], at: xs }])[0]!;
}
function readTable(t: Table, xs: number[], what: string): number[] {
  const v = valuesOf(tableAt(t, xs), xs.length);
  expect(typeof v, `${what}: ${String(v)}`).not.toBe('string');
  return v as number[];
}
/** NumPy's assert_almost_equal at its default decimal=7: |actual − desired| < 1.5 × 10⁻⁷. */
const almost = (actual: number, desired: number): boolean => Math.abs(desired - actual) < 1.5e-7;
/** np.interp's rule (numpy/_core/src/multiarray/compiled_base.c): hold fp[0] below xp[0] and fp[-1] past xp[-1], else the line through the bracketing knots. */
function npInterp(x: number, xp: number[], fp: number[]): number {
  const n = xp.length;
  if (x < xp[0]!) return fp[0]!;
  if (x > xp[n - 1]!) return fp[n - 1]!;
  if (x === xp[n - 1]) return fp[n - 1]!;
  let j = 0; while (j + 1 < n && xp[j + 1]! <= x) j++;
  const slope = (fp[j + 1]! - fp[j]!) / (xp[j + 1]! - xp[j]!);
  return slope * (x - xp[j]!) + fp[j]!;
}

describe('criterion 4 (port): numpy a3d0ef1df0 TestInterp against our linear function tables', () => {
  it('criterion 4: TestInterp.test_basic: x and y linspace(0, 1, 5) read x0 = linspace(0, 1, 50) almost equal', () => {
    const x = linspace(0, 1, 5); const x0 = linspace(0, 1, 50);
    const got = readTable({ x, y: x }, x0, 'test_basic');
    none(x0.flatMap((v, i) => (almost(got[i]!, v) ? [] : [`at ${v} the table reads ${got[i]}`])), 'test_basic');
  }, TIMEOUT);

  it('criterion 4: TestInterp.test_right_left_behavior: sizes 2 to 9 of x = arange(size), y = ones hold 1 at −1, 0, size − 1 and size, in either order', () => {
    const failures: string[] = [];
    for (let size = 2; size < 10; size++) {
      const xp = Array.from({ length: size }, (_, i) => i); const yp = xp.map(() => 1);
      const inc = [-1, 0, size - 1, size]; const dec = [...inc].reverse();
      const got = readTable({ x: xp, y: yp }, [...inc, ...dec], `size ${size}`);
      got.forEach((v, i) => { if (v !== 1) failures.push(`size ${size}: at ${[...inc, ...dec][i]} the table reads ${v}, not 1`); });
    }
    none(failures, 'test_right_left_behavior');
  }, TIMEOUT);

  it('criterion 4: TestInterp.test_scalar_interpolation_point and test_zero_dimensional_interpolation_point: 0, 0.3 and float32(0.3) on linspace read themselves; xp 0, 2, 4 with fp 1, −1, 1 read exactly 0 at 1', () => {
    const x = linspace(0, 1, 5);
    const pts = [0, 0.3, Math.fround(0.3)];
    const got = readTable({ x, y: x }, pts, 'test_scalar_interpolation_point');
    const failures = pts.flatMap((p, i) => (almost(got[i]!, p) ? [] : [`at ${p} the table reads ${got[i]}`]));
    const [one] = readTable({ x: [0, 2, 4], y: [1, -1, 1] }, [1], 'test_zero_dimensional_interpolation_point');
    if (one !== 0) failures.push(`xp [0, 2, 4], fp [1, −1, 1] reads ${one} at 1, not 0`);
    none(failures, 'the scalar points');
  }, TIMEOUT);

  it('criterion 4: TestInterp.test_empty_x: no points read no values', () => {
    expect(readTable({ x: [1, 2], y: [3, 4] }, [], 'test_empty_x')).toEqual([]);
  }, TIMEOUT);

  it('criterion 4: TestInterp.test_exceptions: a table of no points and one whose x and y differ in length are refused, as is a one-point table (np.interp special-cases size 1; ours holds 2 to 4,096 points)', () => {
    const failures: string[] = [];
    const bad: [string, Table][] = [['interp(0, [], [])', { x: [], y: [] }], ['interp(0, [0], [1, 2])', { x: [0], y: [1, 2] }], ['size 1', { x: [0], y: [1] }]];
    for (const [what, t] of bad) {
      const r = tableAt(t, [0]);
      if (!refused(r)) failures.push(`${what}: the table is not refused: ${show(r as unknown as JsonValue)}`);
    }
    none(failures, 'test_exceptions');
  }, TIMEOUT);

  it('criterion 4: the criterion\'s linear table x 0, 1, 2, 4 and y 0, 1, 1.5, 1.75 reads np.interp\'s 1.625 at 3, 0 at −1 and 1.75 at 5', () => {
    const t = { x: [0, 1, 2, 4], y: [0, 1, 1.5, 1.75], mode: 'linear' as const };
    const pts = [3, -1, 5];
    const want = pts.map((p) => npInterp(p, t.x, t.y));
    expect(want, 'np.interp\'s rule gives the criterion\'s values').toEqual([1.625, 0, 1.75]);
    const got = readTable(t, pts, 'the criterion\'s table');
    none(pts.flatMap((p, i) => (got[i] === want[i] ? [] : [`at ${p} the table reads ${got[i]}, np.interp ${want[i]}`])), 'the criterion\'s table');
  }, TIMEOUT);
});

describe('criterion 4 (port): scipy e4e854eaa8 TestPCHIP test_overshoot and test_monotone against our monotone tables', () => {
  // TestPCHIP._make_random: rng = np.random.RandomState(1234); xi = np.sort(rng.random(20)); yi = rng.random(20).
  const draw = randomState(1234);
  const xi = draw(20).sort((a, b) => a - b); const yi = draw(20);
  const random: Table = { x: xi, y: yi, mode: 'monotone' };

  it('criterion 4: the regenerated _make_random data starts as NumPy\'s RandomState(1234) does', () => {
    expect(randomState(1234)(3)).toEqual([0.1915194503788923, 0.6221087710398319, 0.4377277390071145]);
    expect(randomState(0)(3)).toEqual([0.5488135039273248, 0.7151893663724195, 0.6027633760716439]);
  });

  /** Each interval's linspace(x1, x2, n) read through the table: [i, xs, values]. */
  function between(n: number): [number, number[], number[]][] {
    const spans = xi.slice(0, -1).map((x1, i) => [i, linspace(x1, xi[i + 1]!, n)] as [number, number[]]);
    const got = readTable(random, spans.flatMap(([, xs]) => xs), `${n} samples between each pair of knots`);
    return spans.map(([i, xs], k) => [i, xs, got.slice(k * n, (k + 1) * n)]);
  }
  function overshoot(n: number): string[] {
    const failures: string[] = [];
    for (const [i, xs, yp] of between(n)) {
      const lo = Math.min(yi[i]!, yi[i + 1]!); const hi = Math.max(yi[i]!, yi[i + 1]!);
      yp.forEach((v, k) => { if (!(lo <= v + 1e-15 && v <= hi + 1e-15)) failures.push(`knots ${i} and ${i + 1} (${lo}, ${hi}): at ${xs[k]} the table reads ${v}`); });
    }
    return failures;
  }

  it('criterion 4: TestPCHIP.test_overshoot: 10 samples between every pair of knots lie between those knots\' values (within upstream\'s 1e-15)', () => {
    none(overshoot(10), 'test_overshoot');
  }, TIMEOUT);

  it('criterion 4: test_overshoot at the criterion\'s 1,000 samples between every pair of knots', () => {
    none(overshoot(1000), 'test_overshoot at 1,000 samples');
  }, TIMEOUT);

  it('criterion 4: TestPCHIP.test_monotone: each sample past a segment\'s first moves the way its knots do, (y2 − y1)·(yp[1:] − yp[:1]) > 0', () => {
    const failures: string[] = [];
    for (const [i, xs, yp] of between(10)) {
      const d = yi[i + 1]! - yi[i]!;
      yp.slice(1).forEach((v, k) => { if (!(d * (v - yp[0]!) > 0)) failures.push(`knots ${i} and ${i + 1}: at ${xs[k + 1]} the table reads ${v}, against ${yp[0]} at the segment's start`); });
    }
    none(failures, 'test_monotone');
  }, TIMEOUT);

  it('criterion 4: TestPCHIP.test_all_zeros: x arange(10), y zeros read exactly 0 at linspace(0, 9, 101)', () => {
    const x = Array.from({ length: 10 }, (_, i) => i);
    const xx = linspace(0, 9, 101);
    const got = readTable({ x, y: x.map(() => 0), mode: 'monotone' }, xx, 'test_all_zeros');
    none(got.flatMap((v, i) => (v === 0 ? [] : [`at ${xx[i]} the table reads ${v}`])), 'test_all_zeros');
  }, TIMEOUT);
});
