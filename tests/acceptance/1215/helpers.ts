// Test-side tools for the #1215 acceptance tests (vertical text): the documents they draw, the glyph rows
// `deep-canvas-render raster` answers for a text item (README: The surface under test), the fixture CJK font's own
// tables read here for expected values (head, hmtx, vmtx, VORG, and GSUB's `vert` and `vrt2` features), Unicode
// 17.0.0's VerticalOrientation.txt, and the small geometry of a glyph's transform. Builds and runs come from #496's,
// #381's, #407's and #1479's helpers, imported. Nothing here stands in for the shaper, the renderer, the fit check or
// the film audit: every value a test compares comes from a binary, and every expected value from the issue's text,
// the font file or Unicode's file.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { cmapGlyph, readFace, type Sfnt } from '../417/helpers.ts';
import { arr, int, num, obj, show, type JsonObject, type JsonValue } from '../496/helpers.ts';

export type { JsonObject, JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1215 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID (scripts/proof-change.mjs: `#1215.` and the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #1215.711889f5',
  2: 'AC2 #1215.cfb50749',
  3: 'AC3 #1215.87255816',
  4: 'AC4 #1215.89bbe2ef',
  5: 'AC5 #1215.3816845b',
  6: 'AC6 #1215.9495512c',
  7: 'AC7 #1215.f8b80d0d',
  8: 'AC8 #1215.c041c4e8',
} as const;

/** The wrong programs the proof line names, as `raster`'s `planted` values (README: Planted programs). */
export const PLANT = {
  /** AC1: the shaper lays a vertical run out as horizontal text. */
  horizontal: 'vertical_laid_horizontal',
  /** AC2: the shaper never turns a glyph: every glyph stays upright. */
  neverTurns: 'never_turns',
  /** AC3: the shaper never applies the font's `vert` (or `vrt2`) substitution. */
  skipsVert: 'skips_vert',
} as const;

// ---------------------------------------------------------------------------------------------------
// Documents: #373's figure envelope, one writer layer, drawn in the shipped clean look (#417), whose font `cjk` is the
// bundled Han face, Noto Sans SC.

/** The look every document draws in: the shipped clean look, by ID. */
export const LOOK = 'clean';
const LAYERS: JsonObject = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };

/** A figure of `size` u holding `items`. */
export function figure(id: string, items: JsonObject[], size: [number, number]): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `#1215 ${id}`, description: `The #1215 acceptance tests' document ${id}.`, size, layers: LAYERS,
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}

/** A text@1 showing `text` in the clean look's `cjk` font, in ink, drawn from `pos`, with `params` over those. */
export function textItem(id: string, text: string, params: JsonObject, pos: [number, number], order = 'a1'): JsonObject {
  return {
    id, kind: 'text@1', layer: 'main', name: id, order,
    params: { text, font: 'cjk', paint: { fill: { role: 'ink' } }, ...params },
    at: { pos: [pos[0], pos[1], 0] },
  };
}

/** A `raster` line drawing `doc` at t = 0 in the clean look, its PNG `<name>.png` under `dir`, with `extra` fields. */
export function rasterLine(dir: string, name: string, doc: JsonObject, extra: JsonObject = {}): JsonObject {
  return { out: join(dir, `${name}.png`), doc, look: LOOK, t: 0, ...extra };
}

/** A `raster` answer that drew: `ok` true, else the test fails quoting it. */
export function drawnOf(answer: JsonObject | undefined, what: string): JsonObject {
  const a = obj(answer, `${what}: the raster answer`);
  expect(a['ok'], `${what}: raster draws the document: ${show(a)}`).toBe(true);
  return a;
}

// ---------------------------------------------------------------------------------------------------
// The glyph rows `raster` answers for a text item (#381's `texts`, #496's `transform`), read without their outlines.

export interface Row {
  /** The face file the glyph is drawn from, relative to the checkout. */
  font: string;
  /** The size it is shaped at, in u. */
  size: number;
  id: number;
  /** Its origin as the shaped run places it, in u from the run's origin. */
  x: number;
  y: number;
  grapheme: number;
  /** [a, b, c, d, e, f]: the glyph's own frame (pen origin on its baseline, x along its advance, y down) to the document. */
  transform: number[];
  raw: JsonObject;
}

/** The glyph rows of text item `item` in a raster answer, in order. */
export function rowsOf(answer: JsonObject, item: string, what: string): Row[] {
  const texts = obj(answer['texts'], `${what}: texts`);
  const glyphs = arr(obj(texts[item], `${what}: texts.${item}`)['glyphs'], `${what}: texts.${item}.glyphs`);
  return glyphs.map((v, i) => {
    const g = obj(v, `${what}: texts.${item}.glyphs[${i}]`);
    const at = `${what}: texts.${item}.glyphs[${i}]`;
    const transform = arr(g['transform'], `${at}.transform`).map((n, k) => num(n, `${at}.transform[${k}]`));
    expect(transform.length, `${at}.transform has six numbers`).toBe(6);
    expect(typeof g['font'], `${at}.font is a face file, got ${show(g['font'])}`).toBe('string');
    return {
      font: g['font'] as string, size: num(g['size'], `${at}.size`), id: int(g['id'], `${at}.id`), x: num(g['x'], `${at}.x`), y: num(g['y'], `${at}.y`),
      grapheme: int(g['grapheme'], `${at}.grapheme`), transform, raw: g,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Geometry of a glyph's transform (README: The surface under test)

/** A point of a glyph's own frame in the document. */
export const at = (t: number[], p: [number, number]): [number, number] => [t[0]! * p[0] + t[2]! * p[1] + t[4]!, t[1]! * p[0] + t[3]! * p[1] + t[5]!];
/** The direction the glyph's own x axis points in the document, in degrees: 0 upright, 90 turned a quarter clockwise (y down). */
export const turnOf = (t: number[]): number => (Math.atan2(t[1]!, t[0]!) * 180) / Math.PI;
/** The transform's determinant: positive unless the glyph is mirrored. */
export const det = (t: number[]): number => t[0]! * t[3]! - t[1]! * t[2]!;
/** A length in u as messages show it. */
export const fmt = (n: number): string => n.toFixed(2);
/** A code point as messages show it. */
export const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

// ---------------------------------------------------------------------------------------------------
// The fixture CJK font, read here as the OpenType specification lays its tables out: the face the clean look's `cjk`
// font names and its fallback list ends with Han in. #417's reader gives the table directory and the character map.

export const CJK_FILE = 'crates/deep-text/fonts/NotoSansSC-Regular.otf';

export interface Face { file: string; font: Sfnt; upem: number }

function table(f: Face, tag: string): number {
  const t = f.font.tables.get(tag);
  if (!t) throw Error(`${f.file} has no ${tag} table`);
  return t.offset;
}
const u16 = (f: Face, at: number): number => f.font.bytes.readUInt16BE(at);
const i16 = (f: Face, at: number): number => f.font.bytes.readInt16BE(at);
const u32 = (f: Face, at: number): number => f.font.bytes.readUInt32BE(at);

const faces = new Map<string, Face>();
/** A bundled face, read once. */
export function face(file = CJK_FILE): Face {
  let f = faces.get(file);
  if (!f) {
    const font = readFace(file);
    f = { file, font, upem: 0 };
    f.upem = u16(f, table(f, 'head') + 18);
    faces.set(file, f);
  }
  return f;
}
/** The glyph the face's character map gives a character (0: none). */
export const glyphOf = (f: Face, ch: string): number => cmapGlyph(f.font, ch.codePointAt(0)!);
/** A glyph's horizontal advance, font units (hmtx). */
export function hAdvance(f: Face, gid: number): number {
  const n = u16(f, table(f, 'hhea') + 34);
  return u16(f, table(f, 'hmtx') + 4 * Math.min(gid, n - 1));
}
/** A glyph's vertical advance, font units (vmtx), or null for a face with no vmtx. */
export function vAdvance(f: Face, gid: number): number | null {
  if (!f.font.tables.has('vmtx') || !f.font.tables.has('vhea')) return null;
  const n = u16(f, table(f, 'vhea') + 34);
  return u16(f, table(f, 'vmtx') + 4 * Math.min(gid, n - 1));
}
/** A glyph's vertical origin's y above its baseline, font units (VORG), or null for a face with no VORG. */
export function vOrigin(f: Face, gid: number): number | null {
  if (!f.font.tables.has('VORG')) return null;
  const o = table(f, 'VORG');
  const count = u16(f, o + 6);
  for (let i = 0; i < count; i++) if (u16(f, o + 8 + 4 * i) === gid) return i16(f, o + 10 + 4 * i);
  return i16(f, o + 4);
}

/** GSUB's feature `tag` under `script`'s default language system (DFLT's when the script has none): its lookups, in order. */
export function featureLookups(f: Face, tag: string, script = 'hani'): number[] {
  const gsub = table(f, 'GSUB');
  const scripts = gsub + u16(f, gsub + 4);
  const features = gsub + u16(f, gsub + 6);
  const records = (base: number): [string, number][] =>
    Array.from({ length: u16(f, base) }, (_, i) => [f.font.bytes.toString('latin1', base + 2 + 6 * i, base + 6 + 6 * i), base + u16(f, base + 6 + 6 * i)]);
  const byScript = new Map(records(scripts));
  const s = byScript.get(script) ?? byScript.get('DFLT');
  if (s === undefined) return [];
  const langSys = u16(f, s);
  if (langSys === 0) return [];
  const ls = s + langSys;
  const indices = Array.from({ length: u16(f, ls + 4) }, (_, i) => u16(f, ls + 6 + 2 * i));
  const all = records(features);
  const lookups = new Set<number>();
  for (const k of indices) {
    const [t, offset] = all[k]!;
    if (t !== tag) continue;
    for (let j = 0; j < u16(f, offset + 2); j++) lookups.add(u16(f, offset + 4 + 2 * j));
  }
  return [...lookups].sort((a, b) => a - b);
}

/** A coverage table's index of `gid`, or -1. */
function coverage(f: Face, o: number, gid: number): number {
  const format = u16(f, o);
  const count = u16(f, o + 2);
  if (format === 1) {
    for (let i = 0; i < count; i++) if (u16(f, o + 4 + 2 * i) === gid) return i;
    return -1;
  }
  for (let i = 0; i < count; i++) {
    const start = u16(f, o + 4 + 6 * i); const end = u16(f, o + 6 + 6 * i);
    if (gid >= start && gid <= end) return u16(f, o + 8 + 6 * i) + gid - start;
  }
  return -1;
}

/** `gid` after GSUB lookups `lookups` in order, each a single substitution (type 1, or one behind an extension, type 7). */
export function substitute(f: Face, lookups: number[], gid: number): number {
  const gsub = table(f, 'GSUB');
  const list = gsub + u16(f, gsub + 8);
  let g = gid;
  for (const k of lookups) {
    const lookup = list + u16(f, list + 2 + 2 * k);
    const type = u16(f, lookup);
    for (let j = 0; j < u16(f, lookup + 4); j++) {
      let sub = lookup + u16(f, lookup + 6 + 2 * j);
      let kind = type;
      if (kind === 7) { kind = u16(f, sub + 2); sub += u32(f, sub + 4); }
      if (kind !== 1) throw Error(`${f.file}: GSUB lookup ${k} is type ${kind}, not a single substitution`);
      const i = coverage(f, sub + u16(f, sub + 2), g);
      if (i < 0) continue;
      g = u16(f, sub) === 1 ? (g + i16(f, sub + 4)) & 0xffff : u16(f, sub + 6 + 2 * i);
      break;
    }
  }
  return g;
}

/** Every code point the face's Unicode character maps (formats 4 and 12) give a glyph, ascending. */
export function coveredCodePoints(f: Face): number[] {
  const cmap = table(f, 'cmap');
  const out = new Set<number>();
  for (let i = 0; i < u16(f, cmap + 2); i++) {
    const rec = cmap + 4 + 8 * i;
    const platform = u16(f, rec); const encoding = u16(f, rec + 2); const o = cmap + u32(f, rec + 4);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const format = u16(f, o);
    if (format === 12) {
      for (let j = 0; j < u32(f, o + 12); j++) {
        const g = o + 16 + 12 * j;
        const start = u32(f, g); const end = u32(f, g + 4); const first = u32(f, g + 8);
        for (let cp = start; cp <= end; cp++) if (first + cp - start !== 0) out.add(cp);
      }
    } else if (format === 4) {
      const seg2 = u16(f, o + 6);
      const ends = o + 14; const starts = ends + seg2 + 2; const deltas = starts + seg2; const ranges = deltas + seg2;
      for (let s = 0; s < seg2 / 2; s++) {
        const end = u16(f, ends + 2 * s); const start = u16(f, starts + 2 * s); const delta = i16(f, deltas + 2 * s); const range = u16(f, ranges + 2 * s);
        for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
          const raw = range === 0 ? cp : u16(f, ranges + 2 * s + range + 2 * (cp - start));
          if (range !== 0 && raw === 0) continue;
          if (((raw + delta) & 0xffff) !== 0) out.add(cp);
        }
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------
// Unicode 17.0.0's VerticalOrientation.txt, kept beside these tests (README: VerticalOrientation.txt)

export const VO_FILE = join(HERE, 'VerticalOrientation.txt');
export const VO_SHA256 = 'dcef09c3fb24d356b042569c328ec341efc5b53447700d799f2fb4834c3cd3cd';
export type Vo = 'U' | 'R' | 'Tu' | 'Tr';

/** Each code point's Vertical_Orientation as the file gives it: its own line's value, else the file's `@missing` one. */
export function verticalOrientation(): (cp: number) => Vo {
  const bytes = readFileSync(VO_FILE);
  expect(createHash('sha256').update(bytes).digest('hex'), `${VO_FILE} is Unicode 17.0.0's VerticalOrientation.txt, byte for byte`).toBe(VO_SHA256);
  const text = bytes.toString('utf8');
  expect(text.startsWith('# VerticalOrientation-17.0.0.txt'), 'the file is the 17.0.0 one').toBe(true);
  const missing = /^# @missing: 0000\.\.10FFFF; (U|R|Tu|Tr)\s*$/m.exec(text);
  expect(missing, 'the file states its @missing value').not.toBeNull();
  const by = new Map<number, Vo>();
  for (const line of text.split('\n')) {
    const m = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*(U|R|Tu|Tr)\s*(#|$)/.exec(line);
    if (!m) continue;
    const first = parseInt(m[1]!, 16); const last = m[2] ? parseInt(m[2], 16) : first;
    for (let cp = first; cp <= last; cp++) by.set(cp, m[3] as Vo);
  }
  const fallback = missing![1] as Vo;
  return (cp) => by.get(cp) ?? fallback;
}
