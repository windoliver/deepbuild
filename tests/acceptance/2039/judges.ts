// The judges: each decides one clause of a criterion from a picture's pixels, a check's answer or a reply, and returns
// what is wrong as lines of text, none when nothing is (README: Criteria to tests). Each line names what its criterion
// says a failure names: the row, the pixel, the edge, the set. A shipped program's row and a planted program's go
// through the same judge. Every expected value is the issue's, read off the fixture atlas's own texels (fixtures.ts);
// nothing here draws, lays out or checks a frame. No test runner is imported, so a plain node script can hand a judge a
// picture it drew itself, the right way and each wrong way (README: Run them).

import { createHash } from 'node:crypto';
import { CODE_0, CODE_MAX, CODE_STEP, SIDE, cellTexel, type Box, type JsonObject, type JsonValue, type Rgba } from './fixtures.ts';

/** A decoded picture: 8-bit RGBA, straight alpha, row by row (../467/helpers.ts `Image`). */
export interface Picture { width: number; height: number; rgba: Uint8Array }
export const pixel = (im: Picture, x: number, y: number): Rgba => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
};
const same = (a: Rgba, b: Rgba): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
const list = (p: readonly number[]): string => `[${p.join(', ')}]`;
/** The first `n` lines, and a last line saying how many more there are. */
const capped = (lines: string[], n = 48): string[] => (lines.length <= n ? lines : [...lines.slice(0, n), `(${lines.length - n} more)`]);
/** Whether the picture holds the whole box. */
const holds = (im: Picture, [x, y, w, h]: Box): boolean => x >= 0 && y >= 0 && x + w <= im.width && y + h <= im.height;
const outside = (row: string, im: Picture, box: Box): string[] => [`row ${row}: its box ${list(box)} doesn't lie on the ${im.width} × ${im.height} px picture`];

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the corners, and no texel of a neighbouring cell

const CORNERS = [['top left', 0, 0], ['top right', 1, 0], ['bottom left', 0, 1], ['bottom right', 1, 1]] as const;
/**
 * Each corner's 8 × 8 pixels against the source texels, exactly, on all four channels: the pixel at (i, j) of a
 * corner of the box is the texel at (i, j) of that corner of the cell. One line a pixel that differs, in the
 * picture's reading order (line by line, left to right), so the first line names the first differing pixel; each
 * names the row, the pixel and what it reads, and the texel and what it holds.
 */
export function cornerProblems(im: Picture, row: string, box: Box): string[] {
  if (!holds(im, box)) return outside(row, im, box);
  const [bx, by, bw, bh] = box;
  const found: { x: number; y: number; line: string }[] = [];
  for (const [name, right, bottom] of CORNERS) for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) {
    const [tx, ty] = [right ? 2 * SIDE + i : i, bottom ? 2 * SIDE + j : j];
    const [x, y] = [bx + (right ? bw - SIDE + i : i), by + (bottom ? bh - SIDE + j : j)];
    const [got, want] = [pixel(im, x, y), cellTexel(tx, ty)];
    if (!same(got, want)) found.push({ x, y, line: `row ${row}: pixel (${x}, ${y}) reads ${list(got)}; the source texel (${tx}, ${ty}), in the cell's ${name} corner, is ${list(want)}` });
  }
  return capped(found.sort((a, b) => a.y - b.y || a.x - b.x).map((f) => f.line));
}
/**
 * No pixel of the picture holds a texel from a neighbouring cell. Every texel of the frame cell has blue 0 and so has
 * every pixel of the item under the row, so any mix of them, by any sampling, has blue 0 exactly; every texel of the
 * eight cells around the frame has blue 255, so a pixel with any blue holds some of one. One line a pixel, naming the
 * row and the pixel.
 */
export function neighbourProblems(im: Picture, row: string): string[] {
  const out: string[] = [];
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const p = pixel(im, x, y);
    if (p[2] !== 0) out.push(`row ${row}: pixel (${x}, ${y}) reads ${list(p)}: its blue is a neighbouring cell's (the frame cell's texels and the item under the row hold none)`);
  }
  return capped(out);
}
/**
 * The frame fills its box: no pixel of the box shows the item under the row, whose red is 240 or more, above every
 * texel of the frame cell. So the pixels read for a neighbour's texel are the row's.
 */
export function coverProblems(im: Picture, row: string, box: Box): string[] {
  if (!holds(im, box)) return outside(row, im, box);
  const [bx, by, bw, bh] = box;
  const out: string[] = [];
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
    const p = pixel(im, x, y);
    if (p[0] > CODE_MAX || p[3] !== 255) out.push(`row ${row}: pixel (${x}, ${y}) of its box reads ${list(p)}, no texel of the frame cell (red at most ${CODE_MAX}, opaque): the frame doesn't fill its box there`);
  }
  return capped(out);
}
/**
 * What `whole_cell_scaled_to_box` draws, so the test knows its planted draw is that draw: the pixel at (px, py) of the
 * box shows the cell at ((px + ½) × 24 ÷ w, (py + ½) × 24 ÷ h), read on a 5 × 5 lattice of the box's pixels to within
 * half a texel, by nearest or by linear sampling.
 */
export function wholeCellProblems(im: Picture, box: Box): string[] {
  if (!holds(im, box)) return outside('(planted)', im, box);
  const [bx, by, bw, bh] = box;
  const code = (at: number): number => Math.min(CODE_MAX, Math.max(CODE_0, CODE_0 + CODE_STEP * (at - 0.5)));
  const out: string[] = [];
  for (let n = 0; n < 5; n++) for (let m = 0; m < 5; m++) {
    const [px, py] = [Math.round((m * (bw - 1)) / 4), Math.round((n * (bh - 1)) / 4)];
    const p = pixel(im, bx + px, by + py);
    const want = [code(((px + 0.5) * 3 * SIDE) / bw), code(((py + 0.5) * 3 * SIDE) / bh)];
    if (Math.abs(p[0] - want[0]!) > CODE_STEP / 2 + 1 || Math.abs(p[1] - want[1]!) > CODE_STEP / 2 + 1 || p[2] !== 0 || p[3] !== 255) {
      out.push(`pixel (${bx + px}, ${by + py}) reads ${list(p)}; the whole cell scaled to the box shows red ${want[0]!.toFixed(1)} and green ${want[1]!.toFixed(1)} there, within ${CODE_STEP / 2 + 1}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: the top edge's repeats

/** The red of the top edge's strip at its first texel (column 8 of the cell), and the red its eight texels span. */
const STRIP_0 = CODE_0 + CODE_STEP * SIDE;
const STRIP_SPAN = CODE_STEP * (SIDE - 1);
/**
 * `fill: tile`: the top edge repeats its 8-texel strip `repeats` times from the left corner's side, each repeat at the
 * strip's own size, so the pixel at (8 + 8k + i, j) of the box is the texel (8 + i, j) of the cell, exactly, for each
 * repeat k. One line a repeat that isn't the strip, naming the row, the edge, the repeat and its first differing
 * pixel, after a line that counts the repeats that are.
 */
export function tileProblems(im: Picture, row: string, box: Box, repeats: number): string[] {
  if (!holds(im, box)) return outside(row, im, box);
  const [bx, by] = box;
  const out: string[] = [];
  let whole = 0;
  for (let k = 0; k < repeats; k++) {
    let first = '';
    for (let j = 0; j < SIDE && !first; j++) for (let i = 0; i < SIDE && !first; i++) {
      const [x, y] = [bx + SIDE + SIDE * k + i, by + j];
      const [got, want] = [pixel(im, x, y), cellTexel(SIDE + i, j)];
      if (!same(got, want)) first = `row ${row}, top edge: repeat ${k + 1} of ${repeats}: pixel (${x}, ${y}) reads ${list(got)}; texel (${SIDE + i}, ${j}) of its 8-texel strip is ${list(want)}`;
    }
    if (first) out.push(first);
    else whole += 1;
  }
  return out.length ? [`row ${row}, top edge: ${whole} of the ${repeats} repeats of its 8-texel strip across ${SIDE * repeats} u are the strip`, ...out] : [];
}
/**
 * How many times a line of reds falls back from the strip's end to its start: a run of falling steps that drops by at
 * least half the strip's span. Inside a repeat the strip's red only climbs, and where one repeat ends and the next
 * starts it falls by the whole span, in one step or, where a pixel mixes the two, in two.
 */
function falls(reds: number[]): number {
  let n = 0;
  for (let i = 0; i + 1 < reds.length;) {
    let j = i;
    while (j + 1 < reds.length && reds[j + 1]! < reds[j]!) j += 1;
    if (reds[i]! - reds[j]! >= STRIP_SPAN / 2) n += 1;
    i = Math.max(j, i + 1);
  }
  return n;
}
/**
 * `fill: tile_fit`: across the run between the corners the top edge holds `repeats` repeats of its 8-texel strip, each
 * the same width, run ÷ repeats, and none cut. Read two ways on each of the strip's 8 lines. The count: the strip's
 * red climbs along a repeat and falls back where the next starts, so the falls plus one are the repeats. Each repeat:
 * a pixel whose centre is at d u into a repeat of width W shows the strip at texel coordinate u = 8d ÷ W, so its red
 * is 85 + 10 (u − ½) within half a texel's step and one code (linear and nearest sampling both land there), its green
 * its line's within one code, its blue 0, opaque. Pixels within a texel of a repeat's ends, where one repeat meets
 * the next, are read for the count only. A repeat that is cut, or wider or narrower than the others, shows another
 * texel than that. One line for the count and one a repeat, each naming the row and the edge.
 */
export function tileFitProblems(im: Picture, row: string, box: Box, repeats: number): string[] {
  if (!holds(im, box)) return outside(row, im, box);
  const [bx, by, bw] = box;
  const run = bw - 2 * SIDE;
  const each = run / repeats;
  const x0 = bx + SIDE;
  const out: string[] = [];
  const counts = Array.from({ length: SIDE }, (_, j) => falls(Array.from({ length: run }, (_, x) => pixel(im, x0 + x, by + j)[0])) + 1);
  if (counts.some((c) => c !== repeats)) out.push(`row ${row}, top edge: its strip repeats ${[...new Set(counts)].join(' or ')} times across the ${run} u between the corners (on its 8 lines: ${counts.join(', ')}), not ${repeats}`);
  for (let k = 0; k < repeats; k++) {
    let first = '';
    for (let j = 0; j < SIDE && !first; j++) for (let x = Math.max(0, Math.floor(k * each) - 1); x < run && x + 0.5 < (k + 1) * each && !first; x++) {
      const u = ((x + 0.5 - k * each) * SIDE) / each;
      if (u < 1 || u > SIDE - 1) continue;
      const p = pixel(im, x0 + x, by + j);
      const want = [STRIP_0 + CODE_STEP * (u - 0.5), CODE_0 + CODE_STEP * j];
      if (Math.abs(p[0] - want[0]!) > CODE_STEP / 2 + 1 || Math.abs(p[1] - want[1]!) > 1 || p[2] !== 0 || p[3] !== 255) {
        const shows = (p[0] - STRIP_0) / CODE_STEP + 0.5;
        first = `row ${row}, top edge: repeat ${k + 1} of ${repeats}, each ${each.toFixed(3)} u wide: pixel (${x0 + x}, ${by + j}) reads ${list(p)}, the strip at texel ${shows.toFixed(2)} of 8 by its red; a whole repeat of that width shows texel ${u.toFixed(2)} there (red ${want[0]!.toFixed(1)}, green ${want[1]}), so this repeat is cut or not the others' width`;
      }
    }
    if (first) out.push(first);
  }
  return out;
}
/**
 * What `tile_fit_cuts_last_tile` draws, so the test knows its planted draw is that draw: `whole` repeats of the strip
 * at its own size, exactly, then the strip's first `cut` texel columns, then the right corner's first column.
 */
export function cutProblems(im: Picture, box: Box, whole: number, cut: number): string[] {
  if (!holds(im, box)) return outside('(planted)', im, box);
  const [bx, by, bw] = box;
  const out = tileProblems(im, '(planted)', box, whole);
  for (let j = 0; j < SIDE; j++) for (let i = 0; i <= cut; i++) {
    const [x, y] = [bx + SIDE + SIDE * whole + i, by + j];
    const want = i < cut ? cellTexel(SIDE + i, j) : cellTexel(2 * SIDE, j);
    const got = pixel(im, x, y);
    if (!same(got, want)) out.push(`pixel (${x}, ${y}) reads ${list(got)}; ${i < cut ? `the cut tile's texel (${SIDE + i}, ${j})` : `the right corner's texel (${2 * SIDE}, ${j})`} is ${list(want)}`);
  }
  if (bx + SIDE + SIDE * whole + cut !== bx + bw - SIDE) out.push(`${whole} tiles of ${SIDE} u and ${cut} u more don't end at the right corner of a box ${bw} u wide`);
  return capped(out, 12);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the middle, and the refusals

/** The SHA-256 of a region's RGBA bytes, row by row. */
export function regionHash(im: Picture, [x0, y0, w, h]: Box): string {
  const hash = createHash('sha256');
  for (let y = y0; y < y0 + h; y++) hash.update(im.rgba.subarray((y * im.width + x0) * 4, (y * im.width + x0 + w) * 4));
  return hash.digest('hex');
}
/** The middle of a box: what its `slice` leaves between its sides. */
export const middleOf = ([x, y, w, h]: Box): Box => [x + SIDE, y + SIDE, w - 2 * SIDE, h - 2 * SIDE];
/** How many different colors a region holds. */
export function colorsIn(im: Picture, [x0, y0, w, h]: Box): number {
  const seen = new Set<string>();
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) seen.add(pixel(im, x, y).join(','));
  return seen.size;
}
/**
 * The middle of the row's box is not drawn, and the item under it shows through by pixel hash: the middle's pixels in
 * `shown` (the row over the item) hash as the same region of `alone` (the item with no row over it). The one line
 * names the row, both hashes and the first differing pixel.
 */
export function throughProblems(shown: Picture, alone: Picture, row: string, box: Box): string[] {
  const mid = middleOf(box);
  if (!holds(shown, box) || !holds(alone, box)) return outside(row, holds(shown, box) ? alone : shown, box);
  const [a, b] = [regionHash(shown, mid), regionHash(alone, mid)];
  if (a === b) return [];
  let off = 0;
  let first = '';
  for (let y = mid[1]; y < mid[1] + mid[3]; y++) for (let x = mid[0]; x < mid[0] + mid[2]; x++) {
    const [p, q] = [pixel(shown, x, y), pixel(alone, x, y)];
    if (same(p, q)) continue;
    off += 1;
    first ||= `the first at pixel (${x}, ${y}), which reads ${list(p)} where the item under it is ${list(q)}`;
  }
  return [`row ${row}: the middle ${mid[2]} × ${mid[3]} u of its box hashes ${a.slice(0, 16)}…, not ${b.slice(0, 16)}…, the item under it alone: ${off} of its pixels are drawn over, ${first}`];
}

/** An error issue of a check's answer: its own code, IDs and path, and the issue as answered (../467/helpers.ts `Issue`). */
export interface Found { code: string; ids: string[]; path: string; raw: JsonObject }
/** One document through `check`: whether it passed, and its error issues. */
export interface Checked { ok: boolean; errors: Found[] }
/** An issue's own fields: without its prose (`what`, `fix`), its catalog name (`check`) and its close names, as ../536/helpers.ts `fieldsOf` reads them. */
export function ownFields(issue: Found): JsonObject {
  const { what: _w, fix: _f, check: _c, close: _n, ...rest } = issue.raw;
  return rest;
}
const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `name` stands as a whole name in `text`: not inside a longer word, number or row name. */
const names = (text: string, name: string): boolean => new RegExp(`(^|[^A-Za-z0-9_#])${escaped(name)}([^A-Za-z0-9_#]|$)`).test(text);
/** `n` stands as a whole number in `text`: `16`, or `16.0`, not part of `160`, `1.16` or `16.5`. */
export const holdsNumber = (text: string, n: number): boolean => new RegExp(`(?<![\\d.])${escaped(String(n))}(?:\\.0+)?(?![\\d]|\\.\\d)`).test(text);
/** The issue names the set: its `ids` hold it, or its `path` is `items/<set>` or under it (../536/helpers.ts `namesItem`). */
export const namesSet = (issue: Found, set: string): boolean => issue.ids.includes(set) || issue.path === `items/${set}` || issue.path.startsWith(`items/${set}/`);
/**
 * The issue names the row: the row's name `<set>#<key>` (The path grammar: a sub-address after `#` names a mark set's
 * row key) stands whole in its own fields, in its `ids`, its `path` or any other; or it names the set and its own
 * fields hold `row`, at the top or under `actual`, equal to the row's key or index, as the column view's issue names
 * a row (#535). Its prose is not read for a name.
 */
export function namesRow(issue: Found, set: string, key: string): boolean {
  const own = ownFields(issue);
  if (names(JSON.stringify(own), `${set}#${key}`)) return true;
  const actual = own['actual'];
  const inner: JsonValue | undefined = typeof actual === 'object' && actual !== null && !Array.isArray(actual) ? actual['row'] : undefined;
  return namesSet(issue, set) && [own['row'], inner].some((v) => v === key || (typeof v === 'number' && String(v) === key));
}
/** The issue holds the size: `n` as a whole number in its message, `what`, or in its own fields. */
export const holdsSize = (issue: Found, n: number): boolean => holdsNumber(typeof issue.raw['what'] === 'string' ? issue.raw['what'] : '', n) || holdsNumber(JSON.stringify(ownFields(issue)), n);
const fieldsOf = (errors: Found[]): string => JSON.stringify(errors.map((e) => ({ ...ownFields(e), what: e.raw['what'] ?? null }))).slice(0, 1500);
/**
 * A row too small is refused at check, naming the row and the smallest size: `ok` is false, an error names the row,
 * and one that does holds `smallest`. Each line starts with `named`, which names the row.
 */
export function rowRefusalProblems(checked: Checked, set: string, key: string, smallest: number, side: 'width' | 'height', named: string): string[] {
  if (checked.ok) return [`${named}: check takes it (ok: true) where it must refuse it, naming the row ${set}#${key} and the smallest ${side} ${smallest}`];
  const naming = checked.errors.filter((e) => namesRow(e, set, key));
  if (!naming.length) return [`${named}: refused, but no error names the row ${set}#${key}: ${fieldsOf(checked.errors)}`];
  if (!naming.some((e) => holdsSize(e, smallest))) return [`${named}: refused naming the row ${set}#${key}, but no such error holds the smallest ${side} ${smallest} in its message or its own fields: ${fieldsOf(naming)}`];
  return [];
}
/** A set check must refuse is refused, naming the set: `ok` is false and an error names the set. */
export function setRefusalProblems(checked: Checked, set: string, named: string): string[] {
  if (checked.ok) return [`${named}: check takes it (ok: true) where it must refuse it, naming the set ${set}`];
  return checked.errors.some((e) => namesSet(e, set)) ? [] : [`${named}: refused, but no error names the set ${set}: ${fieldsOf(checked.errors)}`];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: one instanced draw

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
/**
 * The set's rows draw in one instanced draw for their atlas: `deep_show`'s `batches` hold exactly one entry whose
 * `items` hold the set, and its `instances` is a whole number no smaller than the rows (#535's reading of "one
 * instanced draw"; whether an instance is a row or one of its nine parts is the implementer's). Each line names the set.
 */
export function oneDrawProblems(batches: JsonValue | undefined, set: string, rows: number): string[] {
  if (!Array.isArray(batches)) return [`set ${set}: deep_show answers no batches list, so its draws can't be counted: ${JSON.stringify(batches ?? null).slice(0, 300)}`];
  const drawing = batches.filter(isObject).filter((b) => Array.isArray(b['items']) && b['items'].includes(set));
  const text = JSON.stringify(batches.map((b) => (isObject(b) ? { ...b, items: Array.isArray(b['items']) ? b['items'].slice(0, 4) : b['items'] } : b))).slice(0, 1200);
  if (drawing.length !== 1) return [`set ${set}: ${drawing.length} draws hold its rows, not one instanced draw for its atlas: ${text}`];
  const n = drawing[0]!['instances'];
  return typeof n === 'number' && Number.isInteger(n) && n >= rows ? [] : [`set ${set}: its one draw's instances are ${JSON.stringify(n ?? null)}, fewer than its ${rows} rows: ${text}`];
}
