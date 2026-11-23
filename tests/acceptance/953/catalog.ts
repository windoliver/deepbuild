// The one catalog every piece of this suite reads (README: The catalog): a table.layout@1 asset packed here from the
// layout's doc (crates/deep-canvas-sandbox/src/layouts.rs, TABLE_DOC) and the design's As built (#194) rules, one table
// of i32 columns. Rows are content: kinds of things (an archer, a hero), never the nodes themselves; a node names its
// row when it is attached. Laid out as crates/deep-catalog/src/lib.rs's `pack` lays out one table of i32 columns (read
// at the base, not run against it: README: Checked before the base run).

/** FNV-1a, 32 bits, over UTF-8 bytes: how a catalog hashes IDs and names (Asset: tables: catalogs). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const TABLE = 'pieces';
export const ID_COLUMN = 'id';
/** The table's i32 columns besides its ID: four a stat's base can name, and three a filter reads. */
export const COLUMNS = ['kind', 'level', 'player', 'attack', 'defense', 'morale', 'speed'] as const;
export type Column = (typeof COLUMNS)[number];
/** A column name no table holds: a filter on it never holds, and a stat whose base names it has base 0. */
export const ABSENT = 'rarity';

export const KIND = { archer: 1, swordsman: 2, pikeman: 3, angel: 4, devil: 5, item: 7, hero: 9, side: 20 } as const;

export interface CatalogRow { id: string; cells: Partial<Record<Column, number>> }

/** The named rows the scenarios use (criteria 2 to 5 and the Oracle lane). */
const NAMED: CatalogRow[] = [
  { id: 'side_red', cells: { kind: KIND.side, player: 0 } },
  { id: 'side_blue', cells: { kind: KIND.side, player: 1 } },
  { id: 'hero', cells: { kind: KIND.hero, level: 5, attack: 5, defense: 5, morale: 1, speed: 6 } },
  { id: 'archer', cells: { kind: KIND.archer, level: 2, attack: 10, defense: 3, speed: 4 } },
  { id: 'swordsman', cells: { kind: KIND.swordsman, level: 3, attack: 12, defense: 8, speed: 3 } },
  { id: 'pikeman', cells: { kind: KIND.pikeman, level: 1, attack: 8, defense: 6, speed: 3 } },
  { id: 'item', cells: { kind: KIND.item, level: 1 } },
  // The Oracle lane's nodes (953-oracle): each node's owner as the `player` column, every stat's base 0.
  { id: 'player_red', cells: { kind: KIND.side, player: 0 } },
  { id: 'player_blue', cells: { kind: KIND.side, player: 1 } },
  { id: 'hero_red', cells: { kind: KIND.hero, player: 0 } },
  { id: 'hero_blue', cells: { kind: KIND.hero, player: 1 } },
  { id: 'pike_red', cells: { kind: KIND.pikeman, player: 0 } },
  { id: 'pike_blue', cells: { kind: KIND.pikeman, player: 1 } },
  { id: 'angel', cells: { kind: KIND.angel, player: 0 } },
  { id: 'devil', cells: { kind: KIND.devil, player: 0 } },
  { id: 'orb', cells: { kind: KIND.item, player: 0 } },
];

/** The kinds seeded trees draw from (model.ts): `k00` to `k23`, their cells fixed by their index. */
export const KINDS = 24;
export const kindRow = (i: number): string => `k${String(i).padStart(2, '0')}`;
function kindCells(i: number): Partial<Record<Column, number>> {
  // A fixed spread, no generator: every value a filter or a base can meet.
  return {
    kind: 1 + (i % 6), level: 1 + ((i * 7) % 9), player: i % 3,
    attack: (i * 13) % 51, defense: (i * 29 + 7) % 51, morale: ((i * 5) % 16) - 5, speed: (i * 11 + 3) % 21,
  };
}
export const ROWS: CatalogRow[] = [...NAMED, ...Array.from({ length: KINDS }, (_, i) => ({ id: kindRow(i), cells: kindCells(i) }))];

/** A row name no catalog row holds: a node attached with it has no row (base 0, every filter fails). */
export const NO_ROW = 'nobody';

/** Each row's cells by ID, and the row's own value of a column (0 for an empty cell, as #194 packs one). */
const byId = new Map(ROWS.map((r) => [r.id, r]));
export function cell(id: string | null, column: string): number | null {
  if (id === null) return null;
  const row = byId.get(id);
  if (!row) return null;
  if (!(COLUMNS as readonly string[]).includes(column)) return null;
  return row.cells[column as Column] ?? 0;
}
/** A row's every column with its value (0 for an empty cell), or null for an ID no row holds. */
const cellsById = new Map(ROWS.map((r) => [r.id, Object.fromEntries(COLUMNS.map((c) => [c, r.cells[c] ?? 0])) as Record<string, number>]));
export const cellsOf = (id: string | null): Record<string, number> | null => (id === null ? null : cellsById.get(id) ?? null);

/**
 * The catalog's bytes (table.layout@1): header `TBLE`, version 1, one table, pool_at (the end of the values: no `refs`)
 * and pool_count 0; the table's directory (name hash, rows, columns) and each column's (name hash, type 0 for i32, at,
 * target 0), columns in order of their name hashes, the ID column an i32 column of its own name holding each row's ID
 * hash; then each column's values in directory order, rows sorted by their ID hash, unsigned.
 */
export function catalogBytes(): Buffer {
  const names = [ID_COLUMN, ...COLUMNS];
  const hashes = new Map(names.map((n) => [n, fnv1a(n)]));
  if (new Set(hashes.values()).size !== names.length) throw Error('BLOCKED: two column names of the fixture catalog share an FNV-1a hash');
  const rows = [...ROWS].sort((a, b) => fnv1a(a.id) - fnv1a(b.id));
  if (new Set(rows.map((r) => fnv1a(r.id))).size !== rows.length || rows.some((r) => fnv1a(r.id) === fnv1a(NO_ROW))) {
    throw Error('BLOCKED: two row IDs of the fixture catalog share an FNV-1a hash');
  }
  const cols = [...names].sort((a, b) => hashes.get(a)! - hashes.get(b)!);
  const directory = 20 + 12 + 16 * cols.length;
  const end = directory + 4 * rows.length * cols.length;
  const b = Buffer.alloc(end);
  b.write('TBLE', 0, 'latin1');
  b.writeUInt32LE(1, 4);
  b.writeUInt32LE(1, 8);
  b.writeUInt32LE(end, 12);
  b.writeUInt32LE(0, 16);
  b.writeUInt32LE(fnv1a(TABLE), 20);
  b.writeUInt32LE(rows.length, 24);
  b.writeUInt32LE(cols.length, 28);
  cols.forEach((c, j) => {
    const at = directory + 4 * rows.length * j;
    b.writeUInt32LE(hashes.get(c)!, 32 + 16 * j);
    b.writeUInt32LE(0, 36 + 16 * j);
    b.writeUInt32LE(at, 40 + 16 * j);
    b.writeUInt32LE(0, 44 + 16 * j);
    rows.forEach((r, k) => {
      if (c === ID_COLUMN) b.writeUInt32LE(fnv1a(r.id), at + 4 * k);
      else b.writeInt32LE(r.cells[c as Column] ?? 0, at + 4 * k);
    });
  });
  return b;
}
