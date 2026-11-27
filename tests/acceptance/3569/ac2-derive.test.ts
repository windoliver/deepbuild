// #3569.22f062d8: "A `derive` of `manufacturing + construction + mining` over one row holding 120, 30 and 0 writes 150
// with the unit of its columns. The same expression over a column of workers and a column of dollars is refused,
// naming both units"
//
// fixtures/one-row.csv holds county 1 with 120, 30 and 0, each column imported in workers. fixtures/one-row-dollars.csv
// is the same row for county 2 (so its bytes, and its hash, differ), its mining column imported in dollars. The job is
// one derive step, `total: {expr: "manufacturing + construction + mining", unit: "workers"}`, keyed by county. The unit
// of the derived column is read from the derived table's record in the store (`probe.table.columns`, #397's form).
// Wrong programs it fails on: the merge base; a derive that reads a 0 cell as missing or drops a term; one that writes
// the column with no unit or another one; one that adds across units, or refuses naming only one unit.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, brief, cell, derive, derivedOf, importTables, int, names, openHub, outputsOf, proof, refusalOf, show, type DeriveParams } from './helpers.ts';

const ID = AC[2];
const job = (sha: string): DeriveParams => ({
  inputs: { county: sha },
  steps: [{ derive: { total: { expr: 'manufacturing + construction + mining', unit: 'workers' } } }],
  key: 'county',
});

describe(`${ID} a derive adds a row's columns in their unit, and refuses to add across units`, () => {
  it(`${ID} manufacturing + construction + mining over one row holding 120, 30 and 0 writes 150 with the unit of its columns; over workers and dollars it is refused, naming both units`, async () => {
    const hub = await openHub();
    expect(typeof hub === 'string' ? hub : '', 'a hub with packages/jobs/asset-tools installed and its table.derive tool listed').toBe('');
    if (typeof hub === 'string') return;
    const tables = await importTables(hub, [
      { name: 'one-row.csv', key: 'county', units: { manufacturing: 'workers', construction: 'workers', mining: 'workers' } },
      { name: 'one-row-dollars.csv', key: 'county', units: { manufacturing: 'workers', construction: 'workers', mining: 'dollars' } },
    ]);
    expect(typeof tables === 'string' ? tables : '', 'the two one-row tables fetched into the hub\'s evidence store, with their units').toBe('');
    if (typeof tables === 'string') return;

    const d = derivedOf(hub, await derive(hub, job(tables.sha['one-row.csv']!)), 'the derive over workers');
    expect(typeof d === 'string' ? d : '', 'deep_job derives the table').toBe('');
    if (typeof d === 'string') return;
    expect(int(cell(d.table, 'county', '1', 'total')), `the derived total of 120 + 30 + 0: ${show(d.table.text, 300)}; ${brief(d.run)}`).toBe(150);
    const columns = Array.isArray(d.record?.probe?.table?.columns) ? (d.record!.probe.table.columns as { name: string; unit: unknown }[]) : [];
    expect(columns.find((c) => c.name === 'total')?.unit, `the derived table's record in the store gives total the unit of its columns: ${show(d.record?.probe ?? d.record, 600)}`).toBe('workers');

    const mixed = await derive(hub, job(tables.sha['one-row-dollars.csv']!));
    expect(typeof mixed === 'string' ? mixed : '', 'the derive over workers and dollars gets a reply').toBe('');
    if (typeof mixed === 'string') return;
    proof('ac2.json', { inputs: tables.sha, workers: { outputs: d.outputs, table: d.table.text, record: d.record }, dollars: mixed.outcome.value });
    const why = refusalOf(mixed.outcome);
    expect(why, `adding workers to dollars is refused: ${brief(mixed)}`).not.toBe('');
    expect([names(why, 'workers'), names(why, 'dollars')], `the refusal names both units: ${why}`).toEqual([true, true]);
    expect(outputsOf(mixed.outcome), 'a refused job keeps no output').toEqual({});
  }, TIMEOUT);
});
