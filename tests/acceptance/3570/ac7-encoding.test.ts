// AC7 (#3570.df4af9a2): "A name holding the byte 0xE9 reads `é` under `encoding: latin-1` and is refused under `utf-8`,
// naming the row"
// `latin1.csv` is `fixtures.ts`'s: 10 rows of `fips,name,pop` in latin-1; line 7, the area 30011, is named `Andr` and
// the byte 0xE9, which no UTF-8 sequence holds alone.
import { beforeAll, describe, expect, it } from 'vitest';
import { latin1Csv } from './fixtures.ts';
import { AC, TIMEOUT, cut, fetchAll, firstDiff, namesRow, openWorld, readTable, refusalOf, runTable, smallParams, tableOf, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

describe(`${AC[7]} a file read in its declared encoding: latin-1's 0xE9 is é, and under utf-8 it is refused by row`, () => {
  it('the name reads André (U+00E9) under latin-1, and under utf-8 the import is refused naming the row', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const fx = latin1Csv();
    expect(fx.bytes.includes(Buffer.from([0x41, 0x6e, 0x64, 0x72, 0xe9, 0x2c])), 'the file holds Andr and the byte 0xE9').toBe(true);
    const fetched = must(await fetchAll(world, { 'latin1.csv': fx.bytes }), 'the file fetched once through the Source block');
    const sha = fetched['latin1.csv']!.sha256;

    const latin = must(await runTable(world, smallParams({}, { encoding: 'latin-1' }), sha), 'a reply');
    const table = must(tableOf(world, latin.outcome), 'the import under latin-1 is done');
    expect(table.bytes.includes(Buffer.from('André', 'utf8')), 'the table holds é as UTF-8').toBe(true);
    const rows = must(cut(must(readTable(table.bytes), 'a table'), ['fips', 'name', 'pop']), 'its columns');
    expect(firstDiff(rows, fx.rows), 'André, and every other cell as the file writes it').toBe('');

    const utf8 = must(await runTable(world, smallParams({}, { encoding: 'utf-8' }), sha), 'a reply');
    const r = refusalOf(utf8.outcome);
    expect(r.refused, `under utf-8 the import is refused: ${utf8.outcome.text.slice(0, 600)}`).toBe(true);
    expect(r.outputs, 'and writes nothing').toBe(0);
    expect(namesRow(r.reason, fx.marked.line, fx.marked.key), `the refusal names the row (line ${fx.marked.line}, area ${fx.marked.key}): ${r.reason}`).toBe(true);
  }, TIMEOUT);
});
