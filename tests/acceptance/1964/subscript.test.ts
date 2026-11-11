// AC1 #1964.437d15d8: In `H2O is water` a run that makes the 2 a subscript draws it at the font's subscript offset and
// size, the glyphs before it keep the plain run's positions, and a run that names a status role is refused naming the
// run
//
// This file holds the first two clauses; refusal.test.ts holds the third. Through `deep-canvas-render raster` (Vello
// CPU, every platform): `texts.formula.glyphs` is the shaped run (#381's Glyph: font, size, id, x, y, grapheme), and the
// PNG is what was drawn. Each font role's card is drawn twice in one process: plain, and with one run `{from: 1, to: 2,
// shift: "sub"}`. The expected size and offset come from the font file the plain 2 reports, read here: size ×
// OS/2.ySubscriptYSize ÷ head.unitsPerEm, and size × OS/2.ySubscriptYOffset ÷ head.unitsPerEm below the baseline
// (README: Readings). Two faces, because Inter's own values sit within 0.01 u of the common 0.6 em and 0.075 em
// defaults, and STIX Two Math's (0.5 em, 0.25 em) don't: only a program that reads the face's own fields passes both.
import { describe, expect, it } from 'vitest';
import {
  AC, H, O, ORIGIN, SIZE, SUB_RUN, TEXT, TWO, differing, drawAll, fontFile, formula, glyphOf, inkRows,
  subscriptMetrics, useBin, useDir, type Drawn,
} from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-canvas-render');
const dir = useDir();

/** The look's font roles drawn: `body` (Inter) and `math` (STIX Two Math). */
const FONTS = ['body', 'math'] as const;
type Font = (typeof FONTS)[number];
/** Tolerances in u (a device pixel at zoom 1): README, Readings. */
const SIZE_TOL = 0.1;
const OFFSET_TOL = 0.5;
const INK_TOL = 1.5;
const SAME = 1e-3;

const pairs = new Map<Font, { plain: Drawn; sub: Drawn }>();
/** A font role's plain card and its card with the subscript run, drawn once for this file in one raster process. */
function drawn(font: Font): { plain: Drawn; sub: Drawn } {
  const known = pairs.get(font);
  if (known) return known;
  const [plain, sub] = drawAll(bin(), dir(), [formula(`${font}-plain`, font), formula(`${font}-sub`, font, [SUB_RUN])],
    [`"${TEXT}" in ${font}`, `"${TEXT}" in ${font} with the run that makes the 2 a subscript`]);
  const pair = { plain: plain!, sub: sub! };
  pairs.set(font, pair);
  return pair;
}

describe(`${ID} a subscript run in one shaped run`, () => {
  for (const font of FONTS) {
    it(`${ID} in ${font}, a run that makes the 2 a subscript draws it at the font's subscript offset and size`, () => {
      const { plain, sub } = drawn(font);
      const plain2 = glyphOf(plain.glyphs, TWO, `the plain run in ${font}`);
      const plainH = glyphOf(plain.glyphs, H, `the plain run in ${font}`);
      expect(plain2.font, `the plain 2 is set in the look's ${font} face`).toMatch(font === 'math' ? /\/STIXTwoMath-Regular\.ttf$/ : /\/Inter[-A-Za-z]*\.ttf$/);
      expect([plain2.size, plain2.y], `the plain 2 is drawn at the item's size, on the line's baseline (H's y)`).toEqual([SIZE, plainH.y]);
      const m = subscriptMetrics(plain2.font);
      const wantSize = (SIZE * m.ySubscriptYSize) / m.unitsPerEm;
      const wantOffset = (SIZE * m.ySubscriptYOffset) / m.unitsPerEm;
      const from = `${plain2.font} (head.unitsPerEm ${m.unitsPerEm}, OS/2.ySubscriptYSize ${m.ySubscriptYSize}, OS/2.ySubscriptYOffset ${m.ySubscriptYOffset})`;

      const sub2 = glyphOf(sub.glyphs, TWO, `the run with the subscript in ${font}`);
      const subH = glyphOf(sub.glyphs, H, `the run with the subscript in ${font}`);
      expect(sub2.font, `the run sets no font, so the subscript 2 stays in the item's face (${fontFile(font)}'s family)`).toBe(plain2.font);
      expect(Math.abs(sub2.size - wantSize), `the subscript 2 is drawn at ${SIZE} × ${m.ySubscriptYSize} ÷ ${m.unitsPerEm} = ${wantSize} u, the subscript size of ${from}; got ${sub2.size}`).toBeLessThanOrEqual(SIZE_TOL);
      const offset = sub2.y - subH.y;
      expect(Math.abs(offset - wantOffset), `the subscript 2's baseline sits ${SIZE} × ${m.ySubscriptYOffset} ÷ ${m.unitsPerEm} = ${wantOffset} u below the line's (H's y ${subH.y}), the subscript offset of ${from}; got ${offset}`).toBeLessThanOrEqual(OFFSET_TOL);

      // Drawn so: the 2's ink, between its pen position and the O's, against H's on the same line of the same card.
      const plainO = glyphOf(plain.glyphs, O, `the plain run in ${font}`);
      const subO = glyphOf(sub.glyphs, O, `the run with the subscript in ${font}`);
      const p2 = inkRows(plain.image, plain2.x, plainO.x, `the plain 2's columns in ${font}`);
      const pH = inkRows(plain.image, plainH.x, plain2.x, `the plain H's columns in ${font}`);
      const s2 = inkRows(sub.image, sub2.x, subO.x, `the subscript 2's columns in ${font}`);
      const sH = inkRows(sub.image, subH.x, sub2.x, `H's columns beside the subscript in ${font}`);
      const drop = (s2.bottom - sH.bottom) - (p2.bottom - pH.bottom);
      expect(Math.abs(drop - wantOffset), `the 2's ink sits ${wantOffset} px lower against H's than the plain 2's does; it sits ${drop} px lower (ink rows: plain 2 ${p2.top}–${p2.bottom}, H ${pH.bottom}; subscript 2 ${s2.top}–${s2.bottom}, H ${sH.bottom})`).toBeLessThanOrEqual(INK_TOL);
      const tall = s2.bottom - s2.top;
      const wantTall = ((p2.bottom - p2.top) * wantSize) / SIZE;
      expect(Math.abs(tall - wantTall), `the 2's ink is the plain 2's scaled by ${wantSize} ÷ ${SIZE}: ${wantTall} px tall; it is ${tall} px`).toBeLessThanOrEqual(INK_TOL);
    });

    it(`${ID} in ${font}, the glyphs before the subscript 2 keep the plain run's positions`, () => {
      const { plain, sub } = drawn(font);
      const plainH = glyphOf(plain.glyphs, H, `the plain run in ${font}`);
      const subH = glyphOf(sub.glyphs, H, `the run with the subscript in ${font}`);
      expect(Math.abs(subH.x - plainH.x), `H keeps the plain run's x ${plainH.x}; it is at ${subH.x}`).toBeLessThanOrEqual(SAME);
      expect(Math.abs(subH.y - plainH.y), `H keeps the plain run's y ${plainH.y}; it is at ${subH.y}`).toBeLessThanOrEqual(SAME);
      // Drawn so: every pixel left of the 2's pen position (one column short of it) is the plain card's.
      const x2 = Math.min(glyphOf(plain.glyphs, TWO, 'the plain run').x, glyphOf(sub.glyphs, TWO, 'the run with the subscript').x);
      const columns = Math.floor(ORIGIN[0] + x2) - 1;
      const moved = differing(plain.image, sub.image, columns);
      expect(moved.slice(0, 10), `every pixel in columns 0 to ${columns - 1} (H and the paper before the 2) is the plain card's; ${moved.length} differ`).toEqual([]);
    });
  }
});
