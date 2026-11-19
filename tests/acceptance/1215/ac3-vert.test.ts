// AC3 #1215.87255816: "，" (U+FF0C), "。" (U+3002), "（" and "）" in vertical flow draw the glyph IDs the fixture font's
// `vert` lookup maps them to; the same text in horizontal flow draws the unsubstituted IDs. A planted shaper that skips
// `vert` fails, naming the character.
//
// The expected IDs are read from the font file: each character's glyph in its character map (the unsubstituted ID), and
// that glyph after the lookups of the font's `vert` feature for Han (GSUB, in lookup order); the guard checks each pair
// differs, so the test can tell them apart. `raster` draws "（敦煌，莫高窟。）" in the clean look's `cjk` font in
// `vertical_rl` and in horizontal flow, and the planted `skips_vert` in `vertical_rl`; each answer's glyph rows give the
// IDs drawn for each of the four characters' graphemes.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, none, run, useRender } from '../496/helpers.ts';
import {
  AC, CJK_FILE, PLANT, drawnOf, face, featureLookups, figure, glyphOf, hex, rasterLine, rowsOf, substitute, textItem, type JsonObject, type Row,
} from './helpers.ts';

const b = useRender();
const TEXT = '（敦煌，莫高窟。）';
const MARKS = ['，', '。', '（', '）'];

/** Each of the four marks drawn with other IDs than `expected` gives it, naming the character. */
function idFailures(rows: Row[], expected: Map<string, number>, what: string): string[] {
  const graphemes = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(TEXT)].map((s) => s.segment);
  const out: string[] = [];
  graphemes.forEach((g, i) => {
    const id = expected.get(g);
    if (id === undefined) return;
    const own = rows.filter((r) => r.grapheme === i);
    const ids = own.map((r) => r.id);
    if (ids.length !== 1 || ids[0] !== id || own[0]!.font !== CJK_FILE) {
      out.push(`"${g}" (${hex(g.codePointAt(0)!)}), grapheme ${i}, draws ${ids.length ? `glyph ${ids.join(', ')} from ${own.map((r) => r.font).join(', ')}` : 'no glyph'}, not glyph ${id} of ${CJK_FILE} (${what})`);
    }
  });
  return out;
}

describe(`${AC[3]} full-width comma, full stop and brackets take the fixture font's vert forms in vertical flow only`, () => {
  it(`${AC[3]} vertical flow draws the vert lookup's IDs, horizontal flow the unsubstituted ones; the planted skips_vert fails, naming the character`, () => {
    const f = face();
    const vert = featureLookups(f, 'vert');
    expect(vert.length, `the fixture font ${CJK_FILE} has a vert feature for Han`).toBeGreaterThan(0);
    const plain = new Map(MARKS.map((c) => [c, glyphOf(f, c)]));
    const vertical = new Map(MARKS.map((c) => [c, substitute(f, vert, plain.get(c)!)]));
    for (const c of MARKS) {
      expect(plain.get(c), `the font maps "${c}"`).not.toBe(0);
      expect(vertical.get(c), `the font's vert lookup maps "${c}" (glyph ${plain.get(c)}) to a vertical form`).not.toBe(plain.get(c));
    }

    const doc = (flow: string | null): JsonObject => figure(`ac3-${flow ?? 'horizontal'}`, [textItem('marks', TEXT, { size: 64, ...(flow ? { flow } : {}) }, [40, 40])], [720, 720]);
    const [down, across, planted] = run(b.bin(), 'raster', [
      rasterLine(b.out(), 'ac3-vertical', doc('vertical_rl')),
      rasterLine(b.out(), 'ac3-horizontal', doc(null)),
      rasterLine(b.out(), 'ac3-planted', doc('vertical_rl'), { planted: PLANT.skipsVert }),
    ]);
    none(idFailures(rowsOf(drawnOf(down, 'vertical_rl'), 'marks', 'vertical_rl'), vertical, 'the vert form'), `"${TEXT}" in vertical_rl`);
    none(idFailures(rowsOf(drawnOf(across, 'horizontal'), 'marks', 'horizontal'), plain, 'unsubstituted'), `"${TEXT}" in horizontal flow`);

    const wrong = idFailures(rowsOf(drawnOf(planted, `planted ${PLANT.skipsVert}`), 'marks', `planted ${PLANT.skipsVert}`), vertical, 'the vert form');
    expect(wrong.length, `the planted ${PLANT.skipsVert} passes the check it must fail`).toBeGreaterThan(0);
    for (const c of MARKS) expect(wrong.some((m) => m.startsWith(`"${c}"`)), `planted ${PLANT.skipsVert}: a failure names "${c}"; the failures: ${wrong.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});

