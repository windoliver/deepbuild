// AC1 #233.b6a28e06: "`math.axes {x_range: [−3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5}` with `math.plot
// {f: x^2}` puts every tick and the curve within 1 px of a stored golden Parabola, rendered once outside the repo, at
// 1920×1080"
//
// The figure (1920 × 1080 u, drawn at 1 px per u): `ax`, math.axes with the criterion's params, and `curve`, math.plot
// {axes: ax, f: "x^2"}. `deep show` presents it; its drawn form (README: Reading the expansion) goes to
// `deep-canvas-render geometry`, which answers each derived item's drawn sub-paths and each axis@1's ticks at t = 0.
// Our ticks: each derived axis@1's shown ticks (opacity > 0), each at its tick mark's place along the axis and the axis
// line's place across it (README: Reading the drawing). Our curve: the on-curve points of the plot's derived items.
// First, the ticks the criterion's ranges give: x at −3 … 3 and y at 0, 3, 6, 9.
// Then the golden (README: The golden): fixtures/parabola-golden.json, the upstream math-film library's own Axes and
// plot with these params, its tick centres and curve points converted to px of a 1920 × 1080 frame, made once outside
// this repo. Until it is stored the test is BLOCKED, never a pass. With it: every golden tick has ours of the same axis
// and value within 1 px (and ours has no other), every golden curve point lies within 1 px of our curve's polyline,
// and every point of ours within 1 px of the golden's.
// Wrong programs: the base (no math@1); a unit other than the short side ÷ 8; y kept up; the origin left at the top
// left; axes placed by their box instead of the library's rule; a curve sampled off the function.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, HERE, TIMEOUT, blocked, derivedOf, docId, drawnForm, geometryOfAll, isObject, mathDoc, none, notPresented, onCurve, present, run, scenario,
  segment, subpathsOf, tickMarks, ticksOf, useBins, useFolders, type JsonObject, type P2,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];
const GOLDEN = join(HERE, 'fixtures', 'parabola-golden.json');
const doc = mathDoc('A parabola on axes', SIZE, {
  ax: { kind: 'math.axes@1', params: { x_range: [-3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5 } },
  curve: { kind: 'math.plot@1', params: { axes: 'ax', f: 'x^2' } },
});

interface Tick { axis: 'x' | 'y'; value: number; px: P2 }
/** Our drawn ticks: every derived axis@1's shown ticks, placed at its marks along it and its line across it. */
function ourTicks(geo: Record<string, JsonObject>, items: Record<string, JsonObject>): { ticks: Tick[]; failures: string[] } {
  const failures: string[] = [];
  const ticks: Tick[] = [];
  const lines = Object.values(geo).flatMap((g) => subpathsOf(g).map(segment).filter((s): s is [P2, P2] => s !== null));
  const longest = (horizontal: boolean): number | null => {
    const ls = lines.filter(([a, b]) => (horizontal ? Math.abs(a[1] - b[1]) : Math.abs(a[0] - b[0])) <= 0.01)
      .sort((p, q) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) - Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]));
    return ls.length ? (horizontal ? ls[0]![0][1] : ls[0]![0][0]) : null;
  };
  for (const [id] of Object.entries(items).filter(([, i]) => i['kind'] === 'axis@1')) {
    const shown = ticksOf(geo[id]!).filter((t) => t.opacity > 0).map((t) => t.value).sort((a, b) => a - b);
    const h = tickMarks(geo[id]!, true); const v = tickMarks(geo[id]!, false);
    const horizontal = h.length === shown.length && h.length > 0 ? true : v.length === shown.length && v.length > 0 ? false : null;
    if (horizontal === null) { failures.push(`${id}: ${shown.length} shown ticks, but ${h.length} marks across a horizontal line and ${v.length} across a vertical one`); continue; }
    const marks = horizontal ? h : [...v].reverse(); // y grows down in u, so a vertical axis's values rise as u falls
    const cross = longest(horizontal);
    if (cross === null) { failures.push(`${id}: no axis line is drawn`); continue; }
    shown.forEach((value, k) => ticks.push({ axis: horizontal ? 'x' : 'y', value, px: horizontal ? [marks[k]!, cross] : [cross, marks[k]!] }));
  }
  return { ticks, failures };
}
function distanceToPolyline(p: P2, line: P2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i]!, line[i + 1]!];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
    const s = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy));
  }
  return line.length === 1 ? Math.hypot(p[0] - line[0]![0], p[1] - line[0]![1]) : best;
}

describe(`${AC[1]} the parabola on axes against the stored golden`, () => {
  it(`${AC[1]} every tick and the curve lie within 1 px of the golden Parabola at 1920 × 1080`, () => {
    const a = run(bin('deep-show'), scenario(folder(), [present(docId(1), doc)]));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const shown = a.replies[0]!;
    expect(notPresented(shown), 'the parabola figure is presented with no error').toBe('');
    const items = { ...derivedOf(shown, 'ax'), ...derivedOf(shown, 'curve') };
    const curveIds = Object.keys(derivedOf(shown, 'curve'));
    expect(curveIds.length, 'math.plot expands to at least one drawn item').toBeGreaterThan(0);
    const geo = geometryOfAll(bin('deep-canvas-render'), drawnForm(doc, shown), Object.keys(items));
    const ours = ourTicks(geo, items);
    none(ours.failures, 'each derived axis draws one mark per shown tick across its line');
    const values = (axis: 'x' | 'y'): number[] => ours.ticks.filter((t) => t.axis === axis).map((t) => t.value);
    expect(values('x'), 'the x axis shows a tick at each step of x_range [−3, 3, 1]').toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(values('y'), 'the y axis shows a tick at each step of y_range [0, 9, 3]').toEqual([0, 3, 6, 9]);
    const curve = curveIds.flatMap((id) => subpathsOf(geo[id]!).flatMap(onCurve));
    expect(curve.length, 'the plot draws its curve').toBeGreaterThan(1);

    if (!existsSync(GOLDEN)) {
      blocked(
        'the stored golden Parabola, tests/acceptance/233/fixtures/parabola-golden.json, is not in the repo; it must be rendered once outside it, with the upstream math-film library itself (README: The golden)',
        'run the upstream library at the oracle page\'s pin outside this repo as the README\'s "The golden" says, and commit its output as tests/acceptance/233/fixtures/parabola-golden.json',
      );
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as JsonObject;
    expect(golden['frame_px'], 'the golden is for 1920 × 1080 px').toEqual([1920, 1080]);
    const gTicks = (Array.isArray(golden['ticks']) ? golden['ticks'] : []).filter(isObject).map((t) => ({ axis: t['axis'] as 'x' | 'y', value: Number(t['value']), px: t['px'] as P2 }));
    const gCurve = (Array.isArray(golden['curve']) ? golden['curve'] : []) as P2[];
    expect(gTicks.length, 'the golden holds the ticks').toBeGreaterThan(0);
    expect(gCurve.length, 'the golden holds at least 601 curve points').toBeGreaterThanOrEqual(601);
    const failures: string[] = [];
    for (const g of gTicks) {
      const o = ours.ticks.find((t) => t.axis === g.axis && Math.abs(t.value - g.value) < 1e-9);
      if (!o) { failures.push(`the golden's ${g.axis} tick at ${g.value} has no tick of ours`); continue; }
      const d = Math.hypot(o.px[0] - g.px[0], o.px[1] - g.px[1]);
      if (d > 1) failures.push(`the ${g.axis} tick at ${g.value} is at (${o.px.map((v) => v.toFixed(2)).join(', ')}) px, ${d.toFixed(2)} px from the golden's (${g.px.join(', ')})`);
    }
    for (const o of ours.ticks) if (!gTicks.some((g) => g.axis === o.axis && Math.abs(g.value - o.value) < 1e-9)) failures.push(`our ${o.axis} tick at ${o.value} is not in the golden`);
    gCurve.forEach((p, i) => { const d = distanceToPolyline(p, curve); if (d > 1) failures.push(`the golden's curve point ${i} (${p.join(', ')}) is ${d.toFixed(2)} px from our curve`); });
    curve.forEach((p, i) => { const d = distanceToPolyline(p, gCurve); if (d > 1) failures.push(`our curve point ${i} (${p.map((v) => v.toFixed(2)).join(', ')}) is ${d.toFixed(2)} px from the golden's curve`); });
    none(failures, 'every tick and the curve within 1 px of the golden');
  }, TIMEOUT);
});
