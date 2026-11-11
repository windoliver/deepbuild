// #407.2d08dfcb (AC3): "A ±5% print-wear flicker on a near-white sky over a quarter of the frame passes the flicker
// check, while a 0.15 swing of relative luminance on a mid-grey quarter of the frame four times a second fails"
// #407.a3712df9 (AC10): "A mid-grey quarter of the frame swinging 0.15 at 2 Hz (four changes a second) passes, and at
// 2 Hz in each half in counter-phase, half the frame each, it fails; a planted count of single changes fails the first
// case, and a whole-view mean passes the second and fails"
//
// Fixtures (helpers.ts), 640 × 360 films at 24 frames a second under looks built here, each judged by one requirement
// {kind: film.flicker}; the grays' relative luminance is IEC 61966-2-1's decode in linear light:
//   - skyFilm: a near-white sky (sRGB 245, Y 0.913) over the top third of the frame above a mid-grey hill (sRGB 124,
//     Y 0.202), under a look whose finish is `print_wear: {flicker: 5%}`: a gain of ±5% on linear luminance each frame,
//     so the sky swings at most 0.091, its darker frame above 0.86, and the hill at most 0.02.
//   - quarterFilm(hz): the top-left quarter (320 × 180 u) mid-grey, sRGB 124 under sRGB 160 (Y 0.202 and 0.351, a swing
//     of 0.150, the darker frame under 0.80), the upper one hidden and shown in turn every 1 ÷ (2 hz) s from 1 s to 5 s:
//     4 Hz is eight changes a second (four flashes), 2 Hz four changes (two flashes).
//   - halvesFilm(2): each half of the frame the same two grays at 2 Hz, the right half in counter-phase, so at each
//     change one half rises 0.150 as the other falls: the whole view's mean luminance never moves.
//
// asserts:
//   - AC3: the worn sky PASSes with nothing raised; the quarter at 4 Hz FAILs with a film.flash at t = 1 s (the first
//     frame of the first flash in the first second that holds more than three; within one frame).
//   - AC10: the quarter at 2 Hz PASSes; the counter-phase halves FAIL with a film.flash at t = 1 s. Planted
//     `flicker_counts_single_changes` (each change counted as a flash) fails the 2 Hz quarter's check, naming it;
//     planted `flicker_whole_view_mean` (one region, the whole view's mean) passes the halves and fails their check,
//     naming them.
import { describe, expect, it } from 'vitest';
import {
  AC, FLASH, FLICKER, FLICKER_FPS, FULL, GRAY, TIMEOUT, docId, failsNaming, failsWith, halvesFilm, judge, luminance, none, passFailures,
  quarterFilm, skyFilm, useBuilds, useFolders, type Film, type Judged, type Row,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const FRAME = 1 / FLICKER_FPS;

const asFilm = (name: string, n: number, made: (doc: string) => { document: Film['document']; stored: Buffer[] }): Film => {
  const { document, stored } = made(docId(n));
  return { name, doc: docId(n), document, stored, check: FLICKER };
};
const QUARTER_2 = 'the mid-grey quarter at 2 Hz';
const QUARTER_4 = 'the mid-grey quarter at 4 Hz';
const HALVES = 'the halves at 2 Hz in counter-phase';
const SKY = 'the worn print of a near-white sky';
const flash = (row: Row | undefined, what: string): string[] =>
  failsWith(row, FLASH, { subject: 'a flash from 1 s', match: () => true, t: 1, within: FRAME + 1e-6 }, what);
const judgeOne = (film: Film, planted?: string): Row | undefined => {
  const judged: Record<string, Judged> = judge(bin(FULL), folder(), [film], planted ? { planted } : {}).judged;
  return judged[film.name]?.row;
};

describe(`${AC[3]} the flicker check counts flashes in relative luminance with the darker frame under 0.80`, () => {
  it(`${AC[3]} a ±5% print-wear flicker on a near-white sky passes, and a 0.15 swing on a mid-grey quarter four times a second fails`, () => {
    // The fixture's own numbers.
    expect(luminance(GRAY.high) - luminance(GRAY.low)).toBeCloseTo(0.15, 2);
    expect(luminance(GRAY.high)).toBeLessThan(0.8);
    expect(0.1 * luminance(GRAY.sky)).toBeLessThan(0.1);
    expect(0.95 * luminance(GRAY.sky)).toBeGreaterThan(0.8);
    const films = [asFilm(SKY, 1, skyFilm), asFilm(QUARTER_4, 2, (d) => quarterFilm(d, 4))];
    const { judged } = judge(bin(FULL), folder(), films);
    none([...passFailures(judged[SKY]?.row, SKY), ...flash(judged[QUARTER_4]?.row, QUARTER_4)], 'the flicker check');
  }, TIMEOUT);
});

describe(`${AC[10]} flashes are counted per change of a region's pixels, never per single change or by the whole view's mean`, () => {
  const films = (): Film[] => [asFilm(QUARTER_2, 1, (d) => quarterFilm(d, 2)), asFilm(HALVES, 2, (d) => halvesFilm(d, 2))];
  const check = (rows: { quarter: Row | undefined; halves: Row | undefined }): string[] =>
    [...passFailures(rows.quarter, QUARTER_2), ...flash(rows.halves, HALVES)];

  it(`${AC[10]} a mid-grey quarter swinging 0.15 at 2 Hz passes, and the two halves at 2 Hz in counter-phase fail`, () => {
    const list = films();
    const { judged } = judge(bin(FULL), folder(), list);
    none(check({ quarter: judged[QUARTER_2]?.row, halves: judged[HALVES]?.row }), 'the flicker check');
  }, TIMEOUT);

  it(`${AC[10]} a planted count of single changes fails the 2 Hz quarter, and this check fails naming it`, () => {
    const [quarter] = films();
    failsNaming(passFailures(judgeOne(quarter!, 'flicker_counts_single_changes'), QUARTER_2), [QUARTER_2], 'the flicker check counting single changes');
  }, TIMEOUT);

  it(`${AC[10]} a planted whole-view mean passes the counter-phase halves, and this check fails naming them`, () => {
    const [, halves] = films();
    failsNaming(flash(judgeOne(halves!, 'flicker_whole_view_mean'), HALVES), [HALVES], 'the flicker check by the whole view\'s mean');
  }, TIMEOUT);
});
