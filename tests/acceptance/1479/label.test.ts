// Criterion 1: a 300 u label at scale 2 draws every glyph, and its coverage holds #385's first criterion against
// Vello CPU. A planted drop fails, naming the glyph.
//
// The label (`WORD` at 300 u, 600 device px a em) is drawn at view zoom 2 by GPUI's frame path (`deep-canvas-render
// render`, the app's) and by Vello CPU (`deep-canvas-render raster`, as snapshots draw it). #385's first criterion's
// edge check for a glyph run: its coverage summed over its pixels within 2% of Vello CPU's, its coverage centroid
// within 0.1 device px. "Every glyph": each glyph's band holds at least half of Vello CPU's coverage there (README).
// `render`'s `planted: "drops_glyph"` leaves out the run's second glyph, silently. At the base the atlas returns
// nothing past 256 device px, so GPUI draws none of the four glyphs.
import { describe, expect, it } from 'vitest';
import { LABEL_SCALE, WORD, answers, glyphsOf, labelDoc, missingGlyphs, drawLine, needsMac, readFrame, runProblems, useDir, useRender } from './helpers.ts';

const bin = useRender();
const dir = useDir('deep-1479-label-');

/** The label drawn by GPUI (under `planted` when given) and by Vello CPU at scale 2: every problem the oracle finds. */
function problems(planted?: string): string[] {
  needsMac();
  const { doc, item } = labelDoc();
  const live = drawLine(dir(), doc, LABEL_SCALE, planted ? { planted } : {});
  const snap = drawLine(dir(), doc, LABEL_SCALE);
  const [g] = answers(bin(), 'render', [live]);
  const [v] = answers(bin(), 'raster', [snap]);
  const vello = readFrame(snap, v!, 'raster (Vello CPU) at scale 2');
  const gpui = readFrame(live, g!, `render (GPUI) at scale 2${planted ? ` planted ${planted}` : ''}`);
  const glyphs = glyphsOf(v!, item, 'raster');
  expect(glyphs.length, `Vello CPU's run of ${WORD} has one glyph per letter`).toBe([...WORD].length);
  return [
    ...missingGlyphs(WORD, gpui.image, vello.image, glyphs, LABEL_SCALE, 'label at scale 2'),
    ...runProblems(item, gpui.image, vello.image, 'label at scale 2'),
  ];
}

describe('C1 a 300 u label at scale 2 draws every glyph and holds #385\'s first criterion against Vello CPU', () => {
  it('C1 every glyph of the 300 u label is drawn at scale 2, and its glyph run is within 2% of Vello CPU\'s summed coverage and 0.1 device px of its centroid', () => {
    expect(problems(), 'GPUI\'s frame against Vello CPU\'s snapshot of the 600 device px label').toEqual([]);
  }, 1_800_000);

  it('C1 a planted drop of the second glyph (render planted drops_glyph) fails, naming that glyph and no other', () => {
    const found = problems('drops_glyph');
    const named = found.filter((s) => /glyph \d+ .* is missing/.test(s));
    expect(named.length, `exactly one glyph is named missing: ${JSON.stringify(found)}`).toBe(1);
    expect(named[0], 'the named glyph is the second, I').toMatch(/glyph 1 "I" \(id \d+\) is missing/);
    expect(found.some((s) => /item label:glyphs: summed coverage/.test(s)), `the run's summed coverage is more than 2% short: ${JSON.stringify(found)}`).toBe(true);
  }, 1_800_000);
});
