// AC1 #505.968d0296 (Oracle lane): "A formula imported from the agent's SVG writes on term by term". The Oracle page
// links manim-ce a6d5cc02b4: test_creation.py's test_DrawBorderThenFill, whose control data
// (control_data/creation/DrawBorderThenFill.npz) stores every frame of a Square(fill_opacity=1) drawn outline first,
// then filled; and manim/animation/creation.py, the formula source for Write, which has no test ("for some reasons it
// appears that this function is untestable", the test file's note).
//
// What manim fixes, re-expressed here (no manim code is copied):
// - DrawBorderThenFill.interpolate_submobject: integer_interpolate(0, 2, alpha) splits a unit's progress in halves;
//   in the first the outline is drawn partially, pointwise_become_partial(outline, 0, 2·alpha), with no fill; in the
//   second the unit interpolates from the outline (fill opacity 0) to itself, so the fill's opacity is 2·alpha − 1.
// - Write: lag_ratio = min(4 ÷ max(1, n), 0.2) for n parts, rate_func linear; Animation.get_sub_alpha (animation.py,
//   same commit) gives part k the progress clip(alpha·(1 + (n − 1)·lag) − k·lag, 0, 1).
// - The control frames (fixtures/manim-draw-border-then-fill.json, decoded from the .npz with Node built-ins by
//   fixtures/extract-manim-npz.mjs): 13 frames over the run's 2 s with double_smooth; per frame its alpha, the share
//   of the whole outline drawn (lit pixels over those at alpha 0.5) and the fill's opacity at the square's center.
//
// Ours: `vector@1` imports an SVG of terms, each a `<path>` with an id in reading order (left to right, document
// order), `write_on.progress` keyed 0 → 1 linearly over 1 s (#398's form, as the #505 suite writes it), so the
// progress at t is t in seconds; `deep-canvas-render raster` draws each frame (the #505 README's surface). Measured
// in a term's own box: pixels drawn (not ground), and the fill's opacity at its center from the center pixel, ink
// over ground, read as composited in encoded sRGB (manim's, Cairo's) or in linear light, whichever fits the frames
// better (README: Choices; which space ours composites in is not this lane's question).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, GROUND, INK, TIMEOUT, countOff, document, fixture, fl, item, pixel, putStore, ramp, rasterAt, same, useRender, useTemp, type Box, type Image, type JsonObject,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('write');
const ID = AC[1];

interface Frame { frame: number; t: number; alpha: number; lit: number; share: number; opacity: number }
const CONTROL = fixture<{ frames: Frame[] }>('manim-draw-border-then-fill.json').frames;

/** An SVG of `boxes` (each [x0, y0, x1, y1] in its viewBox), one term each, ids t0, t1, … in reading order. */
function termsSvg(width: number, height: number, boxes: Box[]): Buffer {
  const paths = boxes.map(([x0, y0, x1, y1], k) => `    <path id="t${k}" d="M${x0} ${y0} H${x1} V${y1} H${x0} Z"/>`).join('\n');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n  <g fill="currentColor">\n${paths}\n  </g>\n</svg>\n`);
}
/** The formula document: the SVG at (20, 20) at scale 1 (so a viewBox unit is a u), written on over 1 s. */
const formulaDoc = (src: string, size: [number, number], alt: string): JsonObject => document('formula-505-oracle', alt, [size[0] + 40, size[1] + 40], [
  item('formula', 'vector@1', 'a0', { src, size, colors: { currentColor: 'ink' }, alt, write_on: { progress: 0, order: 'term' } }, { role: 'part', at: { pos: [20, 20, 0] } }),
], { channels: { write: ramp('items/formula/params/write_on/progress', 0, 1, 1) } });
/** A store folder for `raster` in a test's temporary folder. */
const storeIn = (dir: string): string => { const path = join(dir, 'store'); mkdirSync(path); return path; };
const grow = ([x0, y0, x1, y1]: Box, d: number): Box => [x0 - d, y0 - d, x1 + d, y1 + d];

/** sRGB's transfer function (IEC 61966-2-1), encoded 0–255 to linear. */
const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** The fill's opacity at a center pixel, ink (0) over ground (255): composited in encoded sRGB, or in linear light. */
const opacityOf = (image: Image, [x, y]: [number, number]): { encoded: number; linear: number } => {
  const p = pixel(image, x, y)[0];
  return { encoded: (255 - p) / 255, linear: 1 - toLinear(p) };
};
/** The largest miss of measured opacities against wanted ones, in the compositing space that fits them better. */
function opacityMiss(pairs: { got: { encoded: number; linear: number }; want: number; what: string }[]): { miss: number; space: string; worst: string } {
  const worstIn = (space: 'encoded' | 'linear') => pairs.reduce((w, p) => { const m = Math.abs(p.got[space] - p.want); return m > w.miss ? { miss: m, worst: `${p.what}: ${p.got[space].toFixed(4)}, want ${p.want.toFixed(4)}` } : w; }, { miss: 0, worst: '' });
  const e = worstIn('encoded'); const l = worstIn('linear');
  return e.miss <= l.miss ? { ...e, space: 'encoded sRGB' } : { ...l, space: 'linear light' };
}

/** Manim's Write timing for n parts: part k's progress at overall progress p (Animation.get_sub_alpha, linear rate). */
const lagOf = (n: number): number => Math.min(4 / Math.max(1, n), 0.2);
const progressFor = (n: number, k: number, sub: number): number => (sub + k * lagOf(n)) / (1 + (n - 1) * lagOf(n));

describe(`${ID} manim's DrawBorderThenFill and Write, run against our formula's write-on`, () => {
  it(`${ID} test_DrawBorderThenFill's 13 control frames: at each frame's alpha our one-term formula draws nothing at 0, the same share of its outline and no fill up to 0.5, then the fill at the frames' opacity, and ink at 1`, () => {
    const bin = render();
    const dir = temp();
    const store = storeIn(dir);
    // manim's Square at its test's 240p: 60 px a side; here 60 u, the term t0.
    const src = putStore(store, termsSvg(100, 100, [[20, 20, 80, 80]]));
    const doc = formulaDoc(src, [100, 100], 'a square');
    const box: Box = [40, 40, 100, 100];
    const center: [number, number] = [70, 70];
    const frames = rasterAt(bin, doc, CONTROL.map((f) => ({ t: fl(f.alpha), store })), dir, 'border-then-fill');
    const whole = countOff(frames[CONTROL.findIndex((f) => f.alpha === 0.5)]!, grow(box, 4), GROUND);
    expect(whole, 'at alpha 0.5 the whole outline is drawn').toBeGreaterThan(0);
    const wrong: string[] = [];
    const fills: { got: { encoded: number; linear: number }; want: number; what: string }[] = [];
    CONTROL.forEach((f, i) => {
      const image = frames[i]!;
      const off = countOff(image, grow(box, 4), GROUND);
      const at = `frame ${f.frame} (t ${f.t.toFixed(3)} s, alpha ${f.alpha.toFixed(4)})`;
      if (f.alpha === 0) { if (off !== 0) wrong.push(`${at}: manim draws nothing; ours draws ${off} pixels`); return; }
      if (f.alpha <= 0.5) {
        if (!same(pixel(image, ...center), GROUND)) wrong.push(`${at}: manim's center is still background (outline only); ours reads ${pixel(image, ...center).join(',')}`);
        const share = off / whole;
        if (!(Math.abs(share - f.share) <= 0.1)) wrong.push(`${at}: manim has drawn ${f.share.toFixed(3)} of its outline; ours ${share.toFixed(3)} (${off} of ${whole} pixels)`);
        return;
      }
      if (f.alpha === 1) { if (!same(pixel(image, ...center), INK)) wrong.push(`${at}: manim's fill is whole; our center reads ${pixel(image, ...center).join(',')}, not ink`); return; }
      fills.push({ got: opacityOf(image, center), want: f.opacity, what: at });
    });
    expect(wrong, wrong.join('\n')).toEqual([]);
    const { miss, space, worst } = opacityMiss(fills);
    expect(miss, `the fill's opacity at the frames past 0.5, read as composited in ${space}, against manim's center pixel; worst ${worst}`).toBeLessThanOrEqual(0.03);
  }, TIMEOUT);

  for (const n of [5, 40]) {
    it(`${ID} Write's lag at n = ${n}, min(4 ÷ n, 0.2) = ${lagOf(n)}: each term draws nothing before its start, half its outline and no fill a quarter into its span, the fill at half opacity at three quarters, and ink at its end`, () => {
      const bin = render();
      const dir = temp();
      const store = storeIn(dir);
      // n squares of 16 u in a row, 24 u apart, left to right in document order.
      const boxes: Box[] = Array.from({ length: n }, (_, k) => [24 * k + 4, 4, 24 * k + 20, 20]);
      const src = putStore(store, termsSvg(24 * n, 24, boxes));
      const doc = formulaDoc(src, [24 * n, 24], `${n} terms`);
      const inDoc = boxes.map(([x0, y0, x1, y1]): Box => [x0 + 20, y0 + 20, x1 + 20, y1 + 20]);
      const SUBS = [-0.02, 0.25, 0.5, 0.75, 1];
      const requests = inDoc.flatMap((_, k) => SUBS.map((s) => ({ t: fl(Math.max(0, progressFor(n, k, k === 0 && s < 0 ? 0 : s))), store })));
      const frames = rasterAt(bin, doc, requests, dir, `write-${n}`);
      const wrong: string[] = [];
      const fills: { got: { encoded: number; linear: number }; want: number; what: string }[] = [];
      inDoc.forEach((box, k) => {
        const [before, quarter, half, threeQuarters, end] = SUBS.map((_, j) => frames[k * SUBS.length + j]!);
        const center: [number, number] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
        const term = `term t${k} (starts at ${progressFor(n, k, 0).toFixed(4)} s, span ${(1 / (1 + (n - 1) * lagOf(n))).toFixed(4)} s)`;
        const offBefore = countOff(before!, grow(box, 3), GROUND);
        if (offBefore !== 0) wrong.push(`${term}: ${offBefore} pixels drawn before it starts`);
        const whole = countOff(half!, grow(box, 3), GROUND);
        if (whole === 0) wrong.push(`${term}: nothing drawn halfway through its span`);
        for (const [image, when] of [[quarter, 'a quarter'], [half, 'halfway']] as const) {
          if (!same(pixel(image!, ...center), GROUND)) wrong.push(`${term}: its fill is in ${when} through its span (center ${pixel(image!, ...center).join(',')}), not its outline first`);
        }
        const share = whole === 0 ? NaN : countOff(quarter!, grow(box, 3), GROUND) / whole;
        if (!(Math.abs(share - 0.5) <= 0.15)) wrong.push(`${term}: a quarter through its span it has drawn ${share.toFixed(3)} of its outline, manim's 2 × 0.25 = 0.5`);
        if (!same(pixel(end!, ...center), INK)) wrong.push(`${term}: at its span's end its center reads ${pixel(end!, ...center).join(',')}, not ink`);
        fills.push({ got: opacityOf(threeQuarters!, center), want: 0.5, what: term });
      });
      expect(wrong, wrong.slice(0, 30).join('\n')).toEqual([]);
      const { miss, space, worst } = opacityMiss(fills);
      expect(miss, `three quarters through each span the fill's opacity is manim's 2 × 0.75 − 1 = 0.5, read as composited in ${space}; worst ${worst}`).toBeLessThanOrEqual(0.05);
    }, TIMEOUT);
  }
});
