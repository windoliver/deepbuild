// AC1 #1215.711889f5: With a fixture CJK font at 1,000 units per em and a 1,000-unit vertical advance, "第4窟散花楼" at
// 64 px in `vertical_rl` gives six glyph origins sharing one x within 0.01 px, at y = 0, 64, 128, 192, 256 and 320 px
// within 0.01 px, read from the shaped run. A planted shaper that lays the run out horizontally fails, naming the second
// glyph and both positions.
//
// `raster` draws the title in the clean look's `cjk` font (the bundled Noto Sans SC) and answers its glyph rows: each
// glyph's origin `x`, `y` as the shaped run places it (README: The surface under test). The font guard reads the face
// itself: 1,000 units per em, and each of the six characters 1,000 units down in its vmtx, so the expected y's are the
// running sum of those advances at 64 px. The same check then runs on the planted `vertical_laid_horizontal`, whose run
// is laid out as horizontal text, and must fail naming glyph 1 ("4") with where it sits and where it should.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, none, run, useRender } from '../496/helpers.ts';
import { AC, CJK_FILE, PLANT, drawnOf, face, figure, fmt, glyphOf, rasterLine, rowsOf, textItem, vAdvance, type Row } from './helpers.ts';

const b = useRender();
const TEXT = '第4窟散花楼';
const SIZE = 64;

/** Where the six origins break the criterion: each glyph off the first's x or off its y, naming it and both positions. */
function originFailures(rows: Row[], ys: number[]): string[] {
  const chars = [...TEXT];
  if (rows.length !== chars.length) return [`the run has ${rows.length} glyphs, not ${chars.length}: ${rows.map((r) => `${r.grapheme}:${r.id}`).join(' ')}`];
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (r.grapheme !== i) out.push(`glyph ${i} belongs to grapheme ${r.grapheme}, not ${i}`);
    if (r.font !== CJK_FILE) out.push(`glyph ${i} (${chars[i]}) is drawn from ${r.font}, not the fixture font ${CJK_FILE}`);
  });
  const x0 = rows[0]!.x;
  rows.forEach((r, i) => {
    if (Math.abs(r.x - x0) > 0.01 || Math.abs(r.y - ys[i]!) > 0.01) {
      out.push(`glyph ${i} (${chars[i]}) sits at (${fmt(r.x)}, ${fmt(r.y)}), not (${fmt(x0)}, ${fmt(ys[i]!)}), the first glyph's x and ${fmt(ys[i]!)} down`);
    }
  });
  return out;
}

describe(`${AC[1]} "第4窟散花楼" at 64 px in vertical_rl: six origins on one x, 64 px apart from y = 0`, () => {
  it(`${AC[1]} the shaped run's six origins share one x within 0.01 px at y = 0, 64, …, 320 px; the planted horizontal layout fails, naming the second glyph and both positions`, () => {
    const f = face();
    expect(f.upem, `the fixture font ${CJK_FILE} has 1,000 units per em`).toBe(1000);
    const advances = [...TEXT].map((c) => vAdvance(f, glyphOf(f, c)) ?? NaN);
    expect(advances, 'each of the six characters advances 1,000 units in the fixture font\'s vmtx').toEqual([1000, 1000, 1000, 1000, 1000, 1000]);
    const ys = advances.map((_, i) => advances.slice(0, i).reduce((s, a) => s + (a * SIZE) / f.upem, 0));
    expect(ys, 'the expected origins, the running sum of the advances at 64 px, are the issue\'s').toEqual([0, 64, 128, 192, 256, 320]);

    const doc = figure('ac1-title', [textItem('title', TEXT, { size: SIZE, flow: 'vertical_rl', name: true }, [200, 40])], [480, 480]);
    const [right, planted] = run(b.bin(), 'raster', [
      rasterLine(b.out(), 'ac1', doc),
      rasterLine(b.out(), 'ac1-planted', doc, { planted: PLANT.horizontal }),
    ]);
    none(originFailures(rowsOf(drawnOf(right, 'the title'), 'title', 'the title'), ys), `"${TEXT}" in vertical_rl at 64 px`);

    const laid = rowsOf(drawnOf(planted, `the title under the planted ${PLANT.horizontal}`), 'title', `planted ${PLANT.horizontal}`);
    const failures = originFailures(laid, ys);
    expect(failures.length, `the planted ${PLANT.horizontal} passes the check it must fail`).toBeGreaterThan(0);
    const second = laid[1];
    expect(second, `planted ${PLANT.horizontal}: the run has a second glyph`).toBeDefined();
    const sits = `(${fmt(second!.x)}, ${fmt(second!.y)})`;
    const should = `(${fmt(laid[0]!.x)}, ${fmt(ys[1]!)})`;
    expect(failures.some((m) => m.startsWith('glyph 1 (4)') && m.includes(sits) && m.includes(should)),
      `planted ${PLANT.horizontal}: a failure names the second glyph, where it sits ${sits} and where it should ${should}; the failures: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
