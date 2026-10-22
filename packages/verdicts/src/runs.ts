// Run counts: how many clean runs a check needs, and how many more start on a commit.
import type { RunOutcome } from './types.js';

/** A verdict's run counts are u16 (verdict.made). */
const MAX_RUNS = 65535;

type Needed = { ok: true; needed: number } | { ok: false; reason: string };
/** Counts by rate as written: a verdict asks for each check's count more than once. */
const counted = new Map<string, Needed>();

/**
 * Clean runs a check needs: `runs` when declared, else the least n with (1 − p)^n ≤ 0.05 for `accept`, found by
 * exact comparison on p as a decimal, never by rounding a quotient of logarithms; else 1.
 */
export function runsNeeded(declared: { runs?: number; accept?: string }): Needed {
  if (declared.runs !== undefined) {
    return Number.isInteger(declared.runs) && declared.runs >= 1 && declared.runs <= MAX_RUNS
      ? { ok: true, needed: declared.runs }
      : { ok: false, reason: `runs ${declared.runs} must be a whole number from 1 to ${MAX_RUNS}` };
  }
  if (declared.accept === undefined) return { ok: true, needed: 1 };
  let needed = counted.get(declared.accept);
  if (!needed) {
    if (counted.size >= 1024) counted.clear();
    needed = count(declared.accept);
    counted.set(declared.accept, needed);
  }
  return needed;
}

function count(accept: string): Needed {
  const bad: Needed = { ok: false, reason: `accepted failure rate ${accept} must lie strictly between 0% and 100%, written with its unit %` };
  const many: Needed = { ok: false, reason: `accepted failure rate ${accept} needs more than ${MAX_RUNS} runs` };
  const m = /^(\d+)(?:\.(\d+))?%$/.exec(accept);
  if (!m) return bad;
  const digits = m[2] ?? '';
  // p = num / den exactly.
  const num = BigInt(m[1]! + digits);
  const den = 100n * 10n ** BigInt(digits.length);
  if (num <= 0n || num >= den) return bad;
  // The quotient of logarithms, from the decimal's own text so a long one can't overflow; log1p keeps a tiny p.
  const p = Number(`${m[1]}.${digits || '0'}`) / 100;
  const estimate = Math.log(0.05) / Math.log1p(-p);
  if (!(estimate <= MAX_RUNS + 1)) return many;
  let n = Math.max(1, Math.ceil(estimate));
  // Its rounding can decide the count only when it lands within a hair of a whole number: there, decide
  // (1 − p)^n ≤ 1/20 by bounding (1 − p)^n in fixed point from below and above, wider than the decimal's own
  // digits; only a case those bounds can't settle compares exactly, 20·(den − num)^n ≤ den^n.
  const whole = Math.round(estimate);
  if (Math.abs(estimate - whole) <= 1e-9 * Math.max(1, estimate)) {
    const bits = BigInt(256 + 4 * digits.length);
    const one = 1n << bits;
    const power = (base: bigint, k: number, up: bigint): bigint => {
      let out = one;
      for (let b = base, e = k; e > 0; e >>= 1) {
        if (e & 1) out = (out * b + up) >> bits;
        b = (b * b + up) >> bits;
      }
      return out;
    };
    const low = ((den - num) << bits) / den;
    const fits = (k: number): boolean => {
      if (20n * power(low + 1n, k, one - 1n) <= one) return true;
      if (20n * power(low, k, 0n) > one) return false;
      return 20n * (den - num) ** BigInt(k) <= den ** BigInt(k);
    };
    n = Math.max(1, whole - 1);
    while (!fits(n)) n++;
  }
  return n <= MAX_RUNS ? { ok: true, needed: n } : many;
}

/**
 * How many more runs of a check start on this commit, given its counted runs' outcomes. A pass and a fail end
 * its runs; after a failure, up to two more start; an overrun counts as a failure and an uncounted run as nothing.
 */
export function moreRuns(declared: { runs?: number; accept?: string }, outcomes: readonly RunOutcome[]): number {
  const need = runsNeeded(declared);
  if (!need.ok) return 0;
  if (outcomes.some((o) => o === 'missing' || o === 'ran_nothing' || o === 'stopped')) return 0;
  const passes = outcomes.filter((o) => o === 'passed').length;
  const fails = outcomes.filter((o) => o === 'failed' || o === 'overran').length;
  if (passes && fails) return 0;
  if (fails) return Math.max(0, Math.min(3, need.needed) - fails);
  return Math.max(0, need.needed - passes);
}
