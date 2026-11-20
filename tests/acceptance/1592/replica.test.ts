// AC1, AC2 and AC3: the icons and status marks the shipped pages draw, read from the replica's snapshot and pictures
// (README, Pinned 1, 2 and 5) over the fixture record, and each planted wrong program the criterion names failing the
// same judge. Each plant's test holds the clean run to the judge first, so a program that already fails can't make its
// plant look caught; a plant the build ignores fails as "wasn't caught".
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, ENTRIES, NEEDS_YOU, PLANT, SESSION_PAGE, cleanup, explore, fallbackFailures, iconFailures, shapeFailures, MINUTES, type Seen,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const T = 120 * MINUTES;

let shipped: Promise<Seen[]> | undefined;
/** Every shipped page and the card at the reference window, light: at rest with a picture, and with the pointer over each node. */
const pages = (): Promise<Seen[]> => (shipped ??= explore({ hover: true, picture: true }));
const caught = (failures: readonly string[], ...words: string[]): boolean => failures.some((f) => words.every((w) => f.includes(w)));
const atRest = async (page: string, seen?: Seen[]): Promise<Seen> =>
  (seen ?? (await pages())).find((s) => s.page === page && s.how === 'at rest') ?? expect.fail(`the replica drew no ${page}`);

describe('#1592 icons and status marks on the shipped pages', () => {
  it(`${AC.icons}: every icon on the shipped pages is 14 or 16; a planted 18 fails, naming the view`, async () => {
    const { failures, names } = iconFailures(await pages());
    expect.soft(failures, 'every icon each shipped page draws, at rest and with the pointer over each node').toEqual([]);
    expect.soft(names, 'the icons the shipped pages draw: an icon set at 14 in rows and 16 in page chrome draws some (README, Ambiguities 4)').not.toEqual([]);
    const planted = iconFailures(await explore({ plant: PLANT.icon18, only: [SESSION_PAGE] })).failures;
    expect(caught(planted, SESSION_PAGE, '18 pt'), `the planted 18 pt icon on ${SESSION_PAGE} wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);

  it(`${AC.marks}: each state has its own mark, told apart with color off; a planted pair with the same shape fails, naming them`, async () => {
    expect.soft(shapeFailures(await atRest(NEEDS_YOU)), 'the nine status-map entries\' marks on the list, color off').toEqual([]);
    const planted = shapeFailures(await atRest(NEEDS_YOU, await explore({ plant: PLANT.sharedShape, only: [NEEDS_YOU], picture: true })));
    expect(caught(planted, 'stale and idle draw the same shape'), `the planted stale mark in idle's shape wasn't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);

  it(`${AC.fallback}: a status mark draws with no font fallback; a planted glyph fails`, async () => {
    const { failures, entries } = fallbackFailures(await pages());
    expect.soft(failures, 'every status mark on the shipped pages draws from fonts its text asked for').toEqual([]);
    expect.soft(ENTRIES.filter((e) => !entries.includes(e)), 'the entries no node on the shipped pages draws a mark for').toEqual([]);
    const planted = fallbackFailures(await explore({ plant: PLANT.fontGlyph, only: [NEEDS_YOU] })).failures;
    expect(caught(planted, 'font fallback'), `the planted marks drawn as the look's glyphs in the chrome's face weren't caught: ${JSON.stringify(planted)}`).toBe(true);
  }, T);
});
