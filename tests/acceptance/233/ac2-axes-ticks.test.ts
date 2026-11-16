// AC2 #233.3d899ebc: "`math.axes` expands to a `scale@1` and an `axis@1` per axis and no tick mark set; with the
// expanded x scale's domain keyed from [−3, 3] to [−5, 5] over 1 s, its ticks and their opacities equal those of a
// hand-written `axis@1` on the same scale at 20 sampled times, so entering ticks fade in; a planted expansion that keeps
// a rule mark set of ticks from computed columns fails, naming the recipe"
//
// The figure: `ax`, math.axes {x_range: [−3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5}, at 1920 × 1080.
// From `deep show`'s `expansions` (README: Reading the expansion), the judge `axesFailures` reads ax's derived items:
// exactly two scale@1 and two axis@1, each axis on one of the two scales and each scale under one axis, and no mark
// set (no marks@1 at all: README: Readings); each failure names the recipe math.axes@1 and the instance.
// Then, in the drawn form, the x scale (the derived scale@1 whose domain is [−3, 3]) has its domain's ends keyed
// linearly to [−5, 5] at 1 s, and a hand-written axis@1 `hand` on it is added; `deep-canvas-render geometry` reads the
// derived x axis@1 and `hand` at k ÷ 20 s, k = 1 … 20 (#226's sampling): at each time the shown ticks (opacity > 0)
// are equal, value for value, each opacity within 1e-6, and some tick outside [−3, 3] shows at an opacity strictly
// between 0 and 1 (an entering tick fades in).
// The second test presents the same figure under `planted: math_axes_ticks_as_marks` (README: The planted programs):
// the judge fails, naming math.axes@1.
// Wrong programs: the base (no math@1); the plant; ticks drawn by any mark set; an axis on a scale of its own.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, derivedOf, docId, drawnForm, geometry, isObject, mathDoc, none, notPresented, present, run, scenario, ticksOf, useBins,
  useFolders, type JsonObject, type P2, type Planted,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];
const RECIPE = 'math.axes@1';
const doc = mathDoc('Axes', SIZE, { ax: { kind: RECIPE, params: { x_range: [-3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5 } } });
const SAMPLES = Array.from({ length: 20 }, (_, i) => i + 1);

function presentAxes(planted?: Planted): JsonObject {
  const a = run(bin('deep-show'), scenario(folder(), [present(docId(1), doc)], planted ? { planted } : {}));
  expect(a.ok, `deep-show run accepts the scenario${planted ? ` with planted ${planted}` : ''}: ${a.why}`).toBe(true);
  expect(notPresented(a.replies[0]), `the axes figure is presented with no error${planted ? ` (planted ${planted})` : ''}`).toBe('');
  return a.replies[0]!;
}
/** What breaks "a scale@1 and an axis@1 per axis and no tick mark set", each naming the recipe and the instance. */
function axesFailures(derived: Record<string, JsonObject>): string[] {
  const at = `${RECIPE} (instance ax)`;
  const of = (kind: string): [string, JsonObject][] => Object.entries(derived).filter(([, i]) => i['kind'] === kind);
  const scales = of('scale@1'); const axes = of('axis@1'); const sets = of('marks@1');
  const out: string[] = [];
  if (scales.length !== 2) out.push(`${at} expands to ${scales.length} scale@1, not one per axis (2)`);
  if (axes.length !== 2) out.push(`${at} expands to ${axes.length} axis@1, not one per axis (2)`);
  for (const [id, set] of sets) out.push(`${at} expands to the mark set ${id} (${JSON.stringify(set['params'] ?? {}).slice(0, 200)}): its ticks come from a mark set, not from an axis@1's tick rule`);
  const on = axes.map(([, a]) => (isObject(a['params']) ? a['params']['scale'] : undefined));
  for (const [id] of scales) if (on.filter((s) => s === id).length !== 1) out.push(`${at}: the scale ${id} is under ${on.filter((s) => s === id).length} axis@1, not one`);
  return out;
}

describe(`${AC[2]} math.axes expands to scales and axes, whose ticks follow the one tick rule`, () => {
  it(`${AC[2]} a scale@1 and an axis@1 per axis and no tick mark set; under a keyed domain the x axis's ticks equal a hand-written axis@1's at 20 times, entering ticks fading in`, () => {
    const shown = presentAxes();
    const derived = derivedOf(shown, 'ax');
    none(axesFailures(derived), 'math.axes expands to one scale@1 and one axis@1 per axis and no mark set');
    const xs = Object.entries(derived).find(([, i]) => i['kind'] === 'scale@1' && isObject(i['params']) && JSON.stringify(i['params']['domain']) === '[-3,3]');
    expect(xs, `a derived scale@1 holds x_range's domain [−3, 3]: ${JSON.stringify(Object.keys(derived))}`).toBeDefined();
    const xScale = xs![0];
    const xa = Object.entries(derived).find(([, i]) => i['kind'] === 'axis@1' && isObject(i['params']) && i['params']['scale'] === xScale);
    expect(xa, `a derived axis@1 is on the x scale ${xScale}`).toBeDefined();
    const xAxis = xa![0];
    const ramp = (path: string, from: number, to: number): JsonObject => ({
      target: path, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: '1s', value: to } },
    });
    const drawn = drawnForm(doc, shown);
    const items = drawn['items'] as JsonObject;
    items['hand'] = { id: 'hand', kind: 'axis@1', layer: 'main', name: 'Hand-written axis', order: 'z9', params: { scale: xScale, side: 'bottom', at: 1000 } };
    drawn['channels'] = { ...(isObject(drawn['channels']) ? drawn['channels'] : {}), dom_lo: ramp(`items/${xScale}/params/domain/0`, -3, -5), dom_hi: ramp(`items/${xScale}/params/domain/1`, 3, 5) };
    const t = (k: number): number => Math.round((k * FLICKS) / 20);
    const answers = geometry(bin('deep-canvas-render'), SAMPLES.flatMap((k) => [{ doc: drawn, item: xAxis, t: t(k) }, { doc: drawn, item: 'hand', t: t(k) }]));
    const failures: string[] = [];
    let fades = 0;
    SAMPLES.forEach((k, i) => {
      const [mine, theirs] = [answers[2 * i]!, answers[2 * i + 1]!];
      for (const [who, ans] of [[xAxis, mine], ['hand', theirs]] as const) if (ans['code'] !== undefined) failures.push(`at ${k}/20 s ${who} is refused: ${JSON.stringify(ans).slice(0, 300)}`);
      const a = new Map(ticksOf(mine).filter((x) => x.opacity > 0).map((x) => [x.value, x.opacity]));
      const b = new Map(ticksOf(theirs).filter((x) => x.opacity > 0).map((x) => [x.value, x.opacity]));
      fades += [...b].filter(([v, o]) => Math.abs(v) > 3 && o > 0 && o < 1).length;
      for (const v of [...new Set([...a.keys(), ...b.keys()])].sort((p, q) => p - q)) {
        const [oa, ob] = [a.get(v), b.get(v)];
        if (oa === undefined || ob === undefined || Math.abs(oa - ob) > 1e-6) failures.push(`at ${k}/20 s the x tick at ${v} shows at ${oa ?? 'none'} on ${xAxis} and ${ob ?? 'none'} on the hand-written axis@1`);
      }
    });
    none(failures, 'the expanded x axis\'s ticks and opacities equal the hand-written axis@1\'s at 20 sampled times');
    expect(fades, 'some tick entering the domain (|value| > 3) shows at an opacity strictly between 0 and 1').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[2]} a planted expansion that keeps a rule mark set of ticks from computed columns fails, naming the recipe`, () => {
    const failures = axesFailures(derivedOf(presentAxes('math_axes_ticks_as_marks'), 'ax'));
    console.log(`${AC[2]} the plant's failures: ${failures.join('; ')}`);
    expect(failures.length, 'the judge fails the planted expansion').toBeGreaterThan(0);
    expect(failures.some((f) => f.includes(RECIPE) && f.includes('mark set')), `a failure names ${RECIPE} and its mark set: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
