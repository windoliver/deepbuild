// Test-side tools for the #1965 acceptance tests: the base's `deep-canvas-render` (`check`, `raster`), driven by JSON
// lines through #467's helpers (imported by path, never edited); this suite's looks (#467's look with `code` and `diff`
// role maps added), its code documents, the independent model of the design's raw-to-display steps, and the pixel
// reads. Nothing here stands in for the renderer, the shaper or the check.
// README: The surfaces under test.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  LOOK, REPO, arr, backdrop, clone, decodePng, doc, item, num, obj, px, render, role, sha256, shown, str,
  type Image, type JsonObject, type JsonValue,
} from '../467/helpers.ts';

export { useBin, useDir, type JsonObject, type JsonValue } from '../467/helpers.ts';

/** The criteria's IDs: `#1965.` + the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = { 1: 'AC1 #1965.1f0016ec', 2: 'AC2 #1965.1d486d42', 3: 'AC3 #1965.47bbd705' } as const;

// ---------------------------------------------------------------------------------------------------
// Looks: #467's look, with the code and diff role maps the issue adds (`code: {class → role}`, `diff: {added,
// removed, changed → role}`). Two looks that give every class another role, so a switch is visible in each.

export const CLASSES = ['keyword', 'type', 'function', 'variable', 'string', 'number', 'comment', 'operator', 'punctuation', 'plain'] as const;
export type Class = (typeof CLASSES)[number];
export const CODE_A: Record<Class, string> = {
  keyword: 'vermilion', type: 'ochre', function: 'indigo', variable: 'moss', string: 'wine', number: 'sepia', comment: 'muted', operator: 'accent', punctuation: 'ink', plain: 'ink',
};
export const CODE_B: Record<Class, string> = {
  keyword: 'moss', type: 'wine', function: 'vermilion', variable: 'indigo', string: 'accent', number: 'ochre', comment: 'sepia', operator: 'muted', punctuation: 'ink', plain: 'ink',
};
export const lookWith = (id: string, code: Record<Class, string>): JsonObject => ({
  ...clone(LOOK), id, code, diff: { added: 'moss', removed: 'vermilion', changed: 'ochre' },
});
export const LOOK_A = lookWith('code-1965-a', CODE_A);
export const LOOK_B = lookWith('code-1965-b', CODE_B);
export { role };

// ---------------------------------------------------------------------------------------------------
// Documents

export const PAGE: [number, number] = [900, 260];
export const ORIGIN: [number, number] = [20, 20];
export const SIZE = 48;
export const ITEM = 'cfg';
export interface Token { from: number; to: number; class: string }
export interface Quote { source: string; path: string; lines: [number, number] }
export interface CodeOpts { tokens?: Token[]; quote?: Quote; size?: number; page?: [number, number]; ground?: string; extra?: JsonObject }

/** One code item `cfg` (`text@1` with `code` and `raw`, in the look's `mono` role, ink paint) over a paper backdrop. */
export function codeDoc(id: string, raw: string, o: CodeOpts = {}): JsonObject {
  const page = o.page ?? PAGE;
  const params: JsonObject = {
    font: 'mono', size: o.size ?? SIZE, paint: { fill: { role: 'ink' } },
    code: { language: 'python', ...(o.tokens ? { tokens: o.tokens as unknown as JsonValue } : {}) }, raw,
    ...(o.quote ? { quote: o.quote as unknown as JsonValue } : {}), ...(o.extra ?? {}),
  };
  const assets: JsonObject = o.quote ? { 'source-file': { sha256: o.quote.source, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' } } } : {};
  return doc(id, page, [backdrop(page, o.ground), item(ITEM, 'text@1', 'a1', params, { at: { pos: [ORIGIN[0], ORIGIN[1], 0] } })], o.quote ? { assets } : {});
}

// ---------------------------------------------------------------------------------------------------
// check and raster

export interface Issue { code: string; ids: string[]; path: string; raw: JsonObject }
export interface Checked { ok: boolean; errors: Issue[]; answer: JsonObject }
/** `check {doc, look, store?}` through one process. */
export function checkAll(bin: string, docs: JsonObject[], look: JsonObject | string, store?: string): Checked[] {
  const answers = render(bin, 'check', docs.map((d) => ({ doc: d, look, ...(store ? { store } : {}) })));
  return answers.map((a, n) => {
    expect(typeof a['ok'], `check [${n}] answers ok: ${shown(a)}`).toBe('boolean');
    const issues = Array.isArray(a['issues']) ? (a['issues'] as JsonObject[]) : [];
    const errors = issues.filter((i) => i['severity'] === 'error').map((i) => ({
      code: String(i['code']), ids: Array.isArray(i['ids']) ? i['ids'].map(String) : [], path: String(i['path'] ?? ''), raw: i,
    }));
    return { ok: a['ok'] === true, errors, answer: a };
  });
}
export const checkOne = (bin: string, d: JsonObject, look: JsonObject | string, store?: string): Checked => checkAll(bin, [d], look, store)[0]!;
export const describe = (c: Checked): string => JSON.stringify(c.errors.map((e) => ({ code: e.code, ids: e.ids, path: e.path, actual: e.raw['actual'], what: e.raw['what'] }))).slice(0, 2500);
/** An error's own words: every field but its `fix`, as text (a refusal names what it refuses in these). */
export const words = (e: Issue): string => JSON.stringify(Object.fromEntries(Object.entries(e.raw).filter(([k]) => k !== 'fix')));
/** The errors that name the item (by `ids`, or by a path under it). */
export const naming = (c: Checked, id: string): Issue[] => c.errors.filter((e) => e.ids.includes(id) || e.path.startsWith(`items/${id}/`) || e.path === `items/${id}`);

export interface GlyphRow { x: number; y: number; grapheme: number; advance: number; role: string | null; size: number }
export interface Drawn { ok: boolean; answer: JsonObject; shown: string; glyphs: GlyphRow[]; image: Image | undefined }
let lines = 0;
/** Each document drawn at t 0 through one `raster` process, with the item's `texts` entry and its PNG. */
export function rasterAll(bin: string, dir: string, docs: JsonObject[], look: JsonObject | string, store?: string, itemId = ITEM): Drawn[] {
  const input = docs.map((d) => { lines += 1; return { out: join(dir, `c${process.pid}-${lines}.png`), doc: d, look, t: 0, ...(store ? { store } : {}) }; });
  return render(bin, 'raster', input).map((a, n) => {
    if (a['ok'] !== true) return { ok: false, answer: a, shown: '', glyphs: [], image: undefined };
    const entry = obj(obj(a['texts'], `raster [${n}]: texts`)[itemId], `raster [${n}]: texts.${itemId}`);
    const list = arr(entry['glyphs'], `raster [${n}]: texts.${itemId}.glyphs`) as JsonObject[];
    const glyphs = list.map((g, i) => ({
      x: num(g['x'], `glyphs[${i}].x`), y: num(g['y'], `glyphs[${i}].y`), grapheme: num(g['grapheme'], `glyphs[${i}].grapheme`),
      advance: typeof g['advance'] === 'number' ? g['advance'] : 0, role: typeof g['role'] === 'string' ? g['role'] : null, size: num(g['size'], `glyphs[${i}].size`),
    }));
    return { ok: true, answer: a, shown: str(entry['shown'], `raster [${n}]: texts.${itemId}.shown`), glyphs, image: decodePng(readFileSync(str(input[n]!['out'], 'out'))) };
  });
}
export const drawOne = (bin: string, dir: string, d: JsonObject, look: JsonObject | string, store?: string): Drawn => rasterAll(bin, dir, [d], look, store)[0]!;
export function accepted(d: Drawn, what: string): Drawn {
  expect(d.ok, `raster ${what} was drawn, not refused: ${shown(d.answer)}`).toBe(true);
  return d;
}

// ---------------------------------------------------------------------------------------------------
// The design's raw-to-display steps, modelled here from the issue's words only: decode UTF-8, split lines at LF, CRLF
// or CR and drop the ends, expand tabs at `tab` columns, NFC; each display grapheme keeps its raw byte range.

export interface DisplayGrapheme { text: string; from: number; to: number; line: number }
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
export function model(raw: string, tab = 4): { text: string; graphemes: DisplayGrapheme[] } {
  const graphemes: DisplayGrapheme[] = [];
  let text = '';
  let at = 0; // the raw byte offset of the line start
  const parts = raw.split(/(\r\n|\n|\r)/);
  let line = 0;
  for (let p = 0; p < parts.length; p += 2) {
    const body = parts[p]!;
    const end = parts[p + 1] ?? '';
    if (body === '' && end === '') break;
    line += 1;
    if (line > 1) { graphemes.push({ text: '\n', from: -1, to: -1, line: line - 1 }); text += '\n'; }
    let column = 0; let off = at;
    for (const { segment } of seg.segment(body)) {
      const bytes = Buffer.byteLength(segment, 'utf8');
      const shownText = segment === '\t' ? ' '.repeat(tab - (column % tab)) : segment.normalize('NFC');
      column += segment === '\t' ? shownText.length : 1;
      // A tab is one space grapheme per column it fills; any other grapheme stays one.
      for (const ch of segment === '\t' ? shownText.split('') : [shownText]) graphemes.push({ text: ch, from: off, to: off + bytes, line });
      off += bytes;
      text += shownText;
    }
    at = off + Buffer.byteLength(end, 'utf8');
  }
  return { text, graphemes };
}
/** The display grapheme indices (into the drawn text, a line end counting one) that the raw bytes [from, to) cover. */
export function indicesOf(m: { graphemes: DisplayGrapheme[] }, from: number, to: number): number[] {
  const out: number[] = [];
  m.graphemes.forEach((g, i) => { if (g.from >= from && g.to <= to && g.from >= 0 && g.to > g.from) out.push(i); });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Pixels

export type Rgb = [number, number, number];
/** Pixels in a rectangle (device px at zoom 1) within `tol` of `rgb` in every channel. */
export function matching(im: Image, [x0, y0, x1, y1]: [number, number, number, number], rgb: Rgb, tol = 6): number {
  let n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(im.height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(im.width, Math.ceil(x1)); x++) {
    const p = px(im, x, y);
    if (Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol) n += 1;
  }
  return n;
}
/** A glyph's cell: its pen position to its advance, from above the cap height to below the baseline. */
export const cell = (g: GlyphRow): [number, number, number, number] => [ORIGIN[0] + g.x, ORIGIN[1] + g.y - 0.8 * g.size, ORIGIN[0] + g.x + g.advance, ORIGIN[1] + g.y + 0.2 * g.size];
export const imagesEqual = (a: Image, b: Image): boolean => a.width === b.width && a.height === b.height && a.rgba.every((v, i) => v === b.rgba[i]);

export { sha256 };

/** `deep-canvas-render look` (not in #467's `render` helper): one JSON line in, one out. */
export function lookCommand(bin: string, input: JsonObject): JsonObject {
  const run = spawnSync(bin, ['look'], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-canvas-render look: ${run.error.message}`);
  expect(run.status, `deep-canvas-render look exits 0: ${run.stderr.slice(-1500)}`).toBe(0);
  return obj(JSON.parse(run.stdout.split('\n').filter((l) => l !== '')[0]!) as JsonValue, 'look answer');
}

// ---------------------------------------------------------------------------------------------------
// Colors

export const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
/** An sRGB-encoded color in OKLab (Ottosson's matrices), to hold the status distance as the look's guard does. */
export function oklab([r, g, b]: Rgb): [number, number, number] {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const distance = (a: Rgb, b: Rgb): number => {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** `geometry {doc, look, item, t: 0}` for each id (one process): the item's `box` `[x, y, w, h]` in u, when the answer has one. */
export function geometryOf(bin: string, d: JsonObject, look: JsonObject | string, ids: string[]): Map<string, [number, number, number, number]> {
  const answers = render(bin, 'geometry' as 'check', ids.map((id) => ({ doc: d, look, item: id, t: 0 })));
  const out = new Map<string, [number, number, number, number]>();
  answers.forEach((a, n) => {
    const box = a['box'];
    if (Array.isArray(box) && box.length === 4 && box.every((v) => typeof v === 'number')) out.set(ids[n]!, box as [number, number, number, number]);
  });
  return out;
}
