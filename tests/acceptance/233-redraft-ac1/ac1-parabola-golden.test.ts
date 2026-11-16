// AC1 #233.b6a28e06: "`math.axes {x_range: [−3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5}` with `math.plot
// {f: x^2}` puts every tick and the curve within 1 px of a stored golden Parabola, rendered once outside the repo, at
// 1920×1080"
//
// Blind redraft of criterion 1 (README). The figure, 1920 × 1080 u drawn at 1 px per u: `ax`, math.axes with the
// criterion's params, and `curve`, math.plot {axes: ax, f: "x^2"}. `deep show` presents it; its drawn form goes to
// `deep-canvas-render geometry`, which answers each derived item's drawn sub-paths at t = 0 and each axis@1's ticks.
// Ours: each derived axis@1's shown ticks, placed by its own tick marks and line (helpers.ts `axisTicks`), and the
// plot's derived items' sub-paths, flattened, as the curve. The golden: tests/acceptance/233/fixtures/parabola-golden.json,
// the upstream math-film library's Axes and plot with these params, made once outside the repo, read as it is: its 7
// ticks (x at −3, −2, −1, 1, 2; y at 3, 6) and its 601 curve points. Judged (helpers.ts `judge`): each golden tick has
// ours on its axis at its value within 1 px; each tick of ours is at a step of its range, and one the golden leaves
// undrawn (its origin and tip ends) lies within 1 px of where the golden's axis puts that value; every golden curve
// point is within 1 px of our curve and every point of ours within 1 px of the golden's.
//
// Wrong programs it fails: the base (no math@1: the figure's instances are skipped); a math@1 unit other than the
// frame's short side ÷ 8 (135 u), such as the frame's width ÷ 16 or 100 u; y kept up (the parabola opens downward and
// every y tick mirrors); the origin left at the frame's top left; the axes' coordinate origin put at the frame's centre
// instead of their box centred, as the upstream library does (all 337.5 px low or high); y ticks on the one tick
// rule's 2 or 5 steps instead of y_range's step 3 (no tick at 3 or 6); ticks at values off the range's steps, such as
// x every 0.5; tick marks placed off their values; a curve of another f, clipped to part of x_range, or drawn as a
// coarse polyline (a 7-point polyline strays up to 34 px from the parabola); a plot that draws nothing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, derivedOf, docId, drawnForm, geometryOfAll, mathDoc, none, notPresented, present, run, scenario, useBins, useFolders,
} from '../233/helpers.ts';
import { axisTicks, flatten, judge, readGolden, type JsonValue, type Tick } from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '..', '233', 'fixtures', 'parabola-golden.json');
const RANGES = { x: [-3, 3, 1], y: [0, 9, 3] } as { x: [number, number, number]; y: [number, number, number] };
const doc = mathDoc('A parabola on axes', [1920, 1080], {
  ax: { kind: 'math.axes@1', params: { x_range: RANGES.x, y_range: RANGES.y, x_length: 8, y_length: 5 } },
  curve: { kind: 'math.plot@1', params: { axes: 'ax', f: 'x^2' } },
});

describe(`${AC[1]} the parabola on axes against the stored golden`, () => {
  it(`${AC[1]} every tick and the curve lie within 1 px of the golden Parabola at 1920 × 1080`, () => {
    const { golden, problems } = readGolden(JSON.parse(readFileSync(GOLDEN, 'utf8')) as JsonValue);
    none(problems, 'the stored golden holds a 1920 × 1080 frame, ticks on both axes and at least 601 curve points');

    const a = run(bin('deep-show'), scenario(folder(), [present(docId(1), doc)]));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const shown = a.replies[0]!;
    expect(notPresented(shown), 'the parabola figure is presented with no error and nothing skipped').toBe('');
    const axes = derivedOf(shown, 'ax');
    const plot = derivedOf(shown, 'curve');
    const axisIds = Object.keys(axes).filter((id) => axes[id]!['kind'] === 'axis@1');
    expect(axisIds.length, 'math.axes expands to an axis@1 per axis').toBe(2);
    expect(Object.keys(plot).length, 'math.plot expands to at least one drawn item').toBeGreaterThan(0);

    const geo = geometryOfAll(bin('deep-canvas-render'), drawnForm(doc, shown), [...axisIds, ...Object.keys(plot)]);
    const read = axisIds.map((id) => axisTicks(id, geo[id]!));
    none(read.map((r) => r.failure).filter((f) => f !== ''), 'each derived axis@1 draws its line and one tick mark per shown tick');
    const ours: Tick[] = read.flatMap((r) => r.ticks);
    expect(new Set(ours.map((t) => t.axis)), 'one axis runs horizontally (x) and one vertically (y)').toEqual(new Set(['x', 'y']));
    const curve = Object.keys(plot).flatMap((id) => flatten(geo[id]!));
    expect(curve.flat().length, 'the plot draws its curve').toBeGreaterThan(1);

    none(judge(golden, ours, curve, RANGES), 'every tick and the curve within 1 px of the golden Parabola');
  }, TIMEOUT);
});
