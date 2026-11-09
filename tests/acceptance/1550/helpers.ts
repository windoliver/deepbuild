// Test-side tools for #1550's acceptance tests (README.md): the probe built once and fed JSON lines, the fixtures,
// LineBreakTest.txt read as Unicode wrote it, the planted twin wrappers, and the judges each criterion shares with the
// twins it plants. Nothing here wraps text for the real wrapper: every boundary judged as chrome's comes from the probe,
// which runs GPUI's own text system (probe.rs). Every cargo and probe process is run to its end by spawnSync, so no
// process outlives a call.
//
// The allow-list in `allowListStarts` is ported from gpui-pre 0.3.9, `vendor/gpui-pre/src/text_system/line_wrapper.rs`
// (`LineWrapper::is_word_char`), Copyright Zed Industries, Inc., licensed under the Apache License, Version 2.0
// (vendor/gpui-pre-apple/LICENSE-APACHE). It is the planted wrong program criterion 3 names, nothing else.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, expect } from 'vitest';

export type Obj = { [key: string]: any };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');

/** The criteria's IDs: `#1550.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space
 * collapsed (scripts/proof-change.mjs, `criterionId`). */
export const AC = {
  words: '#1550.1699487d',
  closing: '#1550.575d9695',
  file: '#1550.8fc59257',
  path: '#1550.996d9be7',
  shown: '#1550.54f5f264',
} as const;

export const TEXTS = JSON.parse(readFileSync(join(FIXTURES, 'texts.json'), 'utf8')) as {
  words: Record<string, string>; cjk: Record<string, string>; path: string;
};

/** The two public routes chrome text wraps by (probe.rs). */
export const ROUTES = ['wrap_line', 'shape_text'] as const;
export type Route = (typeof ROUTES)[number];

// ---------------------------------------------------------------------------------------------------
// The probe: an example target of crates/deep-replica (README: What the implementer adds), built once per file.

const PROBE_NAME = 'acceptance_1550_probe';
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
export const PROBE_BIN = (): string => join(targetDir(), 'debug', 'examples', PROBE_NAME);
const BUILD = ['build', '--locked', '-p', 'deep-replica', '--features', 'env-plants', '--example', PROBE_NAME];

/** Builds the probe before the file's tests; a test whose build failed fails with cargo's own words. */
export function useProbe(): void {
  let error = '';
  beforeAll(() => {
    const run = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0 || !existsSync(PROBE_BIN())) {
      error = `cargo ${BUILD.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => /error|warning: unused/.test(l) || /^\s+-->/.test(l)).slice(0, 40).join('\n')}`;
    }
  }, 3_600_000);
  beforeEach(() => {
    if (error) expect.fail(`BLOCKED: the probe isn't built: ${error}`);
  });
}

/** One probe run: one JSON line in per call, one JSON line back per call, each `ok`. */
export function probe(calls: Obj[]): Obj[] {
  if (!calls.length) return [];
  const run = spawnSync(PROBE_BIN(), [], {
    cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 1_800_000,
  });
  if (run.error) expect.fail(`BLOCKED: the probe could not run: ${run.error.message}`);
  const lines = run.stdout.split('\n').filter((l) => l !== '');
  if (run.status !== 0 || lines.length !== calls.length) {
    expect.fail(`BLOCKED: the probe answered ${lines.length} of ${calls.length} calls and exited ${run.status} ${run.signal ?? ''}:\n${run.stderr.slice(-2000)}`);
  }
  return lines.map((line, i) => {
    const reply = JSON.parse(line) as Obj;
    if (reply.ok !== true) expect.fail(`BLOCKED: the probe refused ${JSON.stringify(calls[i]).slice(0, 300)}: ${line.slice(0, 300)}`);
    return reply;
  });
}

export interface Measure { advances: number[]; shaped: number }
/** Each text's per-code-point advances (as the wrapper reads them) and its width shaped as one line. */
export function measure(texts: string[]): Measure[] {
  const out: Measure[] = [];
  for (let i = 0; i < texts.length; i += 4000) {
    out.push(...probe([{ call: 'measure', texts: texts.slice(i, i + 4000) }])[0]!.measures as Measure[]);
  }
  return out;
}
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
/** The wider of the two measures: what a word or cluster needs under either route. */
export const widthOf = (m: Measure, from = 0, to = m.advances.length): number => Math.max(sum(m.advances.slice(from, to)), m.shaped);

/** For each item, for each of its widths, the code point offsets where a line after the first starts. */
export function wrapAll(route: Route, items: { text: string; widths: number[] }[]): number[][][] {
  return probe(items.map(({ text, widths }) => ({ call: 'wrap', route, text, widths }))).map((r) => r.starts as number[][]);
}

/** Every integer width from `from` to `to`, both included. */
export const widthsFrom = (from: number, to: number): number[] => Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i);

/** The text around code point `k` with a `|` where a line starts. */
export function cut(chars: string[], k: number, around = 8): string {
  const before = chars.slice(Math.max(0, k - around), k).join('');
  const after = chars.slice(k, k + around).join('');
  return `${k - around > 0 ? '…' : ''}${before}|${after}${k + around < chars.length ? '…' : ''}`;
}

// ---------------------------------------------------------------------------------------------------
// LineBreakTest.txt (vendor/unicode-17.0.0, Unicode 17.0.0, the version deep-text's segmenter runs).

export const LINE_BREAK_TEST = join(REPO, 'vendor', 'unicode-17.0.0', 'LineBreakTest.txt');
export interface Case { line: number; source: string; cps: number[]; chars: string[]; text: string; allowed: Set<number>; classes: string[] }
/** Mandatory breaks (BK, CR, LF, NL): a wrapper is handed one line, so a case holding one is left out. */
const MANDATORY = new Set([0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029]);

/** Every case of the file, by its line number; `allowed` holds each interior offset the file marks ÷. */
export function lineBreakCases(): { cases: Case[]; skipped: number } {
  const lines = readFileSync(LINE_BREAK_TEST, 'utf8').split('\n');
  const cases: Case[] = [];
  let skipped = 0;
  lines.forEach((raw, i) => {
    const [rule, comment = ''] = raw.split('#');
    const tokens = rule!.trim().split(/\s+/).filter((t) => t !== '');
    if (!tokens.length) return;
    const cps: number[] = [];
    const allowed = new Set<number>();
    for (const token of tokens) {
      if (token === '÷') { if (cps.length > 0) allowed.add(cps.length); }
      else if (token !== '×') cps.push(parseInt(token, 16));
    }
    allowed.delete(cps.length);
    // The comment names each code point's class, in order: `× [0.3] NAME (CLASS) × [rule] NAME (CLASS) ÷ [0.3]`.
    const classes = comment.split(/\s[×÷]\s/).map((s) => /\(([A-Za-z0-9_]+)\)\s*$/.exec(s.trim())?.[1]).filter((c): c is string => !!c && !/^\d/.test(c));
    if (cps.some((cp) => MANDATORY.has(cp))) { skipped++; return; }
    const chars = cps.map((cp) => String.fromCodePoint(cp));
    cases.push({ line: i + 1, source: raw, cps, chars, text: chars.join(''), allowed, classes: classes.slice(-cps.length) });
  });
  return { cases, skipped };
}

/** Line_Break as the file names it (`CL_EastAsian`, `NSorigmEastAsian` -> CL, NS), for every code point it shows. */
export function fileClasses(cases: Case[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const c of cases) {
    if (c.classes.length !== c.cps.length) continue;
    c.cps.forEach((cp, i) => map.set(cp, /^(ZWJ|[A-Z][A-Z0-9])/.exec(c.classes[i]!)![1]!));
  }
  return map;
}

// ---------------------------------------------------------------------------------------------------
// The planted twins: greedy wrappers over the probe's own advances, with a rule for where a line may start.

/** Greedy wrap: fill each line; past the width, start the next line at the last place the rule allows, else (with
 * `breakAnywhere`, as gpui-pre does) here, else nowhere, so the line runs past the width. */
export function greedyStarts(advances: number[], width: number, mayStart: (k: number) => boolean, breakAnywhere: boolean): number[] {
  const starts: number[] = [];
  let lineStart = 0;
  let filled = 0;
  let last = -1;
  for (let k = 0; k < advances.length; k++) {
    if (k > lineStart && mayStart(k)) last = k;
    filled += advances[k]!;
    if (filled > width && k > lineStart && (last > lineStart || breakAnywhere)) {
      const at = last > lineStart ? last : k;
      starts.push(at);
      lineStart = at;
      last = -1;
      filled = sum(advances.slice(at, k + 1));
    }
  }
  return starts;
}

/** gpui-pre 0.3.9's allow-list of word characters (see the notice at the top of this file). */
function isWordChar(c: string): boolean {
  const cp = c.codePointAt(0)!;
  return /^[A-Za-z0-9]$/.test(c)
    || (cp >= 0x00c0 && cp <= 0x024f) || (cp >= 0x0400 && cp <= 0x04ff) || (cp >= 0x1e00 && cp <= 0x1eff)
    || (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x0980 && cp <= 0x09ff)
    || "-_.'’‘$%@#^~,=:;".includes(c) || '!)]}"”»…'.includes(c) || c === '⋯' || [0x202f, 0x00a0, 0x2011].includes(cp);
}
/** Criterion 3's planted program: the allow-list path, where any character off the list may start a line. */
export const allowListStarts = (chars: string[], advances: number[], width: number): number[] =>
  greedyStarts(advances, width, (k) => (isWordChar(chars[k]!) ? chars[k - 1] === ' ' : chars[k] !== ' '), true);
/** Criterion 4's planted program: a wrap that breaks only at spaces. */
export const spacesOnlyStarts = (chars: string[], advances: number[], width: number): number[] =>
  greedyStarts(advances, width, (k) => /\s/.test(chars[k - 1]!) && !/\s/.test(chars[k]!), false);

// ---------------------------------------------------------------------------------------------------
// The judges a criterion shares with its planted twin.

/** A wrapper over LineBreakTest's cases: for each case, for each width, the line starts it picks. */
export type CaseWrapper = { name: string; wrap: (cases: Case[], widths: number[][], measures: Measure[]) => number[][][] };

/** Criterion 3's widths: from just past the case's widest unbreakable cluster (the text between two breaks the file
 * allows, its trailing spaces in it), every px up to the whole case, at most 25 of them. At these widths every cluster
 * fits, so a wrapper never has to break where the file says ×. */
export function narrowWidths(c: Case, m: Measure, clusterShaped: number[]): number[] {
  const edges = [0, ...[...c.allowed].sort((a, b) => a - b), c.cps.length];
  let widest = 0;
  for (let i = 0; i + 1 < edges.length; i++) widest = Math.max(widest, sum(m.advances.slice(edges[i], edges[i + 1])), clusterShaped[i]!);
  const from = Math.ceil(widest) + 1;
  const to = Math.min(Math.ceil(widthOf(m)), from + 24);
  return widthsFrom(from, to);
}

/** Every line start a wrapper picks over the file that the file doesn't allow, each naming its line in the file. */
export function caseProblems(cases: Case[], widths: number[][], measures: Measure[], wrapper: CaseWrapper): string[] {
  const starts = wrapper.wrap(cases, widths, measures);
  const problems: string[] = [];
  cases.forEach((c, i) => {
    widths[i]!.forEach((w, j) => {
      for (const k of starts[i]![j]!) {
        if (k > 0 && k < c.cps.length && c.allowed.has(k)) continue;
        const where = k > 0 && k < c.cps.length
          ? `between U+${c.cps[k - 1]!.toString(16).toUpperCase().padStart(4, '0')} and U+${c.cps[k]!.toString(16).toUpperCase().padStart(4, '0')}, where the file has ×`
          : `at offset ${k}, which isn't between two code points of the case`;
        problems.push(`LineBreakTest.txt:${c.line}: ${wrapper.name} at ${w} px starts a line ${where}: ${c.source.split('#')[0]!.trim()}`);
      }
    });
  });
  return problems;
}

/** Criterion 4's judge: each line of the wrapped path, shaped as drawn, inside the box; else the overflow, named. */
export const BOX = 300;
/** Half a point: the line is measured shaped alone, the wrapper may measure it by advances. */
export const BOX_SLACK = 0.5;
export function overflowProblems(name: string, path: string, starts: number[]): string[] {
  const chars = [...path];
  const edges = [0, ...starts, chars.length];
  const lines = edges.slice(0, -1).map((at, i) => chars.slice(at, edges[i + 1]).join(''));
  const problems: string[] = [];
  if (lines.join('') !== path) problems.push(`${name}: its lines don't make the path again: ${JSON.stringify(lines)}`);
  measure(lines).forEach((m, i) => {
    if (m.shaped > BOX + BOX_SLACK) {
      problems.push(`${name}: line ${i + 1} of ${lines.length} is ${m.shaped.toFixed(1)} px wide, ${(m.shaped - BOX).toFixed(1)} px past the ${BOX} px box: "${lines[i]}"`);
    }
  });
  return problems;
}

/** Problems from several groups (a script and a route, say), taken in turn, so the first few show every group. */
export function interleave(groups: string[][]): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < groups.reduce((n, g) => n + g.length, 0); i++) for (const g of groups) if (i < g.length) out.push(g[i]!);
  return out;
}
/** A list of problems as one message: the count and the first few. */
export const listed = (problems: string[], first = 30): string =>
  `${problems.length} problem(s)${problems.length > first ? `, the first ${first}` : ''}:\n${problems.slice(0, first).join('\n')}`;
