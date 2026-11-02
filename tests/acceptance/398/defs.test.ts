// AC5: An SVG whose glyphs are `<use>` references into `<defs>`, as MathJax writes them, imports with each glyph
// as its own path at its drawn box, and a `currentColor` fill maps through `colors` like any other color.
// With the Oracle lane's resvg pairs for `<use>`, `<defs>` and `currentColor`, run on our import and raster.
import { describe, expect, it } from 'vitest';
import {
  boxError, codeDiff, expectClean, part, parts, perceptualProblems, pixel, put, raster, resvgDoc as resvgDocOf, reviewed, role, same, scratch,
  uniformMask, useRenderBinary, vectorDoc, vectorItem, type Part, type Pt,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('defs');

// mathjax.svg: viewBox 0 −100 300 120 drawn at size 300 × 120 from the origin, so document y = SVG y + 100. The
// glyphs sit under scale(1, −1): a glyph point (gx, gy) used through translate(tx, ty) lands at document
// (gx + tx, 100 − (gy + ty)).
const X_GLYPH: Pt[] = [[0, 0], [12, 0], [30, 24], [48, 0], [60, 0], [36, 32], [60, 64], [48, 64], [30, 40], [12, 64], [0, 64], [24, 32]];
const EQ_BARS: Pt[][] = [[[0, 0], [50, 0], [50, 8], [0, 8]], [[0, 20], [50, 20], [50, 28], [0, 28]]];
const placed = (points: Pt[], tx: number, ty: number): Pt[] => points.map(([x, y]) => [x + tx, 100 - (y + ty)]);
const EXPECT: Record<string, { subpaths: Pt[][]; box: number[] }> = {
  'term-x1': { subpaths: [placed(X_GLYPH, 20, 10)], box: [20, 26, 60, 64] },
  'term-eq': { subpaths: EQ_BARS.map((b) => placed(b, 100, 28)), box: [100, 44, 50, 28] },
  'term-x2': { subpaths: [placed(X_GLYPH, 190, 10)], box: [190, 26, 60, 64] },
};

const mathjaxDoc = (colors: Record<string, string>): ReturnType<typeof vectorDoc> =>
  vectorDoc('ac5-mathjax', [300, 120], [vectorItem('fx', { src: put(dir, 'mathjax.svg'), size: [300, 120], colors, alt: 'x = x' })]);

/** A part's corners: its M and L points, a last point repeating the first read as the closing point. */
function vertices(p: Part, i: number): Pt[] {
  const sp = p.subpaths[i]!;
  expect(sp.verbs.every((v) => v === 'M' || v === 'L' || v === 'Z'), `${p.id}: subpath ${i} is straight lines, as its glyph is (verbs ${sp.verbs.join('')})`).toBe(true);
  const pts = [...sp.points];
  const first = pts[0]!; const last = pts[pts.length - 1]!;
  if (pts.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 0.01) pts.pop();
  return pts;
}

describe('AC5 <use> into <defs> resolves at import, each glyph its own path; currentColor maps through colors', () => {
  it('AC5 each MathJax glyph imports as its own path at its drawn box: the two uses of one glyph are two paths, each where its use places it, within 0.01 u', () => {
    const doc = mathjaxDoc({ currentColor: 'accent' });
    expectClean(doc, dir, 'mathjax.svg');
    const found = parts(doc, 'fx', dir);
    for (const [id, want] of Object.entries(EXPECT)) {
      const p = part(found, id);
      expect(boxError(p.box, want.box), `${id}: box ${JSON.stringify(p.box)} against ${JSON.stringify(want.box)}`).toBeLessThanOrEqual(0.01);
      expect(p.subpaths.length, `${id}: one subpath per contour of its glyph`).toBe(want.subpaths.length);
      // Each of the glyph's contours is one closed subpath with its corners (in any order, from any start).
      want.subpaths.forEach((corners, n) => {
        const match = p.subpaths.findIndex((_, i) => {
          const got = vertices(p, i);
          return got.length === corners.length && corners.every((c) => got.some((g) => Math.hypot(g[0] - c[0], g[1] - c[1]) <= 0.01));
        });
        expect(match, `${id}: contour ${n} (${JSON.stringify(corners)}) is one of its subpaths, corner for corner within 0.01 u`).toBeGreaterThanOrEqual(0);
        expect(p.subpaths[match]!.closed, `${id}: contour ${n} is closed`).toBe(true);
      });
    }
  });

  it('AC5 a currentColor fill draws in the role colors maps it to, as any other color does, and the glyph outlines in <defs> draw nowhere themselves', () => {
    const accent = raster(dir, mathjaxDoc({ currentColor: 'accent' }), dir, 0, 'mathjax.svg, currentColor → accent');
    const ink = raster(dir, mathjaxDoc({ currentColor: 'ink' }), dir, 0, 'mathjax.svg, currentColor → ink');
    // The crossing of each x, and each bar of the equals sign; the gap between the bars is the ground.
    const filled: Pt[] = [[50, 58], [220, 58], [125, 68], [125, 48]];
    for (const [x, y] of filled) {
      expect(codeDiff(pixel(accent, x, y), role('accent')), `(${x}, ${y}) is accent when colors maps currentColor to accent`).toBeLessThanOrEqual(1);
      expect(codeDiff(pixel(ink, x, y), role('ink')), `(${x}, ${y}) is ink when colors maps currentColor to ink`).toBeLessThanOrEqual(1);
    }
    expect(same(pixel(accent, 125, 58), role('ground')), 'the gap in the equals sign is the ground').toBe(true);
    // Where the defs' own outlines would land if they were drawn in place: (0..60, 0..64) and (0..50, 0..8) in
    // SVG units, document y 100 and below.
    for (const [x, y] of [[13, 110], [25, 104]] as Pt[]) expect(same(pixel(accent, x, y), role('ground')), `(${x}, ${y}): a glyph in <defs> is not drawn in place`).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// The Oracle lane: resvg at 77b12f4951, crates/resvg/tests/tests/{structure/use, structure/defs, painting/color},
// each SVG drawn by our import and raster at its reviewed PNG's size (300 × 300 for a 200 × 200 viewBox) and held
// to that PNG, composited over the ground, through the perceptual oracle; the interior is every pixel whose 5 × 5
// neighbourhood in the PNG is one color.

const RESVG = [
  'structure/use/from-defs', 'structure/use/with-currentColor', 'structure/use/simple-case', 'structure/use/transform-attribute-1',
  'structure/use/indirect', 'structure/use/non-linear-order', 'structure/defs/ignore-shapes-inside-defs',
  'painting/color/simple-case', 'painting/color/inherit',
];
// Every color the files name, mapped to a role holding CSS's value for it, so a correct import draws the PNG's
// pixels. currentColor resolves to the `color` the files set (green); its own key maps there too.
const RV_COLORS = { green: 'rv.green', black: 'rv.black', red: 'rv.red', currentColor: 'rv.green' };

const resvgDoc = (name: string) => resvgDocOf(dir, name, RV_COLORS);

describe('AC5 (Oracle lane) resvg\'s <use>, <defs> and currentColor tests, run on our import', () => {
  for (const name of RESVG) {
    it(`AC5 resvg ${name}: imports and draws its reviewed PNG through the perceptual oracle`, () => {
      const doc = resvgDoc(name);
      expectClean(doc, dir, `resvg ${name}`);
      const ours = raster(dir, doc, dir, 0, `resvg ${name}`);
      const png = reviewed(name);
      expect(perceptualProblems(`resvg ${name}`, ours, png, uniformMask(png))).toEqual([]);
    });
  }

  it('AC5 the comparison can fail: from-defs drawn by us is held to ignore-shapes-inside-defs.png (its planted mismatch) and fails on its pixels', () => {
    const ours = raster(dir, resvgDoc('structure/use/from-defs'), dir, 0, 'resvg from-defs');
    const wrong = reviewed('structure/defs/ignore-shapes-inside-defs');
    const problems = perceptualProblems('from-defs against another test\'s PNG', ours, wrong, uniformMask(wrong));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.startsWith('BLOCKED')), problems.join('; ')).toBe(false);
  });

  it("AC5 resvg's uses keep their ids as parts at their boxes: from-defs's use1 at (20, 20, 160, 160) and simple-case's use1 at (20, 110, 160, 70), × 1.5", () => {
    for (const [name, box] of [['structure/use/from-defs', [30, 30, 240, 240]], ['structure/use/simple-case', [30, 165, 240, 105]]] as const) {
      const p = part(parts(resvgDoc(name), 'svg', dir), 'use1');
      expect(boxError(p.box, box), `${name}: use1's box ${JSON.stringify(p.box)}`).toBeLessThanOrEqual(0.01);
    }
  });
});
