import { describe, expect, it } from 'vitest';
import { AC, COUNTY_UNITS, METRO, TIMEOUT, brief, byMetro, cell, derive, derivedOf, importTables, int, openHub, proof, show } from './helpers.ts';

const ID = AC[1];

describe(`${ID} join then group by metro sums and counts each metro's counties`, () => {
  it(`${ID} join then group by metro with sum writes 250 for A and 307 for B, and count writes 4 and 2`, async () => {
    const hub = await openHub();
    expect(typeof hub === 'string' ? hub : '', 'a hub with packages/jobs/asset-tools installed and its table.derive tool listed').toBe('');
    if (typeof hub === 'string') return;
    const tables = await importTables(hub, [{ name: 'counties.csv', key: 'county', units: COUNTY_UNITS }, { name: 'metros.csv', key: METRO.key }]);
    expect(typeof tables === 'string' ? tables : '', 'the two fixture tables fetched into the hub\'s evidence store').toBe('');
    if (typeof tables === 'string') return;
    const run = await derive(hub, byMetro({ county: tables.sha['counties.csv']!, metro: tables.sha['metros.csv']! }));
    const d = derivedOf(hub, run, 'the join and group by metro');
    expect(typeof d === 'string' ? d : '', 'deep_job derives the table').toBe('');
    if (typeof d === 'string') return;
    proof('ac1.json', { inputs: tables.sha, outputs: d.outputs, table: d.table.text, receipt: d.receipt, lineage: d.lineage, reply: d.run.outcome.value });
    const got = {
      A: { workers: int(cell(d.table, 'metro', 'A', 'workers')), counties: int(cell(d.table, 'metro', 'A', 'counties')) },
      B: { workers: int(cell(d.table, 'metro', 'B', 'workers')), counties: int(cell(d.table, 'metro', 'B', 'counties')) },
    };
    expect(got, `the derived table (${show(d.table.text, 400)}); ${brief(d.run)}`).toEqual({ A: { workers: 250, counties: 4 }, B: { workers: 307, counties: 2 } });
    expect(d.table.rows.length, `one row per metro: ${show(d.table.text, 400)}`).toBe(2);
  }, TIMEOUT);
});
