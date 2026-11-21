// Test-side tools for the blind redraft of #1430's AC2 (README: The surface under test). Every reading comes from the one
// shaper's binary, built in release and driven through #856's helpers: `deep-text shape` with the field the first draft
// chose (`run`, on request) and `deep-text fonts` (#390, #417). This file holds the property's cases, made from a recorded
// seed, the reader of `run`, the faces each font role is set in at this base (#1484), and the property itself, which
// returns its failures as sentences naming what failed. The first draft's helpers (tests/acceptance/1430/) aren't at this
// base, so what still holds of them is restated here. Nothing here stands in for the shaper or its caches.

import { expect } from 'vitest';
import { seeded } from '../224/helpers.ts';
import { TEXT_BIN, arr, count, named, num, obj, runLines, shapeReply, str, type JsonObject, type JsonValue, type ShapeReply } from '../856/helpers.ts';

export { useRelease } from '../856/helpers.ts';

/** The criterion's tag: `#1430.` and the first eight hex digits of the SHA-256 of its text, trimmed and its white space
 * collapsed (scripts/budget-window.mjs's criterionId), computed from the live issue. */
export const AC2 = 'AC2 #1430.c8134c7e';
/** Every test's timeout: a release build on a loaded, shared machine may come first. */
export const TIMEOUT = 3_600_000;

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
/** A value for a message. */
const show = (value: unknown): string => JSON.stringify(value)?.slice(0, 1500) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// The cases: random texts, fonts, sizes and widths, from the recorded seed (the first draft's, unchanged)

/** The recorded seed and the count of layouts. */
export const SEED = 1430;
export const CASES = 160;
export type Font = 'body' | 'mono' | 'math';
export interface Case { text: string; font: Font; size: number; width: number }
export interface Cases { texts: string[]; typed: [string, string][]; cases: Case[] }
const FONTS: readonly Font[] = ['body', 'mono', 'math'];
const SIZES = [9, 11, 13, 16.5, 24];
const STOPS = [72, 150, 233.5, 320, 480, 777];
/** Words where faces part: kerning pairs, ligature candidates, figures and punctuation; ASCII, which every face a role is
 * set in maps (Inter Variable, JetBrains Mono, STIX Two Math). */
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

// ---------------------------------------------------------------------------------------------------
// The output: `run` (README), and the faces each role is set in

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

/** Each bundled face's family by its file, and the family each font role's text is set in. */
export interface Faces { of: Map<string, string>; setIn: Record<Font, string> }

/**
 * The faces as `deep-text fonts` lists them (#390, #417), and the family each role's text is set in as the base says it
 * (#1484, crates/deep-text/src/fonts.rs `shaped_in`: a family is shaped in "its variable twin when the bundled faces hold
 * one ... else `family` itself"): the role's family as `fonts` names it, or, when `faces` holds the family named
 * `<family> Variable`, that twin. At a4d0290b5 body is set in Inter Variable, mono in JetBrains Mono, math in STIX Two
 * Math. A role set in no bundled family fails here, naming it.
 */
export function faces(): Faces {
  const reply = obj(runLines(TEXT_BIN, ['fonts'], [{}]).lines[0], 'deep-text fonts');
  expect(reply['ok'], `deep-text fonts answers: ${show(reply)}`).toBe(true);
  const of = new Map(arr(reply['faces'], 'deep-text fonts: faces').map((v, i) => {
    const f = obj(v, `faces[${i}]`);
    return [str(f['file'], `faces[${i}].file`), str(f['family'], `faces[${i}].family`)] as const;
  }));
  const families = new Set(of.values());
  const role: Record<string, string> = {};
  arr(reply['fonts'], 'deep-text fonts: fonts').forEach((v, i) => { const f = obj(v, `fonts[${i}]`); role[str(f['role'], `fonts[${i}].role`)] = str(f['family'], `fonts[${i}].family`); });
  const setIn = Object.fromEntries(FONTS.map((font) => {
    const family = role[font];
    expect(typeof family, `deep-text fonts names the ${font} role's family`).toBe('string');
    const twin = `${family!} Variable`;
    const set = families.has(twin) ? twin : family!;
    expect(families.has(set), `the ${font} role's family ${set} is a family of the bundled faces: ${show([...families])}`).toBe(true);
    return [font, set];
  })) as Record<Font, string>;
  return { of, setIn };
}

/** What an empty cache's output of `c` must be for equal outputs to say anything: the case's text whole, as many glyphs
 * as the reply counts and some for a text with any, every one set in a face of the family its role is set in, at its
 * size. */
export function outputFailures(c: Case, reply: ShapeReply, run: Run, fonts: Faces): string[] {
  const f: string[] = [];
  if (run.shown !== c.text || reply.shown !== c.text) f.push(`${described(c)}: shows ${named(run.shown)}, not the text whole`);
  if (run.glyphs.length !== reply.glyphs) f.push(`${described(c)}: run lists ${run.glyphs.length} glyphs where the reply counts ${reply.glyphs}`);
  if (/\S/.test(c.text) && (run.glyphs.length === 0 || run.lines === 0)) f.push(`${described(c)}: laid out to ${run.glyphs.length} glyphs on ${run.lines} lines`);
  const family = fonts.setIn[c.font];
  const off = run.glyphs.find(([face, size]) => fonts.of.get(face) !== family || Math.abs(size - c.size) > 1e-3);
  if (off) f.push(`${described(c)}: a glyph is ${show(off)}, not one of a ${family} face at ${c.size} px, the family the ${c.font} role is set in`);
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

// ---------------------------------------------------------------------------------------------------
// The property

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
