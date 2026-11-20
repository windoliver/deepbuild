// Test-side tools for the #2500 acceptance tests: this suite's code item `cfg` (a seven-line function with its
// tokens), its documents (the code on a page, still or scrolling, for `deep-canvas-render`; films with a hold shot or a
// two-bone arm for `deep-motion`), the calls (`raster` and `geometry` through #1965's and #1966's helpers, `deep-motion
// eval` through #493's, all imported by path and never edited), and the judges each test applies to what the binaries
// answer and to the planted wrong programs. Nothing here stands in for the renderer, the framer or the reach: every
// glyph, box, projection and position judged comes from a binary; the expected values come from the issue's text.
// README: The surfaces under test.

import { expect } from 'vitest';
import { backdrop, doc, item, keyed, shown, type JsonObject, type JsonValue } from '../467/helpers.ts';
import { LOOK_A, accepted, rasterAll, type Drawn, type GlyphRow } from '../1965/helpers.ts';
import { boxesAt, glyphsIn, rangesIn } from '../1966/helpers.ts';
import { FLICKS, accepted as acceptedEval, evalAll, type Accepted, type EvalLine, type Frame } from '../493/helpers.ts';

export { useBin, useDir, fl, none, failsNaming } from '../467/helpers.ts';
export { useMotion, F60, TIMEOUT } from '../493/helpers.ts';
export type { Accepted, Frame };

/** The criteria's IDs: `#2500.` + the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
export const AC = { 1: 'AC1 #2500.bceb1cbb', 2: 'AC2 #2500.eb02ef3c' } as const;

/** #1965's look (#467's with a role for each token class), passed to `raster` and `geometry` as #1966's suite does. */
export const LOOK = LOOK_A;

export type Pt = [number, number];
/** A box `[x, y, w, h]` in document u, as `geometry` gives it. */
export type Box = [number, number, number, number];

const f2 = (v: number): string => v.toFixed(2);
const f3 = (v: number): string => v.toFixed(3);
const at2 = (p: Pt): string => `(${f2(p[0])}, ${f2(p[1])})`;
const box2 = (b: Box): string => `[${b.map(f2).join(', ')}]`;
/** Flicks to seconds, for messages. */
export const secs = (t: number): number => t / FLICKS;

// ---------------------------------------------------------------------------------------------------
// The code: a function of seven lines, no digits and no number words (an unquoted code item's numbers are checked),
// its keywords and calls tokened in order. `#line:n` counts from `first_line` (1); `#tok:k` is the token `tokens`
// lists at index k, from 0, as the base's anchor and #1965's and #1968's suites count it (README: Readings).

export const CODE = 'cfg';
export const SIZE = 24;
export const LINES = [
  'def load(path, mode):',
  '    with open(path, mode) as handle:',
  '        text = handle.read()',
  '    cfg = parse(text)',
  '    for key in sorted(cfg):',
  '        print(key, cfg[key])',
  '    return cfg',
];
export const RAW = `${LINES.join('\n')}\n`;
export interface Token { from: number; to: number; class: string; word: string; line: number }
/** The `n`-th (from 0) `w` on line `line`, as raw byte offsets (ASCII, LF ends: a byte is a grapheme of the display). */
function token(w: string, line: number, cls: string): Token {
  const start = RAW.indexOf(LINES[line - 1]!) + LINES[line - 1]!.indexOf(w);
  return { from: start, to: start + w.length, class: cls, word: w, line };
}
export const TOKENS: Token[] = [
  token('def', 1, 'keyword'), token('load', 1, 'function'),
  token('with', 2, 'keyword'), token('open', 2, 'function'), token('as', 2, 'keyword'),
  token('parse', 4, 'function'),
  token('for', 5, 'keyword'), token('in', 5, 'keyword'), token('sorted', 5, 'function'),
  token('print', 6, 'function'),
  token('return', 7, 'keyword'),
];
/** The criterion's token: `cfg#tok:2`, `with` on line 2. */
export const TOK = 2;

/** The code item: `text@1` with `raw` and `code` in the mono role, ink, no line numbers (README: Readings), at `AT`. */
export const AT: Pt = [200, 260];
export function codeItem(): JsonObject {
  const tokens: JsonValue[] = TOKENS.map((t) => ({ from: t.from, to: t.to, class: t.class }));
  return item(CODE, 'text@1', 'a1', {
    font: 'mono', size: SIZE, paint: { fill: { role: 'ink' } }, raw: RAW, code: { language: 'python', tokens, numbers: false },
  }, { at: { pos: [AT[0], AT[1], 0] } });
}

export const PAGE: [number, number] = [1280, 720];
/** The scroll AC2's code takes: its `at.pos` y keyed linearly from 260 at 0 s to 140 at 2 s. */
export const SCROLL: [number, number][] = [[0, 260], [2, 140]];
export const scrollY = (s: number): number => SCROLL[0]![1] + ((SCROLL[1]![1] - SCROLL[0]![1]) * (s - SCROLL[0]![0])) / (SCROLL[1]![0] - SCROLL[0]![0]);
const scrollChannels = (): JsonObject => ({ scroll: keyed(`items/${CODE}/at/pos/1`, SCROLL) });

/** The code on its page, for `deep-canvas-render` (#467's envelope, as #1966's suite writes it): still, or scrolling. */
export function page(id: string, scrolling: boolean): JsonObject {
  const d = doc(id, PAGE, [backdrop(PAGE), codeItem()], scrolling ? { transport: { span: '3s' }, channels: scrollChannels() } : {});
  return { ...d, title: `#2500 ${id}`, description: `The #2500 acceptance page ${id}.` };
}

const LAYERS: JsonObject = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
/** A film for `deep-motion` (#493's envelope): the same page size, 3 s at 60 fps. */
function film(id: string, items: JsonObject[], extra: JsonObject): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#2500 ${id}`, description: `The #2500 acceptance film ${id}.`, size: PAGE, layers: LAYERS,
    transport: { span: '3s', frame_rate: '60/1' }, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------
// AC1's films: the still code, a 2D camera over the page, and one hold shot over [0 s, 2 s) that keeps one ID with no
// pad at fill 0.5, in a document with no safe margin, so its place is the frame's centre and its fill a share of the
// frame's shorter side (README: Readings). Stand-ins, rect@1 items at boxes `geometry` gave, are kept by the planted
// shots and projected by every film to read where a box lands.

export const FILL = 0.5;
/** The frame's shorter side, and the place the kept box's centre must land on (the default place: the centre). */
export const SHORTER = Math.min(PAGE[0], PAGE[1]);
export const PLACE: Pt = [PAGE[0] / 2, PAGE[1] / 2];
const standIn = (id: string, b: Box): JsonObject => item(id, 'rect@1', `c${id}`, { box: [...b], paint: { fill: { role: 'accent' } } }, { at: { pos: [0, 0, 0] } });
export function shotFilm(id: string, keep: string, standIns: Record<string, Box>): JsonObject {
  const cam = item('cam', 'camera@1', 'a0', { projection: 'orthographic', target: [PAGE[0] / 2, PAGE[1] / 2, 0], view_width: PAGE[0] });
  return film(id, [cam, codeItem(), ...Object.entries(standIns).map(([k, b]) => standIn(k, b))], {
    camera: 'cam', safe: 0,
    shots: { s: { start: '0s', end: '2s', camera: 'cam', move: 'hold', frame: { keep: [keep], pad: 0, fill: FILL } } },
  });
}

// AC2's film: the scrolling code and a puppet's arm, a chain of three parts (upper arm at ROOT, forearm and hand each
// BONE u along their parent), whose reach2 aims at `target` (README: Choices). The hand is the chain's end.
export const ROOT: Pt = [560, 330];
export const BONE = 200;
export const HAND = 'hand';
export function reachFilm(id: string, target: string): JsonObject {
  const part = (pid: string, order: string, pos: Pt, parent?: string): JsonObject =>
    item(pid, 'rect@1', order, { box: [-6, -6, 12, 12], paint: { fill: { role: 'accent' } } }, { at: { pos: [pos[0], pos[1], 0] }, ...(parent ? { parent } : {}) });
  return film(id, [codeItem(), part('upper_arm', 'b1', ROOT), part('forearm', 'b2', [BONE, 0], 'upper_arm'), part(HAND, 'b3', [BONE, 0], 'forearm')], {
    channels: scrollChannels(),
    constraints: { reach: { owner: 'upper_arm', kind: 'reach2', chain: ['upper_arm', 'forearm', HAND], target, bend: 1 } },
  });
}

// ---------------------------------------------------------------------------------------------------
// Reads: where the code's lines and tokens are (from `raster`'s glyphs), the boxes `geometry` gives, `deep-motion eval`.

export interface LineRow { baseline: number; x0: number; x1: number }
export interface Layout { lines: LineRow[]; tokens: GlyphRow[][] }
/** The code as `raster` set it at 0 s, from the item's origin: each line's baseline and glyphs' x span, each token's glyphs. */
export function layoutOf(d: Drawn): Layout {
  const lines = rangesIn(d.shown, LINES, 'the code').map((r, i) => {
    const g = glyphsIn(d, r);
    expect(g.length, `line ${i + 1} is drawn`).toBeGreaterThan(0);
    return { baseline: g[0]!.y, x0: Math.min(...g.map((q) => q.x)), x1: Math.max(...g.map((q) => q.x + q.advance)) };
  });
  const tokens = TOKENS.map((t, k) => {
    expect(d.shown.slice(t.from, t.to), `token ${k} is "${t.word}" in the shown text`).toBe(t.word);
    const g = glyphsIn(d, [t.from, t.to]);
    expect(g.length, `token ${k} (${t.word}) is drawn`).toBe(t.word.length);
    return g;
  });
  return { lines, tokens };
}
/** `raster` of the still page at 0 s: the code's layout. */
export function layout(render: string, dir: string): Layout {
  const [drawn] = rasterAll(render, dir, [page('code-still-2500', false)], LOOK, undefined, CODE).map((d) => accepted(d, 'the code at 0 s'));
  return layoutOf(drawn!);
}
/** `geometry` of `d` for each `[id, t]`: each box, which must be there. */
export function boxes(render: string, d: JsonObject, asks: [string, number][]): Box[] {
  const got = boxesAt(render, d, asks);
  return got.map((b, i) => {
    expect(b, `geometry gives a box for ${asks[i]![0]} at ${secs(asks[i]![1])} s`).toBeDefined();
    return b!;
  });
}
/** `deep-motion eval` of each `[what, line]` in one process: each answer, which must accept its film, a frame per time. */
export function evaluated(bin: string, lines: [string, EvalLine][]): Accepted[] {
  const answers = evalAll(bin, lines.map(([, l]) => l));
  return answers.map((a, i) => acceptedEval(a, lines[i]![1].times, lines[i]![0]));
}
/** An item's evaluated world position in a frame, `items.<id>.at.pos`, as x and y. */
export function posOf(f: Frame, id: string): Pt {
  const p = (f.items[id] as JsonObject | undefined)?.['at'] as JsonObject | undefined;
  const pos = p?.['pos'];
  expect(Array.isArray(pos) && pos.length === 3 && pos.every((v) => typeof v === 'number'), `items.${id}.at.pos at ${secs(f.t)} s is three numbers: ${shown(pos)}`).toBe(true);
  const xy = pos as number[];
  return [xy[0]!, xy[1]!];
}

// ---------------------------------------------------------------------------------------------------
// The boxes judged against the glyphs, so a wrong anchor can't pass by agreeing with itself. `dy` moves the layout by
// the scroll; every position is the code's origin plus the glyph's.

/** `cfg#line:n`'s box holds line n's baseline and spans its glyphs, and reaches neither neighbour's baseline. */
export function lineBoxFailures(when: string, b: Box, l: Layout, n: number, dy = 0): string[] {
  const [x, y, w, h] = b;
  const base = (k: number): number => AT[1] + dy + l.lines[k - 1]!.baseline;
  const row = l.lines[n - 1]!;
  const out: string[] = [];
  if (!(y <= base(n) && base(n) <= y + h)) out.push(`${when}: the box of ${CODE}#line:${n} ${box2(b)} doesn't hold line ${n}'s baseline at y ${f2(base(n))}`);
  if (!((n === 1 || base(n - 1) < y) && (n === LINES.length || y + h < base(n + 1)))) out.push(`${when}: the box of ${CODE}#line:${n} ${box2(b)} reaches a neighbouring line's baseline`);
  if (!(x <= AT[0] + row.x0 + 0.5 && x + w >= AT[0] + row.x1 - 0.5)) out.push(`${when}: the box of ${CODE}#line:${n} ${box2(b)} doesn't span line ${n}'s glyphs, x ${f2(AT[0] + row.x0)} to ${f2(AT[0] + row.x1)}`);
  return out;
}
/** `cfg`'s box holds every line: every baseline, and every line's glyphs. */
export function wholeBoxFailures(when: string, b: Box, l: Layout): string[] {
  const [x, y, w, h] = b;
  return l.lines.flatMap((row, i) => {
    const base = AT[1] + row.baseline;
    return y <= base && base <= y + h && x <= AT[0] + row.x0 + 0.5 && x + w >= AT[0] + row.x1 - 0.5
      ? [] : [`${when}: the box of ${CODE} ${box2(b)} doesn't hold line ${i + 1} (baseline y ${f2(base)}, x ${f2(AT[0] + row.x0)} to ${f2(AT[0] + row.x1)})`];
  });
}
/**
 * `cfg#tok:k`'s box holds token k: its line's baseline and its glyphs' x span, reaching neither neighbouring line's
 * baseline, and the centre of no glyph of the tokens either side (k − 1 and k + 1).
 */
export function tokenBoxFailures(when: string, b: Box, l: Layout, k: number, dy: number): string[] {
  const [x, y, w, h] = b;
  const t = TOKENS[k]!; const g = l.tokens[k]!;
  const out: string[] = [];
  const base = AT[1] + dy + l.lines[t.line - 1]!.baseline;
  const x0 = AT[0] + Math.min(...g.map((q) => q.x)); const x1 = AT[0] + Math.max(...g.map((q) => q.x + q.advance));
  if (!(y <= base && base <= y + h)) out.push(`${when}: the box of ${CODE}#tok:${k} ${box2(b)} doesn't hold "${t.word}"'s baseline at y ${f2(base)}`);
  const above = t.line > 1 ? AT[1] + dy + l.lines[t.line - 2]!.baseline : -Infinity;
  const below = t.line < LINES.length ? AT[1] + dy + l.lines[t.line]!.baseline : Infinity;
  if (!(above < y && y + h < below)) out.push(`${when}: the box of ${CODE}#tok:${k} ${box2(b)} reaches a neighbouring line's baseline`);
  if (!(x <= x0 + 0.5 && x + w >= x1 - 0.5)) out.push(`${when}: the box of ${CODE}#tok:${k} ${box2(b)} doesn't span "${t.word}"'s glyphs, x ${f2(x0)} to ${f2(x1)}`);
  for (const n of [k - 1, k + 1].filter((m) => m >= 0 && m < TOKENS.length)) {
    const other = TOKENS[n]!;
    const oy = AT[1] + dy + l.lines[other.line - 1]!.baseline - SIZE / 3;
    for (const q of l.tokens[n]!) {
      const ox = AT[0] + q.x + q.advance / 2;
      if (x < ox && ox < x + w && y < oy && oy < y + h) { out.push(`${when}: the box of ${CODE}#tok:${k} ${box2(b)} holds a glyph of token ${n} ("${other.word}")`); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The criteria's judges

/**
 * AC1: a shot's framing judged on each frame through the binary's own projection of the stand-in `id`: its box spans
 * the shot's fill of the frame's shorter side within 1% (its larger side, as a 2D framing spans its kept items), and its
 * centre lands on the place within 0.5 px (README: Readings, "the framing's tolerance").
 */
export function framedFailures(a: Accepted, id: string, label: string): string[] {
  const want = FILL * SHORTER;
  const out: string[] = [];
  for (const f of a.frames) {
    const when = `at ${f2(secs(f.t))} s`;
    const p = f.projected[id] as JsonObject | undefined;
    const b = p?.['box']; const c = p?.['center'];
    const finite = (v: JsonValue | undefined, n: number): boolean => Array.isArray(v) && v.length === n && v.every((q) => typeof q === 'number' && Number.isFinite(q));
    if (!finite(b, 4) || !finite(c, 2)) { out.push(`${when}: ${label} projects to the box ${shown(b ?? null)} and centre ${shown(c ?? null)} px, not a finite box at the shot's fill`); continue; }
    const [x0, y0, x1, y1] = b as [number, number, number, number]; const [cx, cy] = c as [number, number];
    const span = Math.max(x1 - x0, y1 - y0);
    if (!(Math.abs(span / want - 1) <= 0.01)) out.push(`${when}: ${label} spans ${f2(span)} px, ${f3(span / SHORTER)} of the frame's shorter side, not the shot's fill ${FILL} within 1%`);
    const off = Math.hypot(cx - PLACE[0], cy - PLACE[1]);
    if (!(off <= 0.5)) out.push(`${when}: ${label}'s centre lands at ${at2([cx, cy])} px, ${f2(off)} px from its place ${at2(PLACE)}`);
  }
  return out;
}

/** The distance from a point to a box (0 inside it). */
export function toBox(p: Pt, [x, y, w, h]: Box): number {
  return Math.hypot(Math.max(x - p[0], 0, p[0] - (x + w)), Math.max(y - p[1], 0, p[1] - (y + h)));
}
export const centreOf = ([x, y, w, h]: Box): Pt => [x + w / 2, y + h / 2];
/** AC2: the hand at each time on the box `geometry` gives for `cfg#tok:2` there, within 0.5 u. */
export function handFailures(seconds: number[], tokBoxes: Box[], hands: Pt[]): string[] {
  return seconds.flatMap((s, i) => {
    const d = toBox(hands[i]!, tokBoxes[i]!);
    return d <= 0.5 ? [] : [`at ${s} s: the hand is at ${at2(hands[i]!)}, ${f2(d)} u from ${CODE}#tok:${TOK}'s box ${box2(tokBoxes[i]!)}, not on it within 0.5 u`];
  });
}
