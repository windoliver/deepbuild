// The #223 Oracle lane's helpers: the #223 suite's own (../223/helpers.ts), so both lanes build and ask the same
// binaries the same way, and what the ports add: the BLOCKED rule, random cubic paths drawn by a seeded generator
// (as the upstream tests draw theirs), and a few f64 tools for curves. No upstream code is copied.

import { expect } from 'vitest';
import { PLANE, random, toScreen, type Pt } from '../223/helpers.ts';

export * from '../223/helpers.ts';

/** A case that can't run here: it fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function blocked(reason: string, unblock: string): never {
  expect.fail(`BLOCKED: ${reason}\nUnblock: ${unblock}`);
}

/** A random path of 1 to 3 cubics in a row, its control points in the plane's [−2, 2]², as screen points (u) on PLANE. */
export interface Curves { curves: Pt[][]; d: string }
export function randomCurves(seedText: string, count: number, o: { straightLast?: boolean; collapseLast?: boolean } = {}): Curves[] {
  const next = random(seedText);
  const p = (): Pt => toScreen(PLANE, [-2 + 4 * next(), -2 + 4 * next()]);
  return Array.from({ length: count }, () => {
    const n = 1 + Math.floor(next() * 3);
    let at = p();
    const curves: Pt[][] = [];
    for (let k = 0; k < n; k++) {
      const c: Pt[] = [at, p(), p(), p()];
      // The end of each curve lies at least 30 u from its start, so a direction at its end is well defined.
      while (Math.hypot(c[3]![0] - c[0]![0], c[3]![1] - c[0]![1]) < 30) c[3] = p();
      curves.push(c);
      at = c[3]!;
    }
    const last = curves[curves.length - 1]!;
    if (o.straightLast) { const [a, , , b] = last; last[1] = [a![0] + (b![0] - a![0]) / 3, a![1] + (b![1] - a![1]) / 3]; last[2] = [a![0] + (2 * (b![0] - a![0])) / 3, a![1] + (2 * (b![1] - a![1])) / 3]; }
    if (o.collapseLast) last[2] = [last[3]![0], last[3]![1]];
    const d = `M ${curves[0]![0]!.join(' ')} ${curves.map((c) => `C ${c.slice(1).map((q) => q.join(' ')).join(' ')}`).join(' ')}`;
    return { curves, d };
  });
}

/** A cubic's direction where it arrives at its end, as the upstream tip test reads it: B′(1), else B″(1) reversed, else B‴. */
export function arriving(c: Pt[]): Pt {
  const [p0, p1, p2, p3] = c as [Pt, Pt, Pt, Pt];
  const tries: [number, Pt][] = [
    [1, [p3[0] - p2[0], p3[1] - p2[1]]],
    [-1, [p3[0] - 2 * p2[0] + p1[0], p3[1] - 2 * p2[1] + p1[1]]],
    [1, [p3[0] - 3 * p2[0] + 3 * p1[0] - p0[0], p3[1] - 3 * p2[1] + 3 * p1[1] - p0[1]]],
  ];
  for (const [sign, d] of tries) { const l = Math.hypot(d[0], d[1]); if (l > 1e-9) return [(sign * d[0]) / l, (sign * d[1]) / l]; }
  throw Error('a curve of one point has no direction');
}
