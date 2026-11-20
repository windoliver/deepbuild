// A catalog read in its one documented layout, table.layout@1 (canvas primitives: Asset: tables: catalogs
// `table.layout@1`; the layout's doc is deep-canvas-sandbox's layouts), never an agent's summary of it. Its bytes and
// the probe's record come by their hash: the bytes' SHA-256 must be the asset ID the input names and the record's own
// `sha256`, and the record must name the directory the bytes hold, table by table and column by column, by FNV-1a
// hash, with each table's ID column holding its IDs' hashes in rising order, as the probe packs them; else the
// catalog is refused, naming the first table that breaks it.
import { createHash } from 'node:crypto';

/** A column's type, as the probe's record names it. */
export type Ty = 'i32' | 'f64' | 'bool' | 'ref' | 'refs' | 'copy';
const TYPES: Ty[] = ['i32', 'f64', 'bool', 'ref', 'refs', 'copy'];
/** A `ref` to an ID no row holds, and an empty `ref`. */
export const NONE = 0xffff_ffff;

/** The record the decode worker writes beside a catalog's bytes (deep-catalog's `pack`). */
export interface Record_ {
  layout: 'table.layout@1';
  sha256: string;
  tables: { name: string; hash: number; id: string; rows: number; ids: string[]; columns: { name: string; hash: number; type: Ty; at: number; target?: string; copy?: string; unit?: unknown; range?: [number, number] | null; id?: boolean }[] }[];
  missing: { table: string; id: string; column: string; ref: string }[];
}
/** A packed catalog as a check's spec carries it: the bytes in base64 and the record, by the bytes' hash. */
export interface Packed { bytes: string; record: Record_ }

/** One column, its values read from the bytes: refs as [offset, count] pairs into the pool. */
export interface Column { name: string; type: Ty; target: string | null; copy: string | null; range: [number, number] | null; values: Int32Array | Float64Array | Uint8Array | Uint32Array }
export interface Table { name: string; idColumn: string; ids: string[]; index: Map<string, number>; columns: Map<string, Column> }
export interface Catalog { sha256: string; tables: Map<string, Table>; pool: Uint32Array; missing: Record_['missing'] }

/** 32-bit FNV-1a over a text's UTF-8 bytes. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text, 'utf8')) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}

const WIDTH: Record<Ty, number> = { i32: 4, f64: 8, bool: 1, ref: 4, refs: 8, copy: 4 };

/** The catalog `asset` names, from what the spec carries, or the reason it can't be read as table.layout@1. */
export function open(asset: string, carried: Record<string, Packed> | undefined): Catalog | string {
  const packed = carried?.[asset];
  if (!packed) return `the catalog ${asset} isn't carried in the spec's catalogs`;
  const b = Buffer.from(packed.bytes, 'base64');
  const sha = createHash('sha256').update(b).digest('hex');
  if (sha !== asset) return `the catalog's bytes hash to ${sha}, not ${asset}`;
  const r = packed.record;
  if (r?.layout !== 'table.layout@1' || r.sha256 !== asset) return `the catalog's record isn't the probe's record of ${asset}`;
  const u32 = (at: number): number | null => (at + 4 <= b.length ? b.readUInt32LE(at) : null);
  if (b.toString('latin1', 0, 4) !== 'TBLE' || u32(4) !== 1) return 'the catalog isn\'t table.layout@1: its header isn\'t TBLE version 1';
  const count = u32(8) ?? 0;
  const poolAt = u32(12) ?? 0;
  const poolCount = u32(16) ?? 0;
  if (count !== r.tables.length) return `the catalog holds ${count} tables and its record ${r.tables.length}`;
  if (poolAt + 4 * poolCount > b.length) return 'the catalog\'s pool passes its end';
  const pool = new Uint32Array(poolCount);
  for (let i = 0; i < poolCount; i++) pool[i] = b.readUInt32LE(poolAt + 4 * i);
  const tables = new Map<string, Table>();
  let p = 20;
  const names = r.tables.map((t) => t.name);
  for (const t of r.tables) {
    const bad = (why: string): string => `the catalog isn't table.layout@1 at table ${t.name}: ${why}`;
    if (u32(p) !== fnv1a(t.name) || u32(p + 4) !== t.rows || t.ids.length !== t.rows) return bad('its directory entry differs from its record');
    const cc = u32(p + 8) ?? 0;
    if (cc !== t.columns.length) return bad('its column count differs from its record');
    p += 12;
    const columns = new Map<string, Column>();
    for (const c of t.columns) {
      const [h, ty, at, target] = [u32(p), u32(p + 4), u32(p + 8), u32(p + 12)];
      p += 16;
      if (h !== fnv1a(c.name) || ty === null || TYPES[ty] !== c.type || at !== c.at || target === null) return bad(`column ${c.name}'s entry differs from its record`);
      const w = WIDTH[c.type];
      if (at + w * t.rows > b.length) return bad(`column ${c.name}'s values pass the catalog's end`);
      const slice = b.subarray(at, at + w * t.rows);
      const values = c.type === 'f64' ? new Float64Array(t.rows) : c.type === 'bool' ? new Uint8Array(t.rows) : c.type === 'refs' ? new Uint32Array(2 * t.rows) : c.type === 'ref' ? new Uint32Array(t.rows) : new Int32Array(t.rows);
      for (let k = 0; k < values.length; k++) {
        if (values instanceof Float64Array) values[k] = slice.readDoubleLE(8 * k);
        else if (values instanceof Uint8Array) values[k] = slice[k]!;
        else if (values instanceof Uint32Array) values[k] = slice.readUInt32LE(4 * k);
        else values[k] = slice.readInt32LE(4 * k);
      }
      const targetName = c.type === 'ref' || c.type === 'refs' ? names[target] ?? null : null;
      if ((c.type === 'ref' || c.type === 'refs') && targetName !== c.target) return bad(`column ${c.name}'s target differs from its record`);
      columns.set(c.name, { name: c.name, type: c.type, target: targetName, copy: c.copy ?? null, range: Array.isArray(c.range) ? c.range : null, values });
    }
    const idCol = columns.get(t.id);
    if (!idCol || idCol.type !== 'i32') return bad(`it has no i32 ID column ${t.id}`);
    for (let k = 0; k < t.rows; k++) {
      if ((idCol.values[k]! >>> 0) !== fnv1a(t.ids[k]!)) return bad(`row ${k}'s ID hash isn't that of ${t.ids[k]}`);
      if (k > 0 && (idCol.values[k]! >>> 0) <= (idCol.values[k - 1]! >>> 0)) return bad(`its rows aren't sorted by the u32 hash of their ID (row ${t.ids[k]})`);
    }
    tables.set(t.name, { name: t.name, idColumn: t.id, ids: t.ids, index: new Map(t.ids.map((id, k) => [id, k])), columns });
  }
  return { sha256: asset, tables, pool, missing: r.missing ?? [] };
}

/** The rows a ref or refs column's cell at `row` names, each its row index in the target table (NONE for missing). */
export function refsAt(cat: Catalog, c: Column, row: number): number[] {
  if (c.type === 'ref') {
    const v = c.values[row]!;
    return v === NONE ? [] : [v];
  }
  if (c.type !== 'refs') return [];
  const [off, n] = [c.values[2 * row]!, c.values[2 * row + 1]!];
  return Array.from(cat.pool.subarray(off, off + n));
}

/** Like refsAt, with each missing ID kept as NONE, so a list keeps its length and order. */
export function refsWithMissing(cat: Catalog, c: Column, row: number): number[] {
  if (c.type === 'ref') return [c.values[row]!];
  if (c.type !== 'refs') return [];
  const [off, n] = [c.values[2 * row]!, c.values[2 * row + 1]!];
  return Array.from(cat.pool.subarray(off, off + n));
}
