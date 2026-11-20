// AC4 #1215.89bbe2ef: "第4窟" sets "4" upright, centered on the column's axis within 0.5 px. "隋1400年" turns "1400" 90°
// clockwise with `combine_upright: 2`, and with `combine_upright: 4` sets it across, scaled so its width is at most the
// column's width.
//
// `raster` draws the three texts in the clean look's `cjk` font at 64 px in `vertical_rl` and answers each glyph's
// transform (its own frame, pen on its baseline and x along its advance, to the document). A glyph's drawn advance box
// runs from the transform's image of its pen to that of (advance, 0), its advance read from the font's hmtx for the
// glyph ID and size the row reports. The column's axis is the centre of the full-width "第" and "窟" (1,000-unit
// advances). Upright is the glyph's x axis pointing right and its y axis down; turned 90° clockwise is x down and y
// left (y down on screen). The font has no `vert` or `vrt2` form for these digits (guard), so a turn is the drawing's.
// "隋1400年" sets its line height to 80 px, the column's width (README: Readings).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, none, run, useRender } from '../496/helpers.ts';
import {
  AC, at, det, drawnOf, face, featureLookups, figure, fmt, glyphOf, hAdvance, rasterLine, rowsOf, substitute, textItem, turnOf, type JsonObject, type Row,
} from './helpers.ts';

const b = useRender();
const SIZE = 64;
const COLUMN = 80;
const DIGITS = '1400';

/** The direction of a transform's own y axis in the document, degrees. */
const yAxisOf = (t: number[]): number => (Math.atan2(t[3]!, t[2]!) * 180) / Math.PI;
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
/** A glyph drawn upright: x axis right, y axis down, not mirrored. */
const upright = (r: Row): boolean => near(turnOf(r.transform), 0, 0.01) && near(yAxisOf(r.transform), 90, 0.01) && det(r.transform) > 0;
/** A glyph turned 90° clockwise: x axis down, y axis left, not mirrored. */
const turned = (r: Row): boolean => near(turnOf(r.transform), 90, 0.01) && near(Math.abs(yAxisOf(r.transform)), 180, 0.01) && det(r.transform) > 0;
/** Its drawn advance box's left and right ends along x, in document u. */
function ends(r: Row): [number, number] {
  const f = face(r.font);
  const w = (hAdvance(f, r.id) * r.size) / f.upem;
  const a = at(r.transform, [0, 0])[0]; const z = at(r.transform, [w, 0])[0];
  return [Math.min(a, z), Math.max(a, z)];
}
const centre = (r: Row): number => { const [a, z] = ends(r); return (a + z) / 2; };
const angles = (r: Row): string => `x axis at ${turnOf(r.transform).toFixed(3)}°, y axis at ${yAxisOf(r.transform).toFixed(3)}°, transform ${JSON.stringify(r.transform)}`;

/** The one glyph row of grapheme `g`, or a failure. */
function only(rows: Row[], g: number, what: string, out: string[]): Row | null {
  const own = rows.filter((r) => r.grapheme === g);
  if (own.length !== 1) { out.push(`${what}: grapheme ${g} draws ${own.length} glyphs, not one`); return null; }
  return own[0]!;
}

describe(`${AC[4]} a lone digit stands upright on the column's axis; four digits turn, or set across within the column`, () => {
  it(`${AC[4]} "4" in "第4窟" upright within 0.5 px of the axis; "1400" in "隋1400年" turned 90° clockwise at combine_upright 2 and across, no wider than the column, at 4`, () => {
    const f = face();
    const forms = [...featureLookups(f, 'vert'), ...featureLookups(f, 'vrt2')];
    for (const d of new Set(DIGITS + '4')) expect(substitute(f, forms, glyphOf(f, d)), `the fixture font has no vertical form for "${d}"`).toBe(glyphOf(f, d));

    const doc = (name: string, text: string, params: JsonObject): JsonObject =>
      figure(`ac4-${name}`, [textItem('t', text, { size: SIZE, flow: 'vertical_rl', name: true, ...params }, [200, 40])], [480, 640]);
    const [cave, two, four] = run(b.bin(), 'raster', [
      rasterLine(b.out(), 'ac4-cave', doc('cave', '第4窟', {})),
      rasterLine(b.out(), 'ac4-combine-2', doc('combine-2', `隋${DIGITS}年`, { combine_upright: 2, line_height: COLUMN })),
      rasterLine(b.out(), 'ac4-combine-4', doc('combine-4', `隋${DIGITS}年`, { combine_upright: 4, line_height: COLUMN })),
    ]);

    const failures: string[] = [];
    const caveRows = rowsOf(drawnOf(cave, '"第4窟"'), 't', '"第4窟"');
    const [di, four4, ku] = [0, 1, 2].map((g) => only(caveRows, g, '"第4窟"', failures));
    if (di && four4 && ku) {
      if (!near(centre(di), centre(ku), 0.01)) failures.push(`"第4窟": "第" and "窟" centre at ${fmt(centre(di))} and ${fmt(centre(ku))}, so the column has no one axis`);
      const axis = (centre(di) + centre(ku)) / 2;
      if (!upright(four4)) failures.push(`"第4窟": "4" isn't upright: ${angles(four4)}`);
      if (!near(centre(four4), axis, 0.5)) failures.push(`"第4窟": "4" centres at x = ${fmt(centre(four4))}, ${fmt(centre(four4) - axis)} off the column's axis at ${fmt(axis)}`);
    }

    const twoRows = rowsOf(drawnOf(two, 'combine_upright 2'), 't', 'combine_upright 2');
    [1, 2, 3, 4].forEach((g) => {
      const r = only(twoRows, g, '"隋1400年" at combine_upright 2', failures);
      if (r && !turned(r)) failures.push(`"隋1400年" at combine_upright 2: "${DIGITS[g - 1]}" (grapheme ${g}) isn't turned 90° clockwise: ${angles(r)}`);
    });

    const fourRows = rowsOf(drawnOf(four, 'combine_upright 4'), 't', 'combine_upright 4');
    const across = [1, 2, 3, 4].map((g) => only(fourRows, g, '"隋1400年" at combine_upright 4', failures));
    if (across.every((r) => r !== null)) {
      const digits = across as Row[];
      digits.forEach((r, i) => { if (!upright(r)) failures.push(`"隋1400年" at combine_upright 4: "${DIGITS[i]}" isn't set upright: ${angles(r)}`); });
      const base = digits[0]!.transform[5]!;
      digits.forEach((r, i) => { if (!near(r.transform[5]!, base, 0.01)) failures.push(`"隋1400年" at combine_upright 4: "${DIGITS[i]}" sits on a baseline at y = ${fmt(r.transform[5]!)}, not the first digit's ${fmt(base)}`); });
      for (let i = 1; i < digits.length; i++) {
        if (!(ends(digits[i]!)[0] > ends(digits[i - 1]!)[0])) failures.push(`"隋1400年" at combine_upright 4: "${DIGITS[i]}" starts at x = ${fmt(ends(digits[i]!)[0])}, not right of "${DIGITS[i - 1]}" at ${fmt(ends(digits[i - 1]!)[0])}`);
      }
      const width = Math.max(...digits.map((r) => ends(r)[1])) - Math.min(...digits.map((r) => ends(r)[0]));
      if (width > COLUMN + 0.01) failures.push(`"隋1400年" at combine_upright 4: "1400" set across is ${fmt(width)} u wide, more than the column's ${COLUMN}`);
    }
    none(failures, 'the digits in vertical_rl');
  }, TIMEOUT);
});
