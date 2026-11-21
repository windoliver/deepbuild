// AC6 #1215.9495512c: A click on the third glyph's box returns index 2, and the caret after it sits under that glyph,
// within 0.5 px.
//
// "敦煌莫高窟" at 64 px in `vertical_rl` in the clean look's `cjk` font. A first `raster` line gives the third glyph's
// transform; its box is its cell in the column, read from the font: across, its 1,000-unit advance (hmtx); down, from its
// vertical origin (VORG, above its baseline) to that plus its 1,000-unit vertical advance (vmtx). A second line asks the
// hit test at the point a quarter of the way down that box on its centre line (README: The surface under test: `hit`),
// which must answer the item and index 2, and gives the item's carets: the one after the third glyph (caret 3) must lie
// across the column at the box's bottom edge, its middle on the box's centre line, each within 0.5 px.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, none, run, show, useRender } from '../496/helpers.ts';
import { AC, CJK_FILE, at, drawnOf, face, figure, fmt, hAdvance, rasterLine, rowsOf, textItem, vAdvance, vOrigin } from './helpers.ts';

const b = useRender();
const TEXT = '敦煌莫高窟';
const SIZE = 64;

describe(`${AC[6]} a click on the third glyph of a column returns index 2, and the caret after it lies under it`, () => {
  it(`${AC[6]} the hit test at the third glyph's box answers index 2, and caret 3 sits at the box's bottom edge, centred under it, within 0.5 px`, () => {
    const doc = figure('ac6-hit', [textItem('title', TEXT, { size: SIZE, flow: 'vertical_rl' }, [240, 40])], [560, 480]);
    const [first] = run(b.bin(), 'raster', [rasterLine(b.out(), 'ac6-drawn', doc)]);
    const third = rowsOf(drawnOf(first, 'the column'), 'title', 'the column').filter((r) => r.grapheme === 2);
    expect(third.length, 'the third grapheme draws one glyph').toBe(1);
    const g = third[0]!;
    expect(g.font, 'the third glyph is drawn from the fixture font').toBe(CJK_FILE);
    const f = face();
    const k = g.size / f.upem;
    const across = hAdvance(f, g.id) * k;
    const top = -vOrigin(f, g.id)! * k;
    const bottom = top + vAdvance(f, g.id)! * k;
    expect([hAdvance(f, g.id), vAdvance(f, g.id)], 'the third glyph is 1,000 units across and down in the font').toEqual([1000, 1000]);
    const click = at(g.transform, [across / 2, top + (bottom - top) / 4]);
    const under = at(g.transform, [across / 2, bottom]);

    const [hit] = run(b.bin(), 'raster', [rasterLine(b.out(), 'ac6-hit', doc, { hit: click })]);
    const answer = drawnOf(hit, 'the hit test');
    const failures: string[] = [];
    const h = answer['hit'];
    const found = typeof h === 'object' && h !== null && !Array.isArray(h) ? h : null;
    if (!found || found['item'] !== 'title' || found['index'] !== 2) failures.push(`the click at (${fmt(click[0])}, ${fmt(click[1])}) answers hit ${show(h)}, not {item: "title", index: 2}`);
    const texts = answer['texts'];
    const title = typeof texts === 'object' && texts !== null && !Array.isArray(texts) ? texts['title'] : undefined;
    const carets = typeof title === 'object' && title !== null && !Array.isArray(title) ? title['carets'] : undefined;
    const caret = Array.isArray(carets) ? carets[3] : undefined;
    if (!Array.isArray(caret) || caret.length !== 4 || !caret.every((v) => typeof v === 'number')) {
      failures.push(`texts.title.carets[3] is ${show(caret)}, not [x0, y0, x1, y1]; carets: ${show(carets)}`);
    } else {
      const [x0, y0, x1, y1] = caret as number[];
      if (Math.abs(y0! - under[1]) > 0.5 || Math.abs(y1! - under[1]) > 0.5) failures.push(`the caret after the third glyph runs from y = ${fmt(y0!)} to ${fmt(y1!)}, not along the glyph's bottom edge at y = ${fmt(under[1])}`);
      if (Math.abs((x0! + x1!) / 2 - under[0]) > 0.5) failures.push(`the caret after the third glyph is centred at x = ${fmt((x0! + x1!) / 2)}, not under the glyph at x = ${fmt(under[0])}`);
      if (Math.abs(x1! - x0!) < 1) failures.push(`the caret after the third glyph spans ${fmt(Math.abs(x1! - x0!))} u across, not across the column`);
    }
    none(failures, 'the hit test and the caret');
  }, TIMEOUT);
});
