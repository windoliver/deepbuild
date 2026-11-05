// AC2: An SVG whose glyph groups carry the ids x and eq imports with the parts `#x` and `#eq` at their drawn
// boxes, and an SVG with a text element is refused naming the element.
import { describe, expect, it } from 'vitest';
import {
  bounds, boxError, check, errorsOf, expectClean, expectRasterRefused, flatten, listIssues, namesAsData, part, parts, pixelBox, put,
  raster, scratch, useRenderBinary, vectorDoc, vectorItem,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('parts');

// glyphs.svg: viewBox 0 0 200 100, the glyph groups under `translate(10,80) scale(1,-1)`.
//   #x:  its path spans (0..60, 0..64) in glyph units → SVG (10..70, 16..80): box (10, 16, 60, 64).
//   #eq: its bars span (0..70, 0..32) under translate(90,16) → (90..160, 16..48) → SVG (100..170, 32..64): box (100, 32, 70, 32).
// The item sits at at.pos (20, 10) with size 400 × 200 (twice the viewBox), so a document box is pos + 2 × the SVG box.
const POS: [number, number] = [20, 10];
const SCALE = 2;
const toDoc = ([x, y, w, h]: number[]): number[] => [POS[0] + SCALE * x!, POS[1] + SCALE * y!, SCALE * w!, SCALE * h!];
const BOX_X = toDoc([10, 16, 60, 64]); // [40, 42, 120, 128]
const BOX_EQ = toDoc([100, 32, 70, 32]); // [220, 74, 140, 64]
const COLORS = { '#000000': 'ink', '#cc0000': 'op' };

function glyphDoc(fixture: string): ReturnType<typeof vectorDoc> {
  const src = put(dir, fixture);
  return vectorDoc(`ac2-${fixture}`, [440, 220], [vectorItem('formula', { src, size: [400, 200], colors: COLORS, alt: 'x = ', pos: POS })]);
}

describe('AC2 glyph groups with ids become parts at their drawn boxes; a text element is refused naming it', () => {
  it('AC2 glyphs.svg imports with exactly the parts x and eq, each at its box in document u within 0.01 u, its outline inside that box', () => {
    const doc = glyphDoc('glyphs.svg');
    expectClean(doc, dir, 'glyphs.svg');
    const found = parts(doc, 'formula', dir);
    expect([...found.keys()].sort(), 'the elements with an id, and nothing else, are parts').toEqual(['eq', 'x']);
    for (const [id, want] of [['x', BOX_X], ['eq', BOX_EQ]] as const) {
      const p = part(found, id);
      expect(boxError(p.box, want), `part ${id}: box ${JSON.stringify(p.box)} against ${JSON.stringify(want)} (the SVG's transforms, the item's size and its at.pos applied)`).toBeLessThanOrEqual(0.01);
      const outline = p.subpaths.flatMap((s) => flatten(s));
      expect(outline.length, `part ${id} has an outline`).toBeGreaterThan(0);
      expect(boxError(bounds(outline), want), `part ${id}: its outline spans its box`).toBeLessThanOrEqual(0.01);
    }
    expect(part(found, 'x').subpaths.length, 'x is one closed path').toBe(1);
    expect(part(found, 'eq').subpaths.length, 'eq is its two bars').toBe(2);
  });

  it('AC2 the raster draws x in ink and eq in its mapped role exactly over those boxes (within one pixel each side)', () => {
    const doc = glyphDoc('glyphs.svg');
    const image = raster(dir, doc, dir, 0, 'glyphs.svg');
    const inkBox = pixelBox(image, (c) => c[0] < 128 && c[1] < 128 && c[2] < 128);
    const opBox = pixelBox(image, (c) => c[0] > 128 && c[1] < 100 && c[2] < 100);
    const want = (b: number[]): number[] => [b[0]!, b[1]!, b[0]! + b[2]!, b[1]! + b[3]!];
    expect(inkBox, 'x draws in ink').not.toBeNull();
    expect(opBox, 'eq draws in its role op').not.toBeNull();
    expect(boxError(inkBox!, want(BOX_X)), `x's pixels span ${JSON.stringify(inkBox)}, its box ${JSON.stringify(want(BOX_X))}`).toBeLessThanOrEqual(1);
    expect(boxError(opBox!, want(BOX_EQ)), `eq's pixels span ${JSON.stringify(opBox)}, its box ${JSON.stringify(want(BOX_EQ))}`).toBeLessThanOrEqual(1);
  });

  it('AC2 glyphs-text.svg, glyphs.svg with a <text> element, is refused naming the element with a fix, and never drawn', () => {
    const doc = glyphDoc('glyphs-text.svg');
    const result = check(doc, dir);
    const errors = errorsOf(result);
    expect(result.ok, `the check refuses it: ${JSON.stringify(listIssues(result.issues))}`).toBe(false);
    expect(errors.map((e) => e.code), 'every error is svg_text').toEqual(errors.map(() => 'svg_text'));
    expect(errors.length, 'one svg_text error').toBeGreaterThan(0);
    const e = errors[0]!;
    expect(e.ids, 'the error names the item').toContain('formula');
    expect(namesAsData(e.raw, 'text'), `the error names the element text as data (outside what and fix): ${JSON.stringify(e.raw)}`).toBe(true);
    expect(typeof e.raw['fix'] === 'string' && (e.raw['fix'] as string).length > 0, 'the error carries a fix (convert the text to outlines)').toBe(true);
    expectRasterRefused(dir, doc, dir, 'svg_text', 'the SVG holds a text element');
  });

  it("AC2 usvg's parser tests, ported: a use's and a nested path's boxes after their parents' transforms (resvg 77b12f4951, crates/usvg/tests/parser.rs)", () => {
    // use_node_abs_transform: a 100 × 100 rect in defs used through matrix(0.5, 0, 0, 0.5, 20, 30) → (20, 30, 50, 50).
    const useSrc = put(dir, 'resvg/usvg-parser/use_node_abs_transform.svg');
    const useDoc = vectorDoc('usvg-use', [200, 200], [vectorItem('svg', { src: useSrc, size: [200, 200], colors: { black: 'ink' } })]);
    expectClean(useDoc, dir, 'use_node_abs_transform');
    const use = parts(useDoc, 'svg', dir);
    expect(boxError(part(use, 'use1').box, [20, 30, 50, 50]), `use1's box ${JSON.stringify(part(use, 'use1').box)}`).toBeLessThanOrEqual(0.01);
    // path_transform_nested: `M 0 0 L 10 10` under translate(10) under translate(20) → (30, 0, 10, 10).
    const nestedSrc = put(dir, 'resvg/usvg-parser/path_transform_nested.svg');
    const nestedDoc = vectorDoc('usvg-nested', [100, 100], [vectorItem('svg', { src: nestedSrc, size: [100, 100], colors: { black: 'ink' } })]);
    expectClean(nestedDoc, dir, 'path_transform_nested');
    const nested = parts(nestedDoc, 'svg', dir);
    for (const id of ['g1', 'path1']) {
      expect(boxError(part(nested, id).box, [30, 0, 10, 10]), `${id}'s box ${JSON.stringify(part(nested, id).box)}`).toBeLessThanOrEqual(0.01);
    }
  });
});
