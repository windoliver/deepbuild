// AC7 #505.6af13a53 (Oracle lane, port): "y = x over [0, 1] with `color: {by: y, ramp: [a, b], domain: [0, 1]}` draws
// the stroke at x = 0.5 at a and b's OKLab midpoint within 0.001 ΔEOK".
//
// WPT 2f57f45d21, css/css-color/parsing/color-computed-color-mix-function.html (3-Clause BSD), its oklab block (lines
// 494-495, for both "" and "in oklab, "): `color-mix(in oklab, white, blue)` computes to `oklab(0.726 -0.016 -0.156)`,
// and `color-mix(in oklab, white 10%, blue)` to `oklab(0.507 -0.029 -0.28)`, each by fuzzy_test_computed_color at
// its default epsilon, 0.01 a number (css/support/color-testcommon.js, set_up_fuzzy_color_test); and its oklab()
// inputs mix to the plain mean of their coordinates (line 469: oklab(0.1 0.2 0.3) and oklab(0.5 0.6 0.7) to
// oklab(0.3 0.4 0.5)). palette 71011dee47, palette/src/oklab.rs's conversion tests (MIT OR Apache-2.0): sRGB white is
// L 1, a 0, b 0 (lightness_of_white_is_one, 1e-7), #0000ff is (0.4520137183853429, −0.03245698416876397,
// −0.3115281476783751) (blue_srgb, 1e-9), and linear red, green and blue (sRGB #ff0000, #00ff00, #0000ff: 255 is
// linear 1) are the values red(), green() and blue() take from Björn Ottosson's ok_color.h.
//
// Ours: one document, the criterion's line y = x colored by y through the ramp [a, b], and per request a look whose
// roles a and b are two of those colors (#373's role map is 8-bit sRGB). `deep-canvas-render geometry`'s `color_at`
// reads the stroke's color at x in OKLab, unrounded (the #505 README's surface). Judged: at x = 0 and 1 the stroke
// is palette's value of a and of b; at x = 0.5 it is the mean of the two (WPT's oklab rule on palette's values), all
// within the criterion's 0.001 ΔEOK; and for white and blue, at 0.5 and at 0.9 (white 10%), within WPT's 0.01 a
// coordinate of WPT's printed results.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, document, fnAt, item, look, passes, scale, stroke, useRender, type Rgb } from './helpers.ts';

const render = useRender();
const ID = AC[7];
type Lab = [number, number, number];

/** palette's reference values (oklab.rs, mod test::conversion). */
const PALETTE: Record<string, { rgb: Rgb; lab: Lab }> = {
  white: { rgb: [255, 255, 255], lab: [1, 0, 0] },
  red: { rgb: [255, 0, 0], lab: [0.6279553606145516, 0.22486306106597395, 0.1258462985307351] },
  green: { rgb: [0, 255, 0], lab: [0.8664396115356694, -0.23388757418790812, 0.17949847989672985] },
  blue: { rgb: [0, 0, 255], lab: [0.4520137183853429, -0.03245698416876397, -0.3115281476783751] },
};
/** WPT's color-mix(in oklab, …) results for white and blue: the share of blue (the ramp's value) → oklab. */
const WPT: { at: number; css: string; lab: Lab }[] = [
  { at: 0.5, css: 'color-mix(in oklab, white, blue)', lab: [0.726, -0.016, -0.156] },
  { at: 0.9, css: 'color-mix(in oklab, white 10%, blue)', lab: [0.507, -0.029, -0.28] },
];
const WPT_EPSILON = 0.01;
const deltaEok = (p: Lab, q: Lab): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const mean = (p: Lab, q: Lab): Lab => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];

const colorDoc = () => document('color-505-oracle', 'y equals x, colored by y', [480, 480], [
  scale('cx', 'a0', [0, 1], [40, 440]),
  scale('cy', 'a1', [0, 1], [440, 40]),
  item('line', 'path@1', 'b0', { fn: { y: 'x', over: [0, 1], scales: { x: 'cx', y: 'cy' } }, color: { by: 'y', ramp: ['a', 'b'], domain: [0, 1] }, paint: stroke('ink', 9) }),
]);
const PAIRS: [string, string][] = [['white', 'blue'], ['red', 'green'], ['green', 'blue'], ['blue', 'red'], ['red', 'white']];

describe(`${ID} WPT's color-mix in oklab and palette's OKLab references, as a two-role ramp read by color_at`, () => {
  it(`${ID} for ${PAIRS.map((p) => p.join('→')).join(', ')}: the stroke at x = 0 and 1 is palette's a and b, and at x = 0.5 their OKLab mean, within 0.001 ΔEOK`, () => {
    const bin = render();
    const doc = colorDoc();
    passes(bin, doc, look({ a: PALETTE['white']!.rgb, b: PALETTE['blue']!.rgb }), 'the colored line');
    const gs = fnAt(bin, doc, 'line', PAIRS.map(([a, b]) => ({ look: look({ a: PALETTE[a]!.rgb, b: PALETTE[b]!.rgb }), color_at: [0, 0.5, 1] })), 'the colored line');
    const wrong: string[] = [];
    PAIRS.forEach(([a, b], i) => {
      const got = gs[i]!.colorAt;
      if (got.length !== 3) { wrong.push(`${a}→${b}: ${got.length} colors for 3 x values`); return; }
      const want: [number, Lab][] = [[0, PALETTE[a]!.lab], [0.5, mean(PALETTE[a]!.lab, PALETTE[b]!.lab)], [1, PALETTE[b]!.lab]];
      want.forEach(([x, lab], k) => {
        const d = deltaEok(got[k]!, lab);
        if (!(d <= 0.001)) wrong.push(`${a}→${b} at x = ${x}: ${JSON.stringify(got[k])}, want ${JSON.stringify(lab)} (ΔEOK ${d.toFixed(5)})`);
      });
    });
    expect(wrong, wrong.join('\n')).toEqual([]);
  }, TIMEOUT);

  it(`${ID} white→blue: the stroke at x = 0.5 and 0.9 reads WPT's color-mix(in oklab, white, blue) and (white 10%, blue) within WPT's 0.01 a coordinate`, () => {
    const bin = render();
    const [g] = fnAt(bin, colorDoc(), 'line', [{ look: look({ a: PALETTE['white']!.rgb, b: PALETTE['blue']!.rgb }), color_at: WPT.map((w) => w.at) }], 'white→blue');
    expect(g!.colorAt.length, 'one color per x asked').toBe(WPT.length);
    WPT.forEach((w, i) => {
      const got = g!.colorAt[i]!;
      const off = Math.max(...got.map((v, k) => Math.abs(v - w.lab[k]!)));
      expect(off, `x = ${w.at}: ${JSON.stringify(got)} against WPT's ${w.css} → oklab(${w.lab.join(' ')})`).toBeLessThanOrEqual(WPT_EPSILON);
    });
  }, TIMEOUT);
});
