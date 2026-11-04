// AC6: "A taper from 1 to 0 over the last 20% of a stroke draws widths that follow its ease within 2% at sampled
// lengths, and a width under 1 device px draws at 1 px with its alpha scaled by its width"
//
// Through `raster`. A 400 u horizontal stroke 12 u wide, butt-capped, centred on y = 60, black over white, with
// `taper {end: 80, end_width: 0, ease: 0}`: its last 80 u (20%) narrow from the full width to none along the ease;
// ease 0 is the straight ramp, w(s) = 12 × (1 − (s − 320) ÷ 80) past s = 320 (README: Readings). A pixel column's
// summed ink coverage is the width the stroke draws there (2D composites in sRGB-encoded space, so a pixel's
// coverage is (255 − value) ÷ 255), within 2% of the full width, 0.24 u. Past s = 393.3 the width is under 1 device
// px: drawn at 1 px with its alpha scaled by its width, a column still sums to the width, and no pixel in it is
// darker than that width's coverage allows (a thin end drawn opaque at 1 px, or dropped, fails).
import { describe, it } from 'vitest';
import { TIMEOUT, expectClean, figure, inkCoverage, none, pathItem, raster, scratch, useRenderBinary } from './helpers.ts';

useRenderBinary();
const dir = scratch('taper');
const W = 12;
const doc = figure('taper', [440, 120], [
  pathItem('brush', 'a0', 'M 20 60 L 420 60', { paint: { stroke: { role: 'ink', width: W, cap: 'butt', taper: { end: 80, end_width: 0, ease: 0 } } } }),
]);
/** The width the taper draws at arc length s: full, then the straight ramp to 0 over the last 80 u. */
const widthAt = (s: number): number => (s <= 320 ? W : W * (1 - (s - 320) / 80));
/** A column's summed coverage over rows 30..90, and its darkest pixel's coverage. */
function column(image: Parameters<typeof inkCoverage>[0], x: number): { sum: number; peak: number } {
  let sum = 0; let peak = 0;
  for (let y = 30; y < 90; y++) { const c = inkCoverage(image, x, y); sum += c; peak = Math.max(peak, c); }
  return { sum, peak };
}

describe('AC6 stroke taper', () => {
  it('AC6 a taper from 1 to 0 over the last 20% of a stroke draws widths that follow its ease within 2% at sampled lengths', () => {
    expectClean(doc, 'the tapered stroke');
    const { image } = raster(dir, doc, 'the tapered stroke');
    const failures: string[] = [];
    for (const s of [40.5, 160.5, 300.5, 320.5, 330.5, 340.5, 350.5, 360.5, 370.5, 380.5, 390.5]) {
      const x = 20 + s - 0.5; // the column whose centre is at arc length s
      const { sum } = column(image, x);
      const want = widthAt(s);
      if (!(Math.abs(sum - want) <= 0.02 * W)) failures.push(`at arc length ${s} u the stroke draws ${sum.toFixed(3)} u wide, not ${want.toFixed(3)} ± ${0.02 * W}`);
    }
    none(failures, 'the taper\'s widths against its ease');
  }, TIMEOUT);

  it('AC6 a width under 1 device px draws at 1 px with its alpha scaled by its width', () => {
    const { image } = raster(dir, doc, 'the tapered stroke');
    const failures: string[] = [];
    for (const s of [394.5, 395.5, 396.5, 397.5, 398.5]) {
      const x = 20 + s - 0.5;
      const want = widthAt(s); // 0.83 … 0.23 u
      const { sum, peak } = column(image, x);
      if (!(Math.abs(sum - want) <= 0.05)) failures.push(`at arc length ${s} u (width ${want.toFixed(3)} px) the column sums to ${sum.toFixed(3)}, not its width ± 0.05`);
      if (!(peak <= want + 0.05)) failures.push(`at arc length ${s} u a pixel is ${peak.toFixed(3)} covered, more than the width ${want.toFixed(3)} allows (drawn opaque, not with its alpha scaled)`);
      if (!(peak > 0)) failures.push(`at arc length ${s} u the thin end draws nothing`);
    }
    none(failures, 'the sub-pixel end');
  }, TIMEOUT);
});
