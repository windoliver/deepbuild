import { describe, expect, it } from 'vitest';
import {
  LOOK, coverage, coverageAt, expectClean, figure, firstDifference, raster, scratch, useRenderBinary, type Image, type JsonObject,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('stroke');

/**
 * A circle of r 20 at (60, 60) in a group scaled 3×: at (180, 180), r 60 in the document. The stroke is 4 u wide
 * as written; the group is the "parent" of the criterion. `scale_stroke` is a field of the stroke.
 */
const scaledRing = (stroke: JsonObject) => figure([400, 400], [
  { id: 'big', kind: 'group@1', params: {}, at: { scale: [3, 3, 1] } },
  { id: 'ring', kind: 'circle@1', parent: 'big', params: { center: [60, 60], r: 20, paint: { stroke: { role: 'ink', width: 4, ...stroke } } } },
]);

/** The ring's width and radius on the row through its centre (y = 180), read at the right-hand crossing near x = 240. */
function crossing(image: Image): { width: number; centre: number } {
  let sum = 0; let moment = 0;
  for (let x = 215; x < 265; x++) { const c = coverage(image, x, 180); sum += c; moment += c * (x + 0.5); }
  return { width: sum, centre: sum > 0 ? moment / sum : -1 };
}

describe('AC2 a stroke keeps its width under a parent\'s scale unless scale_stroke is true, and a dash count fits a closed circle', () => {
  it('AC2 a circle with a 4 u stroke scaled 3× by its parent keeps a 4 ± 0.1 u stroke, and 12 ± 0.1 u with scale_stroke: true', () => {
    const off = scaledRing({}); const explicitOff = scaledRing({ scale_stroke: false }); const on = scaledRing({ scale_stroke: true });
    for (const [doc, what] of [[off, 'by default'], [explicitOff, 'false'], [on, 'true']] as [JsonObject, string][]) expectClean(doc, LOOK, `scale_stroke ${what}`);

    const a = raster(dir, off, LOOK, 'scale_stroke omitted').image;
    const b = raster(dir, explicitOff, LOOK, 'scale_stroke false').image;
    const c = raster(dir, on, LOOK, 'scale_stroke true').image;
    // The parent's scale does reach the geometry: the ring's centre line is at radius 60, so its right-hand
    // crossing is centred on x = 240 (an implementation that ignores the parent's scale draws at x = 80).
    const wa = crossing(a); const wc = crossing(c);
    expect(Math.abs(wa.centre - 240), `the unscaled-stroke ring's crossing is centred at x = ${wa.centre.toFixed(2)}, not 240 (the parent's 3× scale applied to the geometry)`).toBeLessThanOrEqual(0.3);
    expect(Math.abs(wa.width - 4), `with scale_stroke omitted the stroke is ${wa.width.toFixed(3)} u wide, not 4 ± 0.1`).toBeLessThanOrEqual(0.1);
    expect(firstDifference(a, b), 'scale_stroke omitted draws what false draws').toBeNull();
    expect(Math.abs(wc.centre - 240), `the scaled-stroke ring's crossing is centred at x = ${wc.centre.toFixed(2)}, not 240`).toBeLessThanOrEqual(0.3);
    expect(Math.abs(wc.width - 12), `with scale_stroke true the stroke is ${wc.width.toFixed(3)} u wide, not 12 ± 0.1`).toBeLessThanOrEqual(0.1);
    // The left-hand crossing (near x = 120) agrees, so the width is not just the row's slice of one side.
    let left = 0; for (let x = 95; x < 145; x++) left += coverage(c, x, 180);
    expect(Math.abs(left - 12), `the left crossing with scale_stroke true is ${left.toFixed(3)} u wide`).toBeLessThanOrEqual(0.1);
  }, 300_000);

  it('AC2 count: 12 on a circle draws 12 dashes and 12 gaps of equal length within 0.5 px', () => {
    // A closed circle of r 100 at (200, 200), 8 u wide, butt caps: its centre line is 628.3 px long, so
    // 12 dashes and 12 gaps are each 2π × 100 ÷ 24 = 26.18 px long.
    const doc = figure([400, 400], [{ id: 'dashed', kind: 'circle@1', params: { center: [200, 200], r: 100, paint: { stroke: { role: 'ink', width: 8, dash: { count: 12 } } } } }]);
    expectClean(doc, LOOK, 'a circle with a dash count');
    const { image } = raster(dir, doc, LOOK, 'dash count 12');

    // Walk the centre line every 0.25 px, read its coverage bilinearly (the value of a pixel sits at its
    // centre), and find the 24 places it crosses one half, each to a fraction of a step. The phase of the
    // first dash is not the criterion's, so the lengths are the distances between neighbouring crossings.
    const R = 100; const steps = Math.round((2 * Math.PI * R) / 0.25);
    const at = (k: number): number => { const a = (2 * Math.PI * k) / steps; return coverageAt(image, 200 + R * Math.cos(a), 200 + R * Math.sin(a)); };
    const crossings: number[] = []; // arc lengths in px
    let previous = at(0);
    for (let k = 1; k <= steps; k++) {
      const value = at(k % steps);
      if ((previous >= 0.5) !== (value >= 0.5)) crossings.push(((k - 1 + (0.5 - previous) / (value - previous)) * 2 * Math.PI * R) / steps);
      previous = value;
    }
    expect(crossings.length, `12 dashes and 12 gaps make 24 edges along the centre line, found ${crossings.length}`).toBe(24);
    const wanted = (2 * Math.PI * R) / 24;
    const lengths = crossings.map((c, i) => (i + 1 < crossings.length ? crossings[i + 1]! - c : crossings[0]! + 2 * Math.PI * R - c));
    const worst = Math.max(...lengths.map((l) => Math.abs(l - wanted)));
    expect(worst, `dash and gap lengths ${lengths.map((l) => l.toFixed(2)).join(', ')} px, each within 0.5 of ${wanted.toFixed(2)}`).toBeLessThanOrEqual(0.5);
    // Dashes and gaps alternate: the coverage at the midpoint of every other interval is ink, the rest is ground.
    const mids = crossings.map((c, i) => ((c + lengths[i]! / 2) / (2 * Math.PI * R)) * steps);
    const inks = mids.map((m) => at(Math.round(m) % steps) >= 0.5);
    expect(inks.filter(Boolean).length, 'twelve of the 24 intervals are dashes').toBe(12);
    expect(inks.every((v, i) => v === (i % 2 === inks.findIndex(Boolean) % 2)), 'dashes and gaps alternate').toBe(true);
  }, 300_000);
});
