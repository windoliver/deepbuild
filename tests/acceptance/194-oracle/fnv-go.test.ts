// Criterion 1 (#194.a290ef32), Oracle lane: Go's TestGolden32a, ported. Upstream: golang/go at commit
// 022c8636110ebac86a9b88724cda168ed713c21f, src/hash/fnv/fnv_test.go lines 56-61 (golden32a) and 95-97
// (TestGolden32a: New32a against golden32a). Copyright 2011 The Go Authors; BSD-style license (the file's LICENSE).
// Ported here: the four golden32a pairs, FNV-1a 32 of "", "a", "ab" and "abc" (big-endian bytes as written upstream).
//
// table.layout@1 names each ID, column and table by its FNV-1a 32 hash (Asset: tables: catalogs). Run on our output:
// `deep-catalog pack` of a catalog of three tables named a, ab and abc, each with its ID column `a`, the columns `ab`
// (i32) and `abc` (f64), and the rows whose IDs are a, ab and abc (the name "" can't be an ID, a column or a table, so
// its vector checks only this suite's own hash, a precondition, since helpers.ts uses it for every other expected value). In the packed
// bytes the directory's table name hashes, every table's column name hashes and every ID column's values are exactly the
// golden hashes, in rising order, and the record names the same hashes; the row found by the golden hash of "ab" holds
// the values written for ab.
// The wrong programs: a probe hashing by FNV-1 (Go's golden32: 050c5d7e for "a"), hashing with another offset basis or
// prime, hashing the text in another encoding, or ordering by signed hashes.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, blocked, fnv32a, judgeLayout, layoutOf, none, packAll, packCall, prebuildCatalog, rowValues, scratch } from '../194/helpers.ts';
import type { Schema, Tables } from '../194/fixtures.ts';

prebuildCatalog();

/** golden32a, as upstream writes it: each output's four bytes (big-endian) and its input. */
const GOLDEN32A: [number[], string][] = [
  [[0x81, 0x1c, 0x9d, 0xc5], ''],
  [[0xe4, 0x0c, 0x29, 0x2c], 'a'],
  [[0x4d, 0x25, 0x05, 0xca], 'ab'],
  [[0x1a, 0x47, 0xe9, 0x0b], 'abc'],
];
const u32 = (b: number[]): number => Buffer.from(b).readUInt32BE(0);
const NAMES = ['a', 'ab', 'abc'];
const golden = (s: string): number => u32(GOLDEN32A.find(([, i]) => i === s)![0]);

describe(`${AC[1]} FNV-1a 32 names IDs, columns and tables (Go's TestGolden32a)`, () => {
  it(`${AC[1]} the packed directory, columns and ID columns hold Go's golden32a hashes for a, ab and abc, in rising order`, () => {
    for (const [out, input] of GOLDEN32A) if (fnv32a(input) !== u32(out)) blocked(`this suite's own FNV-1a 32 of ${JSON.stringify(input)} isn't Go's golden ${Buffer.from(out).toString('hex')}`);
    const schema: Schema = Object.fromEntries(NAMES.map((n) => [n, { id: 'a', columns: { ab: { type: 'i32' }, abc: { type: 'f64' } } }]));
    const tables: Tables = Object.fromEntries(NAMES.map((n, t) => [n, {
      columns: ['a', 'ab', 'abc'], rows: NAMES.map((id, k) => ({ a: id, ab: 10 * t + k, abc: t + k / 4 })),
    }]));
    const [p] = packAll([packCall(scratch('fnv'), tables, schema)], 'the a, ab, abc catalog');
    const rising = NAMES.map(golden).sort((x, y) => x - y);
    const l = layoutOf(p!.bytes, 'the a, ab, abc catalog');
    expect(l.tables.map((t) => t.hash), 'the directory\'s table name hashes are the golden hashes, rising').toEqual(rising);
    for (const t of l.tables) {
      expect(t.columns.map((c) => c.hash), 'each table\'s column name hashes are the golden hashes, rising').toEqual(rising);
      const id = t.columns.find((c) => c.hash === golden('a'))!;
      expect(Array.from({ length: t.rows }, (_, r) => p!.bytes.readUInt32LE(id.at + 4 * r)), 'its ID column holds the rows\' golden hashes, rising').toEqual(rising);
    }
    expect((p!.record['tables'] as { hash: number }[]).map((t) => t.hash), 'the record names the tables by the golden hashes').toEqual(rising);
    expect(rowValues(p!.bytes, l, 'ab', schema, 'ab'), 'the row of table ab found by the golden hash of ab holds what was written for it').toEqual({ ab: 11, abc: 1.25 });
    none(judgeLayout(p!.bytes, p!.record, tables, schema), 'the packed bytes against the layout');
  }, TIMEOUT);
});
