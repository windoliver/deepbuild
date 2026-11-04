// Criterion 3 (Oracle lane, port): "A seeded search for counterexamples finds none: each function's interval form
// holds every value its point form gives …" — the Oracle page links the IEEE 1788 interval test suite as inari
// 9e519ce47c ports it: "the outward-rounded enclosure each elementary function must return over interval inputs,
// single points included (sin over [π/2, π/2] is [0.9999999999999999, 1]) and ranges across extrema and poles. Our
// forms are widened by libm's error bound rather than tight".
//
// Ported: every case of libieeep1788_elem.rs's non-decorated tests of a function on our closed list that our `fn`
// call can state (fixtures/itf1788-libieeep1788-elem.json, made by fixtures/extract-itf1788.mjs; README: Criterion
// 3 lists what was left out and why). Each upstream `assert_eq2!(f(X), Y)` becomes: our `over` bound of the
// expression over X (1) is not an estimate, (2) contains Y, the tight enclosure, and (3) is wider than Y by at most
// the margin the README justifies; and our point form at X's two ends lies inside our bound.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, boundsOf, fixture, none, runFns, show, useShowCore, type Bound, type FnCall, type JsonValue } from './helpers.ts';

interface Case { test: string; line: number; src: string; expr: string; x: [number, number]; want: [number | null, number | null] }
const SUITE = fixture<{ kept: number; cases: Case[] }>('itf1788-libieeep1788-elem.json');
const show_ = useShowCore();

/** How far past a tight end ours may reach: the error bound's margin (README: Criterion 3, judging an enclosure). */
const MARGIN = 1e-12;
/** Past this magnitude a widened finite end may round out to unbounded. */
const HUGE = 1e300;

/** Why ours fails to enclose `want` within the margin at one end (`side` −1 low, +1 high), or null. */
function endProblem(side: -1 | 1, ours: number | null, want: number | null): string | null {
  const name = side < 0 ? 'lo' : 'hi';
  if (want === null) return ours === null ? null : `${name} is ${ours}, but the tight end is unbounded`;
  if (ours === null) return Math.abs(want) > HUGE ? null : `${name} is unbounded, but the tight end is ${want}`;
  if (side < 0 ? ours > want : ours < want) return `${name} ${ours} leaves out the tight end ${want}`;
  const past = Math.abs(ours - want);
  return past <= MARGIN * Math.max(1, Math.abs(want)) ? null : `${name} ${ours} is ${past.toExponential(3)} past the tight end ${want}, more than ${MARGIN} × max(1, |end|)`;
}
const inside = (v: number, b: Bound): boolean => (b.lo === null || b.lo <= v) && (b.hi === null || v <= b.hi);

const byTest = new Map<string, Case[]>();
for (const c of SUITE.cases) byTest.set(c.test, [...(byTest.get(c.test) ?? []), c]);

describe('criterion 3 (port): the IEEE 1788 suite (libieeep1788_elem.rs, inari 9e519ce47c) against our interval forms', () => {
  it('criterion 3: the fixture holds the cases its extractor kept', () => {
    expect(SUITE.cases.length).toBe(SUITE.kept);
    expect(SUITE.cases.length, 'a port that keeps no case proves nothing').toBeGreaterThan(400);
  });

  for (const [test, cases] of byTest) {
    it(`criterion 3: ${test} — ${cases.length} cases: our bound is no estimate, holds the tight enclosure, is at most ${MARGIN} × max(1, |end|) wider, and holds our point form at both ends`, () => {
      // One `over` call and one `at` call per expression.
      const exprs = [...new Set(cases.map((c) => c.expr))];
      const calls: FnCall[] = exprs.flatMap((expr) => {
        const cs = cases.filter((c) => c.expr === expr);
        return [{ expr, over: cs.map((c) => c.x) }, { expr, at: cs.flatMap((c) => c.x) }];
      });
      const replies = runFns(show_.bin(), calls);
      const failures: string[] = [];
      exprs.forEach((expr, e) => {
        const cs = cases.filter((c) => c.expr === expr);
        const bounds = boundsOf(replies[2 * e]!, cs.length);
        const pr = replies[2 * e + 1]!;
        // A point value past the largest double reads null (JSON has no infinity); it passes where our bound is unbounded.
        const points = 'values' in pr && pr.values.length === 2 * cs.length ? pr.values : `not ${2 * cs.length} values: ${show(pr as unknown as JsonValue)}`;
        if (typeof bounds === 'string') { failures.push(`${expr} over ${cs.length} ranges: ${bounds}`); return; }
        cs.forEach((c, i) => {
          const b = bounds[i]!;
          const at = `${c.test} line ${c.line} (${c.src}): ${expr} over [${c.x[0]}, ${c.x[1]}] → ${show(b as unknown as JsonValue)}`;
          if (b.estimate) failures.push(`${at}: an estimate, which never decides a check`);
          for (const p of [endProblem(-1, b.lo, c.want[0]), endProblem(1, b.hi, c.want[1])]) if (p) failures.push(`${at}: ${p}`);
          if (typeof points === 'string') return;
          [0, 1].forEach((k) => {
            const v = points[2 * i + k];
            const ok = typeof v === 'number' ? inside(v, b) : v === null && (b.lo === null || b.hi === null);
            if (!ok) failures.push(`${at}: our point form at ${c.x[k]} reads ${show(v)}, outside our bound`);
          });
        });
        if (typeof points === 'string') failures.push(`${expr} at the ranges' ends: ${points}`);
      });
      none(failures, `${test}`);
    }, TIMEOUT);
  }
});
