import { refusal } from './zip.mjs';

export const TABLE_MAX = 16 * 1024 * 1024;
const DTYPES = new Set(['i64', 'f64', 'str']);
const INTEGER = /^[+-]?\d+$/;
const FLOAT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const I64 = [-(2n ** 63n), 2n ** 63n - 1n];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const csvCell = (t) => (/[",\n\r]/.test(t) || t.startsWith('"') ? `"${t.replace(/"/g, '""')}"` : t);

export function parse(text, dtype, group) {
  if (dtype === 'str') return text;
  let t = text;
  if (group) {
    const g = escapeRe(group);
    if (new RegExp(`^[+-]?\\d{1,3}(?:${g}\\d{3})+(?:\\.\\d+)?$`).test(t)) t = t.split(group).join('');
  }
  if (dtype === 'i64') {
    if (!INTEGER.test(t)) return undefined;
    const n = BigInt(t);
    return n < I64[0] || n > I64[1] ? undefined : n.toString();
  }
  if (!FLOAT.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return Object.is(n, -0) ? '0' : String(n);
}

export class Cut {
  constructor(p) {
    this.p = p;
    this.header = p.header ?? 1;
    if (!Number.isSafeInteger(this.header) || this.header < 1) throw refusal('params', `header names a row from 1, not ${JSON.stringify(p.header)}`);
    const names = Object.keys(p.columns ?? {});
    if (!names.length) throw refusal('params', 'columns names at least one column to keep');
    for (const name of names) {
      const c = p.columns[name];
      if (!DTYPES.has(c.dtype)) throw refusal('params', `the column ${name}'s dtype is i64, f64 or str, not ${JSON.stringify(c.dtype)}`, { column: name });
    }
    if (p.key !== undefined && !names.includes(p.key)) throw refusal('params', `the key ${JSON.stringify(p.key)} is none of the columns kept`, { column: p.key });
    this.names = names;
    this.where = (p.where ?? []).map((w) => ({ ...w, in: w.in === undefined ? undefined : new Set(w.in.map(String)) }));
    for (const w of this.where) if (!names.includes(w.column)) throw refusal('params', `where names the column ${JSON.stringify(w.column)}, which isn't kept`, { column: w.column });
    this.rowsRead = 0;
    this.kept = [];
    this.size = 0;
    this.keys = new Map();
    this.missing = Object.fromEntries(names.map((n) => [n, 0]));
    this.formulas = 0;
    this.at = undefined;
  }
  place(n, count, text) {
    const header = [];
    for (let i = 0; i < count; i += 1) header.push(text(i));
    const at = {};
    for (const name of this.names) {
      const { from = name, index } = this.p.columns[name];
      if (index !== undefined) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw refusal('column_missing', `the column ${name} comes from index ${index}, and the header row ${n} has ${count} cells`, { column: name, row: n });
        at[name] = index;
        continue;
      }
      const found = header.flatMap((h, i) => (h === from ? [i] : []));
      if (found.length !== 1) throw refusal('column_missing', `the column ${name} comes from the header ${JSON.stringify(from)}, which the header row ${n} holds ${found.length ? `${found.length} times` : 'nowhere'}`, { column: name, row: n });
      at[name] = found[0];
    }
    this.order = [...this.names].sort((a, b) => at[a] - at[b] || (a < b ? -1 : a > b ? 1 : 0));
    this.at = at;
    this.count = count;
    this.write(this.order.map(csvCell));
  }
  write(cells) {
    const line = `${cells.join(',')}\n`;
    this.size += Buffer.byteLength(line);
    if (this.size <= TABLE_MAX) this.kept.push(line);
  }
  shape(n, count) {
    if (this.p.format === 'csv' && count !== this.count) throw refusal('row_shape', `row ${n} has ${count} cells where the header row has ${this.count}`, { row: n });
  }
  row(n, count, text, formula) {
    if (n < this.header) return;
    if (n === this.header) return this.place(n, count, text);
    if (!this.at) throw refusal('header_missing', `the file has no header row ${this.header}`, { row: this.header });
    this.data(n, count, text, formula);
  }
  data(n, count, text, formula) {
    this.shape(n, count);
    this.rowsRead += 1;
    const cell = (name) => (this.at[name] < count ? text(this.at[name]) : null);
    for (const w of this.where) {
      const t = cell(w.column);
      if (t === null) return;
      if (w.in ? !w.in.has(t) : !t.startsWith(w.prefix)) return;
    }
    const out = {};
    for (const name of this.order) {
      const c = this.p.columns[name];
      const t = cell(name);
      if (formula?.(n, this.at[name])) this.formulas += 1;
      if (t === null || (c.missing ?? []).includes(t)) {
        this.missing[name] += 1;
        out[name] = this.p.plant === 'reads_marker_as_zero' && t !== null ? '0' : '';
        continue;
      }
      const v = parse(t, c.dtype, c.group);
      if (v === undefined) throw refusal('cell_unparsed', `row ${n}'s cell in the column ${name}, ${JSON.stringify(t)}, doesn't parse as ${c.dtype}${c.missing?.length ? ' and is none of its missing markers' : ''}`, { row: n, column: name, cell: t });
      out[name] = v;
    }
    if (this.p.key !== undefined) {
      const k = out[this.p.key];
      if (cell(this.p.key) === null || (this.p.columns[this.p.key].missing ?? []).includes(cell(this.p.key))) throw refusal('key_missing', `row ${n} has no value in the key column ${this.p.key}`, { row: n, column: this.p.key });
      const before = this.keys.get(k);
      if (before !== undefined) throw refusal('key_not_unique', `the key ${this.p.key} holds ${JSON.stringify(k)} in rows ${before} and ${n}`, { column: this.p.key, value: k, rows: [before, n] });
      this.keys.set(k, n);
    }
    this.write(this.order.map((name) => csvCell(out[name])));
  }
  done(member) {
    if (!this.at) throw refusal('header_missing', `the file has no header row ${this.header}`, { row: this.header });
    if (this.size > TABLE_MAX) throw refusal('table_too_big', `the cut is ${this.size} bytes, past a table's ${TABLE_MAX}-byte cap`, { bytes: this.size, cap: TABLE_MAX });
    const receipt = {
      rows_read: this.rowsRead,
      rows_kept: this.kept.length - 1,
      columns_kept: this.order.length,
      missing: Object.fromEntries(this.order.map((n) => [n, this.missing[n]])),
      formula_cells: this.formulas,
      member: member ?? null,
    };
    return { table: Buffer.from(this.kept.join('')), receipt };
  }
}
