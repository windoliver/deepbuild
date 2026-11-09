// AC6 #505.80c4ff9d: "y = x² filled to the axis over [0, 1] reads `#area.value` 0.33333333 within 1e-8 with its edge
// within 0.5 px of the curve, and moving the upper end by a slider updates both in that frame; probes at 1.5 and 2.5
// on y = x²/4 give a secant whose slope readout is 1.0000, and a path attached between their anchors ends on both
// within 0.5 px; y = 2x marked `derivative_of` y = x² passes and y = 2x + 0.1 fails `fn.derivative`, naming the first
// x; and a curve whose `over` end follows a channel draws exactly to that x at 100 sampled times"
//
// All through `deep-canvas-render` (README: `geometry`, `check`, `raster`). The fill's upper end is moved by the
// slider `upper`, which binds `items/area/params/fill/over/1` (Control: `binds`), from 1 to 0.5 by an entry of yours at
// 1 s; `geometry` gives `area: {value, lo, hi}` (#area's integral and its interval bound) and the fill's outline
// (`fill`). "Its edge within 0.5 px of the curve" is both ways: every point of the fill's outline within 0.5 u of the
// region's edge (the curve over [0, upper], the axis under it, the side at upper), and 1,000 checked points of the
// curve within 0.5 u of the outline. The secant: a driver (y2 − y1) ÷ (x2 − x1) over the probes' anchors
// (`items/curve#p1/y` …), a counter at precision 4, and a two-point path whose `attach` names `curve#p1` and
// `curve#p2`. `fn.derivative` is the check's (its code); "naming the first x" is read as the failure carrying the x
// (`x`) where the curves part by more than 0.5 px. The `over` end follows the data value `end`, which a channel keys
// 0.25 → 1 over 1 s; "exactly" is within 1e-4 u (a path's points are f32). Closed forms here: ∫₀¹ x² = 1/3, ∫₀^½ x²
// = 1/24, the secant (2.5² − 1.5²) ÷ 4 = 1.
import { describe, expect, it } from 'vitest';
import { END, SLOPES, T, areaDoc, derivativeDoc, growDoc, secantDoc, secantU, slopesU, unitU } from './docs.ts';
import {
  AC, TIMEOUT, check, dist, entry, fl, fnAt, fnGeometry, geometry, isObject, near, none, passes, rasterAt, seeded, seededIn, shownIssues, shownText, toDrawn,
  useRender, useTemp, type FnGeometry, type JsonValue, type Pt, type Subpath,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('calculus');
const ID = AC[6];

/** The region under y = x² from 0 to `upper`, its edge as a dense polyline in u: the curve, the side at upper, the axis. */
function regionEdge(upper: number): Subpath {
  const pts: Pt[] = [];
  for (let k = 0; k <= 8000; k++) { const x = (upper * k) / 8000; pts.push([unitU.x(x), unitU.y(x * x)]); }
  pts.push([unitU.x(upper), unitU.y(0)], [unitU.x(0), unitU.y(0)]);
  return { closed: true, points: pts };
}
/** Where the fill's outline and the region's edge part by more than 0.5 u, both ways. */
function edgeApart(g: FnGeometry, upper: number): string[] {
  const out: string[] = [];
  if (g.fill.length === 0) return ['the fill draws no outline'];
  const edge = [regionEdge(upper)];
  for (const p of g.fill.flatMap((s) => s.points)) {
    const d = toDrawn(p, edge);
    if (!(d <= 0.5)) out.push(`the fill's point (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) is ${d.toFixed(3)} u off the region's edge`);
  }
  for (const x of seededIn(505_6, 1000, 0, upper)) {
    const d = toDrawn([unitU.x(x), unitU.y(x * x)], g.fill);
    if (!(d <= 0.5)) out.push(`the curve at x = ${x} is ${d.toFixed(3)} u from the fill's edge`);
  }
  return out;
}
function fieldIn(value: JsonValue | undefined, key: string): JsonValue | undefined {
  if (Array.isArray(value)) { for (const v of value) { const f = fieldIn(v, key); if (f !== undefined) return f; } }
  else if (isObject(value)) { if (key in value) return value[key]; for (const v of Object.values(value)) { const f = fieldIn(v, key); if (f !== undefined) return f; } }
  return undefined;
}

describe(`${ID} calculus on a function path`, () => {
  it(`${ID} y = x² filled to the axis over [0, 1] reads #area.value 0.33333333 within 1e-8, its edge within 0.5 px, and a slider on the upper end updates both in that frame`, () => {
    const bin = render();
    const doc = areaDoc();
    const input = [entry(T, 1, 'upper', 0.5)];
    passes(bin, doc, 'the area under x²', { input });
    const [whole, half] = fnAt(bin, doc, 'area', [{ t: T - 1, input }, { t: T, input }], 'the area under x²');
    expect(whole!.area, `the curve answers #area: ${JSON.stringify(whole!.raw).slice(0, 600)}`).not.toBeNull();
    near(whole!.area!.value, 0.33333333, 1e-8, '#area.value over [0, 1]');
    expect(whole!.area!.lo <= 1 / 3 && 1 / 3 <= whole!.area!.hi, `its interval bound [${whole!.area!.lo}, ${whole!.area!.hi}] holds 1/3`).toBe(true);
    none(edgeApart(whole!, 1), 'over [0, 1], the fill\'s edge and the curve');
    expect(half!.area, 'the area in the slider\'s frame').not.toBeNull();
    near(half!.area!.value, 1 / 24, 1e-8, '#area.value in the frame the slider moves the upper end to 0.5');
    expect(half!.area!.lo <= 1 / 24 && 1 / 24 <= half!.area!.hi, `its interval bound [${half!.area!.lo}, ${half!.area!.hi}] holds 1/24`).toBe(true);
    none(edgeApart(half!, 0.5), 'in that frame, over [0, 0.5], the fill\'s edge and the curve');
  }, TIMEOUT);

  it(`${ID} probes at 1.5 and 2.5 on y = x²/4 give a secant whose slope readout is 1.0000, and a path attached between their anchors ends on both within 0.5 px`, () => {
    near((2.5 ** 2 - 1.5 ** 2) / 4 / (2.5 - 1.5), 1, 1e-15, 'the secant\'s slope, closed form');
    const bin = render();
    const doc = secantDoc();
    passes(bin, doc, 'the secant');
    const answer = rasterAt(bin, doc, [{}], temp(), 'secant')[0]!.answer;
    expect(shownText(answer, 'slope', 'the slope readout'), 'the secant\'s slope readout').toBe('1.0000');
    const p1: Pt = [secantU.x(1.5), secantU.y(1.5 ** 2 / 4)];
    const p2: Pt = [secantU.x(2.5), secantU.y(2.5 ** 2 / 4)];
    const [curve] = fnAt(bin, doc, 'curve', [{}], 'the curve');
    expect(curve!.anchors['p1'] && curve!.anchors['p2'], `both probes are anchors: ${JSON.stringify(curve!.raw).slice(0, 600)}`).toBeTruthy();
    expect(dist(curve!.anchors['p1']!.at, p1), 'the anchor #p1 sits on the curve at x = 1.5').toBeLessThanOrEqual(0.5);
    expect(dist(curve!.anchors['p2']!.at, p2), 'the anchor #p2 sits on the curve at x = 2.5').toBeLessThanOrEqual(0.5);
    const [chord] = fnAt(bin, doc, 'chord', [{}], 'the attached path');
    const pts = chord!.subpaths.flatMap((s) => s.points);
    expect(pts.length, 'the attached path draws').toBeGreaterThanOrEqual(2);
    expect(dist(pts[0]!, p1), `the attached path starts on #p1: ${JSON.stringify(pts[0])} against ${JSON.stringify(p1)}`).toBeLessThanOrEqual(0.5);
    expect(dist(pts[pts.length - 1]!, p2), `the attached path ends on #p2: ${JSON.stringify(pts[pts.length - 1])} against ${JSON.stringify(p2)}`).toBeLessThanOrEqual(0.5);
  }, TIMEOUT);

  it(`${ID} y = 2x marked derivative_of y = x² passes and y = 2x + 0.1 fails fn.derivative, naming the first x`, () => {
    const bin = render();
    const honest = check(bin, derivativeDoc('2 * x'), 'y = 2x as the derivative of y = x²');
    expect(honest.issues.filter((i) => i.code === 'fn.derivative'), `y = 2x passes fn.derivative: ${shownIssues(honest)}`).toEqual([]);
    expect(honest.errors, `and the document passes: ${shownIssues(honest)}`).toEqual([]);
    const off = check(bin, derivativeDoc('2 * x + 0.1'), 'y = 2x + 0.1 as the derivative of y = x²');
    const failed = off.issues.filter((i) => i.code === 'fn.derivative');
    expect(failed.length, `y = 2x + 0.1 fails fn.derivative: ${shownIssues(off)}`).toBeGreaterThan(0);
    expect(failed[0]!.severity, 'the failure is an error').toBe('error');
    expect(failed[0]!.ids, 'it names the curve marked derivative_of').toContain('d');
    const x = fieldIn(failed[0]!.raw, 'x');
    expect(typeof x === 'number' && x >= SLOPES.x[0] && x <= SLOPES.x[1], `it names an x in [0, 2]: ${JSON.stringify(failed[0]!.raw).slice(0, 600)}`).toBe(true);
    // There the two curves part by more than 0.5 px: (2x + 0.1) against x²'s slope 2x, 0.1 at 100 u per unit of y is 10 u.
    const xv = x as number;
    expect(Math.abs(slopesU.y(2 * xv + 0.1) - slopesU.y(2 * xv)), 'the curves part there by more than 0.5 px').toBeGreaterThan(0.5);
  }, TIMEOUT);

  it(`${ID} a curve whose over end follows a channel draws exactly to that x at 100 sampled times`, () => {
    const bin = render();
    const doc = growDoc();
    passes(bin, doc, 'the growing curve');
    const rand = seeded(505_61);
    const times = Array.from({ length: 100 }, () => Math.floor(rand() * fl(1)));
    const drawn = geometry(bin, doc, 'grow', times.map((t) => ({ t }))).map((a, i) => fnGeometry(a, `the growing curve at ${times[i]} flicks`));
    const wrong: string[] = [];
    drawn.forEach((g, i) => {
      const t = times[i]!;
      const e = END(t);
      const all = g.subpaths.flatMap((s) => s.points);
      if (all.length === 0) { wrong.push(`t = ${t}: nothing drawn`); return; }
      const last = all[all.length - 1]!;
      const maxX = Math.max(...all.map((p) => p[0]));
      if (Math.abs(last[0] - unitU.x(e)) > 1e-4) wrong.push(`t = ${t} (end ${e}): the curve ends at x = ${last[0]} u, not ${unitU.x(e)}`);
      if (Math.abs(last[1] - unitU.y(e * e)) > 1e-4) wrong.push(`t = ${t}: the end point's y ${last[1]} u is not the curve's ${unitU.y(e * e)}`);
      if (maxX > unitU.x(e) + 1e-4) wrong.push(`t = ${t}: the curve draws past its end, to x = ${maxX} u`);
      if (Math.abs(all[0]![0] - unitU.x(0)) > 1e-4) wrong.push(`t = ${t}: the curve starts at x = ${all[0]![0]} u, not ${unitU.x(0)}`);
    });
    expect(wrong, `the curve draws exactly to the channel's x at each time:\n  ${wrong.slice(0, 20).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
