// The blind redraft of #1550's criteria 1 and 3 (REDRAFT.md): the same criteria, fixtures, widths, oracle and planted
// program as `../wrap.test.ts`, with `shape_text`'s line starts read as the dispute asks (DISPUTE.md): a row's text is
// what its glyphs cover, the rows must be the text cut in order, and a row's start is the smallest offset it covers.
// The `wrap_line` route is read as before, from the original probe.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  AC, LINE_BREAK_TEST, ROUTES, TEXTS, allowListStarts, interleave, lineBreakCases, listed, measure, narrowWidths, useProbe,
  widthOf, widthsFrom, wrapAll,
  type Case, type Measure, type Route,
} from '../helpers.ts';
import { caseRowProblems, readRows, rowsAll, rowsOf, useRowsProbe, type RowRead, type RowWrapper } from './helpers.ts';

useProbe();
useRowsProbe();
const MINUTES = 60_000;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Each item's wrap at each of its widths, read by its route: `wrap_line`'s starts as given, `shape_text`'s rows. */
function readAll(route: Route, items: { text: string; widths: number[] }[]): RowRead[][] {
  if (route === 'wrap_line') return wrapAll(route, items).map((perWidth) => perWidth.map((starts) => ({ starts })));
  return rowsAll(items).map((perWidth, i) => perWidth.map((rows) => readRows(rows, [...items[i]!.text].length)));
}

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
      const note = (what: string, w: number, detail = ''): void => {
        const key = `${script}, ${route}: ${what}`;
        if (!seen.has(key)) { seen.add(key); problems.push(`${key} (first at ${w} px${detail})`); }
      };
      readAll(route, [{ text: sentence, widths }])[0]!.forEach(({ starts, order }, j) => {
        if (order) note("draws rows that aren't the sentence cut in text order", widths[j]!, `: ${order}`);
        for (const k of starts) {
          if (k <= 0 || k >= chars.length) note(`starts a line at offset ${k}, outside the sentence`, widths[j]!);
          else if (/\s/u.test(chars[k - 1]!) || /\s/u.test(chars[k]!)) continue;
          else {
            const word = words.find((w) => w.from < k && k < w.to)!;
            note(`breaks inside "${chars.slice(word.from, k).join('')}|${chars.slice(k, word.to).join('')}"`, widths[j]!);
          }
        }
      });
    }
  }
  const problems = interleave(groups);
  expect(problems.length, listed(problems)).toBe(0);
}, 30 * MINUTES);

// Criterion 3: the file's cases, each wrapped at its narrow widths (`../helpers.ts`, `narrowWidths`), as `../wrap.test.ts`
// measures them. Measured once for both tests.
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
  const problems = interleave(ROUTES.map((route) => caseRowProblems(cases, widths, measures, {
    name: route,
    read: (cs, ws) => readAll(route, cs.map((c, i) => ({ text: c.text, widths: ws[i]! }))),
  })));
  expect(problems.length, listed(problems)).toBe(0);
}, 60 * MINUTES);

it('#1550.8fc59257 (C3) wrong program: a planted allow-list path fails, naming the line', () => {
  const { cases, measures, widths } = overTheFile();
  const planted: RowWrapper = {
    name: 'the planted allow-list path',
    read: (cs, ws, ms) => cs.map((c, i) => ws[i]!.map((w) => readRows(rowsOf(allowListStarts(c.chars, ms[i]!.advances, w), c.cps.length), c.cps.length))),
  };
  const problems = caseRowProblems(cases, widths, measures, planted);
  expect(problems.length, 'the allow-list path picks a break the file forbids').toBeGreaterThan(0);
  const fileLines = readFileSync(LINE_BREAK_TEST, 'utf8').split('\n');
  for (const problem of problems.slice(0, 50)) {
    const [, line, rule] = /^LineBreakTest\.txt:(\d+): .*: ([^:]+)$/.exec(problem) ?? [];
    expect(line, `the failure names a line of the file: ${problem}`).toBeDefined();
    expect(fileLines[Number(line) - 1]!.split('#')[0]!.trim(), `the line it names is the case it judged: ${problem}`).toBe(rule);
  }
  console.log(`${AC.file}: the planted allow-list path fails:\n${listed(problems, 5)}`);
}, 60 * MINUTES);
