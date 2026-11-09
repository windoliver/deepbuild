// AC3 #505.5e6d3319 and AC4 #505.00692b98 (Oracle lane, port): both criteria rest on the interval forms (the plot's
// 0.5 px bound "holds by interval arithmetic with outward rounding", and the implicit tracer drops a cell only when
// "its bound excludes 0"). The Oracle page links the IEEE 1788 suite as inari 9e519ce47c ports it: "for sin, cos, sqr,
// pow, division and the other elementary functions over interval inputs, the tight enclosure each must return. Our
// interval forms are widened by libm's error bound, so each expected interval must lie inside ours."
//
// Ported: libieeep1788_elem.rs's non-decorated cases of the functions the plots and implicit curves are made of
// (fixtures/itf1788-plot-functions.json: sin, cos, sqr, pown, pow, div, recip, 259 cases, taken unchanged from
// tests/acceptance/490-oracle's port by fixtures/subset-itf1788.mjs). They run through #490's `fn` call on
// `deep-show run`, as 490-oracle runs them, but in the context a path fn's expression is evaluated in, `context:
// "path"` (490-oracle sends no context), since that is the form #505's sampler and tracer read. Each upstream
// `assert_eq2!(f(X), Y)` becomes, by 490-oracle's rules (its README: "How an upstream assertion maps onto our wider
// form"): our `over` bound of the expression over X is no estimate, contains Y, is wider than Y by at most
// 1e-12 × max(1, |end|) at each end (unbounded only past 1e300), and holds our point form at X's two ends.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT, fixture, isObject, none, show, useShowCore, type JsonObject, type JsonValue } from './helpers.ts';

interface Case { test: string; line: number; src: string; expr: string; x: [number, number]; want: [number | null, number | null] }
const SUITE = fixture<{ kept: number; tests: string[]; cases: Case[] }>('itf1788-plot-functions.json');
const show_ = useShowCore();
const NAME = `${AC[3]} ${AC[4]}`;

/** How far past a tight end ours may reach (490-oracle's margin, justified in its README). */
const MARGIN = 1e-12;
/** Past this magnitude a widened finite end may round out to unbounded. */
const HUGE = 1e300;

interface Bound { lo: number | null; hi: number | null; estimate: boolean }

/** One `deep-show run` scenario of `fn` calls (#490's surface): the replies, one per call, or why there are none. */
function runFns(bin: string, calls: JsonObject[]): JsonValue[] {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-505-oracle-ev-'));
  try {
    const scenario = { evidence, sessions: {}, processes: [], panels: {}, docs: {}, calls };
    const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
    expect(run.status, `deep-show run exits 0; stdout ${String(run.stdout).slice(0, 600)}; stderr ${String(run.stderr).slice(-1500)}`).toBe(0);
    const out = JSON.parse(run.stdout.split('\n')[0]!) as JsonValue;
    expect(isObject(out) && out['ok'] === true, `deep-show run accepts a scenario of ${calls.length} fn calls (the first: ${show(calls[0])}); it answered ${run.stdout.slice(0, 600)}`).toBe(true);
    const replies = (out as JsonObject)['replies'];
    expect(Array.isArray(replies) && replies.length === calls.length, `one reply per call (${calls.length}); got ${show(replies)}`).toBe(true);
    return replies as JsonValue[];
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
function boundsOf(r: JsonValue | undefined, n: number): Bound[] | string {
  if (!isObject(r) || !Array.isArray(r['bounds'])) return `not bounds: ${show(r)}`;
  if (r['bounds'].length !== n) return `${r['bounds'].length} bounds for ${n} ranges`;
  const out: Bound[] = [];
  for (const b of r['bounds']) {
    const end = (v: JsonValue | undefined): boolean => v === null || (typeof v === 'number' && Number.isFinite(v));
    if (!isObject(b) || !end(b['lo']) || !end(b['hi'])) return `a bound is not {lo, hi}: ${show(b)}`;
    out.push({ lo: b['lo'] as number | null, hi: b['hi'] as number | null, estimate: b['estimate'] === true });
  }
  return out;
}
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

describe(`${NAME} (port): the IEEE 1788 enclosures (libieeep1788_elem.rs, inari 9e519ce47c) the plots rest on, in the path context`, () => {
  for (const test of SUITE.tests) {
    const cases = SUITE.cases.filter((c) => c.test === test);
    it(`${NAME} ${test}, ${cases.length} cases with context "path": our bound is no estimate, holds the tight enclosure, is at most ${MARGIN} × max(1, |end|) wider, and holds our point form at both ends`, () => {
      const exprs = [...new Set(cases.map((c) => c.expr))];
      const calls: JsonObject[] = exprs.flatMap((expr) => {
        const cs = cases.filter((c) => c.expr === expr);
        return [{ call: 'fn', expr, context: 'path', over: cs.map((c) => c.x) }, { call: 'fn', expr, context: 'path', at: cs.flatMap((c) => c.x) }];
      });
      const replies = runFns(show_(), calls);
      const failures: string[] = [];
      exprs.forEach((expr, e) => {
        const cs = cases.filter((c) => c.expr === expr);
        const bounds = boundsOf(replies[2 * e], cs.length);
        const pr = replies[2 * e + 1];
        const points = isObject(pr) && Array.isArray(pr['values']) && pr['values'].length === 2 * cs.length ? pr['values'] : `not ${2 * cs.length} values: ${show(pr)}`;
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
      none(failures, test);
    }, TIMEOUT);
  }
});
