// Criteria 1 and 2 (#832.d6fbcd45, #832.c07dc2c3), Oracle lane: an upstream statistics library's binomial-test tests
// at commit e4e854eaa8f18d807cd3496028e257e36caa93cc, ported. Their expected values come from a reference statistics
// environment's exact binomial test; the rows ported here are their two-sided exact (Clopper–Pearson) intervals, the
// interval catalog.dominance compares a row's
// shares with (Check input: catalog kinds, As built (#832)). Their one-sided intervals and other methods aren't ours.
//
// Run on our output: `binomialInterval(k, n, confidence = 0.95)`, which the design names as exported from
// packages/checks/catalog/dominance.ts and answering [lo, hi] for any confidence in (0, 1), against each row within the
// upstream test's own tolerance; a 0 or a 1 the upstream test asserts exactly is asserted exactly.
// The wrong programs: a normal-approximation (Wald) or Wilson interval; a one-sided bound or α in place of α/2 at either
// end; Beta(k, n − k) in place of Beta(k, n − k + 1) below or Beta(k + 1, n − k) above; a confidence read as α; an end
// clamped short of 0 or 1.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOMINANCE = join(REPO, 'packages', 'checks', 'catalog', 'dominance.ts');
const TAGS = '#832.d6fbcd45 #832.c07dc2c3';

/** The plug-in's binomialInterval, by the path the design names; a path, so the suite type-checks at the base. */
async function binomialInterval(): Promise<(k: number, n: number, confidence?: number) => unknown> {
  expect(existsSync(DOMINANCE), 'the catalog plug-in holds packages/checks/catalog/dominance.ts, which exports binomialInterval').toBe(true);
  const m = (await import(DOMINANCE)) as Record<string, unknown>;
  expect(typeof m['binomialInterval'], 'dominance.ts exports binomialInterval(k, n, confidence = 0.95)').toBe('function');
  return m['binomialInterval'] as (k: number, n: number, confidence?: number) => unknown;
}
/** [lo, hi] as the function answers it: an array of two numbers. */
function ends(v: unknown, what: string): [number, number] {
  expect(Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number'), `${what} answers [lo, hi]: ${JSON.stringify(v)}`).toBe(true);
  return v as [number, number];
}
/** `got` within `tol` of `want`, relative (the upstream test's own measure). */
function near(got: number, want: number, tol: number, what: string): void {
  expect(Math.abs(got - want) <= tol * Math.abs(want), `${what}: ${got}, the upstream ${want} within relative ${tol}`).toBe(true);
}

/** The upstream two-sided exact rows: k, n, confidence, its low and high, each within its relative tolerance; null where it asserts an exact end. */
const ROWS: { k: number; n: number; confidence: number; low: number; high: number; tol: number; exact?: 'low' | 'high' }[] = [
  { k: 20, n: 100, confidence: 0.95, low: 0.1266555521019559, high: 0.2918426890886281, tol: 1e-12 },
  { k: 3, n: 50, confidence: 0.99, low: 0.006872485, high: 0.202706269, tol: 1e-6 },
  { k: 0, n: 10, confidence: 0.95, low: 0, high: 0.3084971, tol: 1e-6, exact: 'low' },
  { k: 10, n: 10, confidence: 0.95, low: 0.6915029, high: 1, tol: 1e-6, exact: 'high' },
];

describe(`${TAGS} binomialInterval is the exact two-sided interval an upstream statistics library's binomial-test tests check`, () => {
  for (const r of ROWS) {
    it(`${TAGS} binomialInterval(${r.k}, ${r.n}, ${r.confidence}) is [${r.low}, ${r.high}]`, async () => {
      const f = await binomialInterval();
      const what = `binomialInterval(${r.k}, ${r.n}, ${r.confidence})`;
      const [lo, hi] = ends(f(r.k, r.n, r.confidence), what);
      if (r.exact === 'low') expect(lo, `${what}: its low is exactly 0`).toBe(0);
      else near(lo, r.low, r.tol, `${what}: its low`);
      if (r.exact === 'high') expect(hi, `${what}: its high is exactly 1`).toBe(1);
      else near(hi, r.high, r.tol, `${what}: its high`);
      if (r.confidence === 0.95) expect(ends(f(r.k, r.n), `binomialInterval(${r.k}, ${r.n})`), 'its confidence is 0.95 when none is given').toEqual([lo, hi]);
    });
  }
});
