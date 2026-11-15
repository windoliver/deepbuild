// The Oracle lane for #1968's AC1 (#1968.4bf4e5fe): the pinned upstream diff library's tests, run on our code.
//
// The Oracle page pins the library at commit e3804055b8 and links five files: its LCS module (src/algorithms/lcs.rs) with
// two snapshot files, and its inline module (src/text/inline.rs), which diffs by line and then token by token inside
// changed lines, with one snapshot file. They are read in place, never copied (README). Each test's sequences and the
// alignment its snapshot or its asserts expect are taken from the files and ported onto what deep-show answers: every
// case is a pair of code items under a text_diff in one film (README: The surface under test), read once by `eval
// {t: 0.5 s, film: true}`, and its alignment is the film block's `diffs.<case>`: the tokens kept (a piece naming a token of
// each item), the tokens that go (`to: null`) and the tokens that come (`from: null`). A sequence of the LCS module's
// tests is ported twice, one element a line (one token each) and one element a token of a single line, so both of
// text_diff's levels run it. The inline module's texts are its own, each word (or each character, for its character-mode
// tests) a token. Our tie to the earlier position could order equal-length choices otherwise than the library's walk;
// only one ported case has two longest alignments (the "bad range" regression: where its one kept element sits), and
// there the design's earlier position and the library agree (README). The order of operations is never compared.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORACLES, vendored } from '../1965-oracle/helpers.ts';
import {
  AC, TIMEOUT, binOf, codeItem, diffOf, failsNaming, film, filmsAt, fl, memo, none, prebuild, textDiff, useTemp, type Diff, type JsonObject, type Piece, type Token,
} from '../1968/helpers.ts';

prebuild(['full']);
const temp = useTemp();
const ID = AC[1];

// ---------------------------------------------------------------------------------------------------
// The pinned files, from the vendor folder whose name ends in the pinned commit's first ten digits (README).

const PIN = 'e3804055b8';
function folder(): string {
  const vendor = join(ORACLES, 'vendor');
  return (existsSync(vendor) ? readdirSync(vendor).find((d) => d.endsWith(`-${PIN}`)) : undefined) ?? `*-${PIN}`;
}
const pinned = (rel: string): string => vendored(`${folder()}/${rel}`);
/** A pinned snapshot file by the end of its name (each name starts with the library's own). */
function snapshot(dir: string, suffix: string): string {
  const at = join(ORACLES, 'vendor', folder(), dir);
  const name = existsSync(at) ? readdirSync(at).find((f) => f.endsWith(suffix)) : undefined;
  return vendored(`${folder()}/${dir}/${name ?? `*${suffix}`}`);
}

// ---------------------------------------------------------------------------------------------------
// Reading the tests: a test function's body, its sequences, the operations it or its snapshot expects.

function fnBody(src: string, name: string): string {
  const at = src.indexOf(`fn ${name}()`);
  expect(at, `the pinned file holds fn ${name}`).toBeGreaterThanOrEqual(0);
  return src.slice(at, src.indexOf('\n}\n', at) + 2);
}
const ints = (s: string): number[] => s.split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number);
function slice(body: string, pattern: RegExp, what: string): number[] {
  const m = pattern.exec(body);
  expect(m, `${what} in the pinned test`).not.toBeNull();
  return ints(m![1]!);
}

interface Expected { kept: [number, number][]; deleted: number[]; inserted: number[] }
/** The library's operations, `Equal`, `Delete`, `Insert`, `Replace` with their fields, as an alignment. */
function fromOps(text: string): Expected {
  const e: Expected = { kept: [], deleted: [], inserted: [] };
  const range = (from: number, len: number): number[] => Array.from({ length: len }, (_, i) => from + i);
  for (const m of text.matchAll(/(Equal|Delete|Insert|Replace) \{([^}]*)\}/g)) {
    const f = Object.fromEntries([...m[2]!.matchAll(/(\w+): (\d+)/g)].map((x) => [x[1]!, Number(x[2])]));
    if (m[1] === 'Equal') e.kept.push(...range(0, f['len']!).map((i): [number, number] => [f['old_index']! + i, f['new_index']! + i]));
    if (m[1] === 'Delete' || m[1] === 'Replace') e.deleted.push(...range(f['old_index']!, f['old_len']!));
    if (m[1] === 'Insert' || m[1] === 'Replace') e.inserted.push(...range(f['new_index']!, f['new_len']!));
  }
  expect(e.kept.length + e.deleted.length + e.inserted.length, `the pinned operations: ${text.slice(0, 300)}`).toBeGreaterThan(0);
  return e;
}

/** One ported case: two code items' raw and tokens, and what the library expects of their alignment (an alignment, or,
 * for its LCS table's test, the length of the longest common subsequence). */
interface Case { name: string; before: string; after: string; beforeTokens: Token[]; afterTokens: Token[]; expected?: Expected; length?: number }
const plain = (raw: string, unit: RegExp): Token[] => [...raw.matchAll(unit)].map((m) => ({ from: m.index, to: m.index + m[0].length, class: 'plain' }));

/** A sequence element as a word: its decimal digits as syllables, so equal elements are equal bytes and no digit or
 * number word reaches a code item (honest numbers). */
const SYLLABLES = ['ka', 'lo', 'mi', 'nu', 'pe', 'ra', 'si', 'tu', 'vo', 'ze'];
const word = (v: number): string => String(v).split('').map((d) => SYLLABLES[Number(d)]!).join('');
/** A pair of sequences as two cases: one element a line (one token each), and one element a token of one line. */
function levels(name: string, a: number[], b: number[], want: { expected?: Expected; length?: number }): Case[] {
  const lines = (s: number[]): string => s.map((v) => `${word(v)}\n`).join('');
  const line = (s: number[]): string => `${s.map(word).join(' ')}\n`;
  return [
    { name: `${name}-lines`, before: lines(a), after: lines(b), beforeTokens: plain(lines(a), /\S+/g), afterTokens: plain(lines(b), /\S+/g), ...want },
    { name: `${name}-tokens`, before: line(a), after: line(b), beforeTokens: plain(line(a), /\S+/g), afterTokens: plain(line(b), /\S+/g), ...want },
  ];
}

/** The LCS module's tests whose expected values are pinned: `test_diff` and `test_pat` (their snapshots), the swapped
 * and bad-range regressions (their asserts), and the table's test (each LCS length it asserts, a non-empty suffix). */
function lcsCases(): Case[] {
  const src = pinned('src/algorithms/lcs.rs');
  const seqs = (body: string): [number[], number[]] => [
    slice(body, /let a: &\[usize\] = &\[([^\]]*)\];/, 'a'), slice(body, /let b: &\[usize\] = &\[([^\]]*)\];/, 'b'),
  ];
  const out: Case[] = [];
  const diff = fnBody(src, 'test_diff');
  out.push(...levels('diff', ...seqs(diff), { expected: fromOps(snapshot('src/algorithms/snapshots', '__algorithms__lcs__diff.snap')) }));
  const pat = fnBody(src, 'test_pat');
  out.push(...levels('pat', ...seqs(pat), { expected: fromOps(snapshot('src/algorithms/snapshots', '__algorithms__lcs__pat.snap')) }));
  const swapped = fnBody(src, 'test_issue44_swapped_regression');
  out.push(...levels('swapped', ...seqs(swapped), { expected: fromOps(swapped) }));
  const bad = fnBody(src, 'test_bad_range_regression');
  const call = /diff\(&mut d, &\[([^\]]*)\], (\d+)\.\.(\d+), &\[([^\]]*)\], (\d+)\.\.(\d+)\)/.exec(bad);
  expect(call, 'the bad-range regression\'s call').not.toBeNull();
  const [a, b] = [ints(call![1]!), ints(call![4]!)];
  expect([Number(call![2]), Number(call![3]), Number(call![5]), Number(call![6])], 'the bad-range regression diffs both whole sequences').toEqual([0, a.length, 0, b.length]);
  out.push(...levels('bad-range', a, b, { expected: fromOps(bad) }));
  const table = fnBody(src, 'test_table');
  const [old, neu] = [slice(table, /let old = vec!\[([^\]]*)\];/, 'old'), slice(table, /let new = vec!\[([^\]]*)\];/, 'new')];
  for (const m of table.matchAll(/table\.get\((\d+), 0\), (\d+)\)/g)) {
    const i = Number(m[1]);
    if (i < neu.length) out.push(...levels(`table-${i}`, old, neu.slice(i), { length: Number(m[2]) }));
  }
  return out;
}

/** The inline module's line-then-token tests: its texts, and per line the parts its snapshot or its asserts mark as
 * changed (`true`) or not. */
interface Change { tag: string; old: number | null; new: number | null; values: [boolean, string][] }
const literal = (s: string): string => JSON.parse(s) as string;
const STR = '("(?:[^"\\\\]|\\\\.)*")';
function texts(body: string): [string, string] {
  const m = new RegExp(`from_lines\\(\\s*${STR},\\s*${STR},?\\s*\\)`).exec(body);
  expect(m, 'the test\'s two texts').not.toBeNull();
  return [literal(m![1]!), literal(m![2]!)];
}
function snapshotChanges(snap: string): Change[] {
  return snap.split('InlineChange {').slice(1).map((block) => {
    const index = (k: string): number | null => { const m = new RegExp(`${k}: (?:Some\\(\\s*(\\d+),?\\s*\\)|None)`).exec(block); return m?.[1] === undefined ? null : Number(m[1]); };
    const values = [...block.matchAll(new RegExp(`\\(\\s*(true|false),\\s*${STR},?\\s*\\)`, 'g'))].map((m): [boolean, string] => [m[1] === 'true', literal(m[2]!)]);
    return { tag: /tag: (\w+)/.exec(block)![1]!, old: index('old_index'), new: index('new_index'), values };
  });
}
/** `changes[i].iter_strings_lossy()` as a test asserts it, by i. */
function assertedValues(body: string): Map<number, [boolean, string][]> {
  const out = new Map<number, [boolean, string][]>();
  for (const m of body.matchAll(/changes\[(\d+)\]\.iter_strings_lossy\(\)\.collect::<Vec<_>>\(\),\s*vec!\[([\s\S]*?)\]\s*\)/g)) {
    out.set(Number(m[1]), [...m[2]!.matchAll(new RegExp(`\\((true|false), Cow::Borrowed\\(${STR}\\)\\)`, 'g'))].map((x): [boolean, string] => [x[1] === 'true', literal(x[2]!)]));
  }
  return out;
}

/** An alignment from the library's per-line changes: an Equal line keeps its tokens; Deletes then Inserts between two
 * Equals are one replaced run, whose unmarked tokens are kept in order and whose marked ones go or come; a run of only
 * Deletes (or Inserts) goes (or comes) whole. `unit` cuts a line into tokens as the case's items do. */
function fromChanges(changes: Change[], c: Case, unit: RegExp): Expected {
  const e: Expected = { kept: [], deleted: [], inserted: [] };
  const lineStarts = (raw: string, tokens: Token[]): number[][] => {
    const lines: number[][] = [];
    tokens.forEach((t, k) => { const l = raw.slice(0, t.from).split('\n').length - 1; (lines[l] ??= []).push(k); });
    return lines;
  };
  const [bl, al] = [lineStarts(c.before, c.beforeTokens), lineStarts(c.after, c.afterTokens)];
  const marked = (ch: Change, line: number[]): { k: number; marked: boolean }[] => {
    const flags = ch.values.flatMap(([m, text]) => [...text.matchAll(unit)].map(() => m));
    expect(flags.length, `a change's parts cut into the line's ${line.length} tokens: ${JSON.stringify(ch.values)}`).toBe(line.length);
    return line.map((k, i) => ({ k, marked: flags[i]! }));
  };
  let gone: { k: number; marked: boolean }[] = []; let come: { k: number; marked: boolean }[] = [];
  const flush = (): void => {
    if (gone.length && come.length) {
      const [g, c2] = [gone.filter((x) => !x.marked), come.filter((x) => !x.marked)];
      expect(g.length, 'a replaced run keeps as many tokens on each side').toBe(c2.length);
      g.forEach((x, i) => e.kept.push([x.k, c2[i]!.k]));
      e.deleted.push(...gone.filter((x) => x.marked).map((x) => x.k)); e.inserted.push(...come.filter((x) => x.marked).map((x) => x.k));
    } else {
      e.deleted.push(...gone.map((x) => x.k)); e.inserted.push(...come.map((x) => x.k));
    }
    gone = []; come = [];
  };
  for (const ch of changes) {
    if (ch.tag === 'Equal') { flush(); bl[ch.old!]?.forEach((k, i) => e.kept.push([k, al[ch.new!]![i]!])); }
    if (ch.tag === 'Delete') gone.push(...marked(ch, bl[ch.old!] ?? []));
    if (ch.tag === 'Insert') come.push(...marked(ch, al[ch.new!] ?? []));
  }
  flush();
  return e;
}

/** The inline module's tests whose expected values are pinned: the line-then-word snapshot test, and the two
 * character-mode tests' asserts. */
function inlineCases(): Case[] {
  const src = pinned('src/text/inline.rs');
  const make = (name: string, [before, after]: [string, string], unit: RegExp): Case => ({ name, before, after, beforeTokens: plain(before, unit), afterTokens: plain(after, unit) });
  const words = make('line-ops', texts(fnBody(src, 'test_line_ops_inline')), /\S+/g);
  words.expected = fromChanges(snapshotChanges(snapshot('src/text/snapshots', '__text__inline__line_ops_inline.snap')), words, /\S+/g);

  const charsBody = fnBody(src, 'test_line_ops_inline_chars');
  const chars = make('chars', texts(charsBody), /\S/g);
  const tags = new Map([...charsBody.matchAll(/changes\[(\d+)\]\.tag\(\), ChangeTag::(\w+)\)/g)].map((m) => [Number(m[1]), m[2]!]));
  expect([tags.get(0), tags.get(1)], 'the character-mode test\'s two changes').toEqual(['Delete', 'Insert']);
  const gone = assertedValues(charsBody).get(0)!;
  // The test asserts the old line's parts only; the new line's unmarked parts are the same text in the same order
  // (a replaced run's kept parts), the rest of it marked.
  const kept = gone.filter(([m]) => !m).map(([, t]) => t).join('').replace(/\s/g, '');
  let i = 0;
  const comeFlags = [...chars.after.matchAll(/\S/g)].map((m) => (i < kept.length && m[0] === kept[i] ? (i++, false) : true));
  expect(i, 'the old line\'s kept parts run through the new line in order').toBe(kept.length);
  chars.expected = fromChanges([
    { tag: 'Delete', old: 0, new: null, values: gone },
    { tag: 'Insert', old: null, new: 0, values: comeFlags.map((m, k): [boolean, string] => [m, [...chars.after.matchAll(/\S/g)][k]![0]]) },
  ], chars, /\S/g);

  const fBody = fnBody(src, 'test_line_ops_inline_issue_84_chars');
  const call = make('call', texts(fBody), /\S/g);
  const both = assertedValues(fBody);
  expect([both.get(0)?.map(([, t]) => t).join(''), both.get(1)?.map(([, t]) => t).join('')], 'the test asserts the old line\'s parts, then the new line\'s').toEqual([call.before, call.after]);
  call.expected = fromChanges([{ tag: 'Delete', old: 0, new: null, values: both.get(0)! }, { tag: 'Insert', old: null, new: 0, values: both.get(1)! }], call, /\S/g);
  return [words, chars, call];
}

// ---------------------------------------------------------------------------------------------------
// Running the cases on our code, and judging each.

const cases = memo(() => [...lcsCases(), ...inlineCases()]);
/** Every case's pair in one film, each pair at its own place and both its items at one place, under its own text_diff
 * over [0 s, 1 s]; its diff read at 0.5 s. */
const diffs = memo((): Map<string, Diff> => {
  const all = cases();
  const items: JsonObject[] = []; const transitions: JsonObject = {};
  all.forEach((c, i) => {
    const at: [number, number] = [40 + (i % 4) * 400, 40 + Math.floor(i / 4) * 190];
    const o = (tokens: Token[]): { size: number; lineHeight: number; numbers: boolean; tokens: Token[] } => ({ size: 12, lineHeight: 16, numbers: false, tokens });
    items.push(codeItem(`${c.name}-a`, c.before, at, o(c.beforeTokens)), codeItem(`${c.name}-b`, c.after, at, o(c.afterTokens)));
    transitions[c.name] = textDiff(`${c.name}-a`, `${c.name}-b`);
  });
  const doc = film('upstream-cases', 'The pinned diff tests on our code', [1680, 40 + Math.ceil(all.length / 4) * 190], items, { transitions });
  const [f] = filmsAt(binOf(), temp(), doc, [fl(0.5)], 'the pinned cases');
  return new Map(all.map((c) => [c.name, diffOf(f!, c.name, `${c.name}-a`, `${c.name}-b`, `the case ${c.name}`)]));
});

const sortPairs = (xs: [number, number][]): string => JSON.stringify([...xs].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
const sortList = (xs: number[]): string => JSON.stringify([...xs].sort((a, b) => a - b));
/** What our diff of a case does against the library's expectation: each token once, the kept tokens a common
 * subsequence (equal bytes, in order on both sides), and the alignment, or its length, as the library's. */
function caseFailures(c: Case, d: Diff): string[] {
  const f: string[] = [];
  const text = (raw: string, t: Token | undefined): string => (t ? raw.slice(t.from, t.to) : '?');
  c.beforeTokens.forEach((_, k) => { const n = d.pieces.filter((p) => p.from === k).length; if (n !== 1) f.push(`${c.name}: before token ${k} is in ${n} pieces, not one`); });
  c.afterTokens.forEach((_, k) => { const n = d.pieces.filter((p) => p.to === k).length; if (n !== 1) f.push(`${c.name}: after token ${k} is in ${n} pieces, not one`); });
  const kept = d.pieces.filter((p) => p.from !== null && p.to !== null).map((p): [number, number] => [p.from!, p.to!]).sort((a, b) => a[0] - b[0]);
  kept.forEach(([o, n], i) => {
    if (text(c.before, c.beforeTokens[o]) !== text(c.after, c.afterTokens[n])) f.push(`${c.name}: kept ${o} → ${n} pairs unequal tokens`);
    if (i > 0 && n <= kept[i - 1]![1]) f.push(`${c.name}: kept ${o} → ${n} crosses ${kept[i - 1]![0]} → ${kept[i - 1]![1]}`);
  });
  if (c.length !== undefined && kept.length !== c.length) f.push(`${c.name}: ${kept.length} tokens kept, not the longest common subsequence's ${c.length}`);
  if (c.expected) {
    const deleted = d.pieces.filter((p) => p.to === null && p.from !== null).map((p) => p.from!);
    const inserted = d.pieces.filter((p) => p.from === null && p.to !== null).map((p) => p.to!);
    if (sortPairs(kept) !== sortPairs(c.expected.kept)) f.push(`${c.name}: kept ${sortPairs(kept)}, not the library's ${sortPairs(c.expected.kept)}`);
    if (sortList(deleted) !== sortList(c.expected.deleted)) f.push(`${c.name}: gone ${sortList(deleted)}, not the library's ${sortList(c.expected.deleted)}`);
    if (sortList(inserted) !== sortList(c.expected.inserted)) f.push(`${c.name}: come ${sortList(inserted)}, not the library's ${sortList(c.expected.inserted)}`);
  }
  return f;
}
/** An alignment as a diff's pieces (boxes and opacities don't enter the judge). */
const piecesOf = (e: Expected): Diff => ({
  progress: 0.5,
  pieces: [
    ...e.kept.map(([o, n]): Piece => ({ from: o, to: n, box: [0, 0, 0, 0], opacity: 1 })),
    ...e.deleted.map((o): Piece => ({ from: o, to: null, box: [0, 0, 0, 0], opacity: 0.5 })),
    ...e.inserted.map((n): Piece => ({ from: null, to: n, box: [0, 0, 0, 0], opacity: 0.5 })),
  ],
});
const nothingKept = (c: Case): Diff => piecesOf({ kept: [], deleted: c.beforeTokens.map((_, k) => k), inserted: c.afterTokens.map((_, k) => k) });
const byPosition = (c: Case): Diff => {
  const n = Math.min(c.beforeTokens.length, c.afterTokens.length);
  return piecesOf({ kept: Array.from({ length: n }, (_, k): [number, number] => [k, k]), deleted: c.beforeTokens.map((_, k) => k).slice(n), inserted: c.afterTokens.map((_, k) => k).slice(n) });
};
const judge = (names: (c: Case) => boolean): string[] => cases().filter(names).flatMap((c) => caseFailures(c, diffs().get(c.name)!));

describe(`${ID} the pinned upstream diff tests, run on text_diff`, () => {
  it(`${ID} the LCS module's sequences, each as lines and as one line's tokens: test_diff's and test_pat's snapshots, the swapped and bad-range regressions' operations and the table test's lengths, on our alignment`, () => {
    const lcs = lcsCases();
    expect(lcs.map((c) => c.name), 'the ported LCS cases').toEqual(['diff-lines', 'diff-tokens', 'pat-lines', 'pat-tokens', 'swapped-lines', 'swapped-tokens', 'bad-range-lines', 'bad-range-tokens', 'table-0-lines', 'table-0-tokens', 'table-1-lines', 'table-1-tokens', 'table-2-lines', 'table-2-tokens']);
    for (const c of lcs) if (c.expected) none(caseFailures(c, piecesOf(c.expected)), `the judge passes the library's own alignment of ${c.name}`);
    const one = lcs.find((c) => c.name === 'diff-tokens')!;
    failsNaming(caseFailures(one, nothingKept(one)), [/not the library's/], 'planted: nothing kept');
    failsNaming(caseFailures(one, byPosition(one)), [/not the library's/], 'planted: tokens paired by position');
    const tie = lcs.find((c) => c.name === 'bad-range-lines')!;
    failsNaming(caseFailures(tie, piecesOf({ kept: [[0, 1]], deleted: [], inserted: [0] })), [/not the library's/], 'planted: the kept element placed at the later of two equal positions');
    const table = lcs.find((c) => c.name === 'table-0-tokens')!;
    failsNaming(caseFailures(table, nothingKept(table)), [/longest common subsequence/], 'planted: a common subsequence shorter than the longest');

    none(judge((c) => lcs.some((x) => x.name === c.name)), 'the LCS module\'s cases on our text_diff');
  }, TIMEOUT);

  it(`${ID} the inline module's line-then-token tests: test_line_ops_inline's snapshot by word, and the two character-mode tests' asserts, on our alignment`, () => {
    const inline = inlineCases();
    for (const c of inline) none(caseFailures(c, piecesOf(c.expected!)), `the judge passes the library's own alignment of ${c.name}`);
    const words = inline[0]!;
    failsNaming(caseFailures(words, byPosition(words)), [/not the library's/], 'planted: tokens paired by position, no line aligned first');

    none(judge((c) => inline.some((x) => x.name === c.name)), 'the inline module\'s cases on our text_diff');
  }, TIMEOUT);
});
