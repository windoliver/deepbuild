// AC5 #1215.3816845b: A 24-character text at 64 px with a 72 px line height, in a box 240 px wide and 512 px high, breaks
// into three columns of 8, the second column's x is the first's minus 72 px, and the fit check reports no overflow; at 400
// px high it breaks into four columns of 6, which need 288 px, and the fit check names the overflow. Breaks are the UAX
// #14 opportunities in the same order as in horizontal flow.
//
// Twenty-four Han characters (UAX #14 class ID, so a break may fall between any two) in the clean look's `cjk` font, each
// 1,000 units across and down. `raster` draws them in `vertical_rl` in the 240 × 512 and 240 × 400 boxes: a column is the
// glyphs sharing one origin x, taken right to left, read top to bottom. The same text in horizontal flow, its box as wide
// as the vertical box is high (512 and 400 u), gives the line starts the columns must start at, and `deep-text breaks`
// lists the UAX #14 opportunities they must be among. `deep-text fit` is the fit check (#390), its `width` and `height`
// the text's extent across and down (README: The surface under test): at 512 high it fits in 3 columns; at 400 it
// doesn't, in 4, and names the 288 px the columns need across the 240 px box.
import { describe, expect, it } from 'vitest';
import { accepted, TEXT_BIN, useBinaries } from '../381/helpers.ts';
import { TIMEOUT, none, run, useRender } from '../496/helpers.ts';
import { AC, drawnOf, figure, fmt, rasterLine, rowsOf, textItem, type JsonObject, type Row } from './helpers.ts';

const b = useRender();
useBinaries('deep-text');
const TEXT = '春眠不觉晓处处闻啼鸟夜来风雨声花落知多少白日依山';
const SIZE = 64;
const LINE = 72;
const WIDE = 240;

/** Runs of glyphs sharing one coordinate (x for columns, y for lines), first run first, each read along the other. */
function runsOf(rows: Row[], by: 'x' | 'y'): { at: number; graphemes: number[] }[] {
  const along = by === 'x' ? 'y' : 'x';
  const runs: { at: number; rows: Row[] }[] = [];
  for (const r of rows) {
    const run = runs.find((g) => Math.abs(g.at - r[by]) <= 0.01);
    if (run) run.rows.push(r); else runs.push({ at: r[by], rows: [r] });
  }
  // Columns of vertical_rl run right to left; lines run top to bottom.
  runs.sort((p, q) => (by === 'x' ? q.at - p.at : p.at - q.at));
  return runs.map((g) => ({ at: g.at, graphemes: g.rows.sort((p, q) => p[along] - q[along]).map((r) => r.grapheme) }));
}

/** Where the runs aren't `count` runs of `size` graphemes taking the text in order. */
function shapeFailures(runs: { graphemes: number[] }[], count: number, size: number, what: string): string[] {
  const want = Array.from({ length: count }, (_, k) => Array.from({ length: size }, (_, i) => k * size + i));
  const got = runs.map((r) => r.graphemes);
  return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${what}: graphemes by ${what.includes('column') ? 'column' : 'line'} ${JSON.stringify(got)}, not ${count} of ${size} in order ${JSON.stringify(want)}`];
}
const startsOf = (runs: { graphemes: number[] }[]): number[] => runs.slice(1).map((r) => r.graphemes[0]!);

describe(`${AC[5]} 24 Han characters in columns of 8 and of 6, 72 px apart, broken where horizontal flow breaks`, () => {
  it(`${AC[5]} three columns of 8 at 512 px high, the second 72 px left of the first, fitting; four of 6 at 400 px, needing 288 px, named by the fit check; breaks at UAX #14 opportunities as in horizontal flow`, () => {
    expect([...TEXT].length, 'the text is 24 characters').toBe(24);
    expect([...TEXT].every((c) => /\p{Script=Han}/u.test(c)), 'every character is Han').toBe(true);
    const vertical = (h: number): JsonObject => figure(`ac5-v${h}`, [textItem('t', TEXT, { size: SIZE, line_height: LINE, box: { w: WIDE, h }, flow: 'vertical_rl' }, [40, 40])], [400, 640]);
    const horizontal = (w: number): JsonObject => figure(`ac5-h${w}`, [textItem('t', TEXT, { size: SIZE, line_height: LINE, box: { w } }, [40, 40])], [640, 640]);
    const [v512, v400, h512, h400] = run(b.bin(), 'raster', [
      rasterLine(b.out(), 'ac5-v512', vertical(512)), rasterLine(b.out(), 'ac5-v400', vertical(400)),
      rasterLine(b.out(), 'ac5-h512', horizontal(512)), rasterLine(b.out(), 'ac5-h400', horizontal(400)),
    ]);
    const columns = (a: JsonObject | undefined, what: string): { at: number; graphemes: number[] }[] => runsOf(rowsOf(drawnOf(a, what), 't', what), 'x');
    const lines = (a: JsonObject | undefined, what: string): { at: number; graphemes: number[] }[] => runsOf(rowsOf(drawnOf(a, what), 't', what), 'y');
    const c512 = columns(v512, 'the 240 × 512 box'); const c400 = columns(v400, 'the 240 × 400 box');
    const l512 = lines(h512, 'horizontal flow 512 wide'); const l400 = lines(h400, 'horizontal flow 400 wide');

    const [breaks] = accepted(TEXT_BIN, ['breaks'], [{ text: TEXT }]);
    const opportunities = new Set((breaks!['breaks'] as number[]) ?? []);
    const [fits512, fits400] = accepted(TEXT_BIN, ['fit'], [512, 400].map((h) => ({ text: TEXT, size: SIZE, line_height: LINE, box: { w: WIDE, h }, flow: 'vertical_rl' })));

    const failures: string[] = [
      ...shapeFailures(c512, 3, 8, 'the 240 × 512 box\'s columns'),
      ...shapeFailures(c400, 4, 6, 'the 240 × 400 box\'s columns'),
    ];
    if (c512.length >= 2 && Math.abs(c512[1]!.at - (c512[0]!.at - LINE)) > 0.01) failures.push(`the 240 × 512 box: the second column's x is ${fmt(c512[1]!.at)}, not the first's ${fmt(c512[0]!.at)} minus ${LINE}`);
    for (const [cols, flat, what] of [[c512, l512, '512'], [c400, l400, '400']] as const) {
      const starts = startsOf(cols);
      if (JSON.stringify(starts) !== JSON.stringify(startsOf(flat))) failures.push(`the columns ${what} high start at graphemes ${JSON.stringify(starts)}, horizontal flow ${what} wide at ${JSON.stringify(startsOf(flat))}`);
      const off = starts.filter((s) => !opportunities.has(s));
      if (off.length) failures.push(`the columns ${what} high start at ${JSON.stringify(off)}, which aren't UAX #14 opportunities ${JSON.stringify([...opportunities])}`);
    }
    if (fits512!['fits'] !== true || fits512!['lines'] !== 3) failures.push(`the fit check at 240 × 512: fits ${JSON.stringify(fits512!['fits'])} in ${JSON.stringify(fits512!['lines'])} columns, not true in 3: ${JSON.stringify(fits512)}`);
    const need = typeof fits400!['width'] === 'number' ? (fits400!['width'] as number) : NaN;
    if (fits400!['fits'] !== false || fits400!['lines'] !== 4 || !(Math.abs(need - 4 * LINE) <= 0.01)) {
      failures.push(`the fit check at 240 × 400: fits ${JSON.stringify(fits400!['fits'])} in ${JSON.stringify(fits400!['lines'])} columns needing ${JSON.stringify(fits400!['width'])} px across, not false in 4 needing ${4 * LINE}: ${JSON.stringify(fits400)}`);
    }
    none(failures, 'the columns, their breaks and the fit check');
  }, TIMEOUT);
});
