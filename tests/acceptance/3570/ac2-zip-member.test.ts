// AC2 (#3570.dabc4318): "The same file as one of two members of a zip imports to the same table hash. Naming the other
// member writes the other table, and its hash is in the receipt. A planted reader that takes the archive's first member
// whatever `member` says fails qualification"
// The zip is `fixtures.ts`'s `twoMembers()`: `a/towns.txt` first, then criterion 1's file as `data/county.txt`. Both
// the zip and the plain file are fetched through the Source block, and each import is given its fetched file by hash.
import { beforeAll, describe, expect, it } from 'vitest';
import { countyFile, sha256, townsFile, twoMembers } from './fixtures.ts';
import { AC, COUNTY_COLUMNS, COUNTY_PARAMS, TIMEOUT, cut, fetchAll, firstDiff, openWorld, plant, readTable, receiptOf, runTable, said, show, tableOf, type Outcome, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

describe(`${AC[2]} a zip's member by its path: the same table as the file alone, the other member's table and hash, and a planted first-member reader refused`, () => {
  it('the county file as the zip\'s second member imports to the plain file\'s table hash; naming the first member writes its table, its path, hash and size in the receipt', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const county = countyFile();
    const towns = townsFile();
    const fetched = must(await fetchAll(world, { 'county.txt': county.bytes, 'two-members.zip': twoMembers(county.bytes) }), 'the files fetched once through the Source block');
    const run = async (sha: string, member?: string): Promise<Outcome> => must(await runTable(world, member === undefined ? COUNTY_PARAMS : { ...COUNTY_PARAMS, member }, sha), 'a reply').outcome;

    const plain = must(tableOf(world, await run(fetched['county.txt']!.sha256)), 'the plain file imports');
    const inZip = await run(fetched['two-members.zip']!.sha256, 'data/county.txt');
    const zipped = must(tableOf(world, inZip), 'the zip\'s member data/county.txt imports');
    expect(zipped.sha256, 'the same file as a zip\'s member imports to the same table hash').toBe(plain.sha256);
    const r1 = must(receiptOf(world, inZip), 'its receipt');
    expect(r1['member'], `the receipt names the member it read: ${show(r1)}`).toMatchObject({ path: 'data/county.txt', sha256: county.sha256, bytes: county.bytes.length });

    const other = await run(fetched['two-members.zip']!.sha256, 'a/towns.txt');
    const otherTable = must(tableOf(world, other), 'the zip\'s member a/towns.txt imports');
    expect(otherTable.sha256, 'naming the other member writes another table').not.toBe(plain.sha256);
    const read = must(readTable(otherTable.bytes), 'a table');
    const rows = must(cut(read, COUNTY_COLUMNS), 'its columns');
    expect(firstDiff(rows, towns.kept), 'the other member\'s counties').toBe('');
    const r2 = must(receiptOf(world, other), 'its receipt');
    expect(r2['member'], `the other member's path, hash and size in the receipt: ${show(r2)}`).toMatchObject({ path: 'a/towns.txt', sha256: sha256(towns.bytes), bytes: towns.bytes.length });
  }, TIMEOUT);

  it('planted takes_first_member: runs-as-is qualifies and is listed; the reader that takes the first member whatever member says fails the kind\'s qualification and isn\'t listed', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const p = await plant(world, 'takes_first_member');
    expect(p.problem).toBe('');
    expect(p.control?.code, `the right reader through the planted entry installs: ${said(p.control!).slice(-800)}`).toBe(0);
    expect(p.controlListed, 'and deep_job lists it').toBe(true);
    expect(p.install?.code, `the planted reader is refused at install: ${said(p.install!).slice(-800)}`).not.toBe(0);
    expect(p.listed, 'and deep_job doesn\'t list it').not.toContain(p.tool);
  }, TIMEOUT);
});
