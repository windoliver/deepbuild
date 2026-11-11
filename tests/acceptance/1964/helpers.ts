// Test-side tools for the #1964 acceptance tests. The binary, the JSON-lines driver, PNG reading and the look come from
// ../467/helpers.ts by import, as #1653's suite takes them; this file adds the one document this suite draws (`H2O is
// water` in a font role, with runs), a reader for the two font tables the expected values come from (head and OS/2),
// and the ink measures the pixel checks take. Nothing here stands in for the renderer or the shaper.
// README: The surface under test.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  decodePng, item, num, obj, px, render, role, shown, str, LOOK, REPO, type Glyph, type Image, type JsonObject,
} from '../467/helpers.ts';

export { check, describeErrors, useBin, useDir, type JsonObject } from '../467/helpers.ts';

/** The criterion's ID: `#1964.` + the first 8 hex digits of SHA-256 of its text (README: Criteria to tests). */
export const AC = { 1: 'AC1 #1964.437d15d8' } as const;

// ---------------------------------------------------------------------------------------------------
// The document

export const TEXT = 'H2O is water';
/** Graphemes of TEXT: H is 0, the 2 is 1, O is 2; "water" is [7, 12). */
export const H = 0;
export const TWO = 1;
export const O = 2;
/** The item's size in u; at zoom 1 a u is a device pixel. */
export const SIZE = 96;
/** Where the text item sits (`at.pos`): its glyphs' `x` and `y` are read from here. */
export const ORIGIN: [number, number] = [40, 40];
export const PAGE: [number, number] = [760, 240];
/** The run that makes the 2 a subscript, and nothing else (what a run doesn't set stays the item's). */
export const SUB_RUN: JsonObject = { from: TWO, to: TWO + 1, shift: 'sub' };

/**
 * `H2O is water` as one `text@1` item `formula` at SIZE u in the look's font role `font` (`body` is Inter, `math` is
 * STIX Two Math in #467's look), start-aligned at the top of a 680 × 160 u box, over the paper backdrop, with `runs`
 * when given. "H2O" is marked a name in the document's honest_numbers check input, since the 2 of a formula's name
 * isn't a number (Honest numbers: names).
 */
export function formula(id: string, font: 'body' | 'math', runs?: JsonObject[]): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#1964 ${id}`, description: `The #1964 acceptance document ${id}.`, size: PAGE,
    budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    checks: [{ kind: 'honest_numbers', names: ['H2O'] }],
    items: Object.fromEntries([
      item('backdrop', 'rect@1', 'a0', { box: [0, 0, PAGE[0], PAGE[1]], paint: { fill: { role: 'paper' } } }),
      item('formula', 'text@1', 'a1', { text: TEXT, font, size: SIZE, box: { w: 680, h: 160 }, paint: { fill: { role: 'title' } }, ...(runs ? { runs } : {}) }, { at: { pos: [ORIGIN[0], ORIGIN[1], 0] } }),
    ].map((i) => [str(i['id'], 'item id'), i])),
  };
}
/** The look's bundled file for a font role (`fonts.<role>.file`). */
export const fontFile = (fontRole: string): string => str(obj(obj(LOOK['fonts'], 'look.fonts')[fontRole], `look.fonts.${fontRole}`)['file'], `look.fonts.${fontRole}.file`);

// ---------------------------------------------------------------------------------------------------
// Drawing

export interface Drawn { glyphs: Glyph[]; image: Image }
let lines = 0;
/** Each document drawn at t 0 through one `raster` process, each answer accepted, with its formula's glyphs and its PNG. */
export function drawAll(bin: string, dir: string, docs: JsonObject[], what: string[]): Drawn[] {
  const input = docs.map((d) => { lines += 1; return { out: join(dir, `f${process.pid}-${lines}.png`), doc: d, look: LOOK, t: 0 }; });
  const answers = render(bin, 'raster', input);
  return answers.map((a, i) => {
    expect(a['ok'], `raster ${what[i]} was drawn, not refused: ${shown(a)}`).toBe(true);
    const entry = obj(obj(a['texts'], `${what[i]}: texts`)['formula'], `${what[i]}: texts.formula`);
    return { glyphs: glyphsOfEntry(entry, what[i]!), image: decodePng(readFileSync(str(input[i]!['out'], 'out'))) };
  });
}
function glyphsOfEntry(entry: JsonObject, what: string): Glyph[] {
  const list = entry['glyphs'];
  expect(Array.isArray(list), `${what}: texts.formula.glyphs is an array, got ${shown(list)}`).toBe(true);
  return (list as JsonObject[]).map((g, i) => ({
    font: str(g['font'], `${what} glyphs[${i}].font`), size: num(g['size'], `${what} glyphs[${i}].size`), id: num(g['id'], `${what} glyphs[${i}].id`),
    x: num(g['x'], `${what} glyphs[${i}].x`), y: num(g['y'], `${what} glyphs[${i}].y`), grapheme: num(g['grapheme'], `${what} glyphs[${i}].grapheme`),
  }));
}
/** The one glyph a grapheme is drawn with. */
export function glyphOf(glyphs: Glyph[], grapheme: number, what: string): Glyph {
  const found = glyphs.filter((g) => g.grapheme === grapheme);
  expect(found.length, `${what}: grapheme ${grapheme} of "${TEXT}" is drawn by one glyph: ${shown(found)}`).toBe(1);
  return found[0]!;
}

// ---------------------------------------------------------------------------------------------------
// The font's own metrics, read from its file (OpenType: the table directory, `head`, `OS/2`)

export interface SubscriptMetrics { unitsPerEm: number; ySubscriptYSize: number; ySubscriptYOffset: number }
/**
 * `head.unitsPerEm` and `OS/2.ySubscriptYSize` and `OS/2.ySubscriptYOffset` of the font at `path` (relative to the
 * checkout, as a glyph's `font` names it), read from the file's own table directory. The OS/2 fields are FWORDs (int16,
 * big-endian) at byte 12 and byte 16 of the table, present in every OS/2 version; `unitsPerEm` is a uint16 at byte 18
 * of `head`.
 */
export function subscriptMetrics(path: string): SubscriptMetrics {
  const file = readFileSync(join(REPO, path));
  const version = file.readUInt32BE(0);
  expect([0x00010000, 0x4f54544f, 0x74727565].includes(version), `${path} is one TrueType or CFF font (sfnt version ${version.toString(16)})`).toBe(true);
  const tables = new Map<string, number>();
  const count = file.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i;
    tables.set(file.toString('latin1', at, at + 4), file.readUInt32BE(at + 8));
  }
  const head = tables.get('head');
  const os2 = tables.get('OS/2');
  expect(head !== undefined && os2 !== undefined, `${path} has a head table and an OS/2 table`).toBe(true);
  return { unitsPerEm: file.readUInt16BE(head! + 18), ySubscriptYSize: file.readInt16BE(os2! + 12), ySubscriptYOffset: file.readInt16BE(os2! + 16) };
}

// ---------------------------------------------------------------------------------------------------
// Ink

/** A pixel is ink when one of its channels is more than 64 codes from the paper's. */
const PAPER = role('paper');
const inked = (im: Image, x: number, y: number): boolean => {
  const p = px(im, x, y);
  return Math.max(Math.abs(p[0] - PAPER[0]), Math.abs(p[1] - PAPER[1]), Math.abs(p[2] - PAPER[2])) > 64;
};
/**
 * The rows of ink in the columns between a glyph's pen position and the next glyph's, in device px at zoom 1, one
 * column in from each so neither neighbour's anti-aliased edge counts: `top` is the first inked row, `bottom` one past
 * the last.
 */
export function inkRows(im: Image, fromU: number, toU: number, what: string): { top: number; bottom: number } {
  const x0 = Math.ceil(ORIGIN[0] + fromU) + 1;
  const x1 = Math.floor(ORIGIN[0] + toU) - 1;
  let top = Infinity; let bottom = -Infinity;
  for (let y = 0; y < im.height; y++) for (let x = x0; x < x1; x++) {
    if (!inked(im, x, y)) continue;
    top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
  }
  expect(Number.isFinite(top), `${what}: ink between columns ${x0} and ${x1}`).toBe(true);
  return { top, bottom };
}
/** Pixels that differ between two images in columns [0, x1), every row, as "(x, y)". */
export function differing(a: Image, b: Image, x1: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < Math.min(a.height, b.height); y++) for (let x = 0; x < x1; x++) {
    const p = px(a, x, y); const q = px(b, x, y);
    if (p.some((v, k) => v !== q[k])) out.push(`(${x}, ${y})`);
  }
  return out;
}
