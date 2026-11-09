// Criteria 1 to 4 of #1550: chrome's wrapper, through both public routes chrome text wraps by (probe.rs), at the font
// the question card draws its rows in, judged against the fixtures and LineBreakTest.txt (README.md: How each criterion
// is read). Criterion 3's and 4's planted programs go through the same judges.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  AC, LINE_BREAK_TEST, ROUTES, TEXTS, allowListStarts, caseProblems, cut, fileClasses, interleave, lineBreakCases, listed, measure,
  narrowWidths, overflowProblems, spacesOnlyStarts, useProbe, widthOf, widthsFrom, wrapAll,
  type Case, type CaseWrapper, type Measure,
} from './helpers.ts';

useProbe();
const MINUTES = 60_000;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

it('#1550.1699487d (C1) Greek, Arabic, Hebrew and Devanagari sentences wrapped at every width from the longest word up never break inside a word', () => {
  const groups: string[][] = [];
  for (const [script, sentence] of Object.entries(TEXTS.words)) {
    const chars = [...sentence];
    const words = [...sentence.matchAll(/\S+/gu)].map((m) => {
      const from = [...sentence.slice(0, m.index)].length;
      return { from, to: from + [...m[0]].length, text: m[0] };
    });
    const [whole, ...each] = measure([sentence, ...words.map((w) => w.text)]) as [Measure, ...Measure[]];
    const longest = Math.max(...words.map((w, i) => Math.max(sum(whole.advances.slice(w.from, w.to)), each[i]!.shaped)));
    const widths = widthsFrom(Math.ceil(longest), Math.ceil(widthOf(whole)));
    expect(widths.length, `${script}: the sentence is wider than its longest word, so some width wraps it`).toBeGreaterThan(10);
    for (const route of ROUTES) {
      const seen = new Set<string>();
      const problems: string[] = [];
      groups.push(problems);
      wrapAll(route, [{ text: sentence, widths }])[0]!.forEach((starts, j) => {
        for (const k of starts) {
          let what: string;
          if (k <= 0 || k >= chars.length) what = `starts a line at offset ${k}, outside the sentence`;
          else if (/\s/u.test(chars[k - 1]!) || /\s/u.test(chars[k]!)) continue;
          else {
            const word = words.find((w) => w.from < k && k < w.to)!;
            what = `breaks inside "${chars.slice(word.from, k).join('')}|${chars.slice(k, word.to).join('')}"`;
          }
          const key = `${script}, ${route}: ${what}`;
          if (!seen.has(key)) { seen.add(key); problems.push(`${key} (first at ${widths[j]} px)`); }
        }
      });
    }
  }
  const problems = interleave(groups);
  expect(problems.length, listed(problems)).toBe(0);
}, 30 * MINUTES);

// Line_Break of the CJK fixture's characters: as LineBreakTest.txt names them, else from the two ranges whose every
// character is ID (CJK Unified Ideographs) or ID or CJ (hiragana and katakana letters), neither of them a class the
// criterion names. Anything else in the fixture is the fixture's error.
const START = new Set(['CL', 'CP', 'EX', 'IS', 'NS']);
const KNOWN = new Set(['ID', 'ID or CJ', 'CJ', 'OP', ...START]);
const letter = (cp: number): string | undefined =>
  cp >= 0x4e00 && cp <= 0x9fff ? 'ID' : (cp >= 0x3041 && cp <= 0x3096) || (cp >= 0x30a1 && cp <= 0x30fa) ? 'ID or CJ' : undefined;

it('#1550.575d9695 (C2) over a Chinese and a Japanese fixture at every width no line starts with CL, CP, EX, IS or NS and none ends with OP, unless one unbreakable cluster passes the width', () => {
  const named = fileClasses(lineBreakCases().cases);
  const groups: string[][] = [];
  for (const [lang, text] of Object.entries(TEXTS.cjk)) {
    const chars = [...text];
    const classes = chars.map((c) => named.get(c.codePointAt(0)!) ?? letter(c.codePointAt(0)!) ?? '?');
    const strange = chars.filter((_, i) => !KNOWN.has(classes[i]!));
    expect(strange, `${lang}: the fixture holds only ideographs, kana and the punctuation the criterion names`).toEqual([]);
    expect(classes.filter((c) => START.has(c) || c === 'OP').length, `${lang}: the fixture holds the classes the criterion names`).toBeGreaterThan(5);
    // A line may start at k unless k is one of the five classes or follows OP; between two such places is a cluster.
    const mayStart = (k: number): boolean => !START.has(classes[k]!) && classes[k - 1] !== 'OP';
    const edges = [0, ...chars.map((_, k) => k).filter((k) => k > 0 && mayStart(k)), chars.length];
    const [whole, ...clusters] = measure([text, ...edges.slice(0, -1).map((at, i) => chars.slice(at, edges[i + 1]).join(''))]) as [Measure, ...Measure[]];
    const clusterWidth = (k: number): number => {
      const i = edges.findIndex((e, j) => e < k && k < edges[j + 1]!);
      return Math.max(sum(whole.advances.slice(edges[i]!, edges[i + 1]!)), clusters[i]!.shaped);
    };
    const widths = widthsFrom(1, Math.ceil(widthOf(whole)));
    for (const route of ROUTES) {
      const seen = new Set<string>();
      const problems: string[] = [];
      groups.push(problems);
      wrapAll(route, [{ text, widths }])[0]!.forEach((starts, j) => {
        const w = widths[j]!;
        for (const k of starts) {
          let what: string;
          if (k <= 0 || k >= chars.length) what = `starts a line at offset ${k}, outside the text`;
          else if (mayStart(k) || clusterWidth(k) > w) continue;
          else if (classes[k - 1] === 'OP') what = `ends a line with "${chars[k - 1]}" (OP): "${cut(chars, k)}"`;
          else what = `starts a line with "${chars[k]}" (${classes[k]}): "${cut(chars, k)}"`;
          const key = `${lang}, ${route}: ${what}`;
          if (!seen.has(key)) { seen.add(key); problems.push(`${key} (first at ${w} px)`); }
        }
      });
    }
  }
  const problems = interleave(groups);
  expect(problems.length, listed(problems)).toBe(0);
}, 30 * MINUTES);

// Criterion 3: the file's cases, each wrapped at its narrow widths (helpers.ts, `narrowWidths`). Measured once for both tests.
let fileRun: { cases: Case[]; skipped: number; measures: Measure[]; widths: number[][] } | undefined;
function overTheFile(): NonNullable<typeof fileRun> {
  if (fileRun) return fileRun;
  const { cases, skipped } = lineBreakCases();
  const clusterTexts = cases.map((c) => {
    const edges = [0, ...[...c.allowed].sort((a, b) => a - b), c.cps.length];
    return edges.slice(0, -1).map((at, i) => c.chars.slice(at, edges[i + 1]).join(''));
  });
  const all = measure(cases.flatMap((c, i) => [c.text, ...clusterTexts[i]!]));
  let at = 0;
  const measures: Measure[] = [];
  const widths = cases.map((c, i) => {
    const m = all[at]!;
    const shaped = all.slice(at + 1, at + 1 + clusterTexts[i]!.length).map((x) => x.shaped);
    at += 1 + clusterTexts[i]!.length;
    measures.push(m);
    return narrowWidths(c, m, shaped);
  });
  fileRun = { cases, skipped, measures, widths };
  return fileRun;
}

it('#1550.8fc59257 (C3) every boundary chrome picks over LineBreakTest.txt at narrow widths is a break the file allows', () => {
  const { cases, skipped, measures, widths } = overTheFile();
  expect(cases.length, `LineBreakTest.txt's cases, ${skipped} with a mandatory break left out`).toBeGreaterThan(17_000);
  const problems = interleave(ROUTES.map((route) => caseProblems(cases, widths, measures, {
    name: route,
    wrap: (cs, ws) => wrapAll(route, cs.map((c, i) => ({ text: c.text, widths: ws[i]! }))),
  })));
  expect(problems.length, listed(problems)).toBe(0);
}, 60 * MINUTES);

it('#1550.8fc59257 (C3) wrong program: a planted allow-list path fails, naming the line', () => {
  const { cases, measures, widths } = overTheFile();
  const planted: CaseWrapper = {
    name: 'the planted allow-list path',
    wrap: (cs, ws, ms) => cs.map((c, i) => ws[i]!.map((w) => allowListStarts(c.chars, ms[i]!.advances, w))),
  };
  const problems = caseProblems(cases, widths, measures, planted);
  expect(problems.length, 'the allow-list path picks a break the file forbids').toBeGreaterThan(0);
  const fileLines = readFileSync(LINE_BREAK_TEST, 'utf8').split('\n');
  for (const problem of problems.slice(0, 50)) {
    const [, line, rule] = /^LineBreakTest\.txt:(\d+): .*: ([^:]+)$/.exec(problem) ?? [];
    expect(line, `the failure names a line of the file: ${problem}`).toBeDefined();
    expect(fileLines[Number(line) - 1]!.split('#')[0]!.trim(), `the line it names is the case it judged: ${problem}`).toBe(rule);
  }
  console.log(`${AC.file}: the planted allow-list path fails:\n${listed(problems, 5)}`);
}, 60 * MINUTES);

it('#1550.996d9be7 (C4) a 200-character path wraps inside a 300 px box', () => {
  const path = TEXTS.path;
  expect([...path].length, 'the fixture path is 200 characters').toBe(200);
  expect(widthOf(measure([path])[0]!), 'the path is wider than the box, so it has to wrap').toBeGreaterThan(300 * 2);
  const problems = ROUTES.flatMap((route) => overflowProblems(route, path, wrapAll(route, [{ text: path, widths: [300] }])[0]![0]!));
  expect(problems.length, listed(problems)).toBe(0);
}, 10 * MINUTES);

it('#1550.996d9be7 (C4) wrong program: a planted wrap that breaks only at spaces fails, naming the overflow', () => {
  const path = TEXTS.path;
  const starts = spacesOnlyStarts([...path], measure([path])[0]!.advances, 300);
  const problems = overflowProblems('the planted spaces-only wrap', path, starts);
  expect(problems.length, 'the spaces-only wrap leaves a line past the box').toBeGreaterThan(0);
  expect(problems[0], 'the failure names the overflow').toMatch(/^the planted spaces-only wrap: line 1 of 1 is [\d.]+ px wide, [\d.]+ px past the 300 px box: "\/srv\//);
  console.log(`${AC.path}: the planted spaces-only wrap fails:\n${listed(problems)}`);
}, 10 * MINUTES);
