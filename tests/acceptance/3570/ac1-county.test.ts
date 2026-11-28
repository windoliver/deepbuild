// AC1 (#3570.d751be37): "A pipe-delimited fixture of 600,000 rows and 30 columns, about 40 MB, written by a seeded
// generator. An import that names 3 columns and a `where` on the prefix `0500000US` of its first column writes a table
// of 3,200 rows and 3 columns. The receipt reads 600,000 rows read and 3,200 kept, and the job's peak memory stays
// under 128 MB."
// The file is `fixtures.ts`'s `countyFile()` (seed 3570), fetched once through the hub's Source block and imported by
// its hash. Its kept rows are the generator's own list; the peak is the supervisor's scan of the tool's run, as the
// hub writes it in the receipt, never the tool's word.
import { beforeAll, describe, expect, it } from 'vitest';
import { COUNTIES, COUNTY_HEADER, PREFIX, ROWS, countyFile } from './fixtures.ts';
import { AC, COUNTY_COLUMNS, COUNTY_PARAMS, TIMEOUT, cut, fetchAll, firstDiff, openWorld, readTable, receiptOf, runTable, show, tableOf, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);

describe(`${AC[1]} the 600,000-row pipe file cut to 3 columns and the 3,200 counties, read in under 128 MB`, () => {
  it('writes the 3,200 counties in file order as 3 columns, the receipt reads 600,000 read and 3,200 kept, and the supervisor read a peak under 128 MB', async () => {
    expect(typeof w === 'string' ? w : '', 'a hub with the import kind\'s table tool').toBe('');
    const world = w as World;

    // The fixture, as the criterion prints it.
    const county = countyFile();
    const lines = county.bytes.toString('latin1').split('\n').filter((l) => l !== '');
    expect(lines.length - 1, 'the generator writes 600,000 rows under its header').toBe(ROWS);
    expect(lines[0]!.split('|'), 'of 30 columns').toEqual(COUNTY_HEADER);
    expect(county.bytes.length, 'about 40 MB').toBeGreaterThan(38e6);
    expect(county.bytes.length, 'about 40 MB').toBeLessThan(46e6);
    expect(county.kept.length, 'with 3,200 counties').toBe(COUNTIES);
    expect(lines.filter((l) => l.includes(PREFIX)).length, 'and decoys that hold the prefix past their start').toBeGreaterThan(COUNTIES);

    const fetched = await fetchAll(world, { 'county.txt': county.bytes });
    expect(typeof fetched === 'string' ? fetched : '', 'the file fetched once through the Source block').toBe('');
    const file = (fetched as Exclude<typeof fetched, string>)['county.txt']!;

    const ran = await runTable(world, COUNTY_PARAMS, file.sha256);
    expect(typeof ran === 'string' ? ran : '').toBe('');
    const { outcome } = ran as Exclude<typeof ran, string>;
    const table = tableOf(world, outcome);
    expect(typeof table === 'string' ? table : '', 'the import is done and keeps its table').toBe('');
    const read = readTable((table as Exclude<typeof table, string>).bytes);
    expect(typeof read === 'string' ? read : '').toBe('');
    const t = read as Exclude<typeof read, string>;
    expect([...t.columns].sort(), 'exactly the 3 named columns').toEqual([...COUNTY_COLUMNS].sort());
    const rows = cut(t, COUNTY_COLUMNS);
    expect(typeof rows === 'string' ? rows : '').toBe('');
    expect((rows as string[][]).length, 'of 3,200 rows').toBe(COUNTIES);
    expect(firstDiff(rows as string[][], county.kept), 'the counties, each cell as the file writes it, in the file\'s order').toBe('');

    const receipt = receiptOf(world, outcome);
    expect(typeof receipt === 'string' ? receipt : '').toBe('');
    const r = receipt as Exclude<typeof receipt, string>;
    expect(r['rows_read'], `the receipt's rows read: ${show(r)}`).toBe(ROWS);
    expect(r['rows_kept'], `the receipt's rows kept: ${show(r)}`).toBe(COUNTIES);

    const used = (outcome.value['receipt'] as { used?: { memory_peak_mb?: unknown } } | undefined)?.used;
    const peak = used?.memory_peak_mb;
    expect(typeof peak === 'number' ? '' : `INCONCLUSIVE: the hub's receipt holds no peak the supervisor read for the tool's run (receipt.used.memory_peak_mb): ${show(outcome.value['receipt'], 600)}`).toBe('');
    expect(peak as number, 'a peak the supervisor read is a process\'s, never 0').toBeGreaterThan(0);
    expect(peak as number, 'the job\'s peak memory, in MB, as the supervisor read it').toBeLessThan(128);
  }, TIMEOUT);
});
