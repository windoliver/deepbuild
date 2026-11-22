// Criteria 1 (#194.a290ef32) and 9 (#194.04da1020), Oracle lane: csv-spectrum's CSV files and the JSON records each
// must parse to, run on our code. Upstream: max-mapper/csv-spectrum at commit b251546d5ccb79217a61aa8ca623ce573977d7e1,
// `csvs/*.csv` and `json/*.json`, copied byte for byte into fixtures/csv-spectrum/ (commas and newlines inside quotes,
// escaped quotes, CRLF line ends, empty quoted cells, UTF-8, a last line with no line end).
//
// The catalog's CSV reading is read back through the probe, the only place it shows (the catalog holds no text column):
// each file is one table `spectrum` whose ID column is the file's first column with plain, distinct, non-empty values
// in its JSON records, and whose every other column is typed `ref spectrum`. A cell's text then comes back two ways: an
// ID as its FNV-1a 32 hash in the packed ID column, and a ref to an ID no row holds as the record's `missing` entry
// `{table, id, column, ref}`, `ref` the cell's text as written (Asset: tables: catalogs, As built; a text cell keeps its
// raw bytes, Asset: tables). So `deep-catalog pack` of each CSV file must give, for each JSON record: its ID's hash in
// the ID column (rows in hash order); for each other non-empty value, a `missing` entry with exactly that text, or the
// row it names when an ID holds it; for an empty one, no entry and 0xFFFFFFFF (helpers.ts `judgeLayout`, the records as
// its rows). Criterion 9's half: the same records written as JSON lines (an empty value as null) pack to the CSV's
// bytes, so both routes reach the probe with the same rows.
// The wrong programs: a CSV reader that splits a quoted comma or newline, keeps the quotes or a doubled quote, drops or
// converts a CR inside quotes, trims a cell, mis-reads UTF-8, drops a last line with no line end, or reads a quoted empty
// cell as a value; a JSON lines reader that reads its rows otherwise than the CSV reader.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, blocked, judgeLayout, none, packAll, prebuildCatalog, scratch, type PackCall } from '../194/helpers.ts';
import type { Row, Schema, Tables } from '../194/fixtures.ts';

prebuildCatalog();

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'csv-spectrum');
const FILES = readdirSync(join(DIR, 'csvs')).filter((f) => f.endsWith('.csv')).map((f) => basename(f, '.csv')).sort();
const TABLE = 'spectrum';

interface Case { name: string; csv: string; records: Record<string, string>[]; header: string[]; id: string; schema: Schema; tables: Tables }
function caseOf(name: string): Case {
  const csv = join(DIR, 'csvs', `${name}.csv`);
  const text = readFileSync(csv, 'latin1');
  if (name.endsWith('_crlf') && !text.includes('\r\n')) blocked(`fixtures/csv-spectrum/csvs/${name}.csv lost its CRLF line ends (the checkout normalized them)`);
  const records = JSON.parse(readFileSync(join(DIR, 'json', `${name}.json`), 'utf8')) as Record<string, string>[];
  const header = Object.keys(records[0] ?? {});
  const id = header.find((h) => {
    const v = records.map((r) => r[h]!);
    return v.every((x) => /^[\w.-]+$/.test(x)) && new Set(v).size === v.length;
  }) ?? blocked(`${name}.json has no column of plain, distinct, non-empty values to be the ID column`);
  const schema: Schema = { [TABLE]: { id, columns: Object.fromEntries(header.filter((h) => h !== id).map((h) => [h, { type: `ref ${TABLE}` }])) } };
  const rows: Row[] = records.map((r) => Object.fromEntries(header.map((h) => [h, r[h] === '' ? null : r[h]!])));
  return { name, csv, records, header, id, schema, tables: { [TABLE]: { columns: header, rows } } };
}

if (FILES.length !== 11) blocked(`fixtures/csv-spectrum/csvs holds ${FILES.length} files, not the eleven upstream pins`);

describe(`${AC[1]} csv-spectrum's CSV files read to their JSON records through the catalog's CSV reading`, () => {
  for (const name of FILES) {
    it(`${AC[1]} csv-spectrum ${name}.csv packs to the cells of ${name}.json`, () => {
      const c = caseOf(name);
      const [p] = packAll([{ op: 'pack', tables: { [TABLE]: { path: c.csv } }, schema: c.schema, out: join(scratch('spectrum'), 'csv.bin') }], `${name}.csv`);
      none(judgeLayout(p!.bytes, p!.record, c.tables, c.schema), `${name}.csv's cells against ${name}.json's records`);
    }, TIMEOUT);
  }
});

describe(`${AC[9]} csv-spectrum's records as JSON lines pack to the CSV files' bytes`, () => {
  for (const name of FILES) {
    it(`${AC[9]} csv-spectrum ${name}'s JSON records as JSON lines pack to ${name}.csv's bytes`, () => {
      const c = caseOf(name);
      const dir = scratch('spectrum');
      const jsonl = join(dir, `${TABLE}.jsonl`);
      writeFileSync(jsonl, `${c.tables[TABLE]!.rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
      const calls: PackCall[] = [
        { op: 'pack', tables: { [TABLE]: { path: c.csv } }, schema: c.schema, out: join(dir, 'csv.bin') },
        { op: 'pack', tables: { [TABLE]: { path: jsonl } }, schema: c.schema, out: join(dir, 'jsonl.bin') },
      ];
      const [fromCsv, fromJsonl] = packAll(calls, `${name} as CSV and as JSON lines`);
      expect(fromJsonl!.sha256, `${name}: the JSON lines route packs the CSV route's bytes`).toBe(fromCsv!.sha256);
      none(judgeLayout(fromJsonl!.bytes, fromJsonl!.record, c.tables, c.schema), `${name}'s JSON lines against its records`);
    }, TIMEOUT);
  }
});
