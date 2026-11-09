// Criterion 3: crossing the threshold moves the coverage centroid by at most 0.1 device px.
// Criterion 4: above the threshold the atlas rasterizes 0 glyphs.
//
// The threshold is the design's 64 device px a em. Each case is drawn by GPUI's frame path (`deep-canvas-render
// render`) in a process of its own, so its atlas starts empty and the frame report's `rasterized` counts every glyph
// the atlas rasterized for it, and by Vello CPU (`raster`) at the same zoom.
//
// C3: the same text at 32 u, at zoom 1.97 (63.04 device px, under the threshold: the atlas) and 2.03 (64.96 px,
// over it: outlines). On each side the offset of GPUI's coverage centroid from Vello CPU's is read; the crossing
// moves it by at most 0.1 device px. That the two sides are drawn two ways is read from the frame report: the atlas
// rasterizes glyphs under the threshold and none over it. At the base both sides draw from the atlas.
// C4: over the threshold (80, 160 and 240 device px, between the threshold and the base's 256 px atlas limit, and
// 600 px) the atlas rasterizes 0 glyphs while every glyph is drawn; under it (13 px) the same count is above 0, so
// the count counts. At the base the atlas rasterizes every glyph up to 256 px.
import { describe, expect, it } from 'vitest';
import {
  CENTROID_PX, THRESHOLD, WORD, answers, coverage, drawLine, glyphsOf, missingGlyphs, needsMac, rasterized, readFrame, textDoc, useDir, useRender,
  type Cover, type Frame, type JsonValue, type TextDoc,
} from './helpers.ts';

const bin = useRender();
const dir = useDir('deep-1479-threshold-');

/** A case drawn: both pictures, the frame report's `rasterized` as GPUI's frame answered it, and the missing glyphs. */
interface Drawn { gpui: Frame; vello: Frame; rasterized: JsonValue; missing: string[] }

/** `t` drawn at `zoom` by GPUI in a fresh process and by Vello CPU. */
function draw(t: TextDoc, zoom: number, what: string): Drawn {
  needsMac();
  const live = drawLine(dir(), t.doc, zoom);
  const snap = drawLine(dir(), t.doc, zoom);
  const [g] = answers(bin(), 'render', [live]);
  const [v] = answers(bin(), 'raster', [snap]);
  const vello = readFrame(snap, v!, `${what}: raster (Vello CPU)`);
  const gpui = readFrame(live, g!, `${what}: render (GPUI)`);
  const glyphs = glyphsOf(v!, t.item, `${what}: raster`);
  expect(glyphs.length, `${what}: Vello CPU's run of ${WORD} has one glyph per letter`).toBe([...WORD].length);
  const missing = missingGlyphs(WORD, gpui.image, vello.image, glyphs, zoom, what);
  return { gpui, vello, rasterized: g!['rasterized'] ?? null, missing };
}

const offset = (g: Cover, v: Cover): [number, number] => [g.cx - v.cx, g.cy - v.cy];

describe('C3 crossing the 64 device px threshold', () => {
  it('C3 32 u text at 63.04 and 64.96 device px: the atlas draws one side and outlines the other, and GPUI\'s coverage centroid against Vello CPU\'s moves by at most 0.1 device px', () => {
    const t = textDoc('cross-1479', WORD, 32, [180, 60]);
    const under = draw(t, 1.97, 'under the threshold, 63.04 device px');
    const over = draw(t, 2.03, 'over the threshold, 64.96 device px');
    expect(32 * 1.97 < THRESHOLD && 32 * 2.03 > THRESHOLD, 'the two sizes lie on either side of the threshold').toBe(true);
    expect(under.missing, 'every glyph is drawn under the threshold').toEqual([]);
    expect(over.missing, 'every glyph is drawn over the threshold').toEqual([]);
    expect(rasterized(under.rasterized, 'under the threshold') > 0, 'under the threshold the text draws from the atlas: its frame rasterized its glyphs').toBe(true);
    expect(rasterized(over.rasterized, 'over the threshold'), 'over the threshold the text draws from outlines: its frame rasterized 0 glyphs').toBe(0);
    const a = offset(coverage(under.gpui.image), coverage(under.vello.image));
    const b = offset(coverage(over.gpui.image), coverage(over.vello.image));
    const moved = Math.hypot(b[0] - a[0], b[1] - a[1]);
    expect(moved <= CENTROID_PX, `GPUI's centroid sits (${a[0].toFixed(3)}, ${a[1].toFixed(3)}) device px from Vello CPU's under the threshold and (${b[0].toFixed(3)}, ${b[1].toFixed(3)}) over it: the crossing moved it ${moved.toFixed(3)} device px, more than 0.1`).toBe(true);
  }, 1_800_000);
});

describe('C4 above the threshold the atlas rasterizes 0 glyphs', () => {
  it('C4 40 u text at 80, 160 and 240 device px and 300 u text at 600 device px: every glyph drawn, 0 rasterized by the atlas', () => {
    const cases: [TextDoc, number, string][] = [
      [textDoc('over-80', WORD, 40, [128, 60], [4, 2]), 2, '40 u at 2×, 80 device px'],
      [textDoc('over-160', WORD, 40, [128, 60], [4, 2]), 4, '40 u at 4×, 160 device px'],
      [textDoc('over-240', WORD, 40, [128, 60], [4, 2]), 6, '40 u at 6×, 240 device px'],
      [textDoc('over-600', WORD, 300, [920, 420]), 2, '300 u at 2×, 600 device px'],
    ];
    const problems: string[] = [];
    for (const [t, zoom, what] of cases) {
      const d = draw(t, zoom, what);
      problems.push(...d.missing);
      if (typeof d.rasterized !== 'number') problems.push(`${what}: the frame report gives no rasterized count, got ${JSON.stringify(d.rasterized)}`);
      else if (d.rasterized !== 0) problems.push(`${what}: the atlas rasterized ${d.rasterized} glyphs, not 0`);
    }
    expect(problems, 'over the threshold: every glyph drawn, none rasterized by the atlas').toEqual([]);
  }, 1_800_000);

  it('C4 under the threshold the same frame report counts the glyphs the atlas rasterized: 13 u at 1×', () => {
    const d = draw(textDoc('under-13', WORD, 13, [64, 24], [2, 2]), 1, '13 u at 1×, 13 device px');
    expect(d.missing, 'every glyph is drawn at 13 device px').toEqual([]);
    const n = rasterized(d.rasterized, '13 u at 1×');
    expect(n >= [...WORD].length, `a fresh process draws 13 px text from the atlas: it rasterized each glyph, at least the four of the word; it reports ${n}`).toBe(true);
  }, 1_800_000);
});
