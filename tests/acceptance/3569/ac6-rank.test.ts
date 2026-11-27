// #3569.eb306d67: "`rank` by the sum, descending, writes 1 for B and 2 for A. Two groups with equal sums rank by their key"
//
// AC1's job with a rank step after the group: `rank {by: workers, desc: true, into: rank}`. On the AC1 fixtures B (307)
// ranks 1 and A (250) 2. fixtures/counties-tie.csv with fixtures/metros-tie.csv gives A and B 250 each and C 400; the
// file meets metro B first (counties 1 and 2), so a rank that breaks the tie by the order rows arrive in, or by the
// key reversed, puts B before A. Ranked by the key, C is 1, A 2 and B 3.
// Wrong programs it fails on: the merge base; a rank ascending; one that ties A and B at 2, breaks the tie by first
// appearance or reversed key, or numbers from 0.
import { describe, expect, it } from 'vitest';
import { AC, COUNTY_UNITS, METRO, TIMEOUT, brief, byMetro, cell, derive, derivedOf, importTables, int, openHub, proof, show } from './helpers.ts';

const ID = AC[6];
const RANK = [{ rank: { by: 'workers', desc: true, within: [], into: 'rank' } }];

describe(`${ID} rank orders groups by their sum, descending, ties by key`, () => {
  it(`${ID} rank by the sum, descending, writes 1 for B and 2 for A, and two groups with equal sums rank by their key`, async () => {
    const hub = await openHub();
    expect(typeof hub === 'string' ? hub : '', 'a hub with packages/jobs/asset-tools installed and its table.derive tool listed').toBe('');
    if (typeof hub === 'string') return;
    const tables = await importTables(hub, [
      { name: 'counties.csv', key: 'county', units: COUNTY_UNITS }, { name: 'metros.csv', key: METRO.key },
      { name: 'counties-tie.csv', key: 'county', units: COUNTY_UNITS }, { name: 'metros-tie.csv', key: METRO.key },
    ]);
    expect(typeof tables === 'string' ? tables : '', 'the fixture tables fetched into the hub\'s evidence store').toBe('');
    if (typeof tables === 'string') return;

    const d = derivedOf(hub, await derive(hub, byMetro({ county: tables.sha['counties.csv']!, metro: tables.sha['metros.csv']! }, { agg: { workers: 'sum(manufacturing)' }, after: RANK })), 'the ranked job');
    expect(typeof d === 'string' ? d : '', 'deep_job derives the ranked table').toBe('');
    if (typeof d === 'string') return;
    expect({ A: int(cell(d.table, 'metro', 'A', 'rank')), B: int(cell(d.table, 'metro', 'B', 'rank')) }, `B's 307 ranks above A's 250: ${show(d.table.text, 300)}; ${brief(d.run)}`).toEqual({ A: 2, B: 1 });

    const tie = derivedOf(hub, await derive(hub, byMetro({ county: tables.sha['counties-tie.csv']!, metro: tables.sha['metros-tie.csv']! }, { agg: { workers: 'sum(manufacturing)' }, after: RANK })), 'the ranked job with a tie');
    expect(typeof tie === 'string' ? tie : '', 'deep_job derives the ranked table with a tie').toBe('');
    if (typeof tie === 'string') return;
    proof('ac6.json', { inputs: tables.sha, ranked: { outputs: d.outputs, table: d.table.text }, tie: { outputs: tie.outputs, table: tie.table.text } });
    expect({ A: int(cell(tie.table, 'metro', 'A', 'workers')), B: int(cell(tie.table, 'metro', 'B', 'workers')), C: int(cell(tie.table, 'metro', 'C', 'workers')) }, `the tie fixture's sums: ${show(tie.table.text, 300)}`).toEqual({ A: 250, B: 250, C: 400 });
    expect({ A: int(cell(tie.table, 'metro', 'A', 'rank')), B: int(cell(tie.table, 'metro', 'B', 'rank')), C: int(cell(tie.table, 'metro', 'C', 'rank')) }, `A and B tie at 250 and rank by their key, A first: ${show(tie.table.text, 300)}`).toEqual({ A: 2, B: 3, C: 1 });
  }, TIMEOUT);
});
