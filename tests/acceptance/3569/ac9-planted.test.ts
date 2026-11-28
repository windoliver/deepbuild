import { describe, expect, it } from 'vitest';
import {
  AC, CHECK, METRO, TIMEOUT, byMetro, derive, derivedOf, failedCheck, fixture, importTables, installPlanted, names, openHub, parseCsv, proof, show, spoil, type Edit, type Plan,
} from './helpers.ts';

const ID = AC[9];
const AGG = { workers: 'sum(manufacturing)', payroll: 'sum(payroll)', counties: 'count' };
const METROS: Record<string, string[]> = { A: ['1', '2', '3', '4'], B: ['5', '6'] };

const rows = parseCsv(fixture('counties-pay.csv').toString('utf8')).slice(1);
const pay = Object.fromEntries(rows.map((r) => [r[0]!, Number(r[2])]));
const workers = Object.fromEntries(rows.map((r) => [r[0]!, Number(r[1])]));
const f64 = (keys: string[]): number => keys.reduce((s, k) => s + pay[k]!, 0);
const f32 = (keys: string[]): number => keys.reduce((s, k) => Math.fround(s + Math.fround(pay[k]!)), 0);

const F32: Plan = { key: 'metro', edits: Object.entries(METROS).map(([m, keys]): Edit => ({ key: m, column: 'payroll', expect: f64(keys), to: String(f32(keys)) })) };
const TWICE: Plan = {
  key: 'metro',
  edits: [
    { key: 'B', column: 'workers', expect: 307, to: String(307 + workers['3']!) },
    { key: 'B', column: 'counties', expect: 2, to: '3' },
    { key: 'B', column: 'payroll', expect: f64(METROS.B!), to: String(f64([...METROS.B!, '3'])) },
  ],
};

describe(`${ID} data.derived recounts every cell on its own and fails a tool that sums in f32 or counts a row twice, naming the cell`, () => {
  it(`${ID} a planted tool that sums in f32 and one that counts a county in two groups each fail data.derived, naming the output cell`, async () => {

    for (const [m, keys] of Object.entries(METROS)) expect(Math.abs(f32(keys) - f64(keys)) / f64(keys), `fixture: metro ${m}'s payroll in f32 is off its f64 sum by more than 1e-9 relative`).toBeGreaterThan(1e-9);
    expect(workers['3'], 'fixture: county 3 holds workers').toBe(40);

    const hub = await openHub();
    expect(typeof hub === 'string' ? hub : '', 'a hub with packages/jobs/asset-tools installed and its table.derive tool listed').toBe('');
    if (typeof hub === 'string') return;
    const tables = await importTables(hub, [{ name: 'counties-pay.csv', key: 'county', units: { manufacturing: 'workers', payroll: 'dollars' } }, { name: 'metros.csv', key: METRO.key }]);
    expect(typeof tables === 'string' ? tables : '', 'the county table with payroll and the metro table fetched into the hub\'s evidence store').toBe('');
    if (typeof tables === 'string') return;
    const params = byMetro({ county: tables.sha['counties-pay.csv']!, metro: tables.sha['metros.csv']! }, { agg: AGG });

    const right = derivedOf(hub, await derive(hub, params), 'the job on the right tool');
    expect(typeof right === 'string' ? right : '', `the right tool's table passes ${CHECK}`).toBe('');
    if (typeof right === 'string') return;
    expect([spoil(right.table.text, F32) !== null, spoil(right.table.text, TWICE) !== null], `both planted edits apply to the right output (its payroll sums in f64, B's 307 workers in 2 counties): ${show(right.table.text, 400)}`).toEqual([true, true]);
    const asIs = await installPlanted(hub, 'as_is', { key: 'metro', edits: [] });
    expect(typeof asIs === 'string' ? asIs : '', 'runs-as-is@1.0.0, the planted plug-in handing on the right bytes, joins the kind').toBe('');
    if (typeof asIs === 'string') return;
    const through = derivedOf(hub, await derive(hub, params, asIs.tool), 'the job on runs-as-is@1.0.0');
    expect(typeof through === 'string' ? through : '', `the right bytes through the planted entry pass ${CHECK}`).toBe('');

    const seen: Record<string, unknown> = { inputs: tables.sha, right: { outputs: right.outputs, table: right.table.text, receipt: right.receipt, lineage: right.lineage } };
    for (const [name, plan, cells] of [['sums_in_f32', F32, [['A', 'payroll'], ['B', 'payroll']]], ['counts_row_twice', TWICE, [['B', 'workers'], ['B', 'counties'], ['B', 'payroll']]]] as const) {
      const planted = await installPlanted(hub, name, plan);
      expect(typeof planted === 'string' ? planted : '', `${name}'s tool joins the kind: it is right on every other input`).toBe('');
      if (typeof planted === 'string') return;
      const run = await derive(hub, params, planted.tool);
      seen[name] = typeof run === 'string' ? run : run.outcome.value;
      proof('ac9.json', seen);
      const failed = failedCheck(run);
      expect(typeof failed === 'string' ? failed : '', `${planted.tool}'s table fails an output check`).toBe('');
      if (typeof failed === 'string') return;
      expect(failed.check, `the check it fails is ${CHECK}: ${failed.reason}`).toBe(CHECK);
      expect(cells.some(([metro, column]) => names(failed.reason, metro) && names(failed.reason, column)), `${CHECK} names a cell ${planted.tool} wrote wrong, by its metro and its column (${cells.map((c) => c.join(' ')).join(', ')}): ${failed.reason}`).toBe(true);
      expect(failed.outputs, 'nothing of the failed run is kept').toEqual({});
    }
  }, TIMEOUT);
});
