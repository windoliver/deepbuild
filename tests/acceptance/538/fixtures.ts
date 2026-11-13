// The criteria's fixtures (README: Fixtures): the documents, each a #391 film envelope as #535's suite writes one (a 2D
// camera over the page, a transport at 60 frames a second, its logic item with its program listed in `assets`), with
// the issue's fields on its `cells@1`, `text@1`, `marks@1` and `group@1` items, and each reference the same item with
// what it must show written out and no logic. Nothing here draws, unpacks, looks up or flips anything.

import {
  COLS, GLYPHS, HEAP_WRITES, LABELS, LAYER_COLS, LAYER_WRITES, ROLES, ROWS, RULES_WRITES, STORY_WRITES, UNITS_WRITES, type Writes,
} from './programs.ts';
import { encodeRgbaPng, ordered, type JsonObject, type JsonValue, type Program, type Rect, type Rgb } from './helpers.ts';

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #538 acceptance tests.' };
export const SEED = 538;

function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
/** A film envelope (#535's): a 2D camera over the page, 4 s at 60 fps, the items, `assets` with a license each, and
 * `extra` (a document's `locale` and `data`). */
export function film(id: string, size: [number, number], items: JsonObject[], assets: Record<string, string>, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#538 ${id}`, description: `The #538 acceptance tests' document ${id}.`, size, seed: SEED, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] }, ...extra,
    items: Object.fromEntries([camera2d(size), ...items].map((i) => [String(i['id']), i])),
    assets: Object.fromEntries(Object.entries(assets).map(([name, sha]) => [name, { sha256: sha, license: LICENSE }])),
  };
}
/** A logic item (Logic `logic@1`): its program by SHA-256 at 60 steps a second, writing `writes`. */
export function logicItem(id: string, program: Program, writes: Writes): JsonObject {
  return {
    id, kind: 'logic@1', name: `Logic ${id}`, order: 'a9',
    params: { program: program.sha, step_rate: 60, writes: Object.fromEntries(writes.map(([n, type, count]) => [n, { type, count }])) },
  };
}
const programAsset = (p: Program): Record<string, string> => ({ [`${p.name}_program`]: p.sha });
/** A typed data column `{dtype, len, data: base64}` (Mark set and columns). */
export function dataColumn(dtype: 'f32' | 'i32' | 'u16', values: number[]): JsonObject {
  const width = dtype === 'u16' ? 2 : 4;
  const b = Buffer.alloc(width * values.length);
  values.forEach((v, i) => (dtype === 'f32' ? b.writeFloatLE(v, 4 * i) : dtype === 'i32' ? b.writeInt32LE(v, 4 * i) : b.writeUInt16LE(v, 2 * i)));
  return { dtype, len: values.length, data: b.toString('base64') };
}
export const strColumn = (values: string[]): JsonObject => ({ dtype: 'str', len: values.length, data: values });

// ---------------------------------------------------------------------------------------------------
// Criterion 1: `board`, a 40 × 12 cell grid of 8 × 16 px cells at (8, 8), fed by `rules.cells`; and `key`, a 3 × 1 grid
// of literal cells under it whose colors are ink and accent by palette index, so each role's color is read from what the
// cells module draws for it.

/** The look's roles a terminal draws with (#1003), the palette's sixteen ANSI roles in order. */
const TERMINAL_ROLES = [
  'term_black', 'term_red', 'term_green', 'term_yellow', 'term_blue', 'term_magenta', 'term_cyan', 'term_white',
  'term_bright_black', 'term_bright_red', 'term_bright_green', 'term_bright_yellow', 'term_bright_blue', 'term_bright_magenta', 'term_bright_cyan', 'term_bright_white',
];
const FONT: JsonObject = { family: 'mono', size: 13, fallback: [], ligatures: false };
export const GRID_SIZE: [number, number] = [336, 232];
export const GRID_SHOT_SIZE: [number, number] = [336, 208];
export interface GridOptions { glyphs?: string[]; count?: number; key?: boolean }
export function gridDoc(program: Program, o: GridOptions = {}): JsonObject {
  const key = o.key ?? true;
  const items: JsonObject[] = [
    logicItem('rules', program, [['cells', 'i32', o.count ?? COLS * ROWS]]),
    {
      id: 'board', kind: 'cells@1', name: 'Dungeon', order: 'a1', at: { pos: [8, 8, 0] },
      params: {
        size: { cols: COLS, rows: ROWS, cell: [8, 16] }, font: FONT, palette: { fg: 'ink', bg: 'ground', ansi: TERMINAL_ROLES, truecolor: true },
        grid: { array: 'rules.cells', size: [COLS, ROWS], glyphs: o.glyphs ?? GLYPHS, roles: ROLES },
      },
    },
  ];
  if (key) {
    items.push({
      id: 'key', kind: 'cells@1', name: 'Key', order: 'a2', at: { pos: [8, 208, 0] },
      params: {
        size: { cols: 3, rows: 1, cell: [8, 16] }, font: FONT,
        palette: { fg: 'ink', bg: 'ground', ansi: ['ink', 'accent', ...Array.from({ length: 14 }, () => 'ink')], truecolor: true },
        frame: {
          revision: 1, base: null, cells: [{ g: '@', fg: 1, bg: 0 }, { g: '#', fg: 0, bg: 1 }, { g: '' }], attrs: [],
          cursor: { x: 0, y: 0, shape: 'block', visible: false, blink: false }, scroll: { history: 0, offset: 0 }, links: {}, images: [],
          modes: { alt_screen: false, bracketed_paste: false, app_cursor: false, focus_events: false, mouse: 'none' },
        },
      },
    });
  }
  return film('grid', key ? GRID_SIZE : GRID_SHOT_SIZE, items, programAsset(program), { requires: { modules: { cells: '^1' } } });
}

// ---------------------------------------------------------------------------------------------------
// Criteria 2 and 3: `caption`, a text item at (8, 12) showing `loot[rules.item]` with rules.count at its widest '999';
// and its references, the same item with the string written out.

export const CAPTION_SIZE: [number, number] = [320, 40];
export const caption = (text: JsonValue): JsonObject =>
  ({ id: 'caption', kind: 'text@1', name: 'Caption', order: 'a1', at: { pos: [8, 12, 0] }, params: { text, size: 13, numerals: 'tabular' } });
export const COPY_TEXT: JsonObject = { copy: 'loot[rules.item]', args: [{ path: 'rules.count', widest: '999' }] };
/** Key 17 in English and French, as the criterion writes them. */
export const KEY17 = {
  en: { one: 'You found {0} gold coin', other: 'You found {0} gold coins' },
  fr: { one: 'Vous trouvez {0} pièce d\'or', other: 'Vous trouvez {0} pièces d\'or' },
  de: { one: 'Du hast {0} Goldmünze gefunden', other: 'Du hast {0} Goldmünzen gefunden' },
} as const;
/** The copy document: `rules` and `caption`, with `loot` in each locale given (the document's locale English). */
export function copyDoc(program: Program, tables: Record<string, JsonValue>): JsonObject {
  return film('loot', CAPTION_SIZE, [logicItem('rules', program, RULES_WRITES), caption(COPY_TEXT)], programAsset(program),
    { locale: 'en', data: { copy: Object.fromEntries(Object.entries(tables).map(([locale, loot]) => [locale, { loot }])) } });
}
/** The criterion's table: key 17 alone, in English and French. */
export const pluralTables = (): Record<string, JsonValue> => ({ en: { 17: { ...KEY17.en } }, fr: { 17: { ...KEY17.fr } } });
/** Criterion 3's English table, its keys stored in the order given (4, 17, 9 first, then sorted). */
export const RUSTY = 'You found a rusty key';
export const SILVER = 'You found a silver ring';
export function keyedTable(order: number[]): Record<string, JsonValue> {
  const entry = (k: number): JsonValue => (k === 4 ? RUSTY : k === 9 ? SILVER : { ...KEY17.en });
  return { en: ordered(order.map((k) => [String(k), entry(k)])) };
}
/** A reference: the caption showing `text` and nothing else, no logic. Its string is #407's localized copy (`copy: key`
 * into `data.copy[locale]`), which shows as text, so the honest-numbers check doesn't refuse a written-out count. */
export function captionRef(id: string, text: string): JsonObject {
  const item = caption(null);
  const { text: _t, ...params } = item['params'] as JsonObject;
  return film(id, CAPTION_SIZE, [{ ...item, params: { ...params, copy: 'shown' } }], {}, { locale: 'en', data: { copy: { en: { shown: text } } } });
}
/** What a plural entry shows for count n, by the form named. */
export const formOf = (s: string, n: number): string => s.replace('{0}', String(n));

// ---------------------------------------------------------------------------------------------------
// Criterion 4: `offer`, a 200 u wide text item with max_lines 1, over `items` in English and German.

export const OFFER_SIZE: [number, number] = [240, 40];
export const LONG_DE = 'Der Händler verkauft Ihnen {0} außergewöhnlich wertvolle Edelsteine aus dem fernen Norden';
export function offerDoc(program: Program, de23: string, args: JsonValue[] = [{ path: 'rules.count', widest: '999' }]): JsonObject {
  return film('offer', OFFER_SIZE, [
    logicItem('rules', program, RULES_WRITES),
    { id: 'offer', kind: 'text@1', name: 'Offer', order: 'a1', at: { pos: [8, 12, 0] }, params: { text: { copy: 'items[rules.item]', args }, size: 13, box: { w: 200, h: 20 }, max_lines: 1 } },
  ], programAsset(program), {
    locale: 'en',
    data: { copy: { en: { items: { 1: 'Coins: {0}', 23: 'Gems: {0}' } }, de: { items: { 1: 'Münzen: {0}', 23: de23 } } } },
  });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: `labels`, a mark set of 30 text rows, three columns of ten, its text column looking `kinds` up by the
// `kind` column read from `units.kind`; and its references, the same rows with their names written out.

export const LABELS_SIZE: [number, number] = [600, 400];
export const NAMES = {
  en: ['Archer', 'Knight', 'Wizard', 'Healer', 'Thief', 'Scout', 'Guard', 'Smith', 'Miner', 'Baker'],
  fr: ['Arbalétrier', 'Chevalier', 'Sorcier', 'Guérisseur', 'Voleur', 'Éclaireur', 'Garde', 'Forgeron', 'Mineur', 'Boulanger'],
} as const;
const rowX = (i: number): number => 10 + 200 * Math.floor(i / 10);
const rowY = (i: number): number => 20 + 40 * (i % 10);
/** Row i's band in px (1 px a u): 200 × 40, the row's label in its middle, no other row's reaching it. */
export const rowBand = (i: number): Rect => [200 * Math.floor(i / 10), 40 * (i % 10), 200, 40];
const rows = Array.from({ length: LABELS }, (_, i) => i);
const positions = (): JsonObject => ({ x: dataColumn('f32', rows.map(rowX)), y: dataColumn('f32', rows.map(rowY)) });
/** Each row at its `x` and `y` in u and showing its `text` (Mark set and columns: `encode`, no scales). */
const ENCODE: JsonObject = { x: { column: 'x' }, y: { column: 'y' }, text: { column: 'text' } };
const kindsTable = (names: readonly string[]): JsonObject => Object.fromEntries(names.map((n, k) => [String(k), n]));
export function labelsDoc(program: Program): JsonObject {
  return film('labels', LABELS_SIZE, [
    logicItem('units', program, UNITS_WRITES),
    {
      id: 'labels', kind: 'marks@1', name: 'Labels', order: 'a1',
      params: { mark: 'text', encode: ENCODE, columns: { ...positions(), kind: { array: 'units.kind', as: 'i32' }, text: { copy: 'kinds', key: 'kind', args: [] } } },
    },
  ], programAsset(program), { locale: 'en', data: { copy: { en: { kinds: kindsTable(NAMES.en) }, fr: { kinds: kindsTable(NAMES.fr) } } } });
}
/** A reference: the same 30 rows with the strings written out (an empty string where a row shows nothing). */
export const labelsRef = (id: string, texts: string[]): JsonObject => film(id, LABELS_SIZE, [{
  id: 'labels', kind: 'marks@1', name: 'Labels', order: 'a1', params: { mark: 'text', n: LABELS, encode: ENCODE, columns: { ...positions(), text: strColumn(texts) } },
}], {});

// ---------------------------------------------------------------------------------------------------
// Criterion 6: `dialogue`, a group of 40 text children `l0` to `l39`, all at (8, 12), flipped by `story.line[0]` with the
// map 0 to 39 → l0 to l39; and its reference, the group with child 37 alone. Each line is a speaker and a phrase, no
// digit in it (a written-out number would need a source).

export const DIALOGUE_SIZE: [number, number] = [360, 40];
export const CHILDREN = 40;
const SPEAKERS = ['Ada', 'Bram', 'Cora', 'Dov', 'Esme'];
const PHRASES = ['Who goes there?', 'The bridge is out.', 'Take the left path.', 'We rest at dawn.', 'The gate is sealed.', 'Follow the river.', 'Mind the wolves.', 'The map was wrong.'];
const lineText = (i: number): string => `${SPEAKERS[Math.floor(i / PHRASES.length)]!}: ${PHRASES[i % PHRASES.length]!}`;
const child = (i: number): JsonObject => ({ id: `l${i}`, kind: 'text@1', name: `Line ${i}`, parent: 'dialogue', order: `b${String(i).padStart(2, '0')}`, at: { pos: [8, 12, 0] }, params: { text: lineText(i), size: 13 } });
export const FLIP: JsonObject = { array: 'story.line[0]', map: Object.fromEntries(Array.from({ length: CHILDREN }, (_, i) => [String(i), `l${i}`])) };
export function dialogueDoc(program: Program): JsonObject {
  return film('dialogue', DIALOGUE_SIZE, [
    logicItem('story', program, STORY_WRITES),
    { id: 'dialogue', kind: 'group@1', name: 'Dialogue', order: 'a1', params: { flip: FLIP } },
    ...Array.from({ length: CHILDREN }, (_, i) => child(i)),
  ], programAsset(program));
}
export const dialogueRef = (i: number): JsonObject => film(`dialogue-ref-${i}`, DIALOGUE_SIZE, [
  { id: 'dialogue', kind: 'group@1', name: 'Dialogue', order: 'a1', params: {} }, child(i),
], {});

// ---------------------------------------------------------------------------------------------------
// Criterion 8: the budgets' 2D documents.

/** `heap` writing 1 MiB a step, nothing reading it, over 0.5 s (30 steps). */
export const heapDoc = (program: Program): JsonObject =>
  film('heap', [64, 64], [logicItem('heap', program, HEAP_WRITES)], programAsset(program), { transport: { span: '0.5s', frame_rate: [60, 1] } });
/** `layer`: 96 × 96 atlas cells of 6 u from `map.cells` as u16 (#535's form), on an atlas of eight solid 4 × 4 px cells. */
export const LAYER_SIZE: [number, number] = [LAYER_COLS * 6 + 6, LAYER_COLS * 6 + 6];
const EIGHT: Rgb[] = [[230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230]];
export const layerAtlas = (): Buffer => encodeRgbaPng(32, 4, (x) => [...EIGHT[Math.floor(x / 4)]!, 255] as [number, number, number, number]);
export function layerDoc(program: Program, atlas: string): JsonObject {
  return film('layer', LAYER_SIZE, [
    logicItem('map', program, LAYER_WRITES),
    {
      id: 'layer', kind: 'marks@1', name: 'Layer', order: 'a1', at: { pos: [3, 3, 0] },
      params: {
        mark: 'image', atlas: { asset: atlas, cell: [4, 4], padding: 1 }, grid: { shape: 'square', cell: [6, 6], size: [LAYER_COLS, LAYER_COLS] },
        columns: { tile: { array: 'map.cells', as: 'u16' } },
      },
    },
  ], { ...programAsset(program), layer_atlas: atlas });
}
/** `ware`, a text item over `goods`: `keys` keys in English, French and German, each with its argument at '999', each
 * string its own (the key spelled in letters, so no string writes a digit out). */
export const FIT_KEYS = 5_000;
export const FIT_LOCALES = ['en', 'fr', 'de'] as const;
const letters = (k: number): string => (k < 26 ? '' : letters(Math.floor(k / 26) - 1)) + String.fromCharCode(97 + (k % 26));
export function fitDoc(program: Program, keys = FIT_KEYS): JsonObject {
  const words = { en: 'Crate', fr: 'Caisse', de: 'Kiste' } as const;
  const table = (locale: (typeof FIT_LOCALES)[number]): JsonObject => Object.fromEntries(Array.from({ length: keys }, (_, k) => [String(k), `${words[locale]} ${letters(k)}: {0}`]));
  return film('goods', [320, 40], [
    logicItem('rules', program, RULES_WRITES),
    { id: 'ware', kind: 'text@1', name: 'Ware', order: 'a1', at: { pos: [8, 12, 0] }, params: { text: { copy: 'goods[rules.item]', args: [{ path: 'rules.count', widest: '999' }] }, size: 13 } },
  ], programAsset(program), { locale: 'en', data: { copy: Object.fromEntries(FIT_LOCALES.map((l) => [l, { goods: table(l) }])) } });
}
/** A still document with no logic columns: a text, a mark set of 30 labels from data columns and a group of two rects;
 * and the bare one, a rect alone. */
export function stillDoc(bare: boolean): JsonObject {
  const rect = (id: string, box: number[], parent?: string): JsonObject => ({ id, kind: 'rect@1', name: id, order: `c${id}`, ...(parent ? { parent } : {}), params: { box, paint: { fill: { role: 'accent' } } } });
  if (bare) return film('bare', LABELS_SIZE, [rect('one', [10, 10, 40, 20])], {});
  return film('still', LABELS_SIZE, [
    { id: 'title', kind: 'text@1', name: 'Title', order: 'a1', at: { pos: [8, 12, 0] }, params: { text: 'A board with no logic', size: 13 } },
    { id: 'labels', kind: 'marks@1', name: 'Labels', order: 'a2', params: { mark: 'text', n: LABELS, encode: ENCODE, columns: { ...positions(), text: strColumn(rows.map((i) => NAMES.en[i % 10]!)) } } },
    { id: 'pair', kind: 'group@1', name: 'Pair', order: 'a3', params: {} },
    rect('left', [420, 300, 40, 20], 'pair'), rect('right', [480, 300, 40, 20], 'pair'),
  ], {});
}
