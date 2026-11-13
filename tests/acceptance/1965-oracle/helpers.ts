// Test-side tools for the #1965 Oracle lane: the two Unicode files the issue's Oracle page pins (icu4x `b1cec62bb7`:
// NormalizationTest.txt and GraphemeBreakTest.txt), read where README says, parsed here, and run on our code through
// `deep-canvas-render check` and `raster` (the same surface tests/acceptance/1965 drives, its helpers imported by path).
// Nothing here stands in for our code: every shown string and glyph role compared with a file's value is our output.
//
// The files are Unicode data under the Unicode License v3 (https://www.unicode.org/license.txt, © Unicode, Inc.); nothing of
// them is copied into this folder, they are read in place.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';
import { REPO, render, type JsonObject, type JsonValue } from '../467/helpers.ts';
import { ITEM, LOOK_A, codeDoc, type Token } from '../1965/helpers.ts';

export { useBin, useDir } from '../1965/helpers.ts';

export const NORMALIZATION = 'icu4x-b1cec62bb7/components/normalizer/tests/data/NormalizationTest.txt';
export const GRAPHEMES = 'icu4x-b1cec62bb7/components/segmenter/tests/testdata/GraphemeBreakTest.txt';

/** Where the oracle checkout is: `DEEP_ORACLES` (the folder holding `vendor/`), else a sibling worktree of the `doneright` branch. */
export const ORACLES = process.env['DEEP_ORACLES'] ? resolve(process.env['DEEP_ORACLES']) : resolve(REPO, '..', 'deep-oracles', 'doneright', 'oracles');

/** The pinned file's text, or BLOCKED with the one thing to do (README: BLOCKED). */
export function vendored(rel: string): string {
  const path = join(ORACLES, 'vendor', rel);
  if (!existsSync(path)) {
    throw Error(`BLOCKED: the pinned upstream file vendor/${rel} is missing at ${path}. Unblock: check out branch doneright of DeepBuildAI/deepbuild as a worktree (git fetch origin doneright && git worktree add ../deep-oracles origin/doneright) or set DEEP_ORACLES to the folder that holds vendor/, then rerun.`);
  }
  return readFileSync(path, 'utf8');
}

const cps = (s: string): number[] => s.trim().split(/\s+/).filter((x) => x !== '').map((h) => Number.parseInt(h, 16));
/** A code point the lane leaves out of a raw: a C0 or C1 control (tab, line ends and the like are another step's, README) or a surrogate. */
const skipped = (c: number): boolean => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0xd800 && c <= 0xdfff);

/** NormalizationTest's inputs and the NFC form each must display as (c2 for c1, c2, c3; c4 for c4, c5). */
export function normalizationCases(): { cases: Map<string, string>; rows: number; skippedRows: number; conflicts: string[] } {
  const cases = new Map<string, string>(); const conflicts: string[] = [];
  let rows = 0; let skippedRows = 0;
  for (const raw of vendored(NORMALIZATION).split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '' || line.startsWith('@')) continue;
    const cols = line.split(';').slice(0, 5).map(cps);
    if (cols.length < 5) continue;
    rows += 1;
    if (cols.some((c) => c.some(skipped))) { skippedRows += 1; continue; }
    const text = cols.map((c) => String.fromCodePoint(...c));
    const pairs: [string, string][] = [[text[0]!, text[1]!], [text[1]!, text[1]!], [text[2]!, text[1]!], [text[3]!, text[3]!], [text[4]!, text[3]!]];
    for (const [input, want] of pairs) {
      const had = cases.get(input);
      if (had !== undefined && had !== want) conflicts.push(`${[...input].map((ch) => ch.codePointAt(0)!.toString(16)).join(' ')}: ${had} vs ${want}`);
      cases.set(input, want);
    }
  }
  return { cases, rows, skippedRows, conflicts };
}

/** GraphemeBreakTest's rows as clusters of strings (a `÷` breaks, a `×` doesn't). */
export function graphemeRows(): { rows: string[][]; skippedRows: number } {
  const rows: string[][] = []; let skippedRows = 0;
  for (const raw of vendored(GRAPHEMES).split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '') continue;
    const parts = line.split(/\s+/);
    const clusters: number[][] = [];
    let current: number[] | null = null;
    for (const p of parts) {
      if (p === '÷') { if (current) clusters.push(current); current = null; } else if (p === '×') { /* joined */ } else { (current ??= []).push(Number.parseInt(p, 16)); }
    }
    if (current) clusters.push(current);
    if (clusters.some((c) => c.some(skipped))) { skippedRows += 1; continue; }
    rows.push(clusters.map((c) => String.fromCodePoint(...c)));
  }
  return { rows, skippedRows };
}

// ---------------------------------------------------------------------------------------------------
// Running strings on our code: each as one code item (`raw` the string, one token class over the byte ranges)

export const hex = (s: string): string => [...s].map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
export const byteLen = (s: string): number => Buffer.byteLength(s, 'utf8');

const ids = (n: number): string => `r${n}`;
/** One document of code items `r0…`, item n holding `raws[n]` with `tokens[n]`. */
export function manyDoc(id: string, raws: string[], tokens: (Token[] | undefined)[]): JsonObject {
  const d = codeDoc(id, '');
  const items = d['items'] as JsonObject;
  delete items[ITEM];
  raws.forEach((raw, n) => {
    const one = (codeDoc(id, raw, { ...(tokens[n] ? { tokens: tokens[n]! } : {}), size: 24, extra: { name: true } })['items'] as JsonObject)[ITEM] as JsonObject;
    items[ids(n)] = { ...one, id: ids(n), name: ids(n), order: `a${n + 1}` };
  });
  return d;
}

export interface Text { shown: string; glyphs: { grapheme: number; role: string | null }[] }
/** Which of `raws` our `check` accepts as drawable: a string a face can't draw is refused `text.glyph_missing`, and left out; any other refusal is a failure. */
export function drawable(bin: string, raws: string[]): { ok: boolean[]; failures: string[] } {
  const ok: boolean[] = []; const failures: string[] = [];
  for (let from = 0; from < raws.length; from += 4000) {
    const chunk = raws.slice(from, from + 4000);
    const answers = render(bin, 'check', chunk.map((raw, n) => ({ doc: manyDoc(`o-${from + n}`, [raw], [undefined]), look: LOOK_A })));
    answers.forEach((a, n) => {
      const issues = ((a['issues'] as JsonObject[] | undefined) ?? []).filter((i) => i['severity'] === 'error');
      const missing = issues.some((i) => i['code'] === 'text.glyph_missing');
      const other = issues.filter((i) => i['code'] !== 'text.glyph_missing' && i['code'] !== 'number_unsourced');
      ok.push(!missing && other.length === 0);
      if (other.length > 0) failures.push(`${hex(chunk[n]!)} is refused by check for ${other.map((i) => String(i['code'])).join(', ')}`);
    });
  }
  return { ok, failures };
}
/** Each of `raws` drawn (100 to a document) with its tokens: the `texts` entry of each. A refused document is a failure. */
export function drawn(bin: string, dir: string, raws: string[], tokens: (Token[] | undefined)[]): { texts: Text[]; failures: string[] } {
  const texts: Text[] = []; const failures: string[] = [];
  const docs: JsonObject[] = []; const spans: number[] = [];
  for (let from = 0; from < raws.length; from += 100) {
    docs.push(manyDoc(`o-${from}`, raws.slice(from, from + 100), tokens.slice(from, from + 100)));
    spans.push(Math.min(100, raws.length - from));
  }
  const input = docs.map((d, n) => ({ out: join(dir, `o${process.pid}-${n}.png`), doc: d, look: LOOK_A, t: 0 }));
  for (let from = 0; from < input.length; from += 20) {
    const answers = render(bin, 'raster', input.slice(from, from + 20) as JsonValue[]);
    answers.forEach((a, k) => {
      const n = from + k;
      if (a['ok'] !== true) { failures.push(`the document of inputs ${n * 100}–${n * 100 + spans[n]! - 1} was refused: ${JSON.stringify(a).slice(0, 300)}`); for (let j = 0; j < spans[n]!; j++) texts.push({ shown: '\u0000refused', glyphs: [] }); return; }
      const all = a['texts'] as JsonObject;
      for (let j = 0; j < spans[n]!; j++) {
        const t = all[ids(j)] as JsonObject | undefined;
        const glyphs = ((t?.['glyphs'] as JsonObject[] | undefined) ?? []).map((g) => ({ grapheme: g['grapheme'] as number, role: typeof g['role'] === 'string' ? g['role'] : null }));
        texts.push({ shown: typeof t?.['shown'] === 'string' ? t['shown'] : '\u0000missing', glyphs });
      }
    });
  }
  expect(texts.length, 'one text per input').toBe(raws.length);
  return { texts, failures };
}
