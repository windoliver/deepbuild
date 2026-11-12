// AC1 #1653.7cb93294: A text with two halos draws them under its glyphs, the wider one outermost, its glyph positions
// unchanged; a number whose widest halo passes its box fails the fit check, naming it; a halo that brings the text under
// render.contrast's minimum is refused, naming the item
//
// Through `deep-canvas-render raster` (Vello CPU, every platform; `texts.<id>.glyphs` is #381's shaped run) and `check`.
// `halo` is the text@1 field Text `text@1`: halo writes: `params.halo: [{width, role, opacity?, offset?, blur?}]`. The
// two halos are listed narrower first, so only a renderer that draws them from the outside in by width shows both
// (README: Readings). The fit check is Honest numbers' (the base's refusal `number_unfit`); the contrast minimum is
// render.contrast's default, 4.5:1 WCAG, between the text's fill and its innermost halo.
import { describe, expect, it } from 'vitest';
import {
  AC, CARD_SIZE, check, describeErrors, distanceTo, glyphsOf, haloCard, haloNumber, naming, px, rasterLine, rasterLines,
  refusalNames, render, rgbOff, role, shown, textEntry, useBin, useDir, type Rgb,
} from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-canvas-render');
const dir = useDir();

const NARROW = 4;
const WIDE = 14;
const SLACK = 1.5;
const TWO_HALOS = [{ width: NARROW, role: 'glow', opacity: 1 }, { width: WIDE, role: 'sky', opacity: 1 }];

describe(`${ID} halos on text`, () => {
  it(`${ID} a text with two halos draws them under its glyphs, the wider one outermost, its glyph positions unchanged`, () => {
    const lines = [rasterLine(dir(), haloCard('bare')), rasterLine(dir(), haloCard('two-halos', TWO_HALOS))];
    const [plain, withHalos] = rasterLines(bin(), lines, 'the halo cards');
    const own = glyphsOf(textEntry(withHalos!.answer, 'word', 'the card with halos')['glyphs'], 'texts.word.glyphs');
    expect(own, 'the halos leave the shaped run where it was: its glyphs equal the card\'s without halos').toEqual(glyphsOf(textEntry(plain!.answer, 'word', 'the bare card')['glyphs'], 'bare glyphs'));
    const bare = plain!.image; const haloed = withHalos!.image;
    const [w, h] = CARD_SIZE;
    const paper = role('paper'); const title = role('title'); const narrow = role('glow'); const wide = role('sky');
    // The glyphs: every pixel of the bare card that isn't the paper (their anti-aliased edges included).
    const glyph = (x: number, y: number): boolean => rgbOff(bare!, x, y, paper) > 2;
    const dist = distanceTo(w, h, glyph, WIDE + 6);
    // Under the glyphs: where the bare card shows the text's fill, the card with halos shows it too.
    let solid = 0; const covered: string[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (rgbOff(bare!, x, y, title) > 1) continue;
      solid += 1;
      if (rgbOff(haloed!, x, y, title) > 1) covered.push(`(${x}, ${y}) shows [${px(haloed!, x, y).slice(0, 3).join(', ')}]`);
    }
    expect(solid, 'the bare card has solid glyph pixels to compare').toBeGreaterThan(100);
    expect(covered.slice(0, 10), `the halos draw under the glyphs: a solid glyph pixel keeps the text's fill (${covered.length} don't)`).toEqual([]);
    // Both halos show; the narrow one only near the glyphs, the wide one beyond it.
    const near = NARROW + SLACK;
    const shows = (c: Rgb): number[] => { const d: number[] = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!glyph(x, y) && rgbOff(haloed!, x, y, c) <= 2) d.push(dist[y * w + x]!); return d; };
    const narrowAt = shows(narrow); const wideAt = shows(wide);
    expect(narrowAt.length, `the narrower halo (width ${NARROW}, glow) shows around the glyphs, not hidden under the wider one`).toBeGreaterThanOrEqual(30);
    const strayNarrow = narrowAt.filter((d) => d > near).length;
    expect(strayNarrow, `the narrower halo never shows farther than ${near} px from the glyphs: the wider one is outermost`).toBe(0);
    const outer = wideAt.filter((d) => d > near && Number.isFinite(d)).length;
    expect(outer, `the wider halo (width ${WIDE}, sky) shows outside the narrower one, more than ${near} px from the glyphs`).toBeGreaterThanOrEqual(30);
  });

  it(`${ID} a number whose widest halo passes its box fails the fit check, naming it`, () => {
    const lines = [haloNumber('bare'), haloNumber('near', [{ width: 2, role: 'glow' }]), haloNumber('far', [{ width: 2, role: 'glow' }, { width: 40, role: 'sky' }])].map((d) => rasterLine(dir(), d));
    const [bare, small, far] = render(bin(), 'raster', lines);
    expect(bare!['ok'], `the number fits its 40 u box on its own: ${shown(bare)}`).toBe(true);
    expect(small!['ok'], `with a 2 px halo the number still fits its box: ${shown(small)}`).toBe(true);
    expect(far!['ok'], `with a 40 px halo the widest halo passes the box, so the number doesn't fit and isn't drawn: ${shown(far)}`).toBe(false);
    expect(far!['code'], 'the refusal is the fit check\'s for a number').toBe('number_unfit');
    expect(refusalNames(far!, 'fit'), `the refusal names the number's item: ${shown(far)}`).toBe(true);
  });

  it(`${ID} a halo that brings the text under render.contrast's minimum is refused, naming the item`, () => {
    const light = check(bin(), haloCard('light-halos', TWO_HALOS));
    expect(describeErrors(light.errors), 'halos in glow and sky (7.5:1 and 6.7:1 against the text\'s fill) pass the check').toBe('none');
    const { answer, errors } = check(bin(), haloCard('dark-halo', [{ width: 4, role: 'dark', opacity: 1 }]));
    expect(answer['ok'], `a halo in dark (1.8:1 against the text's fill, under 4.5:1) is refused at check: ${describeErrors(errors)}`).toBe(false);
    expect(naming(errors, 'word'), `an error names the text: ${describeErrors(errors)}`).toBe(true);
  });
});
