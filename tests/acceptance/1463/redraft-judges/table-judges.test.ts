// Blind redraft (README) of the self-test of #1463's judges `tableFailures` and `retiredFailures`, and of `stateTable()`,
// which reads states::TABLE for them. No criterion tag: no hub, CLI or replica, and it passes on a right judge at any
// commit. Every right and wrong input is built from the table the judge is given, so it holds whatever words
// states::TABLE holds now or gains; made-up tables show each judge reads the table it is handed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO, retiredFailures, stateTable, tableFailures, type Row, type TableRow } from '../helpers.ts';

const row = (id: string, word: string, entry: unknown): Row => ({ id, address: id, title: `Title of ${id}`, entry, word, why: 'an ask open for 1 min', waits_on: 'you', since: 1, actions: [], unread: false });
const fail = (why: string): never => { throw new Error(why); };
/** `from`, made longer until it is none of `taken`. */
const absent = (taken: ReadonlySet<string>, from: string): string => { let s = from; while (taken.has(s)) s += '?'; return s; };
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** The judge's own reading of "multi-word": a never-word holding a space. */
const multiWord = (w: string): boolean => w.trim().includes(' ');

/** States people see as the design writes it (docs/technical-design.md): its word, status-map entry and never-words. */
function designTable(): TableRow[] {
  const lines = readFileSync(join(REPO, 'docs/technical-design.md'), 'utf8').split('\n');
  const head = lines.findIndex((l) => /^#{2,6}\s+States people see\s*$/.test(l));
  if (head < 0) fail('docs/technical-design.md has no heading "States people see"');
  const top = lines.findIndex((l, i) => i > head && l.startsWith('|'));
  const next = lines.findIndex((l, i) => i > head && /^#{1,6}\s/.test(l));
  if (top < 0 || (next >= 0 && next < top)) fail('the design\'s "States people see" holds no table');
  const cells = (l: string): string[] => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/`/g, ''));
  const header = cells(lines[top]!);
  const col = (re: RegExp): number => { const i = header.findIndex((h) => re.test(h)); return i >= 0 ? i : fail(`the design's States table has no column ${re} in ${JSON.stringify(header)}`); };
  const [w, e, n] = [col(/^word/i), col(/entry/i), col(/^never/i)];
  const out: TableRow[] = [];
  for (let i = top + 2; i < lines.length && lines[i]!.startsWith('|'); i++) {
    const c = cells(lines[i]!);
    out.push({ word: c[w] ?? '', entry: c[e] ?? '', never: (c[n] ?? '').split(',').map((x) => x.trim()).filter(Boolean) });
  }
  return out;
}

/** One row per word of `table`, each with its entry: what a right reader gives. */
const rightRows = (table: readonly TableRow[]): Row[] => table.map((t, i) => row(`session:right-${i}`, t.word, t.entry));

/** Words that are no word of `table`: the issue's retired ones, every never-word, each word in another case, cut short or added to. */
function wrongWords(table: readonly TableRow[]): string[] {
  const words = new Set(table.map((t) => t.word));
  const tries = [
    'need you', 'gone quiet',
    ...table.flatMap((t) => t.never),
    ...table.flatMap((t) => [t.word.toUpperCase(), t.word.toLowerCase(), cap(t.word), t.word.slice(0, -1), `${t.word} now`]),
    absent(words, 'made-up state'),
  ];
  return [...new Set(tries)].filter((x) => x.trim() && !words.has(x));
}

/** A list as a right reader prints it, in `table`'s words, with the count sentences and a finished session's detail. */
const rightText = (table: readonly TableRow[]): string => [
  ...table.map((t, i) => `Session ${i + 1} · ${t.word} · 2 min`),
  '  30 calls, 1 failed, 2 commits · deep read session:s1',
  'Docs refresh · quiet since 12:31',
  "Ship the cart page today?  If you don't answer: No, at 16:40  ask:01KB1463AK0000000000000002",
  '1 ask needs you',
  '3 asks need you',
  '12 asks need you',
].join('\n');

describe('judges, redrafted: states::TABLE and its words', () => {
  test('stateTable() reads states::TABLE whole: every row of the design\'s table, with its entry and its never-words', () => {
    const code = stateTable();
    const design = designTable();
    expect(design.length, "the design's States people see table has rows").toBeGreaterThan(0);
    expect(code.length, 'stateTable() has rows').toBeGreaterThan(0);
    expect(code.filter((t) => !t.word || !t.entry || t.never.some((x) => !x)), 'stateTable() rows with an empty word, entry or never-word').toEqual([]);
    const misses = design.flatMap((d) => {
      const c = code.filter((x) => x.word === d.word);
      if (!c.length) return [`the design's word "${d.word}" is no word of stateTable() (${code.map((x) => x.word).join(', ')})`];
      return [
        ...(c.some((x) => x.entry === d.entry) ? [] : [`"${d.word}" has entry ${c.map((x) => x.entry).join(' or ')} in stateTable() and ${d.entry} in the design`]),
        ...d.never.filter((v) => !c.some((x) => x.never.includes(v))).map((v) => `"${d.word}"'s never-word "${v}" is in the design and not in stateTable()`),
      ];
    });
    expect(misses, 'what stateTable() lacks of the design\'s table').toEqual([]);
  });

  test('tableFailures: every word with its entry passes; any other word, or a word with another entry, fails naming the row', () => {
    const table = stateTable();
    const right = rightRows(table);
    expect(tableFailures(right, table, 'deep status --json')).toEqual([]);
    expect(tableFailures([...right].reverse(), table, 'deep status --json')).toEqual([]);
    expect(tableFailures([...right, ...right.map((r) => ({ ...r, id: `${r.id}-again` }))], table, 'deep status --json')).toEqual([]);

    const anEntry = table[0]!.entry;
    for (const word of wrongWords(table)) {
      const got = tableFailures([row('ask:wrong-word', word, anEntry)], table, 'deep inbox --json');
      expect(got, `the word ${JSON.stringify(word)}, no word of states::TABLE`).toHaveLength(1);
      expect(got[0], `the failure for ${JSON.stringify(word)} names the row, the reader and the word`).toContain('ask:wrong-word');
      expect(got[0]).toContain('deep inbox --json');
      expect(got[0]).toContain(word);
    }

    const allEntries = [...new Set(table.map((t) => t.entry))];
    for (const word of new Set(table.map((t) => t.word))) {
      const its = table.filter((t) => t.word === word).map((t) => t.entry);
      const other = allEntries.find((x) => !its.includes(x)) ?? absent(new Set(its), 'no_such_entry');
      const upper = its[0]!.toUpperCase();
      for (const entry of [other, undefined, ...(its.includes(upper) ? [] : [upper])]) {
        const got = tableFailures([row('session:wrong-entry', word, entry)], table, "the app's list");
        expect(got, `"${word}" with entry ${JSON.stringify(entry)}; states::TABLE gives it ${its.join(' or ')}`).toHaveLength(1);
        expect(got[0], `the failure for "${word}" with entry ${JSON.stringify(entry)} names the row and the reader`).toContain('session:wrong-entry');
        expect(got[0]).toContain("the app's list");
      }
    }

    const mixed = [...right];
    mixed.splice(Math.floor(mixed.length / 2), 0, row('ask:wrong-word', absent(new Set(table.map((t) => t.word)), 'made-up state'), anEntry));
    const got = tableFailures(mixed, table, 'deep status --json');
    expect(got, 'one wrong row among right ones: one failure').toHaveLength(1);
    expect(got[0]).toContain('ask:wrong-word');
    expect(got.join('\n'), 'no right row is named').not.toMatch(/session:right-/);
  });

  test('tableFailures reads the table it is handed: a word it gains passes, a word it lacks fails', () => {
    const table = stateTable();
    const gained = absent(new Set(table.map((t) => t.word)), 'made-up state');
    const entry = absent(new Set(table.map((t) => t.entry)), 'made_up_entry');
    const grown: TableRow[] = [...table, { word: gained, entry, never: [] }];
    expect(tableFailures([row('session:gained', gained, entry)], grown, 'deep')).toEqual([]);
    expect(tableFailures([...rightRows(table), row('session:gained', gained, entry)], grown, 'deep')).toEqual([]);
    expect(tableFailures([row('session:gained', gained, entry)], table, 'deep').join(), 'a word the table lacks').toMatch(/session:gained/);
    const madeUp: TableRow[] = [{ word: gained, entry, never: [] }];
    expect(tableFailures(rightRows(table), madeUp, 'deep'), "every word of states::TABLE against a table that holds none of them").toHaveLength(table.length);
  });

  test('retiredFailures: a list in the table\'s words passes; each word that goes fails, in any case, naming it and the reader', () => {
    const table = stateTable();
    const right = rightText(table);
    expect(retiredFailures(right, table, 'deep status')).toEqual([]);

    const lines = right.split('\n');
    const withLine = (line: string): string => [...lines.slice(0, 1), line, ...lines.slice(1)].join('\n');
    const retired = [
      ...['gone quiet'].flatMap((w) => [`Search index · ${w} since 12:31`, `${cap(w)}: Search index`].map((text) => [w, text] as const)),
      ...['2', '12'].map((n) => [`${n} need you`, `14 sessions: ${n} need you, 1 working`] as const),
      ...table.flatMap((t) => t.never.filter(multiWord)).flatMap((w) => [...new Set([w, cap(w), w.toUpperCase()])].map((v) => [v, `Cart totals · ${v}`] as const)),
    ];
    for (const [phrase, line] of retired) {
      const got = retiredFailures(withLine(line), table, 'deep status');
      expect(got.length, `${JSON.stringify(line)} holds "${phrase}", a word no state goes by`).toBeGreaterThan(0);
      expect(got.join('\n'), `the failure names "${phrase}"`).toContain(phrase);
      expect(got.every((f) => f.includes('deep status')), 'each failure names the reader').toBe(true);
    }
  });

  test('retiredFailures reads the table it is handed: its multi-word never-words go, single words and parts of words stay', () => {
    const table = stateTable();
    const realNever = new Set(table.flatMap((t) => t.never.map((w) => w.toLowerCase())));
    const phrase = absent(realNever, 'writing it up');
    const madeUp: TableRow[] = [{ word: absent(new Set(table.map((t) => t.word)), 'made-up state'), entry: 'made_up_entry', never: [phrase, 'busy'] }];
    expect(retiredFailures(`Release notes · ${cap(phrase)}`, madeUp, 'deep').join(), "a never-word of the table it's handed").toContain(cap(phrase));
    expect(retiredFailures(`Release notes · ${cap(phrase)}`, table, 'deep'), 'a never-word of another table').toEqual([]);
    expect(retiredFailures('Release notes · busy', madeUp, 'deep'), 'a single-word never-word, which a detail line can hold ("1 failed")').toEqual([]);
    expect(retiredFailures(`Release notes · re${phrase}stream`, madeUp, 'deep'), 'the phrase inside longer words').toEqual([]);
    expect(retiredFailures(rightText(table), [...table, ...madeUp], 'deep'), 'the right list, against the table grown by a word').toEqual([]);
  });
});
