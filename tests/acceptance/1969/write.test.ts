// AC2 #1969.0cd379f8: "Text in write mode does the same per grapheme as #94's 3-term formula write does per term: 3
// graphemes written over 1.2 s start at 0, 6/35 and 12/35 s, and at 0.15 s the first one's outline is 0.35 drawn within
// 0.01 with no fill"
//
// Through `deep-canvas-render raster` (README: The surface under test). "ILT" in the bundled body role at 240 u, ink fill,
// no stroke, at (40, 20) of a 640 × 360 film, with `reveal: {mode: write, order: reading, progress}`, the progress keyed
// linearly from 0 at 0 s to 1 at 1.2 s; and the same text with no reveal (`still`), whose run gives each glyph's outline
// (#496's `outline` and `transform`), whose frame gives the ground and the ink.
//
// Expected, from the formula write's source the Oracle page names (its lag of min(4 ÷ n, 0.2) and lagged sub-alpha, the
// outline drawn over the first half of each part's own progress, then the fill) with the design's linear progress: n = 3,
// lag 0.2, each grapheme over 1.2 ÷ 1.4 = 6/7 s, grapheme k starting at k × 6/35 s; its outline's drawn share is
// min(1, 2 × its own progress). So at 0.15 s grapheme 1's outline is 0.35 drawn, and at 0.3 s and 0.42 s the drawn shares
// are 0.7 and 0.3, then 0.98, 0.58 and 0.18.
//
// Read from the frame (README: Readings): a grapheme's drawn share is the run of its outline, from the path's first point
// along its direction, whose pixels are ink (at least 40% of the way from the ground to the ink), read every 0.5 u, with
// nothing drawn past the run; "no fill" is every pixel inside the glyph and 6 u clear of its outline exactly the ground,
// within one code value; "draws nothing" is the glyph's box and 4 u around it within two code values of the ground, and
// "draws" is at least 10 ink pixels there. Wrong programs: a lag of 0.25 or of 4 ÷ n, units that don't overlap, a fade in
// place of the outline, a fill from the span's start, an outline drawn by share of its curves rather than its length.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, along, boundsOf, codeDiff, contoursOf, distance, drawnAt, fl, glyphsOf, inconclusive, inside, lengthOf, linear, none,
  pixel, raster, readPng, renderFilm, textItem, useBinary, useFolders, type Image, type Rgb,
} from './helpers.ts';

const render = useBinary('deep-canvas-render');
const folder = useFolders();

const N = 3;
const RUN = 1.2;
const STEP = 0.5;
const words = { text: 'ILT', font: 'body', size: 240, paint: { fill: { role: 'ink' } } };
const WRITTEN = renderFilm('ac2-write', [textItem('ilt', 'a1', { ...words, reveal: { mode: 'write', order: 'reading', progress: 0 } }, { pos: [40, 20, 0] })], {
  channels: { write: linear('items/ilt/params/reveal/progress', [[0, 0], [RUN, 1]]) },
}, '2s');
const STILL = renderFilm('ac2-still', [textItem('ilt', 'a1', words, { pos: [40, 20, 0] })], {}, '2s');
/** The progress at t seconds. */
const progress = (s: number): number => Math.min(1, Math.max(0, s / RUN));
const TIMES = [0, 0.03, 0.15, 0.165, 0.19, 0.3, 0.34, 0.36, 0.42] as const;

interface Measure { poly: [number, number][]; length: number; box: [number, number, number, number] }

describe(`${AC[2]} write mode draws each grapheme as the formula write draws each term`, () => {
  it(`${AC[2]} 3 graphemes written over 1.2 s start at 0, 6/35 and 12/35 s, each drawing its outline first, and at 0.15 s the first one's outline is 0.35 drawn within 0.01 with no fill`, () => {
    const dir = folder();
    const still = raster(render(), dir, STILL, [0]);
    const glyphs = glyphsOf(still.answers[0]!, 'ilt', 'the still text');
    expect(glyphs.map((g) => g.grapheme), 'the still run holds one glyph a grapheme, I, L and T in order').toEqual([0, 1, 2]);
    const measures: Measure[] = glyphs.map((g, k) => {
      const contours = contoursOf(g);
      if (contours.length !== 1) inconclusive(`grapheme ${k} of ILT draws ${contours.length} contours in the bundled body font, so "its outline drawn along its path" isn't one path to read`);
      const poly = contours[0]!;
      return { poly, length: lengthOf(poly), box: boundsOf(poly) };
    });
    const plain = readPng(still.pngs[0]!);
    const scale = plain.width / 640;
    const ground = pixel(plain, 2, 2);
    // The ink: what the still glyph I holds well inside its outline.
    const core = (img: Image, m: Measure, clear: number): Rgb[] => {
      const out: Rgb[] = [];
      const [x0, y0, x1, y1] = m.box;
      for (let y = Math.floor(y0 * scale); y <= Math.ceil(y1 * scale); y++) {
        for (let x = Math.floor(x0 * scale); x <= Math.ceil(x1 * scale); x++) {
          const p: [number, number] = [(x + 0.5) / scale, (y + 0.5) / scale];
          if (inside(m.poly, p) && distance(m.poly, p) >= clear) out.push(pixel(img, x, y));
        }
      }
      return out;
    };
    const inkSamples = core(plain, measures[0]!, 6);
    if (inkSamples.length < 50) inconclusive(`the glyph I at 240 u has only ${inkSamples.length} pixels 6 u clear of its outline, too few to read its fill`);
    const ink = inkSamples[Math.floor(inkSamples.length / 2)]!;
    expect(codeDiff(ink, ground), `the still text draws in ink (${ink.join(',')}) over the ground (${ground.join(',')})`).toBeGreaterThanOrEqual(64);
    const isInk = (c: Rgb): boolean => codeDiff(c, ground) >= 0.4 * codeDiff(ink, ground);

    /** The drawn share of a glyph's outline: its leading run of ink samples, and any ink drawn past that run. */
    const share = (img: Image, m: Measure): { share: number; stray: number | null } => {
      const count = Math.floor(m.length / STEP);
      const on = Array.from({ length: count }, (_, i) => {
        const [x, y] = along(m.poly, (i + 0.5) * STEP);
        return isInk(pixel(img, Math.min(img.width - 1, Math.floor(x * scale)), Math.min(img.height - 1, Math.floor(y * scale))));
      });
      let n = 0;
      while (n < count && on[n]) n++;
      const stray = on.findIndex((v, i) => v && i >= n + 4 / STEP && (i + 0.5) * STEP < m.length - 4);
      return { share: (n * STEP) / m.length, stray: stray < 0 ? null : (stray + 0.5) * STEP };
    };
    /** How many pixels of the glyph's box, and 4 u around it, are ink, and how many aren't the ground. */
    const marks = (img: Image, m: Measure): { ink: number; off: number } => {
      let inkCount = 0; let off = 0;
      const [x0, y0, x1, y1] = m.box;
      for (let y = Math.floor((y0 - 4) * scale); y <= Math.ceil((y1 + 4) * scale); y++) {
        for (let x = Math.floor((x0 - 4) * scale); x <= Math.ceil((x1 + 4) * scale); x++) {
          const c = pixel(img, x, y);
          if (isInk(c)) inkCount++;
          if (codeDiff(c, ground) > 2) off++;
        }
      }
      return { ink: inkCount, off };
    };

    const written = raster(render(), dir, WRITTEN, TIMES.map(fl));
    const frame = new Map(TIMES.map((t, i) => [t, readPng(written.pngs[i]!)]));
    const at = (t: (typeof TIMES)[number]): Image => frame.get(t)!;
    const failures: string[] = [];

    // At 0.15 s: grapheme 1's outline 0.35 drawn, one run from its first point; no fill; graphemes 2 and 3 nothing.
    const first = share(at(0.15), measures[0]!);
    if (!(Math.abs(first.share - 0.35) <= 0.01)) failures.push(`at 0.15 s grapheme 1's outline is ${first.share.toFixed(4)} drawn, not 0.35 within 0.01`);
    if (first.stray !== null) failures.push(`at 0.15 s grapheme 1's outline is drawn at ${first.stray} u along it, past its drawn run from the path's start`);
    const filled = core(at(0.15), measures[0]!, 6).filter((c) => codeDiff(c, ground) > 1);
    if (filled.length > 0) failures.push(`at 0.15 s grapheme 1 has fill: ${filled.length} pixels inside it, 6 u clear of its outline, aren't the ground (one is ${filled[0]!.join(',')})`);

    // Starts: grapheme 1 at 0 s, grapheme 2 at 6/35 s (0.1714 s), grapheme 3 at 12/35 s (0.3429 s).
    const nothing: [number, number][] = [[0, 0], [0.15, 1], [0.15, 2], [0.165, 1], [0.3, 2], [0.34, 2]];
    for (const [t, k] of nothing) {
      const m = marks(at(t as (typeof TIMES)[number]), measures[k]!);
      if (m.off > 0) failures.push(`at ${t} s grapheme ${k + 1} draws ${m.off} pixels; it starts at ${(k * 6) / 35} s`);
    }
    const something: [number, number][] = [[0.03, 0], [0.19, 1], [0.36, 2]];
    for (const [t, k] of something) {
      const m = marks(at(t as (typeof TIMES)[number]), measures[k]!);
      if (m.ink < 10) failures.push(`at ${t} s grapheme ${k + 1} draws ${m.ink} ink pixels; it started at ${(k * 6) / 35} s`);
    }

    // Each grapheme's own 6/7 s: the drawn shares at 0.3 s and 0.42 s, while every outline is still drawing.
    const shares: [number, number][] = [[0.3, 0], [0.3, 1], [0.42, 0], [0.42, 1], [0.42, 2]];
    for (const [t, k] of shares) {
      const want = drawnAt(progress(t), k, N);
      const got = share(at(t as (typeof TIMES)[number]), measures[k]!);
      if (!(Math.abs(got.share - want) <= 0.01)) failures.push(`at ${t} s grapheme ${k + 1}'s outline is ${got.share.toFixed(4)} drawn, not ${want.toFixed(2)} within 0.01`);
      if (got.stray !== null) failures.push(`at ${t} s grapheme ${k + 1}'s outline is drawn at ${got.stray} u along it, past its drawn run`);
    }
    none(failures, 'write mode draws each grapheme as the formula write draws each term');
  }, TIMEOUT);
});
