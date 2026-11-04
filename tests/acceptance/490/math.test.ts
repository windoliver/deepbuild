// Criterion 8: "A path fn `y = sinc(x)` over [−10, 10] draws as one sub-path with no notice, and sinc's interval form
// over [−1e-9, 1e-9] lies within [0.99999999, 1], where a planted form computing sin(x) ÷ x returns an unbounded range
// and fails; `sum(k, 0, n, (−1)^k · x^(2k+1) ÷ factorial(2k+1))` with n a var declared max 19, set by a test writer's
// entry on the core's input track, equals sin x within 1e-12 at 1,000 seeded x in [−6, 6] at n = 19; `cpow(vec2(x,
// y), 2)` equals vec2(x² − y², 2xy) within 2 ulp at 10,000 seeded points; and `factorial(171)`, `factorial(2.5)` and
// a sum of 257 terms are each refused at check, naming the call"
//
// Through `deep-show run` in the `full` build: a board holding a path@1 item whose params hold `fn: {y: "sinc(x)",
// over: [-10, 10]}` is presented (`deep show`) and read back with the `path` call; the rest through the `fn` call
// (README: `fn`). The sum runs as a path function's expression (`context: "path"`, cap 512 nodes: its 20 terms of
// 18 nodes each would pass a driver's 64), its var n bound to a slider `terms` with the declared range [0, 19] and
// set to 19 by a test writer's input-track entry. "Within 2 ulp" is against x·x − y·y and 2·x·y computed in f64, in
// units of the result's ulp. "Naming the call" is the refusal naming the function and its argument. No upstream test.
import { describe, expect, it } from 'vitest';
import {
  DOC, TIMEOUT, boundsOf, drawn, entry, failsNaming, fnRefused, fnReplies, mentions, none, numbersIn, present, runShow, scalars, scenario, seededIn,
  show, slider, ulp, useEvidence, useShow, valuesOf, type Bound, type JsonObject,
} from './helpers.ts';

const FULL = 'full';
const shows = useShow([FULL]);
const evidence = useEvidence();

const SINC_BOARD: JsonObject = {
  format: 1, profile: 'board', title: 'Sinc', description: 'The curve sin x ÷ x through 0, for the #490 suite.', size: [320, 200],
  items: { curve: { id: 'curve', kind: 'path@1', name: 'Sinc curve', order: 'a0', params: { fn: { y: 'sinc(x)', over: [-10, 10] }, paint: { stroke: { role: 'ink' } } } } },
};
/** sinc's bound over [−1e-9, 1e-9] lies within [0.99999999, 1]. */
const sincFailures = (b: Bound): string[] => (b.estimate || b.lo === null || b.hi === null || b.lo < 0.99999999 || b.hi > 1
  ? [`sinc over [-1e-9, 1e-9]: the form gives ${b.estimate ? 'an estimate ' : ''}[${b.lo}, ${b.hi}], not within [0.99999999, 1]`] : []);

describe('criterion 8: the math functions: sinc through 0, bounded sums, complex powers, and refused calls', () => {
  it('criterion 8: a path fn y = sinc(x) over [−10, 10] draws as one sub-path with no notice', () => {
    const [shown, path] = runShow(shows.bin(FULL), scenario(evidence(), [present(DOC.a, SINC_BOARD), { call: 'path', doc: DOC.a, item: 'curve' }]));
    expect(shown!['outcome'], `the board is presented: ${show(shown)}`).toBe('presented');
    const notices = Array.isArray(shown!['notices']) ? shown!['notices'] : [];
    expect(notices.filter((n) => mentions(n, 'curve')), 'no notice names the curve').toEqual([]);
    const d = drawn(path!, 'the sinc curve');
    expect(d.subpaths.length, `the curve draws as one sub-path: ${show(path)}`).toBe(1);
    expect(d.notices, 'the path names no notice').toEqual([]);
    const xs = d.subpaths[0]!.map((p) => p[0]);
    expect(Math.min(...xs) <= -10 + 1e-6 && Math.max(...xs) >= 10 - 1e-6, 'the sub-path spans [−10, 10]').toBe(true);
  }, TIMEOUT);

  it('criterion 8: sinc\'s interval form over [−1e-9, 1e-9] lies within [0.99999999, 1], and a planted form computing sin(x) ÷ x returns an unbounded range and fails', () => {
    const range: [number, number][] = [[-1e-9, 1e-9]];
    const [real, planted] = fnReplies(shows.bin(FULL), evidence(), [
      { expr: 'sinc(x)', over: range },
      { expr: 'sinc(x)', over: range, planted: 'sinc_as_sin_over_x' },
    ]);
    none(sincFailures(boundsOf(real!, 1, 'sinc')[0]!), 'sinc near 0');
    const p = boundsOf(planted!, 1, 'the planted sinc')[0]!;
    expect(p.lo === null || p.hi === null, `the planted form's range is unbounded: [${p.lo}, ${p.hi}]`).toBe(true);
    failsNaming(sincFailures(p), ['sinc'], 'the bound check on the planted sinc');
  }, TIMEOUT);

  it('criterion 8: the sum to n of (−1)^k·x^(2k+1) ÷ factorial(2k+1), with n declared max 19 and set to 19 by a test writer\'s entry, equals sin x within 1e-12 at 1,000 seeded x in [−6, 6]', () => {
    const xs = seededIn(490_08, 1000, -6, 6);
    const call = { expr: 'sum(k, 0, n, (-1)^k * x^(2*k+1) / factorial(2*k+1))', context: 'path' as const, vars: { n: 'controls/terms/value' }, controls: { terms: slider('Terms', [0, 19], 0) } };
    const [set, unset] = fnReplies(shows.bin(FULL), evidence(), [
      { ...call, input: [entry(0, 1, 'terms', 19)], at: xs },
      { ...call, at: [1] },
    ]);
    const v = scalars(set!, xs.length, 'the sum at n = 19');
    none(xs.flatMap((x, i) => (Math.abs((v[i] ?? NaN) - Math.sin(x)) <= 1e-12 ? [] : [`at x = ${x} the sum reads ${v[i]}, sin x = ${Math.sin(x)}`])), 'the sum against sin x');
    expect(scalars(unset!, 1, 'the sum at the control\'s default')[0], 'without the entry n is the control\'s default 0, so the sum is its first term, x').toBe(1);
  }, TIMEOUT);

  it('criterion 8: cpow(vec2(x, y), 2) equals vec2(x² − y², 2xy) within 2 ulp at 10,000 seeded points', () => {
    const xs = seededIn(490_081, 10_000, -10, 10);
    const ys = seededIn(490_082, 10_000, -10, 10);
    const pts = xs.map((x, i) => ({ x, y: ys[i]! }));
    const [r] = fnReplies(shows.bin(FULL), evidence(), [{ expr: 'cpow(vec2(x, y), 2)', at: pts }]);
    const v = valuesOf(r!, pts.length, 'cpow');
    const failures: string[] = [];
    pts.forEach(({ x, y }, i) => {
      const got = v[i];
      const want = [x * x - y * y, 2 * x * y];
      if (!Array.isArray(got) || got.length !== 2) { failures.push(`at (${x}, ${y}) cpow reads ${JSON.stringify(got)}, not a vec2`); return; }
      want.forEach((w, k) => { if (!(Math.abs(got[k]! - w) <= 2 * ulp(w))) failures.push(`at (${x}, ${y}) cpow's ${k === 0 ? 'real' : 'imaginary'} part reads ${got[k]}, ${(Math.abs(got[k]! - w) / ulp(w)).toFixed(1)} ulp from ${w}`); });
    });
    none(failures, 'cpow(z, 2) against z·z');
  }, TIMEOUT);

  it('criterion 8: factorial(171), factorial(2.5) and a sum of 257 terms are each refused at check, naming the call', () => {
    const [big, half, long, ok] = fnReplies(shows.bin(FULL), evidence(), [
      { expr: 'factorial(171)', at: [0] },
      { expr: 'factorial(2.5)', at: [0] },
      { expr: 'sum(k, 0, 256, x)', at: [1] },
      { expr: 'factorial(170) + sum(k, 0, 255, x)', at: [1] },
    ]);
    const named = (r: JsonObject, fn: string, args: number[], what: string): void => {
      expect(fnRefused(r), `${what} is refused: ${show(r)}`).toBe(true);
      expect(mentions(r, fn), `${what}: the refusal names ${fn}: ${show(r)}`).toBe(true);
      expect(numbersIn(r).some((n) => args.includes(n)), `${what}: the refusal names its argument: ${show(r)}`).toBe(true);
    };
    named(big!, 'factorial', [171], 'factorial(171)');
    named(half!, 'factorial', [2.5], 'factorial(2.5)');
    named(long!, 'sum', [256, 257], 'a sum of 257 terms');
    expect(fnRefused(ok!), `factorial(170) and a sum of 256 terms are accepted: ${show(ok)}`).toBe(false);
  }, TIMEOUT);
});
