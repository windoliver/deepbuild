import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, brief, cell, derive, derivedOf, importTables, openHub, proof, show } from './helpers.ts';

const ID = AC[5];

describe(`${ID} a division by 0 is a missing cell, counted`, () => {
  it(`${ID} a / b where b is 0 writes a missing cell and counts it, never infinity or 0`, async () => {
    const hub = await openHub();
    expect(typeof hub === 'string' ? hub : '', 'a hub with packages/jobs/asset-tools installed and its table.derive tool listed').toBe('');
    if (typeof hub === 'string') return;
    const tables = await importTables(hub, [{ name: 'ratios.csv', key: 'id', units: { a: 'workers', b: 'workers' } }]);
    expect(typeof tables === 'string' ? tables : '', 'the ratio table fetched into the hub\'s evidence store').toBe('');
    if (typeof tables === 'string') return;
    const d = derivedOf(hub, await derive(hub, { inputs: { ratios: tables.sha['ratios.csv']! }, steps: [{ derive: { q: { expr: 'a / b', unit: 'share' } } }], key: 'id' }), 'the derive of a / b');
    expect(typeof d === 'string' ? d : '', 'deep_job derives the table').toBe('');
    if (typeof d === 'string') return;
    proof('ac5.json', { inputs: tables.sha, outputs: d.outputs, table: d.table.text, receipt: d.receipt });
    const one = cell(d.table, 'id', '1', 'q');
    expect(one !== undefined && one !== '' && Number(one), `6 / 3 is 2: ${show(d.table.text, 300)}; ${brief(d.run)}`).toBe(2);
    expect(cell(d.table, 'id', '2', 'q'), `5 / 0 is a missing cell, never infinity, NaN or 0: ${show(d.table.text, 300)}`).toBe('');
    expect(d.receipt.nonfinite?.q, `the receipt counts the 1 cell whose value wasn't finite: ${show(d.receipt)}`).toBe(1);
  }, TIMEOUT);
});
