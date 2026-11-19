// AC4 #1484.f9223910: "The fit check and drawing agree on width within 0.1 px"
//
// The fit check is `deep-text fit` (#390's: `{text, font, size, weight}` in, the shaped text's `width` out, its widest
// line's advance in px). Drawing is the canvas drawing the same text as a text@1 item in the body role
// (`deep-canvas-render raster` at zoom 1, so px = u, in the shipped clean look): the run's width as drawn is the far
// edge of its last advance, the largest `x + advance` of its glyph rows. The window draws the same shaped run (one
// shaper: README, Surface choices). Four texts: the title at the opsz maximum, the label at its minimum, a size between
// at a weight no static face has, and AC7's 13 u label at 700. At the base `fit` sets a weight with no static face on
// the nearest static Inter while the canvas sets it on Inter Variable, so the last two disagree.
import { describe, expect, it } from 'vitest';
import { AC, TEXT, drawLine, drew, glyphsOf, num, run, runName, textDoc, useBin, useDir, type Item } from './helpers.ts';

const ID = AC[4];
const canvas = useBin('deep-canvas-render');
const shaper = useBin('deep-text');
const dir = useDir('deep-1484-fit-');

const CASES: Item[] = [
  { id: 'title', text: TEXT, size: 64, weight: 400, pos: [8, 8] },
  { id: 'label', text: TEXT, size: 14, weight: 400, pos: [8, 100] },
  { id: 'between', text: TEXT, size: 20, weight: 450, pos: [8, 130] },
  { id: 'bold', text: TEXT, size: 13, weight: 700, pos: [8, 170] },
];

describe(`${ID} the fit check and drawing agree on width within 0.1 px`, () => {
  it(`${ID} deep-text fit's width equals the drawn run's width within 0.1 px at 64 u, 14 u, 20 u at 450 and 13 u at 700`, () => {
    const fits = run(shaper(), ['fit'], CASES.map((t) => ({ text: t.text, font: 'body', size: t.size, weight: t.weight })));
    const [answer] = run(canvas(), ['raster'], [drawLine(dir(), textDoc('fit-1484', [560, 200], CASES), 1, 'light')]);
    drew(answer!, 'raster of the four texts');
    const rows: string[] = [];
    const problems: string[] = [];
    CASES.forEach((t, k) => {
      const fit = num(drew(fits[k]!, `deep-text fit of ${runName(t)}`)['width'], `deep-text fit of ${runName(t)}: width`);
      const glyphs = glyphsOf(answer!, t.id, 'raster');
      expect(glyphs.length, `${runName(t)} is drawn with one glyph per letter`).toBe([...t.text].length);
      const drawn = Math.max(...glyphs.map((g) => g.x + g.advance)) - Math.min(...glyphs.map((g) => g.x));
      rows.push(`${t.id} ${fit.toFixed(3)} / ${drawn.toFixed(3)}`);
      if (!(Math.abs(fit - drawn) <= 0.1)) problems.push(`${runName(t)}: the fit check measures ${fit.toFixed(3)} px and drawing ${drawn.toFixed(3)} px, ${Math.abs(fit - drawn).toFixed(3)} apart, past 0.1`);
    });
    console.log(`${ID} widths, fit / drawn, px: ${rows.join('; ')}`);
    expect(problems, 'the fit check against drawing').toEqual([]);
  }, 1_800_000);
});
