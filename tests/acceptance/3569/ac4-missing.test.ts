// #3569.becbb065: "County 2's cell is empty. Metro A's sum is missing. With `skip_missing: true` it reads 170 and the
// receipt counts 1 skipped cell for that column. A planted tool that reads the empty cell as 0 and reports nothing
// fails `data.derived`, naming metro A"
//
// fixtures/counties-gap.csv is counties.csv with county 2's manufacturing cell empty; AC1's job runs on it with the
// group's skip_missing left out (false) and with it true. A missing cell is an empty cell in the derived CSV (README:
// the derived table). The planted tool `reads-missing-as-zero@1.0.0` runs the right tool and, where it wrote metro A's
// workers missing, writes 170 (the sum with the empty cell read as 0) and leaves the receipt as it is, so it reports
// no skipped cell. It is installed beside `runs-as-is@1.0.0`, the same plug-in handing on the right bytes, which must
// join and pass `data.derived` on the same job.
// Wrong programs it fails on: the merge base; a sum that reads the empty cell as 0 (170 where it must be missing); a
// skip that skips nothing or counts no cell; a `data.derived` that recounts with the same reading, or names B or no
// metro.
import { describe, expect, it } from 'vitest';
import {
  AC, CHECK, COUNTY_UNITS, METRO, TIMEOUT, brief, byMetro, cell, derive, derivedOf, failedCheck, importTables, installPlanted, int, names, openHub, proof, show, spoil, type Plan,
} from './helpers.ts';

const ID = AC[4];
const ZERO: Plan = { key: 'metro', edits: [{ key: 'A', column: 'workers', expect: null, to: '170' }] };

describe(`${ID} a missing cell stays missing, is skipped and counted only when asked, and data.derived fails the tool that reads it as 0`, () => {
  it(`${ID} with county 2's cell empty metro A's sum is missing; with skip_missing it reads 170 with 1 skipped cell counted; the planted tool that reads the cell as 0 fails data.derived, naming metro A`, async () => {
    const hub = await openHub();
    expect(typeof hub === 'string' ? hub : '', 'a hub with packages/jobs/asset-tools installed and its table.derive tool listed').toBe('');
    if (typeof hub === 'string') return;
    const tables = await importTables(hub, [{ name: 'counties-gap.csv', key: 'county', units: COUNTY_UNITS }, { name: 'metros.csv', key: METRO.key }]);
    expect(typeof tables === 'string' ? tables : '', 'the county table with an empty cell and the metro table fetched into the hub\'s evidence store').toBe('');
    if (typeof tables === 'string') return;
    const sha = { county: tables.sha['counties-gap.csv']!, metro: tables.sha['metros.csv']! };

    const kept = derivedOf(hub, await derive(hub, byMetro(sha)), 'the job with skip_missing left out');
    expect(typeof kept === 'string' ? kept : '', 'deep_job derives the table with the missing cell').toBe('');
    if (typeof kept === 'string') return;
    expect(cell(kept.table, 'metro', 'A', 'workers'), `metro A's sum holds a missing cell, so it is missing (an empty cell), never 170 or 0: ${show(kept.table.text, 300)}; ${brief(kept.run)}`).toBe('');
    expect(int(cell(kept.table, 'metro', 'B', 'workers')), 'metro B holds no missing cell: 307').toBe(307);

    const skipped = derivedOf(hub, await derive(hub, byMetro(sha, { skip_missing: true })), 'the job with skip_missing: true');
    expect(typeof skipped === 'string' ? skipped : '', 'deep_job derives the table with skip_missing: true').toBe('');
    if (typeof skipped === 'string') return;
    expect(int(cell(skipped.table, 'metro', 'A', 'workers')), `with skip_missing: true metro A reads 170: ${show(skipped.table.text, 300)}`).toBe(170);
    expect(skipped.receipt.skipped?.workers, `the receipt counts the 1 cell it skipped for workers: ${show(skipped.receipt)}`).toBe(1);

    const asIs = await installPlanted(hub, 'as_is', { key: 'metro', edits: [] });
    expect(typeof asIs === 'string' ? asIs : '', 'runs-as-is@1.0.0, the planted plug-in handing on the right bytes, joins the kind').toBe('');
    if (typeof asIs === 'string') return;
    const right = derivedOf(hub, await derive(hub, byMetro(sha), asIs.tool), 'the job on runs-as-is@1.0.0');
    expect(typeof right === 'string' ? right : '', `the right bytes through the planted entry pass ${CHECK}`).toBe('');
    if (typeof right === 'string') return;
    expect(spoil(right.table.text, ZERO) !== null, `the planted edit applies to the right output (metro A's workers missing): ${show(right.table.text, 300)}`).toBe(true);

    const zero = await installPlanted(hub, 'reads_missing_as_zero', ZERO);
    expect(typeof zero === 'string' ? zero : '', 'reads-missing-as-zero@1.0.0 joins the kind: it is right on every other input').toBe('');
    if (typeof zero === 'string') return;
    const planted = await derive(hub, byMetro(sha), zero.tool);
    const failed = failedCheck(planted);
    proof('ac4.json', { inputs: tables.sha, kept: { outputs: kept.outputs, table: kept.table.text, receipt: kept.receipt }, skipped: { outputs: skipped.outputs, table: skipped.table.text, receipt: skipped.receipt }, planted: typeof planted === 'string' ? planted : planted.outcome.value });
    expect(typeof failed === 'string' ? failed : '', `the tool that reads the empty cell as 0 and reports nothing fails an output check`).toBe('');
    if (typeof failed === 'string') return;
    expect(failed.check, `the check it fails is ${CHECK}: ${failed.reason}`).toBe(CHECK);
    expect([names(failed.reason, 'A'), names(failed.reason, 'workers')], `${CHECK} names metro A's workers cell: ${failed.reason}`).toEqual([true, true]);
    expect(names(failed.reason, 'B'), `${CHECK} names only the cell that is wrong, not metro B: ${failed.reason}`).toBe(false);
    expect(failed.outputs, 'nothing of the failed run is kept').toEqual({});
  }, TIMEOUT);
});
