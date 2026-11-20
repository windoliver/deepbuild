// Test-side tools for the #1430 acceptance tests (README: The surface under test). Every reading comes from the one
// shaper's binary: `deep-text shape`, #856's JSON lines with the fields this suite adds (`caches` on every reply, `run`
// on request), and `deep-text fonts` (#390, #417), built in release and driven through #856's helpers; and, for AC4,
// from benchmarks/budgets.json, read with scripts/benchmark.mjs's validator and judged by the task's own judge through
// #224's helpers. This file adds the texts the criteria name, made here deterministically or from a recorded seed, the
// readers of the added fields, and each criterion's check, which returns its failures as sentences naming what failed.
// Nothing here stands in for the shaper, its caches or the bench.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { judgeTask, load, seeded, standing, type Task } from '../224/helpers.ts';
import {
  REPO, TEXT_BIN, arr, count, isObject, named, num, obj, prose, runLines, shapeReply, str,
  type JsonObject, type JsonValue, type ShapeReply,
} from '../856/helpers.ts';

export { judgeTask, load, standing, type Task };
export { isObject, useRelease, type JsonObject, type JsonValue, type ShapeReply } from '../856/helpers.ts';

/** Each criterion's tag: `#1430.` and the first eight hex digits of the SHA-256 of its text, trimmed and its white space
 * collapsed (scripts/budget-window.mjs's criterionId), computed from the live issue. */
export const AC = { 1: 'AC1 #1430.76f8be84', 2: 'AC2 #1430.c8134c7e', 3: 'AC3 #1430.550b2a5e', 4: 'AC4 #1430.8a0fdfd2' } as const;
/** The bare ID, `#1430.xxxxxxxx`, of a tag. */
export const idOf = (tag: string): string => tag.split(' ')[1]!;
/** Every test's timeout: a release build on a loaded, shared machine may come first. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// Verdicts

/** A test that can't be judged here fails with this word, never passes. */
export function inconclusive(why: string): never {
  expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
}
/** A test whose input is missing fails with this word, never passes. */
export function blocked(why: string): never {
  expect.fail(`BLOCKED: ${why}; this is not a pass`);
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one matching each pattern: what a planted program must give. */
export function failsNaming(failures: readonly string[], patterns: readonly RegExp[], what: string): void {
  expect(failures.length, `${what} fails the check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const pattern of patterns) {
    expect(failures.some((f) => pattern.test(f)), `${what}: a failure matches ${pattern}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}
/** The number the first failure matching `pattern` names in its first group, commas dropped: a planted program's count. */
export function countIn(failures: readonly string[], pattern: RegExp, what: string): number {
  const found = failures.map((f) => pattern.exec(f)).find((m) => m !== null);
  expect(found, `${what}: a failure matches ${pattern}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBeTruthy();
  return Number(found![1]!.replace(/,/g, ''));
}
/** A value for a message. */
export const show = (value: unknown): string => JSON.stringify(value)?.slice(0, 1500) ?? 'undefined';
const grouped = (n: number): string => n.toLocaleString('en-US');

// ---------------------------------------------------------------------------------------------------
// `deep-text shape` (README: The surface under test)

/** `deep-text shape [--planted <name>]` over `inputs` in one process: each answer line as it came, and as #856 reads it. */
export function shapeLines(inputs: readonly JsonObject[], planted?: string): { raw: JsonValue[]; replies: ShapeReply[] } {
  const args = ['shape', ...(planted ? ['--planted', planted] : [])];
  const { lines } = runLines(TEXT_BIN, args, [...inputs]);
  return { raw: lines, replies: lines.map((line, i) => shapeReply(line, `deep-text ${args.join(' ')}, line ${i + 1}`)) };
}

/** A shaping's text as the paragraph it shaped: without the `\n` that ends it, when it carries one. */
export const asParagraph = (text: string): string => (text.endsWith('\n') ? text.slice(0, -1) : text);

/** One layout of `text`, `w` px wide: the body face at 13 px (`shape`'s defaults), drawn whole (`overflow: mask`), never cut. */
export const layoutAt = (text: string, w: number): JsonObject => ({ text, box: { w }, overflow: 'mask' });

// ---------------------------------------------------------------------------------------------------
// The long text (AC1, AC3): 100 paragraphs, one `\n` after each but the last

/** Paragraphs in the long text. */
export const PARAGRAPHS = 100;
/** Paragraph k: 512 characters of #856's lowercase words, by a stride and an offset of its own, so no two are equal. */
export const paragraph = (k: number): string => prose(512, 1 + (k % 22), (7 * k) % 23);
/** 51,299 bytes of ASCII: past 50 KB read as 50,000 bytes or as 51,200. */
export const LONG_TEXT = Array.from({ length: PARAGRAPHS }, (_, k) => paragraph(k)).join('\n');
/** AC3's typed character: `q`, typed at character 256 of paragraph 42 (index 41), mid-text and mid-word. */
export const TYPED = { paragraph: 41, at: 256, char: 'q' } as const;
/** Paragraph 42 with the typed character: 513 characters. */
export const TYPED_PARAGRAPH = `${paragraph(TYPED.paragraph).slice(0, TYPED.at)}${TYPED.char}${paragraph(TYPED.paragraph).slice(TYPED.at)}`;
/** The long text with the typed character. */
export const TYPED_TEXT = Array.from({ length: PARAGRAPHS }, (_, k) => (k === TYPED.paragraph ? TYPED_PARAGRAPH : paragraph(k))).join('\n');

/** What the tests first hold the long text to, so a slip in the fixture reads as one. */
export function longTextFailures(): string[] {
  const f: string[] = [];
  const paragraphs = LONG_TEXT.split('\n');
  const bytes = Buffer.byteLength(LONG_TEXT, 'utf8');
  if (paragraphs.length !== PARAGRAPHS || new Set(paragraphs).size !== PARAGRAPHS) f.push(`the long text holds ${new Set(paragraphs).size} distinct paragraphs of ${paragraphs.length}, not ${PARAGRAPHS}`);
  if (paragraphs.some((p) => p.length === 0)) f.push('the long text holds an empty paragraph');
  if (bytes < 51_200) f.push(`the long text is ${grouped(bytes)} bytes, under 50 KB`);
  if (TYPED_TEXT.length !== LONG_TEXT.length + 1 || TYPED_TEXT.split('\n')[TYPED.paragraph] !== TYPED_PARAGRAPH) f.push('the typed text is not the long text with one character typed into one paragraph');
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC1: 100 widths in turn, and the scope's two caches

/** AC1's widths: 160 to 853 px by 7, widest and narrowest alternating (853, 160, 846, 167, …), so no layout can stand in
 * for the one after it. Every word of the long text is far narrower than 160 px at 13 px. */
export const WIDTHS: number[] = Array.from({ length: 100 }, (_, k) => 160 + 7 * (k % 2 === 0 ? 99 - k / 2 : (k - 1) / 2));
/** How far a line's advance may pass its box: parley counts the space that hangs at a wrapped line's end in its advance,
 * which is under an em; a layout made at another width is hundreds of px off. */
const HANG = 13;

/**
 * AC1's count: one layout of `text` per width, in turn, in one process (`replies`, one per width). The first layout
 * shapes each paragraph of the text once and nothing else; every later one shapes nothing; each shows the text whole, at
 * its own width. The last failure counts the shapings.
 */
export function widthFailures(text: string, widths: readonly number[], replies: readonly ShapeReply[]): string[] {
  const [first, ...later] = replies;
  if (!first || replies.length !== widths.length) return [`${replies.length} replies for ${widths.length} widths`];
  const failures: string[] = [];
  const paragraphs = text.split('\n');
  const index = new Map(paragraphs.map((p, i) => [p, i] as const));
  const times = paragraphs.map(() => 0);
  let strays = 0;
  for (const s of first.shaped) {
    const i = index.get(asParagraph(s.text));
    if (i !== undefined) times[i] = (times[i] ?? 0) + 1;
    else if (strays++ < 3) failures.push(`line 1, at ${widths[0]} px, shaped ${named(s.text)}, ${grouped(s.glyphs)} glyphs, which is no paragraph of the text: a long text shapes per paragraph`);
  }
  const off = times.flatMap((n, i) => (n === 1 ? [] : [`paragraph ${i + 1} ${n} times`]));
  if (off.length) failures.push(`line 1, the text's first layout, shaped ${off.slice(0, 5).join(', ')}${off.length > 5 ? `, and ${off.length - 5} more paragraphs other than once` : ''}, where each paragraph is shaped once`);
  let again = 0;
  let glyphs = 0;
  let told = 0;
  later.forEach((r, k) => {
    if (r.shaped.length === 0) return;
    const g = r.shaped.reduce((sum, s) => sum + s.glyphs, 0);
    again += r.shaped.length;
    glyphs += g;
    if (told++ < 3) failures.push(`line ${k + 2}, laid out at ${widths[k + 1]} px, shaped ${grouped(r.shaped.length)} ${r.shaped.length === 1 ? 'text' : 'texts'} again, ${grouped(g)} glyphs (${r.shaped.slice(0, 2).map((s) => named(s.text)).join(', ')}${r.shaped.length > 2 ? ', …' : ''}), though line 1 had shaped every paragraph`);
  });
  let wrong = 0;
  replies.forEach((r, k) => {
    if (r.shown !== text && wrong++ < 3) failures.push(`line ${k + 1} shows ${named(r.shown)}, not the text whole`);
    if (r.width > widths[k]! + HANG && wrong++ < 3) failures.push(`line ${k + 1} is ${r.width} px wide at ${widths[k]} px, past its box by more than an em: it wasn't laid out at its width`);
  });
  const shapings = (n: number): string => `${grouped(n)} ${n === 1 ? 'shaping' : 'shapings'}`;
  if (failures.length) failures.push(`over ${widths.length} widths, the first layout made ${shapings(first.shaped.length)} for the text's ${paragraphs.length} paragraphs, and the ${later.length} layouts after it made ${shapings(again)}, ${grouped(glyphs)} glyphs, where a width change makes none`);
  return failures;
}

/** The base's shaped-run cache bound (`BOUND`, `32 << 20`, in crates/deep-text/src/cache.rs): the existing byte bound
 * each of the two caches keeps. */
export const BOUND = 32 << 20;
export interface Cache { entries: number; bytes: number; bound: number; hits: number }
export interface Caches { shape: Cache; layout: Cache }

/** A reply's `caches` (README): each of the two caches after the line. */
export function cachesOf(value: JsonValue | undefined, what: string): Caches {
  const all = obj(obj(value, what)['caches'], `${what}: caches`);
  const one = (name: keyof Caches): Cache => {
    const c = obj(all[name], `${what}: caches.${name}`);
    return {
      entries: count(c['entries'], `${what}: caches.${name}.entries`), bytes: count(c['bytes'], `${what}: caches.${name}.bytes`),
      bound: count(c['bound'], `${what}: caches.${name}.bound`), hits: count(c['hits'], `${what}: caches.${name}.hits`),
    };
  };
  return { shape: one('shape'), layout: one('layout') };
}

/**
 * The scope's two caches over AC1's run: `lines` are the caches after each of the 100 layouts and after a 101st asking
 * the 100th again at once, whose reply is `repeat`. At every line each cache reports the existing byte bound, holds no
 * more bytes than it, and its hits never fall; over the 99 layouts at a new width the shape cache hits at least once a
 * layout, since each reuses the text's shaped runs; the layout asked again shapes nothing and hits the layout cache.
 */
export function cacheFailures(lines: readonly Caches[], repeat: ShapeReply): string[] {
  const f: string[] = [];
  lines.forEach((c, i) => {
    for (const name of ['shape', 'layout'] as const) {
      const x = c[name];
      const before = lines[i - 1]?.[name];
      if (x.bound !== BOUND && f.length < 12) f.push(`line ${i + 1}: the ${name} cache's bound is ${grouped(x.bound)} bytes, not the existing ${grouped(BOUND)}`);
      if (x.bytes > x.bound && f.length < 12) f.push(`line ${i + 1}: the ${name} cache holds ${grouped(x.bytes)} bytes in ${grouped(x.entries)} entries, past its bound of ${grouped(x.bound)}`);
      if (before && x.hits < before.hits && f.length < 12) f.push(`line ${i + 1}: the ${name} cache's hits fell from ${grouped(before.hits)} to ${grouped(x.hits)}; a count of hits only rises`);
    }
  });
  const [first, last, again] = [lines[0], lines.at(-2), lines.at(-1)];
  if (!first || !last || !again || lines.length < 3) return [...f, `${lines.length} lines of caches, not the 100 layouts and the one asked again`];
  const reused = last.shape.hits - first.shape.hits;
  if (reused < lines.length - 2) f.push(`over the ${lines.length - 2} layouts at a new width the shape cache counted ${grouped(reused)} hits, fewer than one a layout, though each reused the text's shaped runs`);
  if (repeat.shaped.length > 0) f.push(`the layout asked again at once shaped ${repeat.shaped.length} ${repeat.shaped.length === 1 ? 'text' : 'texts'}: ${repeat.shaped.slice(0, 2).map((s) => named(s.text)).join(', ')}`);
  if (again.layout.hits <= last.layout.hits) f.push(`the layout asked again at once counted no hit in the layout cache (${grouped(last.layout.hits)} hits before it, ${grouped(again.layout.hits)} after)`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC2: the split cache against an empty cache, over random texts, fonts, sizes and widths

/** AC2's recorded seed and its count of layouts. */
export const SEED = 1430;
export const CASES = 160;
export type Font = 'body' | 'mono' | 'math';
export interface Case { text: string; font: Font; size: number; width: number }
export interface Cases { texts: string[]; typed: [string, string][]; cases: Case[] }
const FONTS: readonly Font[] = ['body', 'mono', 'math'];
const SIZES = [9, 11, 13, 16.5, 24];
const STOPS = [72, 150, 233.5, 320, 480, 777];
/** Words where faces part: kerning pairs, ligature candidates, figures and punctuation; ASCII, which every role's face covers. */
const VOCAB = ['office', 'fjord', 'AVATAR', 'Wave', 'Tokyo', 'affluent', 'first', 'flow', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog',
  'LT', 'Yo', 'ill', 'mm', '1,234.50', '(x+y)', '"quoted"', "it's", 'e.g.', 'A-Z', 'www', '->', '!=', 'Tw', 'Va', 'r.', 'WAVE', '7/8', ';', '?!'];

/**
 * The property's texts and cases, from `seed` (mulberry32): six random texts of one to five paragraphs (one paragraph in
 * ten empty) of 1 to 18 words; the first four again, each with one character typed into one paragraph; and one text of
 * the last two's paragraphs, so paragraphs recur across texts. Each case lays one of the eleven texts out in a random
 * font role, at a random size and width, mostly from short lists so cases meet again in the caches.
 */
export function generate(seed = SEED, n = CASES): Cases {
  const r = seeded(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const words = (): string => (r() < 0.1 ? '' : Array.from({ length: 1 + Math.floor(r() * 18) }, () => pick(VOCAB)).join(' '));
  const text = (): string => Array.from({ length: 1 + Math.floor(r() * 5) }, words).join('\n');
  const base = Array.from({ length: 6 }, text);
  const typed = base.slice(0, 4).map((t): [string, string] => {
    const ps = t.split('\n');
    const p = Math.floor(r() * ps.length);
    const at = Math.floor(r() * (ps[p]!.length + 1));
    ps[p] = `${ps[p]!.slice(0, at)}${pick(['a', 'e', 'x', '.', ','])}${ps[p]!.slice(at)}`;
    return [t, ps.join('\n')];
  });
  const mixed = [...base[4]!.split('\n'), ...base[5]!.split('\n')].join('\n');
  const texts = [...base, ...typed.map(([, t]) => t), mixed];
  const cases = Array.from({ length: n }, (): Case => ({
    text: pick(texts), font: pick(FONTS), size: r() < 0.8 ? pick(SIZES) : Math.round(800 + r() * 2200) / 100,
    width: r() < 0.75 ? pick(STOPS) : 40 + Math.floor(r() * 760),
  }));
  return { texts, typed, cases };
}

/** A case as a `shape` line asking for its `run`. */
export const caseLine = (c: Case): JsonObject => ({ text: c.text, font: c.font, size: c.size, box: { w: c.width }, overflow: 'mask', run: true });
export const described = (c: Case): string => `${named(c.text)} in ${c.font} at ${c.size} px, ${c.width} px wide`;

/** The meetings the property needs among the cases, a failure naming each one missing: a text in two fonts at one size
 * and width (where a key missing the font shows), a text at two widths in one font and size (a width change reusing
 * shaped runs), and a typed text after its original in one font and size (a paragraph reused across texts). */
export function meetingFailures({ typed, cases }: Cases): string[] {
  const met = { fonts: false, widths: false, typed: false };
  cases.forEach((b, j) => cases.slice(0, j).forEach((a) => {
    const same = a.text === b.text && a.size === b.size;
    if (same && a.width === b.width && a.font !== b.font) met.fonts = true;
    if (same && a.font === b.font && a.width !== b.width) met.widths = true;
    if (typed.some(([was, now]) => a.text === was && b.text === now) && a.font === b.font && a.size === b.size) met.typed = true;
  }));
  return [
    ...(met.fonts ? [] : ['no two cases lay one text out in two fonts at one size and width']),
    ...(met.widths ? [] : ['no two cases lay one text out at two widths in one font and size']),
    ...(met.typed ? [] : ['no case lays a typed text out after its original in one font and size']),
  ];
}

/** A glyph as `run` lists it (README): its face (the file `deep-text fonts` names), its size in px, its ID, x and y. */
export type RunGlyph = [string, number, number, number, number];
/** A reply's `run`; `json` is the field as the binary wrote it, read back, for comparing bytes. */
export interface Run { lines: number; width: number; height: number; shown: string; glyphs: RunGlyph[]; json: string }

export function runOf(value: JsonValue | undefined, what: string): Run {
  const o = obj(value, what);
  expect(o['ok'], `${what} is accepted: ${show(o).slice(0, 600)}`).toBe(true);
  const r = obj(o['run'], `${what}: run`);
  const list = arr(r['glyphs'], `${what}: run.glyphs`);
  const glyph = (g: JsonValue | undefined): boolean => Array.isArray(g) && g.length === 5 && typeof g[0] === 'string'
    && g.slice(1).every((v) => typeof v === 'number' && Number.isFinite(v)) && Number.isInteger(g[2]) && (g[2] as number) >= 0;
  const bad = list.findIndex((g) => !glyph(g));
  expect(bad, `${what}: run.glyphs[${bad}] is [face, size, id, x, y], got ${show(list[bad])}`).toBe(-1);
  return {
    lines: count(r['lines'], `${what}: run.lines`), width: num(r['width'], `${what}: run.width`), height: num(r['height'], `${what}: run.height`),
    shown: str(r['shown'], `${what}: run.shown`), glyphs: list as unknown as RunGlyph[], json: JSON.stringify(r),
  };
}

export interface Faces { family: Record<string, string>; of: Map<string, string> }
/** The family of each font role, and of each bundled face by its file, as `deep-text fonts` lists them (#390, #417). */
export function faces(): Faces {
  const reply = obj(runLines(TEXT_BIN, ['fonts'], [{}]).lines[0], 'deep-text fonts');
  expect(reply['ok'], `deep-text fonts answers: ${show(reply)}`).toBe(true);
  const family: Record<string, string> = {};
  arr(reply['fonts'], 'deep-text fonts: fonts').forEach((v, i) => { const f = obj(v, `fonts[${i}]`); family[str(f['role'], `fonts[${i}].role`)] = str(f['family'], `fonts[${i}].family`); });
  for (const role of FONTS) expect(typeof family[role], `deep-text fonts names the ${role} role's family`).toBe('string');
  const of = new Map(arr(reply['faces'], 'deep-text fonts: faces').map((v, i) => { const f = obj(v, `faces[${i}]`); return [str(f['file'], `faces[${i}].file`), str(f['family'], `faces[${i}].family`)] as const; }));
  return { family, of };
}

/** What an empty cache's output of `c` must be for equal outputs to say anything: the case's text whole, as many glyphs
 * as the reply counts and some for a text with any, every one set in a face of its role's family at its size. */
export function outputFailures(c: Case, reply: ShapeReply, run: Run, fonts: Faces): string[] {
  const f: string[] = [];
  if (run.shown !== c.text || reply.shown !== c.text) f.push(`${described(c)}: shows ${named(run.shown)}, not the text whole`);
  if (run.glyphs.length !== reply.glyphs) f.push(`${described(c)}: run lists ${run.glyphs.length} glyphs where the reply counts ${reply.glyphs}`);
  if (/\S/.test(c.text) && (run.glyphs.length === 0 || run.lines === 0)) f.push(`${described(c)}: laid out to ${run.glyphs.length} glyphs on ${run.lines} lines`);
  const family = fonts.family[c.font];
  const off = run.glyphs.find(([face, size]) => fonts.of.get(face) !== family || Math.abs(size - c.size) > 1e-3);
  if (off) f.push(`${described(c)}: a glyph is ${show(off)}, not one of a ${family} face at ${c.size} px`);
  return f;
}

/** Where two runs of one case first differ. */
function difference(warm: Run, empty: Run): string {
  for (const key of ['lines', 'width', 'height', 'shown'] as const) {
    if (warm[key] !== empty[key]) return `${key} ${show(warm[key]).slice(0, 80)} from the split cache, ${show(empty[key]).slice(0, 80)} from an empty cache`;
  }
  const g = warm.glyphs.findIndex((x, i) => show(x) !== show(empty.glyphs[i]));
  if (g >= 0) return `glyph ${g + 1} is ${show(warm.glyphs[g])} from the split cache, ${show(empty.glyphs[g] ?? null)} from an empty cache`;
  if (warm.glyphs.length !== empty.glyphs.length) return `${warm.glyphs.length} glyphs from the split cache, ${empty.glyphs.length} from an empty cache`;
  return `the run ${warm.json.slice(0, 300)} from the split cache, ${empty.json.slice(0, 300)} from an empty cache`;
}

/**
 * AC2's property over `cases`, under `planted` both ways: laid out in turn in one process (the split cache, warm with
 * every case before), each case's `run` must be byte-equal to the same case's `run` laid out alone in a fresh process
 * (an empty cache). Each empty-cache output must first be the case's own (`outputFailures`). The first case that differs
 * is shrunk to the fewest cases before it that still make it differ, and the failure names the seed, the case, its first
 * difference and the shrunk cases.
 */
export function propertyFailures(cases: readonly Case[], fonts: Faces, planted?: string): string[] {
  const args = ['shape', ...(planted ? ['--planted', planted] : [])];
  const alone = new Map<string, { reply: ShapeReply; run: Run }>();
  const empty = (c: Case): { reply: ShapeReply; run: Run } => {
    const key = JSON.stringify(caseLine(c));
    let got = alone.get(key);
    if (!got) {
      const [line] = runLines(TEXT_BIN, args, [caseLine(c)]).lines;
      got = { reply: shapeReply(line, `${described(c)}, alone`), run: runOf(line, `${described(c)}, alone`) };
      alone.set(key, got);
    }
    return got;
  };
  const inTurn = (seq: readonly Case[]): Run[] => runLines(TEXT_BIN, args, seq.map(caseLine)).lines.map((line, i) => runOf(line, `case ${i + 1} in turn, ${described(seq[i]!)}`));
  const broken = cases.flatMap((c) => outputFailures(c, empty(c).reply, empty(c).run, fonts));
  if (broken.length) return broken.slice(0, 12);
  const warm = inTurn(cases);
  const at = warm.findIndex((r, i) => r.json !== empty(cases[i]!).run.json);
  if (at < 0) return [];
  const differs = (seq: readonly Case[]): boolean => inTurn(seq).at(-1)!.json !== empty(seq.at(-1)!).run.json;
  let kept = cases.slice(0, at + 1);
  for (let j = kept.length - 2; j >= 0; j--) {
    const without = kept.filter((_, k) => k !== j);
    if (differs(without)) kept = without;
  }
  const c = cases[at]!;
  return [
    `seed ${SEED}, case ${at + 1} of ${cases.length} (${described(c)}): the split cache's output differs from an empty cache's: ${difference(warm[at]!, empty(c).run)}`,
    `shrunk to ${kept.length} ${kept.length === 1 ? 'case' : 'cases'} laid out in turn, the last differing: ${kept.map(described).join('; ')}`,
  ];
}

// ---------------------------------------------------------------------------------------------------
// AC3: one typed character

/** AC3's width: the long text laid out at 640 px, then again with the typed character. */
export const TYPING_WIDTH = 640;

/**
 * AC3: the long text laid out once in a fresh process (`replies[0]`), then with one character typed into one paragraph
 * (`replies[1]`). The second shapes that paragraph, as typed, and nothing else, and shows the text with the character.
 */
export function typedFailures(replies: readonly ShapeReply[]): string[] {
  const [before, after] = replies;
  if (!before || !after || replies.length !== 2) return [`${replies.length} replies for the two layouts`];
  const f: string[] = [];
  if (before.shown !== LONG_TEXT) f.push(`the first layout shows ${named(before.shown)}, not the long text`);
  if (before.shaped.length === 0) f.push('the first layout of the long text, in a fresh process, shaped nothing');
  if (after.shown !== TYPED_TEXT) f.push(`the layout after the typed character shows ${named(after.shown)}, not the text with it`);
  const s = after.shaped;
  if (s.length !== 1 || asParagraph(s[0]!.text) !== TYPED_PARAGRAPH) {
    const chars = s.reduce((n, x) => n + x.text.length, 0);
    f.push(`the character typed into paragraph ${TYPED.paragraph + 1} of ${PARAGRAPHS} reshaped ${s.length} ${s.length === 1 ? 'text' : 'texts'}, ${grouped(chars)} characters in all (${s.slice(0, 3).map((x) => named(x.text)).join(', ')}${s.length > 3 ? ', …' : ''}), where one paragraph of ${grouped(TYPED_PARAGRAPH.length)} characters changed`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// AC4: the budget record (docs/parallel-proof.md §12a) and its judge (scripts/benchmark.mjs)

/** The task the budget window measures for AC4 (README: The budget task). */
export const REFLOW_TASK: Task = {
  id: 'canvas-text-reflow', command: ['node', 'benchmarks/canvas.mjs', 'text-reflow'],
  targets: { width_change_50kb_ms: 5, typed_char_50kb_ms: 2 },
};

/** git in this checkout, with no GIT_ variable of the caller's steering it to another repository. */
function git(args: string[]): { ok: boolean; out: string; err: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const run = spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: run.status === 0, out: run.stdout ?? '', err: (run.stderr || run.error?.message || '').trim() };
}

/** The checkout's benchmarks/budgets.json, and its merge base's (`git merge-base HEAD origin/main`); BLOCKED without one. */
export function budgetFiles(): { current: JsonObject; base: JsonObject } {
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
  const mergeBase = git(['merge-base', 'HEAD', 'origin/main']);
  if (!mergeBase.ok) blocked(`the merge base can't be found (git merge-base HEAD origin/main: ${mergeBase.err}), so the record can't be held to it`);
  const base = git(['show', `${mergeBase.out.trim()}:benchmarks/budgets.json`]);
  if (!base.ok) blocked(`the merge base's benchmarks/budgets.json can't be read: ${base.err}`);
  return { current, base: JSON.parse(base.out) as JsonObject };
}

interface Bench { validateBudgets: (current: unknown, base: unknown) => unknown }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
const sorted = (o: JsonValue | undefined): string => JSON.stringify(isObject(o) ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) : o);

/** What keeps `current` from recording `task` for `criterion` as the budget window reads it, against `base`. */
export async function recordFailures(current: JsonObject, base: JsonObject, task: Task, criterion: string): Promise<string[]> {
  const entry = (Array.isArray(current['tasks']) ? current['tasks'] : []).filter(isObject).find((t) => t['id'] === task.id);
  if (!entry) return [`benchmarks/budgets.json has no task ${task.id}`];
  const f: string[] = [];
  if (show(entry['command']) !== show(task.command)) f.push(`${task.id} runs ${show(entry['command'])}, not ${show(task.command)}`);
  if (sorted(entry['targets']) !== sorted(task.targets)) f.push(`${task.id} holds the targets ${show(entry['targets'])}, not the issue's numbers ${show(task.targets)}`);
  if (entry['margin'] !== 0.5) f.push(`${task.id} compares with the merge base at margin ${show(entry['margin'])}, not the lane's 0.5`);
  if (!Array.isArray(entry['criteria']) || !entry['criteria'].includes(criterion)) f.push(`${task.id} doesn't name ${criterion} among its criteria, so the budget window never measures it`);
  if (!/#1430\b/.test(String(entry['initialReason'] ?? ''))) f.push(`${task.id}'s initialReason doesn't name #1430`);
  try {
    (await bench()).validateBudgets(current, base);
  } catch (e) {
    f.push(`the lane's validator refuses budgets.json against the merge base's: ${String(e)}`);
  }
  return f;
}
