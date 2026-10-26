// AC3: line breaks, bidi order and grapheme boundaries match LineBreakTest.txt, BidiCharacterTest.txt and
// GraphemeBreakTest.txt at the pinned Unicode version (17.0.0, vendor/unicode-17.0.0/) on every line; a
// planted breaker that breaks only at spaces fails the first file and a planted layout that draws an
// Arabic run in logical order fails the second, each naming the first line that differs.
// Every line of each file goes through `deep-text breaks`, `bidi` or `graphemes` in one process. A line
// the pinned segmenter tailors may be listed, with its reason, in crates/deep-text/conformance/
// tailored.json (README: Tailored lines); the list must be exactly the lines that differ, so nothing is
// skipped silently. The shaper's own layout is held to LineBreakTest too: on its ASCII lines, `fit` at
// a width of 0 lays out one line per segment the file marks. At the base, deep-text has none of the
// three subcommands (it answers bad_command).

import { describe, expect, it } from 'vitest';
import {
  TEXT_BIN, accepted, batch, bidiCases, breakCases, conformance, conformanceMessage, num, sameInts, tailoredLines, textOf, useBinaries,
  type BidiCase, type BreakCase, type JsonObject, type JsonValue,
} from './helpers.ts';

useBinaries('deep-text');

const LB = 'LineBreakTest.txt';
const GB = 'GraphemeBreakTest.txt';
const BIDI = 'BidiCharacterTest.txt';

function tailored(): ReturnType<typeof tailoredLines>['entries'] {
  const t = tailoredLines();
  expect(t.problems, 'the tailored-lines list names each line and its reason').toEqual([]);
  if (t.entries.length) console.log(`tailored lines (${t.entries.length}):\n${t.entries.map((e) => `${e.file}:${e.line} ${e.reason}`).join('\n')}`);
  return t.entries;
}

const breaksDiff = (c: BreakCase, a: JsonObject): string | null =>
  sameInts(a['breaks'], c.breaks) ? null : `breaks at ${JSON.stringify(a['breaks'])}, the file at ${JSON.stringify(c.breaks)}`;

function bidiDiff(c: BidiCase, a: JsonObject): string | null {
  if (a['paragraph'] !== c.paragraph) return `paragraph level ${JSON.stringify(a['paragraph'])}, the file ${c.paragraph}`;
  const levels = a['levels'];
  if (!Array.isArray(levels) || levels.length !== c.levels.length || levels.some((l, i) => l !== c.levels[i])) {
    return `levels ${JSON.stringify(levels)}, the file ${JSON.stringify(c.levels)}`;
  }
  return sameInts(a['order'], c.order) ? null : `visual order ${JSON.stringify(a['order'])}, the file ${JSON.stringify(c.order)}`;
}

const lbInputs = (cases: BreakCase[], planted?: string): JsonValue[] => cases.map((c) => ({ text: textOf(c.cps), ...(planted ? { planted } : {}) }));
const bidiInputs = (cases: BidiCase[], planted?: string): JsonValue[] => cases.map((c) => ({ text: textOf(c.cps), dir: c.dir, ...(planted ? { planted } : {}) }));

/** The planted breaker's rule, here: a break after each run of spaces, and at the end, nowhere else. */
function spaceBreaks(cps: number[]): number[] {
  const out: number[] = [];
  for (let k = 1; k <= cps.length; k++) if (k === cps.length || (cps[k - 1] === 0x20 && cps[k] !== 0x20)) out.push(k);
  return out;
}

/** The first answer that isn't an acceptance, or null. */
const refusal = (answers: JsonValue[]): JsonValue | null => answers.find((a) => (a as JsonObject)?.['ok'] !== true) ?? null;

const ARABIC = [[0x0600, 0x06ff], [0x0750, 0x077f], [0x0870, 0x089f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff], [0x10ec0, 0x10eff], [0x1ee00, 0x1eeff]];
const isArabic = (cp: number): boolean => ARABIC.some(([a, b]) => cp >= a! && cp <= b!);

describe('AC3 line breaks, bidi order and grapheme boundaries match Unicode\'s conformance files at the pinned version on every line', () => {
  it(`AC3 every line of ${LB} (Unicode 17.0.0): the shaper's break opportunities are the file's, and its layout at a width of 0 breaks the file's ASCII lines into the file's segments`, () => {
    const t = tailored();
    const cases = breakCases(LB);
    expect(cases.length, `${LB} holds its test lines`).toBe(19338);
    const r = conformance(LB, cases, batch(TEXT_BIN, ['breaks'], lbInputs(cases)), breaksDiff, t, true);
    expect(r.failures, conformanceMessage(LB, r)).toEqual([]);
    // The opportunities are the layout's: on the file's ASCII lines (printable ASCII, a space never
    // first), the one shaper laying the text out at a width of 0 starts a line at every opportunity.
    const listed = new Set(t.filter((e) => e.file === LB).map((e) => e.line));
    const ascii = cases.filter((c) => !listed.has(c.line) && c.cps.every((cp, k) => (cp >= 0x21 && cp <= 0x7e) || (cp === 0x20 && k > 0)));
    expect(ascii.length, 'the file holds ASCII lines').toBeGreaterThan(300);
    const laid = accepted(TEXT_BIN, ['fit'], ascii.map((c) => ({ text: textOf(c.cps), box: { w: 0 }, overflow: 'mask' })));
    const wrong = ascii.flatMap((c, i) => {
      const lines = num(laid[i]!['lines'], `fit ${LB}:${c.line}: lines`);
      return lines === c.breaks.length ? [] : [`${LB}:${c.line} ${JSON.stringify(textOf(c.cps))}: the layout makes ${lines} lines, the file ${c.breaks.length} segments`];
    });
    expect(wrong, 'the shaper\'s layout breaks where its break opportunities are').toEqual([]);
  }, 1_800_000);

  it(`AC3 every line of ${GB} (Unicode 17.0.0): the shaper's grapheme boundaries are the file's; a doctored answer that takes each code point for a grapheme fails, naming the first line that differs`, () => {
    const t = tailored();
    const cases = breakCases(GB);
    expect(cases.length, `${GB} holds its test lines`).toBe(766);
    const answers = batch(TEXT_BIN, ['graphemes'], cases.map((c) => ({ text: textOf(c.cps) })));
    const r = conformance(GB, cases, answers, breaksDiff, t, true);
    expect(r.failures, conformanceMessage(GB, r)).toEqual([]);
    // The check's twin: every code point boundary reported as a grapheme boundary.
    const listed = new Set(t.filter((e) => e.file === GB).map((e) => e.line));
    const perCodePoint = cases.map((c) => ({ ok: true, breaks: c.cps.map((_, k) => k + 1) }));
    const twin = conformance(GB, cases, perCodePoint, breaksDiff, t, false);
    const expected = cases.find((c) => !listed.has(c.line) && !sameInts(c.cps.map((_, k) => k + 1), c.breaks))!.line;
    expect(twin.first, conformanceMessage(GB, twin)).toBe(expected);
    expect(conformanceMessage(GB, twin), 'the twin\'s failure names the first line that differs').toContain(`${GB}:${expected}`);
  }, 1_800_000);

  it(`AC3 every line of ${BIDI} (Unicode 17.0.0): the paragraph level, each character's resolved level (none where X9 removes it) and the visual order the shaper's layout draws are the file's`, () => {
    const t = tailored();
    const cases = bidiCases();
    expect(cases.length, `${BIDI} holds its test lines`).toBe(91707);
    const r = conformance(BIDI, cases, batch(TEXT_BIN, ['bidi'], bidiInputs(cases)), bidiDiff, t, true);
    expect(r.failures, conformanceMessage(BIDI, r)).toEqual([]);
  }, 1_800_000);

  it(`AC3 the planted breaker that breaks only at spaces fails ${LB}, naming the first line that differs`, () => {
    const t = tailored();
    const cases = breakCases(LB);
    const listed = new Set(t.filter((e) => e.file === LB).map((e) => e.line));
    const expected = cases.find((c) => !listed.has(c.line) && !sameInts(spaceBreaks(c.cps), c.breaks))!.line;
    const answers = batch(TEXT_BIN, ['breaks'], lbInputs(cases, 'space_breaker'));
    expect(refusal(answers), 'the planted breaker answers every line').toBeNull();
    // The plant is the breaker the criterion names: its answers are a space-only breaker's.
    const notSpaceOnly = cases.filter((c, i) => !sameInts((answers[i] as JsonObject)['breaks'], spaceBreaks(c.cps)));
    expect(notSpaceOnly.map((c) => c.line).slice(0, 10), 'the planted breaker breaks after runs of spaces and at the end, nowhere else').toEqual([]);
    const r = conformance(LB, cases, answers, breaksDiff, t, false);
    expect(r.first, `the planted breaker fails ${LB} first at line ${expected}: ${conformanceMessage(LB, r)}`).toBe(expected);
    expect(conformanceMessage(LB, r), 'its failure names the first line that differs').toContain(`the first is ${LB}:${expected}`);
  }, 1_800_000);

  it(`AC3 the planted layout that draws an Arabic run in logical order fails ${BIDI}, naming the first line that differs, a line with an Arabic run at an odd level`, () => {
    const t = tailored();
    const cases = bidiCases();
    const answers = batch(TEXT_BIN, ['bidi'], bidiInputs(cases, 'logical_arabic'));
    expect(refusal(answers), 'the planted layout answers every line').toBeNull();
    const r = conformance(BIDI, cases, answers, bidiDiff, t, false);
    expect(r.first, `the planted layout fails ${BIDI}: ${conformanceMessage(BIDI, r)}`).not.toBeNull();
    const line = cases.find((c) => c.line === r.first)!;
    expect(line.cps.some((cp, i) => isArabic(cp) && (line.levels[i] ?? 0) % 2 === 1), `${BIDI}:${r.first}, where it first fails, holds an Arabic character at an odd level`).toBe(true);
    expect(r.failures[0], 'its failure names the first line that differs, by the visual order').toMatch(new RegExp(`^${BIDI}:${r.first}: visual order`));
    expect(conformanceMessage(BIDI, r), 'its failure names the first line that differs').toContain(`the first is ${BIDI}:${r.first}`);
    // Lines with no Arabic at an odd level never differ: the plant only draws Arabic runs in logical order.
    const listed = new Set(t.filter((e) => e.file === BIDI).map((e) => e.line));
    const elsewhere = cases.filter((c, i) => !listed.has(c.line) && !c.cps.some((cp, j) => isArabic(cp) && (c.levels[j] ?? 0) % 2 === 1)
      && bidiDiff(c, answers[i] as JsonObject) !== null);
    expect(elsewhere.map((c) => c.line).slice(0, 10), 'the planted layout differs only on lines with an Arabic run at an odd level').toEqual([]);
  }, 1_800_000);
});
