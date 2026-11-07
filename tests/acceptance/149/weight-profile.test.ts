// AC4 #149.fc5501aa: Line weight by light makes a circle's contour away from the light (1 + weight) times as wide as
// toward it, within 2%, and a profile tapering to 0.2 px draws at 1 px with alpha 0.2 within 5%, never vanishing.
//
// The first figure strokes a circle under a light from 135° with weight 0.6. The design's width is 1 + weight ×
// max(0, −n·l), so the side toward the light keeps its width and the side away is 1.6 times as wide. Width is read as
// the integral of the stroke layer's alpha across the contour, so edge pixels count for their coverage. The angle's
// convention is the one AC11's rims fix: 0° right, 90° up, counter-clockwise on the screen.
//
// The second is one line whose width falls linearly to 0 over its whole length (`taper_out: 1`; README: Readings), on a
// pixel row's center, so a point under 1 px lands in one row. Every column where the width is under 0.95 px is held to
// the design: one row wide, with alpha equal to the width, within 5%, down to 0.05 px, 0.2 px among them. That also runs
// the oracle page's Vello hairline rule (`filled_vertical_hairline_rect`: a 0.5 px mark inside one pixel keeps that
// pixel, with alpha scaled by its coverage) as behavior on our 2D renderer. Vello's PNG snapshots aren't compared: they
// hold a fill at alpha 0.5 in Rebecca purple, and this figure is the profile the criterion names.
//
// Wrong programs: weight on the side toward the light; a linear n·l that thins the near side; a point under 1 px dropped
// (alpha 0), widened at alpha 1, or left to fade by its own thin coverage across two rows.
import { describe, expect, it } from 'vitest';
import { AC, alphaAt, figure, layerFloats, layersCall, look, mark, none, requireMetal, runGpu, useDir, useGpu, type Floats } from './helpers.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();

/** Alpha at a continuous screen position, bilinear. */
function alpha(im: Floats, sx: number, sy: number): number {
  const x = sx - 0.5; const y = sy - 0.5; const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0;
  return (alphaAt(im, x0, y0) * (1 - fx) + alphaAt(im, x0 + 1, y0) * fx) * (1 - fy) + (alphaAt(im, x0, y0 + 1) * (1 - fx) + alphaAt(im, x0 + 1, y0 + 1) * fx) * fy;
}
const WEIGHT = 0.6;
const C = 160; const R = 110; const BASE = 10;
/** The stroke's width across the contour on the ray at `deg` (0° right, 90° up), averaged over a degree either side. */
function widthAt(im: Floats, deg: number): number {
  const widths = [-1, 0, 1].map((d) => {
    const a = ((deg + d) * Math.PI) / 180;
    let sum = 0;
    for (let r = R - 24; r <= R + 24; r += 0.125) sum += alpha(im, C + r * Math.cos(a), C - r * Math.sin(a)) * 0.125;
    return sum;
  });
  return widths.reduce((s, w) => s + w, 0) / widths.length;
}

describe(`${ID} line weight by light, and a taper under a pixel`, () => {
  it(`${ID} the contour away from the light is (1 + weight) times as wide as toward it, within 2%`, () => {
    requireMetal();
    const out = dir();
    const lk = look({ id: 'weight-149', lines: { line: { kind: 'exact', width: 2 }, contour: { kind: 'exact', width: BASE } }, light: { dir: 135, elevation: 45, weight: WEIGHT } });
    const doc = figure('weight-149', [2 * C, 2 * C], { ring: mark('ring', 'circle@1', 'a0', { center: [C, C], r: R, paint: { stroke: { role: 'ink', line: 'contour' } } }) });
    const [reply] = runGpu(bin(), out, [layersCall(doc, lk)]);
    const layer = layerFloats(out, reply!, 'main', [2 * C, 2 * C], 'the circle');
    const toward = widthAt(layer, 135); const away = widthAt(layer, 315);
    console.log(`${ID}: width toward the light ${toward.toFixed(3)} px, away ${away.toFixed(3)} px, ratio ${(away / toward).toFixed(4)}, against ${1 + WEIGHT}`);
    expect(Math.abs(toward / BASE - 1), `the side toward the light keeps its ${BASE} px, got ${toward}`).toBeLessThanOrEqual(0.02);
    expect(Math.abs(away / toward / (1 + WEIGHT) - 1), `away ÷ toward is ${1 + WEIGHT} within 2%, got ${away / toward}`).toBeLessThanOrEqual(0.02);
  });

  it(`${ID} a profile tapering to 0.2 px draws at 1 px with alpha 0.2 within 5%, and never vanishes`, () => {
    requireMetal();
    const out = dir();
    const [W, H] = [480, 64] as const;
    const [X0, LEN, Y, FULL] = [20, 440, 32, 2];
    const lk = look({ id: 'taper-149', lines: { line: { kind: 'exact', width: 2 }, fine: { kind: 'exact', width: FULL, profile: { taper_in: 0, taper_out: 1, seed: 1 } } } });
    const doc = figure('taper-149', [W, H], { tail: mark('tail', 'path@1', 'a0', { d: `M ${X0} ${Y + 0.5} L ${X0 + LEN} ${Y + 0.5}`, paint: { stroke: { role: 'ink', line: 'fine' } } }) });
    const [reply] = runGpu(bin(), out, [layersCall(doc, lk)]);
    const layer = layerFloats(out, reply!, 'main', [W, H], 'the tapered line');
    const failures: string[] = [];
    let judged = 0; let atPointTwo: number | null = null;
    for (let x = X0; x < X0 + LEN; x++) {
      const width = FULL * (1 - (x + 0.5 - X0) / LEN);
      if (width >= 0.95 || width < 0.05) continue;
      judged++;
      const onRow = alphaAt(layer, x, Y);
      if (Math.abs(width - 0.2) < FULL / LEN) atPointTwo = onRow;
      if (Math.abs(onRow - width) > 0.05 * width) failures.push(`column ${x}: width ${width.toFixed(3)} px draws at alpha ${onRow.toFixed(4)}`);
      for (const y of [Y - 2, Y - 1, Y + 1, Y + 2]) if (alphaAt(layer, x, y) > 1 / 255) failures.push(`column ${x}: the point spreads to row ${y}, alpha ${alphaAt(layer, x, y).toFixed(4)}`);
    }
    expect(judged, 'columns under 1 px are judged').toBeGreaterThan(150);
    expect(atPointTwo, 'the line reaches 0.2 px').not.toBeNull();
    console.log(`${ID}: at 0.2 px the line draws at alpha ${atPointTwo!.toFixed(4)}`);
    none(failures, 'points under 1 px off the design');
  });
});
