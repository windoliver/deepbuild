// AC3: a reworded row label with the same `id` passes a stored journey, and that journey's locator holds no visible word; a
// planted journey that locates by a word fails the kit's lint, naming the word. The stored journey is
// fixtures/journeys/by-id.json, played call by call through the real deep-drive over the fixture record and over a copy whose
// every question is reworded; the lint is `deep-replica --journey-lint` (README, Pinned 6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../16/helpers.ts';
import { driveBinary, FIXTURES, ID, journeyLint, locatorWords, openAsks, playJourney, RECORD, requireMacos, REWORDED, rowStarting, see, variant, visibleWords } from './helpers.ts';

afterAll(() => cleanup(), 60_000);
const MIN = 60_000;
const STORED = join(FIXTURES, 'journeys', 'by-id.json');
const BY_WORD = join(FIXTURES, 'journeys', 'by-word.json');
const BY_TEXT = join(FIXTURES, 'journeys', 'by-text.json');
const journey = (file: string): Record<string, any>[] => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>[];

describe(`AC3 ${ID.journey} A reworded row label with the same \`id\` passes a stored journey, and that journey's locator holds no visible word. A planted journey that locates by a word fails the kit's lint, naming the word`, () => {
  it('AC3 the stored journey passes on the fixture and on the same record with every question reworded, whose rows keep their ids', async () => {
    requireMacos();
    const bin = await driveBinary();
    const reworded = variant('reword');
    // The rewording reached the screen, and each row kept its id.
    const [before, after] = [await see(bin, RECORD), await see(bin, reworded)];
    for (const ask of openAsks(RECORD)) {
      const [was, now] = [rowStarting(before, ask.question), rowStarting(after, REWORDED[ask.handle]!)];
      expect(now, `the reworded record shows ${ask.handle} as "${REWORDED[ask.handle]}"`).toBeDefined();
      expect(rowStarting(after, ask.question), `the old words "${ask.question}" are gone`).toBeUndefined();
      expect(typeof was?.id === 'string' && was.id !== '', `${ask.handle}'s row carries an id: ${JSON.stringify(was)}`).toBe(true);
      expect(now?.id, `${ask.handle}'s row keeps its id when its words change`).toBe(was?.id);
    }
    for (const fixture of [RECORD, reworded]) {
      const { replies, closed } = await playJourney(bin, STORED, fixture);
      const where = fixture === RECORD ? 'the fixture' : 'the reworded fixture';
      expect(replies.filter((r) => r.ok !== true), `every call of the stored journey on ${where} answers: ${JSON.stringify(replies).slice(0, 1200)}`).toEqual([]);
      expect(closed.journey?.outcome, `the stored journey on ${where}: ${JSON.stringify(closed.journey).slice(0, 800)}`).toBe('passed');
      expect(closed.journey?.tests_run, 'both its assertions ran').toBe(2);
    }
  }, 30 * MIN);

  it('AC3 the stored journey\'s locators hold no word the screen shows, before or after the rewording, and the lint passes it', async () => {
    requireMacos();
    const stored = journey(STORED);
    expect(locatorWords(stored).length, 'the journey locates something').toBeGreaterThan(0);
    const bin = await driveBinary();
    for (const fixture of [RECORD, variant('reword')]) expect(visibleWords(stored, await see(bin, fixture))).toEqual([]);
    const lint = await journeyLint(STORED);
    expect(lint.verdict, `deep-replica --journey-lint gives a verdict (README, Pinned 6): ${lint.said}`).not.toBeNull();
    expect(lint.verdict).toEqual({ result: 'pass' });
    expect(lint.code, 'a passing lint exits 0').toBe(0);
  }, 30 * MIN);

  it('AC3 wrong programs: a journey locating by a row\'s name, and one locating by drawn text, each fail the lint, naming the word', async () => {
    for (const [file, word] of [[BY_WORD, 'Which font for the printed receipt?'], [BY_TEXT, 'Which layout for the changelog?']] as const) {
      const lint = await journeyLint(file);
      expect(lint.verdict, `deep-replica --journey-lint gives a verdict on ${file} (README, Pinned 6): ${lint.said}`).not.toBeNull();
      expect(lint.verdict?.result, `the lint fails ${file}`).toBe('fail');
      expect(lint.verdict?.names, 'the failure names the word').toContain(word);
      expect(lint.code, 'a failing lint exits 1').toBe(1);
    }
  }, 30 * MIN);
});
