// #3569.9a78233f: "The second table names county 3 twice with `expect: many_to_one`: the job is refused, naming
// county 3. A county the second table doesn't name is dropped under `inner` and the receipt's `dropped` reads 1"
//
// fixtures/metros-twice.csv is metros.csv with a seventh row that names county 3 again (metro A); its key is `link`, so
// the import keeps both rows and only the join can see the repeat. fixtures/metros-short.csv names counties 1 to 5,
// so county 6 has no match. Both run AC1's job (README: the jobs). The control is the same job on metros.csv, done.
// Wrong programs it fails on: the merge base; a join that keeps the first or last match, or sums county 3 twice; a
// refusal that names another county or none; an inner join that keeps county 6, or drops it and counts nothing.
import { describe, expect, it } from 'vitest';
import { AC, COUNTY_UNITS, METRO, TIMEOUT, brief, byMetro, cell, derive, derivedOf, importTables, int, names, openHub, outputsOf, proof, refusalOf, show } from './helpers.ts';

const ID = AC[3];

describe(`${ID} a join that expects many to one refuses a repeated key, and an inner join drops and counts an unmatched row`, () => {
  it(`${ID} county 3 named twice under many_to_one is refused, naming county 3; a county the metro table doesn't name is dropped under inner and dropped reads 1`, async () => {
    const hub = await openHub();
    expect(typeof hub === 'string' ? hub : '', 'a hub with packages/jobs/asset-tools installed and its table.derive tool listed').toBe('');
    if (typeof hub === 'string') return;
    const tables = await importTables(hub, [
      { name: 'counties.csv', key: 'county', units: COUNTY_UNITS },
      { name: 'metros.csv', key: METRO.key }, { name: 'metros-twice.csv', key: METRO.key }, { name: 'metros-short.csv', key: METRO.key },
    ]);
    expect(typeof tables === 'string' ? tables : '', 'the county table and three metro tables fetched into the hub\'s evidence store').toBe('');
    if (typeof tables === 'string') return;
    const county = tables.sha['counties.csv']!;

    const control = derivedOf(hub, await derive(hub, byMetro({ county, metro: tables.sha['metros.csv']! })), 'the job on metros.csv');
    expect(typeof control === 'string' ? control : '', 'the same job on the metro table that names each county once is done').toBe('');

    const twice = await derive(hub, byMetro({ county, metro: tables.sha['metros-twice.csv']! }));
    expect(typeof twice === 'string' ? twice : '', 'the job on metros-twice.csv gets a reply').toBe('');
    if (typeof twice === 'string') return;
    const why = refusalOf(twice.outcome);
    expect(why, `the metro table names county 3 twice under expect: many_to_one, so the job is refused: ${brief(twice)}`).not.toBe('');
    expect(names(why, '3'), `the refusal names county 3: ${why}`).toBe(true);
    expect(outputsOf(twice.outcome), 'a refused job keeps no output').toEqual({});

    const short = derivedOf(hub, await derive(hub, byMetro({ county, metro: tables.sha['metros-short.csv']! })), 'the job on metros-short.csv');
    expect(typeof short === 'string' ? short : '', 'the job on the metro table that leaves out county 6 is done').toBe('');
    if (typeof short === 'string') return;
    proof('ac3.json', { inputs: tables.sha, twice: twice.outcome.value, short: { outputs: short.outputs, table: short.table.text, receipt: short.receipt } });
    expect(short.receipt.dropped, `the receipt's dropped counts county 6, which the inner join dropped: ${show(short.receipt)}`).toBe(1);
    expect({ A: int(cell(short.table, 'metro', 'A', 'workers')), B: int(cell(short.table, 'metro', 'B', 'workers')) }, `county 6's 7 workers are in no sum: ${show(short.table.text, 300)}`).toEqual({ A: 250, B: 300 });
  }, TIMEOUT);
});
