// The pixel judges, on drawn pictures and read lines: no app, no criterion tag, runnable at the base on any platform. Each
// judge AC1, AC2, AC4 and AC5 lean on must pass a right reading and fail the wrong ones, so a failure on the real app is
// the app's, not the judge's.
import { describe, expect, it } from 'vitest';
import { drawsRow, gridLaw, groundAndInk, hex, type Line, type Picture, type Rgb } from './helpers.ts';

const GROUND: Rgb = [255, 255, 255];
const FIVE: Rgb = [216, 27, 154];
const ONE: Rgb = [19, 196, 163];
const BAR: Rgb = [96, 64, 208];
type Fill = [x: number, y: number, w: number, h: number, c: Rgb];
const picture = (fills: readonly Fill[]): Picture => ({
  path: 'drawn', width: 400, height: 200,
  at: (x, y) => fills.find(([fx, fy, w, h]) => x >= fx && x < fx + w && y >= fy && y < fy + h)?.[4] as [number, number, number] | undefined ?? [...GROUND] as [number, number, number],
});
/** The fixture's fills on a grid of `w` × `h` px cells, from `(x, y)`. */
const grid = (x: number, y: number, w: number, h: number): Fill[] => [
  [x, y + h, 5 * w, h, FIVE], [x + 7 * w, y + h, w, h, ONE], [x + 10 * w, y + 2 * h, w, 2 * h, BAR],
];

describe('#1172 (judges) the grid law', () => {
  it.each([[16, 32], [18, 36], [14, 28]])('control: fills on a grid of %i × %i px cells pass, whatever the cell', (w, h) => {
    expect(gridLaw(picture(grid(10, 20, w, h)), FIVE, ONE, BAR)).toEqual([]);
  });
  it('wrong program: text with no cell fills fails, naming the tab', () => {
    expect(gridLaw(picture([]), FIVE, ONE, BAR).join('\n')).toMatch(/the terminal tab wrote its text outside the cell grid/);
  });
  it('wrong program: proportional text, whose rows end at different columns, fails, naming the tab', () => {
    const [five, one] = grid(10, 20, 16, 32);
    const out = gridLaw(picture([five!, one!, [100, 84, 16, 32, BAR], [190, 116, 16, 32, BAR]]), FIVE, ONE, BAR);
    expect(out.join('\n')).toMatch(/the terminal tab: the cell after ten "i"s/);
  });
  it('wrong program: cells of unequal width fail, naming the tab', () => {
    const [, one, bar] = grid(10, 20, 16, 32);
    expect(gridLaw(picture([[10, 52, 100, 32, FIVE], one!, bar!]), FIVE, ONE, BAR).join('\n')).toMatch(/the terminal tab: 5 cells draw 100/);
  });
});

describe('#1172 (judges) ground and ink', () => {
  it('control: the most common color is the ground and the strokes\' core its ink', () => {
    const ink: Rgb = [139, 143, 151];
    const strokes: Fill[] = [0, 1, 2, 3, 4, 5].map((i) => [20 + 20 * i, 30, 4, 20, ink]);
    const { ground, ink: read } = groundAndInk(picture(strokes), [10, 20, 200, 40]);
    expect(hex(ground)).toBe('#ffffff');
    expect(hex(read)).toBe(hex(ink));
  });
});

describe('#1172 (judges) a list row drawn on the pixels', () => {
  const question = 'Which header colour on the login page?';
  const lines = (...texts: string[]): Line[] => texts.map((text) => ({ text, box: [0, 0, 1, 1] }));
  it.each([
    ['the whole question', 'Which header colour on the login page? How it looks'],
    ['the title cut by an ellipsis, then the state word (the disputed Mac run\'s reading)', 'Which header co... How it looks'],
    ['the title cut by a single-glyph ellipsis', 'Which header colour on…  2m'],
  ])('control: %s passes', (_, text) => {
    expect(drawsRow(lines('Needs you 3', text), question)).toBe(true);
  });
  it.each([
    ['the ask\'s handle', 'ask:01MCBHM300GP83QANM5WDCWNNP How it looks'],
    ['the ask\'s kind alone', 'How it looks'],
    ['another ask\'s question, cut', 'Which font for th... How it looks'],
    ['the title clipped at the edge with no ellipsis', 'Which header colour on the lo'],
    ['fewer than the first 10 letters and digits before the ellipsis', 'Which hea... How it looks'],
    ['an ellipsis after text that isn\'t the question\'s start', 'Header colour on the login... How it looks'],
  ])('wrong program: %s fails', (_, text) => {
    expect(drawsRow(lines('Needs you 3', text), question)).toBe(false);
  });
});
