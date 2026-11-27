// AC9 (#3570.1144aef4): "Budget, on the reference Mac in the local preflight: the 40 MB fixture imports in under 5 s
// (estimate; the first measurement may move it once)"
// One reading (AGENTS.md: a budget is best effort under load): criterion 1's import of `countyFile()`, a cache miss
// in a fresh hub, timed from deep_job's call to its reply. On a fit reference Mac (scripts/benchmark.mjs: model, chip
// and memory; mains power, Low Power Mode off, thermal state nominal) at a load at most its cores, it passes within
// 5,000 ms and fails over it; anywhere else it is INCONCLUSIVE, never PASS.
import { beforeAll, describe, expect, it } from 'vitest';
import { COUNTIES, countyFile } from './fixtures.ts';
import { AC, COUNTY_PARAMS, TIMEOUT, fetchAll, judgeOnce, openWorld, receiptOf, runTable, tableOf, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };
const LIMIT_MS = 5_000;

describe(`${AC[9]} the 40 MB fixture imports in under 5 s on a fit reference Mac`, () => {
  it('one timed import of the pipe file, judged once', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const county = countyFile();
    const fetched = must(await fetchAll(world, { 'county.txt': county.bytes }), 'the file fetched once through the Source block');
    const ran = must(await runTable(world, COUNTY_PARAMS, fetched['county.txt']!.sha256), 'a reply');
    must(tableOf(world, ran.outcome), 'the import is done');
    expect((ran.outcome.value['receipt'] as { cache?: unknown } | undefined)?.cache, 'the timed run is a cache miss, its tool run').toBe('miss');
    const receipt = must(receiptOf(world, ran.outcome), 'its receipt');
    expect(receipt['rows_kept'], 'the timed run is criterion 1\'s import').toBe(COUNTIES);
    const verdict = await judgeOnce(ran.ms, LIMIT_MS);
    console.log(`#3570 AC9 ${verdict.status}: ${verdict.reason}`);
    expect(verdict.status, verdict.reason).toBe('PASS');
  }, TIMEOUT);
});
