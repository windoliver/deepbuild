// Test-side tools for the #1966 acceptance tests: this suite's documents (a code item under a highlight that scrolls,
// a path attached to one of its lines, a bullet list), the calls into `deep-canvas-render` (`raster`, `geometry`,
// `path`, through #467's and #1965's helpers, imported by path and never edited), and the judges each test applies to
// what the binary answers and to the planted wrong programs. Nothing here stands in for the renderer: every box, end
// point, glyph and pixel judged comes from the binary; the expected values come from the issue's text.
// README: The surfaces under test.

import { expect } from 'vitest';
import { backdrop, doc, item, keyed, px, render, shown, type Image, type JsonObject, type JsonValue } from '../467/helpers.ts';
import { LOOK_A, type Drawn, type GlyphRow } from '../1965/helpers.ts';
import { subpathsOf } from '../160/helpers.ts';

export { useBin, useDir, fl, failsNaming, none, render, shown, type Image, type JsonObject } from '../467/helpers.ts';
export { accepted, rasterAll, type Drawn, type GlyphRow } from '../1965/helpers.ts';

/** The criteria's IDs: `#1966.` + the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = { 1: 'AC1 #1966.3e2ae44d', 2: 'AC2 #1966.bbe0ca22' } as const;

/** #1965's look: #467's look with a role for each token class, so the code's keywords draw in a role of their own. */
export const LOOK = LOOK_A;
const PAPER: [number, number, number] = [0xf4, 0xec, 0xd8];

export type Pt = [number, number];
export type Box = [number, number, number, number];
export type Rect = [number, number, number, number];

function withTitle(d: JsonObject, id: string): JsonObject {
  return { ...d, title: `#1966 ${id}`, description: `The #1966 acceptance document ${id}.` };
}

// ---------------------------------------------------------------------------------------------------
// The code: a function of seven lines, no digits (an unquoted code item's digits count as numbers), keywords tokened.

export const CODE = 'cfg';
export const SIZE = 24;
export const LINES = [
  'def area(radius):',
  '    if radius < lower:',
  '        raise ValueError(radius)',
  '    square = radius * radius',
  '    total = pi * square',
  '    print(total)',
  '    return total',
];
export const RAW = `${LINES.join('\n')}\n`;
const word = (w: string, line: number): { from: number; to: number } => {
  const start = RAW.indexOf(LINES[line - 1]!) + LINES[line - 1]!.indexOf(w);
  return { from: start, to: start + w.length };
};
const TOKENS = [
  { ...word('def', 1), class: 'keyword' }, { ...word('area', 1), class: 'function' }, { ...word('if', 2), class: 'keyword' },
  { ...word('raise', 3), class: 'keyword' }, { ...word('print', 6), class: 'function' }, { ...word('return', 7), class: 'keyword' },
];
/** The issue's highlight: lines 3 to 5, in its default treatment (`dim_others`). */
export const HIGHLIGHT: JsonValue[] = [{ lines: [3, 5] }];

/** The code item's params: `numbers: false`, so no gutter takes part in any read (README: Readings). */
export function codeParams(highlight?: JsonValue[]): JsonObject {
  return {
    font: 'mono', size: SIZE, paint: { fill: { role: 'ink' } }, raw: RAW,
    code: { language: 'python', tokens: TOKENS, numbers: false, ...(highlight ? { highlight } : {}) },
  };
}

export const STILL_PAGE: [number, number] = [620, 280];
export const STILL_AT: Pt = [40, 30];
/** The code still at 0 s: with the highlight, or without it and drawn at `opacity` (the item's own `adjust.opacity`). */
export function still(id: string, o: { highlight?: JsonValue[]; opacity?: number } = {}): JsonObject {
  const extra: JsonObject = { at: { pos: [STILL_AT[0], STILL_AT[1], 0] }, ...(o.opacity !== undefined ? { adjust: { opacity: o.opacity } } : {}) };
  return withTitle(doc(id, STILL_PAGE, [backdrop(STILL_PAGE), item(CODE, 'text@1', 'a1', codeParams(o.highlight), extra)]), id);
}

// The film: the same code under the highlight, scrolling up 100 u over 2 s (a keyed channel on its `at.pos` y), and
// a path from a fixed start whose end is attached to `cfg#line:4` with no gap.
export const FILM_PAGE: [number, number] = [900, 400];
export const FILM_X = 40;
export const SCROLL: [number, number][] = [[0, 150], [2, 50]];
export const START: Pt = [860, 200];
export const ANCHOR = `${CODE}#line:4`;
/** The code item's y at `s` seconds: the channel's linear keys. */
export const scrollY = (s: number): number => SCROLL[0]![1] + ((SCROLL[1]![1] - SCROLL[0]![1]) * (s - SCROLL[0]![0])) / (SCROLL[1]![0] - SCROLL[0]![0]);
export function film(withPath: boolean): JsonObject {
  const items = [
    backdrop(FILM_PAGE),
    item(CODE, 'text@1', 'a1', codeParams(HIGHLIGHT), { at: { pos: [FILM_X, SCROLL[0]![1], 0] } }),
    ...(withPath ? [item('pointer', 'path@1', 'a2', {
      d: `M ${START[0]} ${START[1]} L 640 ${START[1]}`, attach: { end: ANCHOR, gap: 0 }, paint: { stroke: { role: 'accent', width: 2 } },
    })] : []),
  ];
  return withTitle(doc('code-film-1966', FILM_PAGE, items, { transport: { span: '2s' }, channels: { 'code-scroll': keyed(`items/${CODE}/at/pos/1`, SCROLL) } }), 'code-film-1966');
}

// ---------------------------------------------------------------------------------------------------
// `geometry` and `path`

/** `geometry {doc, look, item, t}` for each `[id, t]` (one process): the `box` `[x, y, w, h]` in u, when the answer has one. */
export function boxesAt(bin: string, d: JsonObject, asks: [string, number][]): (Box | undefined)[] {
  const answers = render(bin, 'geometry' as 'check', asks.map(([id, t]) => ({ doc: d, look: LOOK, item: id, t })));
  return answers.map((a) => {
    const b = a['box'];
    return Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number') ? (b as Box) : undefined;
  });
}

/** `path {doc, look, item, times}`: the item's end point (the last point of its last sub-path, after its attachment) at each time. */
export function pathEnds(bin: string, d: JsonObject, id: string, times: number[]): Pt[] {
  const [answer] = render(bin, 'path', [{ doc: d, look: LOOK, item: id, times }]);
  expect(answer!['ok'], `path: ${id}, attached to ${ANCHOR}, is placed at every time, not refused: ${shown(answer)}`).toBe(true);
  const frames = answer!['frames'];
  expect(Array.isArray(frames) && frames.length === times.length, `path: one frame per time: ${shown(frames)}`).toBe(true);
  return (frames as JsonObject[]).map((f, i) => {
    const subpaths = subpathsOf(f['subpaths'], `path frame ${i}`);
    const last = subpaths[subpaths.length - 1]?.points;
    expect(last && last.length > 0, `path frame ${i} has a point`).toBe(true);
    return last![last!.length - 1]!;
  });
}

// ---------------------------------------------------------------------------------------------------
// Judges for AC1

/** Where the line from a box's centre toward `from` crosses the box's outline: where an attached end lands at `edge`. */
export function boxHit([x, y, w, h]: Box, from: Pt): Pt {
  const c: Pt = [x + w / 2, y + h / 2];
  const d: Pt = [from[0] - c[0], from[1] - c[1]];
  const s = Math.min(d[0] === 0 ? Infinity : w / 2 / Math.abs(d[0]), d[1] === 0 ? Infinity : h / 2 / Math.abs(d[1]));
  return [c[0] + s * d[0], c[1] + s * d[1]];
}
/** The distance from a point to a box's outline. */
export function toOutline(p: Pt, [x, y, w, h]: Box): number {
  const dx = Math.max(x - p[0], 0, p[0] - (x + w)); const dy = Math.max(y - p[1], 0, p[1] - (y + h));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p[0] - x, x + w - p[0], p[1] - y, y + h - p[1]);
}
const f2 = (v: number): string => v.toFixed(2);
const pt = (p: Pt): string => `(${f2(p[0])}, ${f2(p[1])})`;

/** Where line 4 is at a time, from the glyphs `raster` sets and the scroll: its baseline, its neighbours' and its ink's x span. */
export interface LineAt { b3: number; b4: number; b5: number; x0: number; x1: number }
/**
 * An end at `when` judged against the box `geometry` gives for `#line:4`: the box is line 4's (it holds line 4's
 * baseline and glyphs, and neither line 3's nor line 5's baseline), and the end lies on that box's edge within 0.5 u,
 * where the line from the box toward the path's start meets it.
 */
export function endFailures(when: string, box: Box | undefined, end: Pt, line: LineAt): string[] {
  if (!box) return [`${when}: geometry gives no box for ${ANCHOR}`];
  const out: string[] = [];
  const [x, y, w, h] = box;
  if (!(y <= line.b4 && line.b4 <= y + h)) out.push(`${when}: the box of ${ANCHOR} [${box.map(f2).join(', ')}] doesn't hold line 4's baseline at y ${f2(line.b4)}`);
  if (!(line.b3 < y && y + h < line.b5)) out.push(`${when}: the box of ${ANCHOR} [${box.map(f2).join(', ')}] reaches line 3's or line 5's baseline (y ${f2(line.b3)}, ${f2(line.b5)})`);
  if (!(x <= line.x0 + 0.5 && x + w >= line.x1 - 0.5)) out.push(`${when}: the box of ${ANCHOR} [${box.map(f2).join(', ')}] doesn't span line 4's glyphs, x ${f2(line.x0)} to ${f2(line.x1)}`);
  const edge = toOutline(end, box);
  const hit = boxHit(box, START);
  const off = Math.hypot(end[0] - hit[0], end[1] - hit[1]);
  if (!(edge <= 0.5)) out.push(`${when}: the path ends at ${pt(end)}, ${f2(edge)} u from the edge of line 4's box [${box.map(f2).join(', ')}], not within 0.5 u`);
  else if (!(off <= 0.5)) out.push(`${when}: the path ends at ${pt(end)} on the box's edge but ${f2(off)} u from ${pt(hit)}, where the line toward its start meets it`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Judges for AC1's dimming: each line's ink, read from the PNGs over the line's own band

/** Each of `lines`' grapheme range in the shown text (ASCII, so a grapheme is a UTF-16 unit and a line end counts one). */
export function rangesIn(text: string, lines: string[], what: string): [number, number][] {
  let from = 0;
  return lines.map((l) => {
    const at = text.indexOf(l, from);
    expect(at, `${what}: the shown text holds "${l}" after index ${from}: ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0);
    from = at + l.length;
    return [at, at + l.length];
  });
}
/** The glyphs drawn for graphemes [from, to), leaving spaces out. */
export const glyphsIn = (d: Drawn, [from, to]: [number, number]): GlyphRow[] => d.glyphs.filter((g) => g.grapheme >= from && g.grapheme < to && d.shown[g.grapheme] !== ' ');

/** A line's band in device px (zoom 1): its glyphs' x span, ±2 px, and 0.75 of the line pitch above its baseline to 0.25 below. */
export interface Band { line: number; baseline: number; x0: number; x1: number; rect: Rect }
export function bandsOf(d: Drawn, at: Pt, lines: string[]): Band[] {
  const ranges = rangesIn(d.shown, lines, 'the code');
  const rows = ranges.map((r, i) => {
    const g = glyphsIn(d, r);
    expect(g.length, `line ${i + 1} is drawn`).toBeGreaterThan(0);
    return { baseline: g[0]!.y, x0: Math.min(...g.map((q) => q.x)), x1: Math.max(...g.map((q) => q.x + q.advance)) };
  });
  const pitch = Math.min(...rows.slice(1).map((r, i) => r.baseline - rows[i]!.baseline));
  expect(pitch, `the lines are set one under another: ${rows.map((r) => r.baseline).join(', ')}`).toBeGreaterThan(SIZE);
  return rows.map((r, i) => ({
    line: i + 1, baseline: r.baseline, x0: r.x0, x1: r.x1,
    rect: [at[0] + r.x0 - 2, at[1] + r.baseline - 0.75 * pitch, at[0] + r.x1 + 2, at[1] + r.baseline + 0.25 * pitch],
  }));
}
const lum = (p: readonly number[]): number => (p[0]! + p[1]! + p[2]!) / 3;
/** A rectangle's ink: how much darker than the paper its pixels are, summed. */
export function inkIn(im: Image, [x0, y0, x1, y1]: Rect): number {
  let sum = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(im.height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(im.width, Math.ceil(x1)); x++) sum += Math.max(0, lum(PAPER) - lum(px(im, x, y)));
  return sum;
}
/**
 * The dimming judged line by line: each line's ink as a share of the same line drawn with no highlight. Lines `kept`
 * keep all of it (1 ± 0.03); every other line keeps what the item drawn at 40% opacity keeps (± 0.03).
 */
export function dimFailures(drawn: Image, full: Image, at40: Image, bands: Band[], kept: [number, number]): string[] {
  const out: string[] = [];
  for (const b of bands) {
    const whole = inkIn(full, b.rect);
    const share = inkIn(drawn, b.rect) / whole;
    const want = b.line >= kept[0] && b.line <= kept[1] ? 1 : inkIn(at40, b.rect) / whole;
    const what = b.line >= kept[0] && b.line <= kept[1] ? 'full opacity' : '40% opacity';
    if (!(Math.abs(share - want) <= 0.03)) out.push(`line ${b.line} keeps ${f2(share)} of its ink, not the ${f2(want)} of ${what}`);
  }
  return out;
}
/** A picture made of `a` on lines `from` to `to` and `b` elsewhere, band by band: a planted wrong range. */
export function spliced(a: Image, b: Image, bands: Band[], [from, to]: [number, number]): Image {
  const rgba = new Uint8Array(b.rgba);
  for (const band of bands.filter((x) => x.line >= from && x.line <= to)) {
    const [x0, y0, x1, y1] = band.rect;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(a.height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(a.width, Math.ceil(x1)); x++) {
      const o = (y * a.width + x) * 4;
      rgba.set(a.rgba.subarray(o, o + 4), o);
    }
  }
  return { width: b.width, height: b.height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// The list (AC2 and the Oracle lane): `text@1` with `list`, its lines set by the shaper; judged from glyphs and pixels

export const LIST = 'steps';
export interface ListOpts { list?: JsonObject; size?: number; w?: number; at?: Pt; page?: [number, number] }
/**
 * One `text@1` item `steps`: `items` joined by `\n`, in the body face, ink, in a box `w` wide whose height grows and
 * holds every line, drawn whole (`overflow: mask`: README, Readings).
 */
export function listDoc(id: string, items: string[], o: ListOpts = {}): JsonObject {
  const page = o.page ?? [460, 320];
  const at = o.at ?? [40, 30];
  const params: JsonObject = {
    text: items.join('\n'), font: 'body', size: o.size ?? SIZE, box: { w: o.w ?? 360, h: page[1] - at[1] - 10 }, autosize: 'height', overflow: 'mask',
    paint: { fill: { role: 'ink' } }, ...(o.list ? { list: o.list } : {}),
  };
  return withTitle(doc(id, page, [backdrop(page), item(LIST, 'text@1', 'a1', params, { at: { pos: [at[0], at[1], 0] } })]), id);
}

interface Component { pixels: Pt[]; cy: number }
/** The 8-connected components of ink (a pixel more than 64 codes from the paper in a channel) inside `rect`, of 3 px or more. */
export function inkComponents(im: Image, [x0, y0, x1, y1]: Rect): Component[] {
  const X0 = Math.max(0, Math.floor(x0)); const Y0 = Math.max(0, Math.floor(y0));
  const X1 = Math.min(im.width, Math.ceil(x1)); const Y1 = Math.min(im.height, Math.ceil(y1));
  const ink = (x: number, y: number): boolean => { const p = px(im, x, y); return Math.max(...[0, 1, 2].map((c) => Math.abs(p[c]! - PAPER[c]!))) > 64; };
  const seen = new Set<number>();
  const out: Component[] = [];
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    if (seen.has(y * im.width + x) || !ink(x, y)) continue;
    const pixels: Pt[] = []; const stack: Pt[] = [[x, y]]; seen.add(y * im.width + x);
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      pixels.push([cx, cy]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx; const ny = cy + dy;
        if (nx < X0 || ny < Y0 || nx >= X1 || ny >= Y1 || seen.has(ny * im.width + nx) || !ink(nx, ny)) continue;
        seen.add(ny * im.width + nx); stack.push([nx, ny]);
      }
    }
    if (pixels.length >= 3) out.push({ pixels, cy: pixels.reduce((s, p) => s + p[1], 0) / pixels.length });
  }
  return out;
}

/** An item's visual lines: its glyphs grouped by baseline, top to bottom, each with the x of its first non-space glyph. */
export interface VisualLine { baseline: number; x: number }
function visualLines(d: Drawn, range: [number, number]): VisualLine[] {
  const rows = new Map<number, number>();
  for (const g of glyphsIn(d, range)) {
    const key = [...rows.keys()].find((b) => Math.abs(b - g.y) <= 0.5) ?? g.y;
    rows.set(key, Math.min(rows.get(key) ?? Infinity, g.x));
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([baseline, x]) => ({ baseline, x }));
}
export interface ListRead { lines: VisualLine[][]; markers: Component[][][]; column: number; rect: Rect; pitch: number }
/**
 * The list as drawn: each item's visual lines (from `raster`'s glyphs) and, for each of them, the ink components left of
 * the wrapping item's text column (the markers), assigned to a line by their centre: within 0.75 of the pitch above its
 * baseline to 0.25 below.
 */
export function readList(d: Drawn, at: Pt, items: string[], wraps: number): ListRead {
  const lines = rangesIn(d.shown, items, 'the list').map((r) => visualLines(d, r));
  const baselines = lines.flat().map((l) => l.baseline).sort((a, b) => a - b);
  const pitch = Math.min(...baselines.slice(1).map((b, i) => b - baselines[i]!).filter((p) => p > 0.5), SIZE * 2);
  const column = lines[wraps]![0]!.x;
  const rect: Rect = [0, at[1] + baselines[0]! - pitch, at[0] + column - 1, at[1] + baselines[baselines.length - 1]! + 0.5 * pitch];
  const found = inkComponents(d.image!, rect);
  const markers = lines.map((item) => item.map((l) => found.filter((c) => c.cy >= at[1] + l.baseline - 0.75 * pitch && c.cy < at[1] + l.baseline + 0.25 * pitch)));
  return { lines, markers, column, rect, pitch };
}
/**
 * The criterion judged: item `wraps` takes two lines or more (exactly `count` when given), each of its lines after the
 * first starts under its text (the x of its first line's first glyph, within 0.5 u), and each item has a single marker
 * left of that text, on its first line, and none beside a wrapped line.
 */
export function listFailures(d: Drawn, at: Pt, items: string[], wraps: number, count?: number): string[] {
  const { lines, markers, column } = readList(d, at, items, wraps);
  const out: string[] = [];
  const own = lines[wraps]!;
  if (own.length < 2 || (count !== undefined && own.length !== count)) out.push(`item ${wraps + 1} takes ${own.length} line(s), not ${count ?? '2 or more'}: it doesn't wrap as asked`);
  own.slice(1).forEach((l, j) => {
    if (!(Math.abs(l.x - column) <= 0.5)) out.push(`item ${wraps + 1}'s wrapped line ${j + 2} starts at x ${f2(l.x)}, not under its text at x ${f2(column)}`);
  });
  markers.forEach((item, k) => item.forEach((m, j) => {
    const want = j === 0 ? 1 : 0;
    if (m.length !== want) out.push(`item ${k + 1}'s ${j === 0 ? 'first line' : `wrapped line ${j + 1}`} has ${m.length} marker(s) left of the text at x ${f2(column)}, not ${want}`);
  }));
  return out;
}
/** A planted twin: the picture with item `wraps`'s marker drawn again beside each of its wrapped lines. */
export function markerOnEveryLine(d: Drawn, at: Pt, items: string[], wraps: number): Drawn {
  const { lines, markers } = readList(d, at, items, wraps);
  const im = d.image!;
  const rgba = new Uint8Array(im.rgba);
  for (const l of lines[wraps]!.slice(1)) {
    const dy = Math.round(l.baseline - lines[wraps]![0]!.baseline);
    for (const c of markers[wraps]![0]!) for (const [x, y] of c.pixels) {
      if (y + dy >= im.height) continue;
      const from = (y * im.width + x) * 4; const to = ((y + dy) * im.width + x) * 4;
      rgba.set(im.rgba.subarray(from, from + 4), to);
    }
  }
  return { ...d, image: { width: im.width, height: im.height, rgba } };
}
