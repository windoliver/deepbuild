// AC6 (#3570.39c1c79a): "A cell `1,234` is refused in a plain numeric column and reads 1234 where the column says
// `group: ","`"
// `groups.tsv` is `fixtures.ts`'s: 20 rows of `fips<TAB>name<TAB>pop`, read with `delimiter: tab`; line 12, the area
// 20077, writes its pop `1,234`.
import { beforeAll, describe, expect, it } from 'vitest';
import { groupsTsv } from './fixtures.ts';
import { AC, TIMEOUT, cut, fetchAll, firstDiff, namesRow, openWorld, readTable, refusalOf, runTable, smallParams, tableOf, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

describe(`${AC[6]} a number with a group mark parses only where its column names the mark`, () => {
  it('1,234 is refused in a plain i64 column, naming the row and column, and reads 1234 under group ","', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const fx = groupsTsv();
    const fetched = must(await fetchAll(world, { 'groups.tsv': fx.bytes }), 'the file fetched once through the Source block');
    const sha = fetched['groups.tsv']!.sha256;

    const plain = must(await runTable(world, smallParams({}, { delimiter: 'tab' }), sha), 'a reply');
    const r = refusalOf(plain.outcome);
    expect(r.refused, `1,234 in a plain numeric column is refused: ${plain.outcome.text.slice(0, 600)}`).toBe(true);
    expect(r.outputs, 'and writes nothing').toBe(0);
    expect(namesRow(r.reason, fx.marked.line, fx.marked.key), `the refusal names the row (line ${fx.marked.line}, area ${fx.marked.key}): ${r.reason}`).toBe(true);
    expect(r.reason, 'and the column').toMatch(/\bpop\b/);

    const grouped = must(await runTable(world, smallParams({ group: ',' }, { delimiter: 'tab' }), sha), 'a reply');
    const table = must(tableOf(world, grouped.outcome), 'the import under group "," is done');
    const rows = must(cut(must(readTable(table.bytes), 'a table'), ['fips', 'name', 'pop']), 'its columns');
    expect(firstDiff(rows, fx.rows.map((row) => row.map((c) => (c === '1,234' ? '1234' : c)))), '1,234 reads 1234, every other cell as the file writes it').toBe('');
  }, TIMEOUT);
});
