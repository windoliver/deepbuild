// The test's own reference for the judging rule, written from the design alone: one-sided 95% Clopper-Pearson
// bounds, exact for the binomial, by bisection on the binomial's tail. It loads no package. The judge under test
// is resolver-decisions' `judge`; this is only what its numbers are compared with, and the wrong judges the
// criterion names (plants.ts) are built on it.

/** ln C(n, k). */
function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X <= x) for X ~ Binomial(n, p). */
function cdf(x: number, n: number, p: number): number {
  if (x >= n || p <= 0) return 1;
  if (p >= 1) return 0;
  let s = 0;
  for (let k = 0; k <= x; k++) s += Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
  return Math.min(1, s);
}

function bisect(below: (p: number) => boolean): number {
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 200 && hi - lo > 1e-17; i++) {
    const mid = (lo + hi) / 2;
    if (below(mid)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The exact upper bound on a rate seen as x in n, one-sided at 1 - alpha: 1 when nothing was seen. */
export const upper = (x: number, n: number, alpha = 0.05): number => (x >= n ? 1 : bisect((p) => cdf(x, n, p) > alpha));
/** The exact lower bound on a rate seen as x in n, one-sided at 1 - alpha: 0 when none broke. */
export const lower = (x: number, n: number, alpha = 0.05): number => (x <= 0 ? 0 : bisect((p) => 1 - cdf(x - 1, n, p) < alpha));

/** A rate as the issue writes it: a percentage to two decimals. */
export const pct = (rate: number): string => `${(rate * 100).toFixed(2)}%`;
