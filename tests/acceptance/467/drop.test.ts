// AC1 #467.ae875f3c: A drop on text reuses the shaped run: the copy's glyph positions equal the text's plus the offset
// exactly, and the fit check counts the copy
//
// Through `deep-canvas-render raster` (Vello CPU, every platform). `texts.<id>` (#381) gains `drop: {glyphs}`, the copy's
// glyphs in the same frame as the text's own (px from the layout box's top-left). The fit check is the one Honest
// numbers names, a number that doesn't fit fails: the base's refusal for it is `number_unfit` (README: Readings).
import { describe, expect, it } from 'vitest';
import {
  AC, card, glyphsOf, numberCard, obj, rasterAll, rasterLine, refusalNames, render, shown, textEntry, useBin, useDir,
} from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-canvas-render');
const dir = useDir();
const OFFSET: [number, number] = [7, 5];

describe(`${ID} a drop on text reuses the shaped run and counts in the fit check`, () => {
  it(`${ID} the copy's glyph positions equal the text's plus the offset exactly`, () => {
    const [plain, dropped] = rasterAll(bin(), dir(), [card('plain'), card('dropped', { drop: { offset: OFFSET, role: 'drop' } })], 'the card');
    const text = textEntry(dropped!.answer, 'word', 'the card with a drop');
    const own = glyphsOf(text['glyphs'], 'texts.word.glyphs');
    const copy = glyphsOf(obj(text['drop'], 'texts.word.drop: the copy')['glyphs'], 'texts.word.drop.glyphs');
    expect(own, 'the drop leaves the text\'s own shaped run where it was: its glyphs equal the card\'s without a drop').toEqual(glyphsOf(textEntry(plain!.answer, 'word', 'the plain card')['glyphs'], 'plain glyphs'));
    expect(copy.length, 'the copy draws the same shaped run: one glyph for each of the text\'s').toBe(own.length);
    const exact = (got: number, base: number, d: number): boolean => got === base + d || got === Math.fround(base + d);
    const off = copy.flatMap((g, i) => {
      const o = own[i]!;
      const same = g.font === o.font && g.size === o.size && g.id === o.id && g.grapheme === o.grapheme;
      return same && exact(g.x, o.x, OFFSET[0]) && exact(g.y, o.y, OFFSET[1]) ? [] : [`glyph ${i}: copy ${shown(g)}, text ${shown(o)} plus [${OFFSET.join(', ')}]`];
    });
    expect(off, 'each copy glyph is the text\'s glyph (font, size, ID, grapheme) at its position plus the offset, exactly').toEqual([]);
    const changed = dropped!.image.rgba.some((v, i) => v !== plain!.image.rgba[i]);
    expect(changed, 'the copy is drawn: the card with a drop differs from the card without').toBe(true);
  });

  it(`${ID} the fit check counts the copy: a number whose copy passes its box is refused, the same number without it draws`, () => {
    const lines = [numberCard('bare'), numberCard('near', { drop: { offset: [6, 0], role: 'drop' } }), numberCard('far', { drop: { offset: [40, 0], role: 'drop' } })].map((d) => rasterLine(dir(), d));
    const [bare, near, far] = render(bin(), 'raster', lines);
    expect(bare!['ok'], `the number fits its 30 u box on its own: ${shown(bare)}`).toBe(true);
    expect(near!['ok'], `with its copy 6 px right the number still fits its box: ${shown(near)}`).toBe(true);
    expect(far!['ok'], `with its copy 40 px right the copy passes the box's right edge, so the number doesn't fit and isn't drawn: ${shown(far)}`).toBe(false);
    expect(far!['code'], 'the refusal is the fit check\'s for a number').toBe('number_unfit');
    expect(refusalNames(far!, 'fit'), `the refusal names the number's item: ${shown(far)}`).toBe(true);
  });
});
