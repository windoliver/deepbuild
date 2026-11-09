// Criterion 2: a 40 u title zoomed 1× to 16× over 120 frames has no frame with a missing glyph.
//
// One `deep-canvas-render render` process draws the title in 120 frames, frame k at view zoom 16^(k/119) (1× to 16×,
// 40 to 640 device px a em, past the 64 px threshold at about 1.6× and the base's 256 px atlas limit at 6.4×), so the
// atlas and caches one frame leaves are the next frame's. One `raster` process draws the same 120 frames with Vello
// CPU. A frame misses a glyph when that glyph's band holds under half of Vello CPU's coverage there (README). At the
// base the view refuses a zoom above 8 and the atlas returns nothing past 256 device px, so frames from about 6.5×
// on miss every glyph.
import { describe, expect, it } from 'vitest';
import { TITLE_EM, WORD, answers, drawLine, glyphsOf, missingGlyphs, needsMac, readFrame, titleDoc, useDir, useRender, zoomAt, type JsonObject } from './helpers.ts';

const bin = useRender();
const dir = useDir('deep-1479-zoom-');
const FRAMES = 120;

describe('C2 a 40 u title zoomed 1× to 16× over 120 frames', () => {
  it('C2 no frame of the 120, from 1× to 16×, has a missing glyph', () => {
    needsMac();
    const { doc, item } = titleDoc();
    const zooms = Array.from({ length: FRAMES }, (_, k) => zoomAt(k, FRAMES));
    expect(zooms[0], 'the zoom starts at 1×').toBe(1);
    expect(zooms[FRAMES - 1], 'the zoom ends at 16×').toBeCloseTo(16, 9);
    const live: JsonObject[] = zooms.map((z) => drawLine(dir(), doc, z));
    const snap: JsonObject[] = zooms.map((z) => drawLine(dir(), doc, z));
    const g = answers(bin(), 'render', live);
    const v = answers(bin(), 'raster', snap);
    const problems: string[] = [];
    for (const [k, z] of zooms.entries()) {
      const what = `frame ${k} at ${z.toFixed(3)}× (${(TITLE_EM * z).toFixed(1)} device px a em)`;
      if (g[k]!['ok'] !== true) { problems.push(`${what}: GPUI's frame was refused: ${JSON.stringify(g[k]).slice(0, 300)}`); continue; }
      if (v[k]!['ok'] !== true) { problems.push(`${what}: Vello CPU's snapshot was refused: ${JSON.stringify(v[k]).slice(0, 300)}`); continue; }
      const vello = readFrame(snap[k]!, v[k]!, `${what}: raster`);
      const gpui = readFrame(live[k]!, g[k]!, `${what}: render`);
      const glyphs = glyphsOf(v[k]!, item, `${what}: raster`);
      expect(glyphs.length, `${what}: Vello CPU's run of ${WORD} has one glyph per letter`).toBe([...WORD].length);
      problems.push(...missingGlyphs(WORD, gpui.image, vello.image, glyphs, z, what));
    }
    expect(problems, `frames with a missing glyph (${problems.length} problems)`).toEqual([]);
  }, 3_600_000);
});
