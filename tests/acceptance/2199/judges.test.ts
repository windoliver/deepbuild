// The judges, each held to a right input and the wrong ones, with no hub or CLI: a judge that passes what it should
// fail would let a criterion pass on a wrong program. No criterion tag: these pass at the base.
import { describe, expect, test } from 'vitest';
import { idsShown, optionFailures, sentenceFailures, type Shown } from './helpers.ts';

const BORDER: Shown = { handle: 'ask:01KB2199AK0000000000000001', question: 'Which border for the card, thin or thick?', options: [['thin', 'Thin'], ['thick', 'Thick']], default: 'thin' };
const STORE: Shown = { handle: 'ask:01KB2199AK0000000000000002', question: 'Where does the cart keep its data?', options: [['sqlite', 'SQLite'], ['files', 'Plain files']], default: 'files' };
const ALL = [BORDER, STORE];
const SESSION = '6b3e4f50-2222-4333-8444-555566667777';
/** `deep inbox` as the base prints it, with `border` and `store` where a fix might print options on the line, and `under` each line. */
const inbox = (border = '', store = '', under: [string, string] = ['', '']): string => [
  `${BORDER.question}  taste  work  ${SESSION}  2s${border}  If you don't answer: Thin, on Fri 13 Nov at 11:23  ${BORDER.handle}`, ...(under[0] ? [under[0]] : []),
  `${STORE.question}  choice  shop  ${SESSION}  2s${store}  If you don't answer: Plain files, on Thu 12 Nov at 11:23  ${STORE.handle}`, ...(under[1] ? [under[1]] : []),
  '2 asks need you', '',
].join('\n');

describe('judges', () => {
  test('optionFailures: the base line holds no ID, though its question says "thin or thick" and its default says "Plain files"', () => {
    expect(idsShown(inbox(), BORDER, ALL)).toEqual([]);
    expect(optionFailures(inbox(), BORDER, ALL)).toEqual([
      expect.stringMatching(/^deep inbox's ask ask:01KB2199AK0000000000000001 \(.*\) lacks its option ID thin: /),
      expect.stringMatching(/^deep inbox's ask ask:01KB2199AK0000000000000001 \(.*\) lacks its option ID thick: /),
    ]);
    expect(optionFailures(inbox(), STORE, ALL)).toEqual([
      expect.stringMatching(/^deep inbox's ask ask:01KB2199AK0000000000000002 \(.*\) lacks its option ID sqlite: /),
      expect.stringMatching(/^deep inbox's ask ask:01KB2199AK0000000000000002 \(.*\) lacks its option ID files: /),
    ]);
  });

  test('optionFailures: IDs on the line or under it pass, in more than one way of writing them', () => {
    for (const text of [
      inbox('  thin|thick', '  sqlite|files'),
      inbox('  [thin, thick]', '  [sqlite, files]'),
      inbox('  thin (Thin) or thick (Thick)', '  sqlite (SQLite) or files (Plain files)'),
      inbox('', '', ['    answer with: thin, thick', '    answer with: sqlite, files']),
      inbox('', '', ['    thin  Thin\n    thick  Thick', '    Plain files: files\n    SQLite: sqlite']),
    ]) {
      expect(optionFailures(text, BORDER, ALL), text).toEqual([]);
      expect(optionFailures(text, STORE, ALL), text).toEqual([]);
      expect(idsShown(text, BORDER, ALL), text).toEqual(['thin', 'thick']);
    }
  });

  test('optionFailures: labels where the IDs belong fail, naming the ask and the label', () => {
    for (const text of [inbox('  Thin|Thick', '  SQLite|Plain files'), inbox('', '', ['    answer with: Thin, Thick', '    answer with: SQLite, Plain files'])]) {
      expect(optionFailures(text, STORE, ALL), text).toEqual([
        expect.stringMatching(/^deep inbox shows ask:01KB2199AK0000000000000002's option sqlite by its label "SQLite" and not by its ID/),
        expect.stringMatching(/^deep inbox shows ask:01KB2199AK0000000000000002's option files by its label "Plain files" and not by its ID/),
      ]);
      expect(optionFailures(text, BORDER, ALL).join('\n'), text).toMatch(/ask:01KB2199AK0000000000000001's option thick by its label "Thick"/);
    }
  });

  test('optionFailures: an ID with another ask, a part of a longer word, or one ID of two, fails', () => {
    // Both asks' IDs under the second ask only: the first ask has none with it.
    expect(optionFailures(inbox('', '', ['', '    thin, thick, sqlite, files']), BORDER, ALL)).toHaveLength(2);
    expect(optionFailures(inbox('', '', ['', '    thin, thick, sqlite, files']), STORE, ALL)).toEqual([]);
    expect(optionFailures(inbox('  thinner|thick-set', '  sqlite3|profiles'), BORDER, ALL)).toHaveLength(2);
    expect(optionFailures(inbox('  thinner|thick-set', '  sqlite3|profiles'), STORE, ALL)).toHaveLength(2);
    expect(optionFailures(inbox('  thin'), BORDER, ALL)).toEqual([expect.stringMatching(/lacks its option ID thick/)]);
    expect(optionFailures(inbox('', '  sqlite'), STORE, ALL, ['files'])).toEqual([expect.stringMatching(/lacks its option ID files/)]);
    expect(optionFailures(inbox('', '  files'), STORE, ALL, ['files'])).toEqual([]);
    expect(optionFailures('2 asks need you\n', BORDER, ALL)).toEqual([`deep inbox lacks the question of ${BORDER.handle} ("${BORDER.question}")`]);
  });

  test('sentenceFailures: the default sentence between the question and the handle', () => {
    expect(sentenceFailures(inbox('  thin|thick', '  sqlite|files'), ALL)).toEqual([]);
    expect(sentenceFailures(inbox().replace("  If you don't answer: Thin, on Fri 13 Nov at 11:23", ''), ALL)).toEqual([expect.stringMatching(/^deep inbox's ask ask:01KB2199AK0000000000000001 .* lacks its default sentence/)]);
    const after = inbox().replace(`  If you don't answer: Plain files, on Thu 12 Nov at 11:23  ${STORE.handle}`, `  ${STORE.handle}\n    If you don't answer: Plain files, on Thu 12 Nov at 11:23`);
    expect(sentenceFailures(after, ALL)).toEqual([expect.stringMatching(/^deep inbox's ask ask:01KB2199AK0000000000000002 .* lacks its default sentence/)]);
  });
});
