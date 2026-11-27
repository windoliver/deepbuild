import { beforeAll, describe, expect, it } from 'vitest';
import { AC, CHECK, FIELDS, FIRST, NAMES, SECOND, TIMEOUT, assetsOf, chart, check, errorsOf, fetchedAt, list, openFiles, openWorld, piece, proof, recorded, rowsOf, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(await openFiles()); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

describe(`${AC[1]} the fixture piece's list draws one row for each fetched file its labels trace to, every field its asset's record`, () => {
  it(`${AC[1]} a label of a table derived from two fetched files and a label of a third: the list draws three rows, and each field equals its asset's record`, async () => {
    const world = must(w, 'a hub with the table import and the table.derive tools');
    const p = must(await piece(world), 'three files fetched after one yes each, imported, and the first two derived into one table');
    const doc = chart([FIRST(), SECOND(), list({ of: 'document', fields: [...FIELDS], group: 'none' })], assetsOf(p));
    const c = must(check(world, doc), 'deep-canvas-render check answers');
    proof('ac1-fetch-records.json', NAMES.map((n) => ({ file: n, record: p.files[n].record })));
    expect(errorsOf(c), `the fixture piece passes the check, ${CHECK} included`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
    const rows = must(rowsOf(c), 'the rows the list draws');
    proof('ac1-rows.json', rows);
    expect(rows.length, 'one row for each fetched file a shown number traces to').toBe(3);
    for (const [i, n] of NAMES.entries()) {
      const f = p.files[n];
      const record = must(recorded(f), `the record of the fetched file ${n}`);
      const row = rows[i]!.fields;
      expect(Object.keys(row).sort(), `row ${i + 1} shows the fields the item names`).toEqual([...FIELDS].sort());
      expect({ title: record.title, publisher: record.publisher, edition: record.edition }, `${n}'s record holds the title, publisher and edition your approval stored`).toEqual({ title: f.file.title, publisher: f.file.publisher, edition: f.file.edition });
      expect({ url: record.url, sha256: record.sha256, bytes: record.bytes, license: record.license, credit: record.credit }, `${n}'s record holds what the hub wrote at the fetch and the asset's license`)
        .toEqual({ url: f.file.url, sha256: f.file.sha256, bytes: String(f.file.size), license: f.file.license.id, credit: f.file.license.credit });
      const at = fetchedAt(record.fetched);
      expect(at >= f.asked - 1000 && at <= f.landed + 1000, `${n}'s record holds the time the hub fetched it, ${String(record.fetched)}, between the ask (${f.asked}) and the landing (${f.landed})`).toBe(true);
      for (const field of ['title', 'publisher', 'edition', 'license', 'url', 'fetched', 'sha256', 'bytes'] as const) expect(row[field], `row ${i + 1} (${n}): ${field} equals the record's`).toBe(record[field]);
      if (record.credit === null) expect(/[\p{L}\p{N}]/u.test(row.credit ?? 'x'), `row ${i + 1} (${n}): no credit is shown for a license that carries none, and it shows ${JSON.stringify(row.credit)}`).toBe(false);
      else expect(row.credit, `row ${i + 1} (${n}): credit equals the license's`).toBe(record.credit);
      expect(row.used_by, `row ${i + 1} (${n}): one label's number traces to the file`).toBe('1');
    }
  }, TIMEOUT);
});
