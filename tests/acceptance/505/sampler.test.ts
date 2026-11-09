// AC3 #505.5e6d3319: "sin(2πx) over [0, 1], at 100 px per unit on both axes, draws its peak at x = 0.25 within 0.5 px
// of y = 1, though x = 0, 0.5 and 1 all give 0, and a search of 10,000 checked x values finds no point of the curve
// more than 0.5 px from the drawn line, while a planted sampler that stops once a segment's midpoint lies on the
// curve draws a flat line and fails; sin(1/x) over [0.0001, 1] draws with a notice naming the stretch near 0 it
// couldn't bound within 2,000 points, which the check report lists as an estimate, never a bound, and a check that
// needs the curve's bound over that stretch is refused, naming the item and the range"
//
// The scales put [0, 1] × [−1, 1] at 100 u per unit (1 u is 1 px at zoom 1). `geometry` gives the drawn line; the
// search is this test's: 10,000 seeded x (and 0.25 and 0.75), each curve point's distance to the drawn line. The
// planted sampler is `planted: "stops_at_midpoint"` (README: Planted programs): over [0, 1] the midpoint 0.5 gives 0,
// on the chord from (0, 0) to (1, 0), so it stops there and draws a flat line, which the same search fails. sin(1/x)
// at 1,000 u per unit of x: `geometry`'s notices and `check`'s `curves` report (README: `check`). The check that needs
// the curve's bound over the stretch is the area under it (`fill`, whose `#area` carries an interval bound): over
// [0.0001, 1] the check refuses it, naming the item and an x range in the stretch; over [0.5, 1], where the curve is
// bounded, it passes.
import { describe, expect, it } from 'vitest';
import { SINE, WILD, sineDoc, sineU, wildDoc, wildU } from './docs.ts';
import {
  AC, TIMEOUT, arr, check, drawnYAt, estimates, fails, fnAt, isObject, near, none, obj, passes, pointCount, seededIn, show, shownIssues, toDrawn,
  useRender, xRangeOf, type FnGeometry, type JsonObject, type JsonValue, type Pt,
} from './helpers.ts';

const render = useRender();
const ID = AC[3];
const CHECKED = [0.25, 0.75, ...seededIn(505_3, 10_000, SINE.x[0], SINE.x[1])];
const sinPoint = (x: number): Pt => [sineU.x(x), sineU.y(Math.sin(2 * Math.PI * x))];

/** The search: each checked x's point of the curve more than 0.5 px from the drawn line. */
function search(g: FnGeometry): string[] {
  const out: string[] = [];
  for (const x of CHECKED) {
    const d = toDrawn(sinPoint(x), g.subpaths);
    if (!(d <= 0.5)) out.push(`x = ${x}: the curve is ${d.toFixed(3)} px from the drawn line`);
  }
  return out;
}
/** An x range [a, b] as the answer writes it. */
const range = (v: JsonValue | undefined, what: string): [number, number] => {
  const r = arr(v, what);
  expect(r.length, `${what} is [a, b]`).toBe(2);
  return [Number(r[0]), Number(r[1])];
};
/** The first member named `key` anywhere in a JSON value, depth first. */
function fieldIn(value: JsonValue | undefined, key: string): JsonValue | undefined {
  if (Array.isArray(value)) { for (const v of value) { const f = fieldIn(v, key); if (f !== undefined) return f; } }
  else if (isObject(value)) { if (key in value) return value[key]; for (const v of Object.values(value)) { const f = fieldIn(v, key); if (f !== undefined) return f; } }
  return undefined;
}
const overlaps = ([a, b]: [number, number], [c, d]: [number, number]): boolean => Math.max(a, c) < Math.min(b, d);

describe(`${ID} a curve bounded by interval arithmetic, not by its samples`, () => {
  it(`${ID} sin(2πx) draws its peak at x = 0.25 within 0.5 px of y = 1, and 10,000 checked x find no point more than 0.5 px off`, () => {
    const bin = render();
    const doc = sineDoc();
    passes(bin, doc, 'sin(2πx)');
    const [g] = fnAt(bin, doc, 'curve', [{}], 'sin(2πx)');
    // x = 0, 0.5 and 1 all give 0 (the closed form, here): a sampler of those three points alone sees a flat line.
    for (const x of [0, 0.5, 1]) near(Math.sin(2 * Math.PI * x), 0, 1e-15, `sin(2π·${x})`);
    const peak = drawnYAt(sineU.x(0.25), g!.subpaths);
    expect(peak, 'the drawn line spans x = 0.25').not.toBeNull();
    near(peak!, sineU.y(1), 0.5, 'the drawn line at x = 0.25 (u), against y = 1 (u)');
    const trough = drawnYAt(sineU.x(0.75), g!.subpaths);
    expect(trough, 'the drawn line spans x = 0.75').not.toBeNull();
    near(trough!, sineU.y(-1), 0.5, 'the drawn line at x = 0.75 (u), against y = −1 (u)');
    expect(pointCount(g!.subpaths), 'at most 2,000 points').toBeLessThanOrEqual(2000);
    none(search(g!), 'the search of 10,000 checked x');
  }, TIMEOUT);

  it(`${ID} a planted sampler that stops once a segment's midpoint lies on the curve draws a flat line and fails`, () => {
    const bin = render();
    const [g] = fnAt(bin, sineDoc(), 'curve', [{ planted: 'stops_at_midpoint' }], 'sin(2πx), the planted sampler');
    expect(g!.subpaths.length, 'the planted sampler draws a line').toBeGreaterThan(0);
    const flat = g!.subpaths.flatMap((s) => s.points).filter(([, v]) => Math.abs(v - sineU.y(0)) > 0.5);
    expect(flat, `the planted sampler draws a flat line at y = 0: ${show(g!.raw)}`).toEqual([]);
    const failures = search(g!);
    fails(failures, 'the search of 10,000 checked x, on the planted sampler');
    expect(failures.some((f) => /^x = 0\.25:/.test(f)), 'the search fails at the peak, x = 0.25').toBe(true);
  }, TIMEOUT);

  it(`${ID} sin(1/x) over [0.0001, 1] draws with a notice naming the stretch near 0, which the check report lists as an estimate, never a bound`, () => {
    const bin = render();
    const doc = wildDoc();
    const c = passes(bin, doc, 'sin(1/x)');
    const [g] = fnAt(bin, doc, 'curve', [{}], 'sin(1/x)');
    expect(pointCount(g!.subpaths), 'at most 2,000 points').toBeLessThanOrEqual(2000);
    expect(g!.subpaths.length, 'it draws').toBeGreaterThan(0);
    const drawnNotices = estimates(g!.notices, 'curve');
    expect(drawnNotices.length, `the drawing raises an estimate notice naming the curve: ${show(g!.notices as unknown as JsonValue)}`).toBeGreaterThan(0);
    const stretches = drawnNotices.map((n, i) => xRangeOf(n, `the drawing's estimate notice ${i}`));
    for (const [a, b] of stretches) {
      expect(a < b && a >= WILD.x[0] - 1e-12 && b <= WILD.x[1] + 1e-12, `the stretch [${a}, ${b}] lies inside [0.0001, 1]`).toBe(true);
    }
    const near0 = stretches.filter(([a]) => a <= 0.0001 + 1e-9);
    expect(near0.length, `a stretch named starts at 0.0001, near 0: ${JSON.stringify(stretches)}`).toBe(1);
    expect(near0[0]![1], 'the stretch near 0 is not the whole curve: the rest is bounded').toBeLessThan(1);
    // The check report: the same notice, the stretch listed as an estimate and never inside a bound.
    const reported = estimates(c.notices, 'curve').map((n, i) => xRangeOf(n, `the check's estimate notice ${i}`));
    expect(reported.some(([a, b]) => Math.abs(a - near0[0]![0]) <= 1e-9 && Math.abs(b - near0[0]![1]) <= 1e-9), `the check report's notices name the stretch ${JSON.stringify(near0[0])}: ${JSON.stringify(reported)}`).toBe(true);
    const curves = obj(obj(c.raw['curves'], 'the check report: curves')['curve'], 'the check report: curves.curve');
    const bound = arr(curves['bound'], 'curves.curve.bound').map((r, i) => range(r, `curves.curve.bound[${i}]`));
    const estimate = arr(curves['estimate'], 'curves.curve.estimate').map((r, i) => range(r, `curves.curve.estimate[${i}]`));
    expect(estimate.some(([a, b]) => a <= near0[0]![0] + 1e-9 && b >= near0[0]![1] - 1e-9), `the report lists the stretch as an estimate: ${JSON.stringify(estimate)}`).toBe(true);
    const both = bound.filter((r) => estimate.some((e) => overlaps(r, e)));
    expect(both, `no bound overlaps an estimate: bound ${JSON.stringify(bound)}, estimate ${JSON.stringify(estimate)}`).toEqual([]);
    expect(bound.length, 'the rest of the curve is listed as bounded').toBeGreaterThan(0);
    // Where the report says the curve is bounded, 2,000 checked x across those ranges (by length) find no point more
    // than 0.5 px off.
    const wrong: string[] = [];
    const total = bound.reduce((s, [a, b]) => s + (b - a), 0);
    for (const u of seededIn(505_31, 2000, 0, total)) {
      let left = u;
      const r = bound.find(([a, b]) => { if (left <= b - a) return true; left -= b - a; return false; }) ?? bound[bound.length - 1]!;
      const x = Math.min(r[1], r[0] + left);
      const d = toDrawn([wildU.x(x), wildU.y(Math.sin(1 / x))], g!.subpaths);
      if (!(d <= 0.5)) wrong.push(`x = ${x} in the bound [${r[0]}, ${r[1]}]: ${d.toFixed(3)} px from the drawn line`);
    }
    none(wrong, 'the bounded stretches hold within 0.5 px');
  }, TIMEOUT);

  it(`${ID} a check that needs the curve's bound over that stretch is refused, naming the item and the range`, () => {
    const bin = render();
    const [g] = fnAt(bin, wildDoc(), 'curve', [{}], 'sin(1/x)');
    const stretch = estimates(g!.notices, 'curve').map((n, i) => xRangeOf(n, `estimate notice ${i}`)).find(([a]) => a <= 0.0001 + 1e-9);
    expect(stretch, 'the drawing names the stretch near 0').toBeDefined();
    const refused = check(bin, wildDoc([0.0001, 1]), 'the area under sin(1/x) over [0.0001, 1]');
    const naming = refused.errors.filter((e) => e.ids.includes('curve'));
    expect(naming.length, `the check is refused, an error naming the curve: ${shownIssues(refused)}`).toBeGreaterThan(0);
    expect(refused.ok, 'the check does not pass').toBe(false);
    const ranges = naming.map((e) => fieldIn(e.raw as JsonObject, 'x_range')).filter((r) => r !== undefined).map((r, i) => range(r, `the refusal's x_range ${i}`));
    expect(ranges.some((r) => overlaps(r, stretch!)), `the refusal names the range, an x_range in the stretch ${JSON.stringify(stretch)}: ${shownIssues(refused)} ${JSON.stringify(ranges)}`).toBe(true);
    // Its twin over [0.5, 1], where the curve is bounded, passes: the check refuses the stretch, not every area.
    passes(bin, wildDoc([0.5, 1]), 'the area under sin(1/x) over [0.5, 1]');
  }, TIMEOUT);
});
