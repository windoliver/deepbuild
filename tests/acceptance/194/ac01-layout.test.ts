// AC1 #194.a290ef32: "A fixture catalog of 40 items, 15 recipes and 4 creatures as three CSV tables with a schema, one
// item inheriting from another, packs into table.layout@1; a logic item that names it reads item cudgel's weight, 1.8 in
// the CSV, by its column name's hash and its ID's hash; a planted packer that writes rows one after another instead of
// columns fails that read, naming the column; the inheriting item's packed row equals the same row written out in full;
// and the packed bytes are the same on macOS arm64 and Linux x86_64"
//
// The fixture (fixtures.ts `catalog`, `SCHEMA`) written as three CSV files and packed by `deep-catalog pack`:
// - its bytes and record meet this suite's judge of the layout's doc and the As built rules (helpers.ts `judgeLayout`),
//   and deep-show's `validate` admits them under table.layout@1;
// - in deep-show, a film whose logic item `reader` names the catalog in `assets` (the document listing it as a catalog
//   asset) and whose program finds items, weight and cudgel by their FNV-1a hashes (programs.ts `f64Reader`) writes 1.8;
//   the same document over the bytes of the planted packer `catalog_rows_not_columns` (its directory the clean one's,
//   byte for byte) fails this suite's judge of that read, naming items.weight;
// - spiked_cudgel, whose base is cudgel and whose weight, stack and damage cells are empty, packs to the row the same
//   catalog gives it written out in full (cudgel's 1.8, false and 6 in those cells, no base);
// - the same files packed by the probe built for linux/amd64 in Docker give the same bytes (BLOCKED without Docker or
//   the amd64 image).
// The wrong programs: the base (no deep-catalog), a packer that lays rows out one after another, one that keys rows by
// file position or doesn't sort by ID hash, one that leaves inheritance unresolved, and one whose bytes differ by host.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { binOf, prebuild, presented, putEvidence, runShow, scenario, show as show538, showCall } from '../538/helpers.ts';
import {
  AC, DOC, TIMEOUT, canon, catalogBin, failsNaming, inconclusive, judgeLayout, layoutOf, none, packAll, packCall, packOnLinux, packedOf, prebuildCatalog, rowValues, scratch, show,
  type Obj, type Packed,
} from './helpers.ts';
import { CREATURE_COUNT, CUDGEL, INHERITS, ITEM_COUNT, RECIPE_COUNT, SCHEMA, catalog, withCell } from './fixtures.ts';
import { f64Reader, readerDoc } from './programs.ts';

prebuildCatalog();
prebuild(['full']);

/** This criterion's judge of the read: the document presented with no error, and `reader.value` 1.8 at every step. */
function readFailures(shown: Obj, ran: Obj): string[] {
  const where = 'items.weight of cudgel, read by the logic item by its column name\'s and ID\'s hashes';
  if (shown['outcome'] !== 'presented') return [`${where}: the document naming the catalog isn't presented: ${show538(shown['issues'] ?? shown, 800)}`];
  const errors = (Array.isArray(shown['issues']) ? shown['issues'] : []).filter((i: Obj) => i?.['severity'] === 'error');
  if (errors.length) return [`${where}: the document's check raises ${show(errors, 800)}`];
  if (!Array.isArray(ran['steps'])) return [`${where}: the logic call ran no step: ${show(ran, 800)}`];
  const out: string[] = [];
  (ran['steps'] as Obj[]).forEach((s, k) => {
    const v = (s['arrays'] as Obj | undefined)?.['reader.value']?.[0];
    if (v !== CUDGEL.weight) out.push(`${where}: step ${k} reads ${show(v)}, not ${CUDGEL.weight}`);
  });
  return out;
}

describe(`${AC[1]} the fixture catalog packs into table.layout@1, and a logic item reads it by hash`, () => {
  it(`${AC[1]} 40 items, 15 recipes and 4 creatures as three CSV tables pack into table.layout@1 as its doc and the As built rules lay it out`, () => {
    const t = catalog();
    expect([t['items']!.rows.length, t['recipes']!.rows.length, t['creatures']!.rows.length], 'the fixture holds 40 items, 15 recipes and 4 creatures').toEqual([ITEM_COUNT, RECIPE_COUNT, CREATURE_COUNT]);
    expect([ITEM_COUNT, RECIPE_COUNT, CREATURE_COUNT]).toEqual([40, 15, 4]);
    const dir = scratch('ac01');
    const [p] = packAll([packCall(dir, t, SCHEMA)], 'the fixture as CSV');
    none(judgeLayout(p!.bytes, p!.record, t, SCHEMA), 'the packed bytes and record against the layout');
    expect(p!.record['missing'], 'every ref resolves').toEqual([]);
    const path = join(dir, 'clean.bin');
    writeFileSync(path, p!.bytes);
    const [v] = runShow(binOf('full'), scenario(scratch('ev'), [], [{ call: 'validate', layout: 'table.layout@1', path }]), 'AC1 validate');
    expect([v!['outcome'], v!['asset']], `table.layout@1's validator admits the bytes: ${show(v)}`).toEqual(['admitted', p!.sha256]);
  }, TIMEOUT);

  it(`${AC[1]} a logic item that names it reads cudgel's weight 1.8 by its column name's hash and its ID's hash; the planted catalog_rows_not_columns fails that read, naming the column`, () => {
    const t = catalog();
    const dir = scratch('ac01');
    const [clean, planted] = packAll([packCall(dir, t, SCHEMA), packCall(dir, t, SCHEMA, 'csv', 'catalog_rows_not_columns')], 'the fixture, clean and planted');
    const dirEnd = layoutOf(clean!.bytes, 'the clean bytes').directoryEnd;
    expect(planted!.bytes.subarray(0, dirEnd).equals(clean!.bytes.subarray(0, dirEnd)), 'the planted packer\'s header and directory are the clean one\'s: its directory still says column after column').toBe(true);
    expect(planted!.sha256, 'the planted packer writes other bytes after the directory').not.toBe(clean!.sha256);
    const program = f64Reader('items', 'weight', CUDGEL.id);
    const ev = scratch('ev');
    for (const b of [program.bytes, clean!.bytes, planted!.bytes]) putEvidence(ev, b);
    const [a, b] = [DOC(1), DOC(2)];
    const r = runShow(binOf('full'), scenario(ev, [a, b], [
      showCall(a, readerDoc('reader', program, { value: 'f64' }, clean!.sha256) as never), { call: 'logic', doc: a, steps: 3 },
      showCall(b, readerDoc('reader', program, { value: 'f64' }, planted!.sha256) as never), { call: 'logic', doc: b, steps: 3 },
    ]), 'AC1 the reader');
    presented(r[0]!, 'the document naming the clean catalog');
    none(readFailures(r[0]!, r[1]!), 'the logic item\'s read of the clean catalog');
    failsNaming(readFailures(r[2]!, r[3]!), ['items.weight'], 'the logic item\'s read of the catalog_rows_not_columns bytes');
  }, TIMEOUT);

  it(`${AC[1]} the inheriting item's packed row equals the same row written out in full`, () => {
    const t = catalog();
    let full = withCell(t, 'items', INHERITS.id, 'base', null);
    const parent = t['items']!.rows.find((x) => x['id'] === INHERITS.from)!;
    for (const c of INHERITS.empty) {
      expect(t['items']!.rows.find((x) => x['id'] === INHERITS.id)![c], `${INHERITS.id} leaves ${c} empty in the fixture`).toBeNull();
      full = withCell(full, 'items', INHERITS.id, c, parent[c]!);
    }
    const dir = scratch('ac01');
    const [inherits, written]: Packed[] = packAll([packCall(dir, t, SCHEMA), packCall(dir, full, SCHEMA)], 'the fixture, and with the row written out');
    const a = rowValues(inherits!.bytes, layoutOf(inherits!.bytes, 'inheriting'), 'items', SCHEMA, INHERITS.id);
    const b = rowValues(written!.bytes, layoutOf(written!.bytes, 'written out'), 'items', SCHEMA, INHERITS.id);
    expect(a, `${INHERITS.id}'s packed row equals the same row written out in full`).toEqual(b);
    expect(b, `that row holds cudgel's weight, stack and damage and its own name and value`).toEqual({ name: 1043, weight: CUDGEL.weight, value: 12, stack: false, damage: 6 });
  }, TIMEOUT);

  it(`${AC[1]} the packed bytes are the same on macOS arm64 and Linux x86_64`, () => {
    if (`${process.platform}/${process.arch}` !== 'darwin/arm64') inconclusive(`this leg compares macOS arm64 with Linux x86_64 and runs on ${process.platform}/${process.arch}`);
    const t = catalog();
    const dir = scratch('ac01');
    const call = packCall(dir, t, SCHEMA);
    const [mac] = packAll([call], 'the fixture on this Mac', catalogBin());
    const linuxOut = join(dir, 'linux.bin');
    const [reply] = packOnLinux([{ ...call, out: linuxOut }], [dir]);
    const linux = packedOf(reply!, linuxOut, 'the fixture on linux/amd64');
    expect(linux.sha256, 'Linux x86_64 packs the same bytes as macOS arm64').toBe(mac!.sha256);
    expect(linux.bytes.equals(mac!.bytes), 'byte for byte').toBe(true);
    expect(canon(linux.record), 'and the same record').toBe(canon(mac!.record));
  }, TIMEOUT * 3);
});
