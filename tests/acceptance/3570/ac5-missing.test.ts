// AC5 (#3570.9251b800): "A cell `(D)` in a numeric column that lists it under `missing` is missing and counted.
// Without it in the list the import is refused, naming the row and the column. A planted reader that writes 0 for it
// fails qualification"
// `marker.csv` is `fixtures.ts`'s: 100 rows of `fips,name,pop`; line 58, the area 48201, prints `(D)` for its pop.
import { beforeAll, describe, expect, it } from 'vitest';
import { markerCsv } from './fixtures.ts';
import { AC, TIMEOUT, cut, fetchAll, firstDiff, namesRow, openWorld, plant, readTable, receiptOf, refusalOf, runTable, said, show, smallParams, tableOf, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

describe(`${AC[5]} a publisher's marker in a numeric column is missing and counted where the column lists it, and refused by row and column where it doesn't`, () => {
  it('(D) listed under missing is missing and counted 1 for pop; unlisted, the import is refused naming the row and pop', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const fx = markerCsv();
    const fetched = must(await fetchAll(world, { 'marker.csv': fx.bytes }), 'the file fetched once through the Source block');

    const listed = must(await runTable(world, smallParams({ missing: ['(D)'] }), fetched['marker.csv']!.sha256), 'a reply');
    const table = must(tableOf(world, listed.outcome), 'the import with (D) listed is done');
    const rows = must(cut(must(readTable(table.bytes), 'a table'), ['fips', 'name', 'pop']), 'its columns');
    const want = fx.rows.map((r) => r.map((c) => (c === '(D)' ? null : c)));
    expect(firstDiff(rows, want), 'the (D) cell missing, every other cell as the file writes it').toBe('');
    const receipt = must(receiptOf(world, listed.outcome), 'its receipt');
    expect((receipt['missing'] as Record<string, unknown> | undefined)?.['pop'], `the receipt counts the missing cell by column: ${show(receipt)}`).toBe(1);

    const unlisted = must(await runTable(world, smallParams(), fetched['marker.csv']!.sha256), 'a reply');
    const r = refusalOf(unlisted.outcome);
    expect(r.refused, `without (D) in the list the import is refused: ${unlisted.outcome.text.slice(0, 600)}`).toBe(true);
    expect(r.outputs, 'and writes nothing').toBe(0);
    expect(namesRow(r.reason, fx.marked.line, fx.marked.key), `the refusal names the row (line ${fx.marked.line}, area ${fx.marked.key}): ${r.reason}`).toBe(true);
    expect(r.reason, 'and the column').toMatch(/\bpop\b/);
  }, TIMEOUT);

  it('planted reads_marker_as_zero: runs-as-is qualifies and is listed; the reader that writes 0 for the marker fails the kind\'s qualification and isn\'t listed', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const p = await plant(world, 'reads_marker_as_zero');
    expect(p.problem).toBe('');
    expect(p.control?.code, `the right reader through the planted entry installs: ${said(p.control!).slice(-800)}`).toBe(0);
    expect(p.controlListed, 'and deep_job lists it').toBe(true);
    expect(p.install?.code, `the planted reader is refused at install: ${said(p.install!).slice(-800)}`).not.toBe(0);
    expect(p.listed, 'and deep_job doesn\'t list it').not.toContain(p.tool);
  }, TIMEOUT);
});
