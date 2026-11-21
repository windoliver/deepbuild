// The judges, each held to right inputs and wrong ones, with no hub or CLI: a judge that passes what it should fail
// would let a criterion pass on a wrong program. The shell model is also held to /bin/sh itself. No criterion tag:
// these pass at the base.
import { describe, expect, test } from 'vitest';
import { CASES, givesOption, idPattern, printedForms, refusalFailures, shArgs, shellWords, shownOf } from './helpers.ts';

const [DASH, ESC, ZW, SPACE, COMMA, PAREN] = CASES.map((c) => c.id) as [string, string, string, string, string, string];
const H = (n: number): string => `ask:01KB2563AK000000000000000${n}`;
const ALL = CASES.map((c, i) => shownOf(H(i + 1), c.spec));
const SESSION = '6b3e4f50-2222-4333-8444-555566667777';
const visible = (s: string): string => s.replace(/\u001b/g, '\\x1b').replace(/​/g, '\\u{200b}');
/** `deep inbox` over the six asks: each ask's line as the base prints it, and under it `under(i)` (the base's `answer with` line by default). */
const inbox = (under: (i: number) => string = base): string => [
  ...CASES.flatMap((c, i) => [`${c.spec.question}  choice  work  ${SESSION}  2s  If you don't answer: ${c.spec.options[1]![1]}, on Fri 13 Nov at 11:23  ${H(i + 1)}`, under(i)]),
  '6 asks need you', '',
].join('\n');
/** The base's line under each ask (#2199): `answer with id (label), id (label)`, through visible(). */
function base(i: number): string {
  const opts = CASES[i]!.spec.options.map(([id, label]) => (label.toLowerCase() === id.toLowerCase() ? id : `${id} (${label})`));
  return visible(`    answer with ${opts.join(', ')}`);
}
const forms = (text: string, i: number): string[] => printedForms(text, ALL[i]!, ALL, CASES[i]!.id);

describe('judges', () => {
  test('shellWords reads quoting as a POSIX shell does, and refuses what would expand or run', () => {
    expect(shellWords('-fast')).toEqual(['-fast']);
    expect(shellWords("'title case'")).toEqual(['title case']);
    expect(shellWords('"title case"')).toEqual(['title case']);
    expect(shellWords('title\\ case')).toEqual(['title case']);
    expect(shellWords('title case')).toEqual(['title', 'case']);
    expect(shellWords('red, green')).toEqual(['red,', 'green']);
    expect(shellWords("'red, green'")).toEqual(['red, green']);
    expect(shellWords("$'esc\\x1bkey'")).toEqual([ESC]);
    expect(shellWords("$'esc\\ekey'")).toEqual([ESC]);
    expect(shellWords("$'esc\\033key'")).toEqual([ESC]);
    expect(shellWords("$'zero\\xe2\\x80\\x8bwidth'")).toEqual([ZW]);
    expect(shellWords("'zero​width'")).toEqual([ZW]);
    expect(shellWords('esc\\x1bkey')).toEqual(['escx1bkey']);
    expect(shellWords('"a\\$b"')).toEqual(['a$b']);
    expect(shellWords("'wide (padded)'")).toEqual([PAREN]);
    expect(shellWords('wide\\ \\(padded\\)')).toEqual([PAREN]);
    expect(shellWords("-- '-fast'")).toEqual(['--', '-fast']);
    for (const bad of ['wide (padded)', 'x$(rm -rf y)', '`id`', '"a$b"', 'a*', 'a?', '[ab]', '{a,b}', 'a;b', 'a|b', 'a&b', 'a>b', "'open", '"open', '#c', '~x', "$'\\u200b'", "$'\\q'", 'end\\']) {
      expect(shellWords(bad), bad).toBeUndefined();
    }
  });

  test('shellWords agrees with /bin/sh on the forms it reads', async () => {
    for (const typed of ['-fast', "'title case'", '"title case"', 'title\\ case', "$'esc\\x1bkey'", "$'esc\\033key'", "$'zero\\xe2\\x80\\x8bwidth'", "'red, green'", 'wide\\ \\(padded\\)', "-- '-fast'", 'esc\\x1bkey', '"a\\$b"']) {
      expect(await shArgs(typed), typed).toEqual(shellWords(typed));
    }
  }, 60_000);

  test('givesOption: the ID alone, or after --, and nothing else', () => {
    expect(givesOption(['-fast'], DASH)).toBe(true);
    expect(givesOption(['--', '-fast'], DASH)).toBe(true);
    expect(givesOption(['title', 'case'], SPACE)).toBe(false);
    expect(givesOption(['x', '-fast'], DASH)).toBe(false);
    expect(givesOption(['-fast', '--'], DASH)).toBe(false);
    expect(givesOption(undefined, DASH)).toBe(false);
  });

  test('printedForms: the base prints a typed-back form of the dash ID alone, and of none of the others', () => {
    const text = inbox();
    expect(forms(text, 0)).toEqual(['-fast']);
    for (let i = 1; i < CASES.length; i++) expect(forms(text, i), CASES[i]!.id).toEqual([]);
    // A plain ID is found, so the judge isn't blind: each ask's default.
    for (let i = 0; i < CASES.length; i++) expect(printedForms(text, ALL[i]!, ALL, CASES[i]!.spec.default), CASES[i]!.spec.default).toContain(CASES[i]!.spec.default);
  });

  test('printedForms: forms a fix might print are found, in more than one format', () => {
    const quoted = (i: number) => `    answer with ${CASES[i]!.spec.options.map(([id]) => (i === 1 ? `$'esc\\x1bkey'` : i === 2 ? `$'zero\\xe2\\x80\\x8bwidth'` : `'${id}'`)).join(' or ')}`;
    const t1 = inbox((i) => (i === 1 || i === 2 ? quoted(i).replace(/ or .*/, '') : quoted(i)));
    for (let i = 0; i < CASES.length; i++) expect(forms(t1, i).length, `${CASES[i]!.id} in ${t1}`).toBeGreaterThan(0);
    const t2 = inbox((i) => `    option 1: ${[`-- -fast`, `$'esc\\ekey'`, `$'zero\\342\\200\\213width'`, `title\\ case`, `"red, green"`, `wide\\ \\(padded\\)`][i]}\n    option 2: ${CASES[i]!.spec.default}`);
    for (let i = 0; i < CASES.length; i++) expect(forms(t2, i).length, `${CASES[i]!.id} in ${t2}`).toBeGreaterThan(0);
  });

  test("printedForms: a form printed with another ask, or not printed, isn't found", () => {
    // Every ask's hard ID quoted, but all under the last ask only.
    const all = CASES.map((c) => (c.id === ESC ? `$'esc\\x1bkey'` : c.id === ZW ? `$'zero\\xe2\\x80\\x8bwidth'` : `'${c.id}'`)).join(' ');
    const text = inbox((i) => (i === CASES.length - 1 ? `    ${all}` : base(i)));
    for (let i = 1; i < CASES.length - 1; i++) expect(forms(text, i), CASES[i]!.id).toEqual([]);
    expect(forms(text, CASES.length - 1)).toContain("'wide (padded)'");
    expect(forms('6 asks need you\n', 3)).toEqual([]);
    // The visible() escape and a label are not the ID.
    expect(forms(inbox((i) => (i === 1 ? '    answer with esc\\x1bkey, Escape key' : base(i))), 1)).toEqual([]);
  });

  test('refusalFailures: a refusal naming the ID and why passes; one that lacks either fails', () => {
    expect(refusalFailures('option ID "-fast" starts with "-", which deep inbox answer would read as a flag', DASH)).toEqual([]);
    expect(refusalFailures('the option ID esc\\x1bkey holds the control character U+001B, which a terminal never shows', ESC)).toEqual([]);
    expect(refusalFailures('option "zero\\u{200b}width" holds an invisible character (U+200B)', ZW)).toEqual([]);
    expect(refusalFailures(`option "${SPACE}": an ID holds no space`, SPACE)).toEqual([]);
    expect(refusalFailures('/data/options/0/id must match pattern "^[a-z0-9_]+$"', COMMA)).toEqual([expect.stringMatching(/doesn't name the option ID/)]);
    expect(refusalFailures('invalid ask', PAREN)).toEqual([expect.stringMatching(/doesn't name the option ID/)]);
    expect(refusalFailures('"wide (padded)"', PAREN)).toEqual([expect.stringMatching(/but not why/)]);
    expect(refusalFailures('option "Title Case" holds a space, which is refused', SPACE)).toEqual([expect.stringMatching(/doesn't name the option ID/)]);
    expect(idPattern(ESC).test('esc\\u{1B}key')).toBe(true);
    expect(idPattern(ESC).test('esckey')).toBe(false);
  });
});
