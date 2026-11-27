// AC4 (#3570.c30fc78d): "A workbook of two sheets: the named sheet's 5 rows come in. A cell `=SUM(B2:B5)` with the
// stored value 250 comes in as 250 and `formula_cells` reads 1. The same cell with no stored value is missing. A
// planted reader that evaluates the formula, on a fixture whose cells sum to 260 beside a stored 250, fails
// qualification, naming the cell"
// `sum.xlsx` and `blank.xlsx` are `fixtures.ts`'s: the sheet `Notes` first (7 rows), then `Counties` (5 rows under
// its header; B2:B5 hold 50, 60, 70 and 80, which sum to 260, and B6 holds =SUM(B2:B5), stored as 250 in `sum.xlsx`
// and with no stored value in `blank.xlsx`). The kind's qualification holds `sum.xlsx` byte for byte (README).
import { beforeAll, describe, expect, it } from 'vitest';
import { SHEET, SHEET_ROWS, SUM_CELL, blankXlsx, sumXlsx } from './fixtures.ts';
import { AC, TIMEOUT, cut, fetchAll, firstDiff, openWorld, plant, readTable, receiptOf, runTable, said, show, tableOf, type TableParams, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };
const PARAMS: TableParams = {
  format: 'xlsx', sheet: SHEET,
  columns: { name: { from: 'name', dtype: 'str', unit: 'text' }, pop: { from: 'pop', dtype: 'i64', unit: 'people' } }, key: 'name',
};

describe(`${AC[4]} a workbook's named sheet comes in as the file stores it: a formula's stored value, counted, and never evaluated`, () => {
  it('the named sheet\'s 5 rows come in, B6 as its stored 250 with formula_cells 1; with no stored value B6 is missing', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const fetched = must(await fetchAll(world, { 'sum.xlsx': sumXlsx(), 'blank.xlsx': blankXlsx() }), 'the workbooks fetched once through the Source block');

    const ran = must(await runTable(world, PARAMS, fetched['sum.xlsx']!.sha256), 'a reply');
    const table = must(tableOf(world, ran.outcome), 'the workbook imports');
    const rows = must(cut(must(readTable(table.bytes), 'a table'), ['name', 'pop']), 'its columns');
    expect(firstDiff(rows, SHEET_ROWS), `the sheet ${SHEET}'s 5 rows, ${SUM_CELL} as its stored 250, never the 260 its cells sum to`).toBe('');
    const receipt = must(receiptOf(world, ran.outcome), 'its receipt');
    expect(receipt['formula_cells'], `formula_cells: ${show(receipt)}`).toBe(1);

    const blank = must(await runTable(world, PARAMS, fetched['blank.xlsx']!.sha256), 'a reply');
    const blankTable = must(tableOf(world, blank.outcome), 'the workbook with no stored value imports');
    const blankRows = must(cut(must(readTable(blankTable.bytes), 'a table'), ['name', 'pop']), 'its columns');
    expect(firstDiff(blankRows, [...SHEET_ROWS.slice(0, 4), ['Total', null]]), `${SUM_CELL} with no stored value is missing, never 0 or 260`).toBe('');
  }, TIMEOUT);

  it('planted evaluates_formulas: runs-as-is qualifies and is listed; the reader that evaluates the formula fails the kind\'s qualification naming the cell, and isn\'t listed', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const p = await plant(world, 'evaluates_formulas');
    expect(p.problem).toBe('');
    expect(p.control?.code, `the right reader through the planted entry installs: ${said(p.control!).slice(-800)}`).toBe(0);
    expect(p.controlListed, 'and deep_job lists it').toBe(true);
    const text = said(p.install!);
    expect(p.install?.code, `the planted reader is refused at install: ${text.slice(-800)}`).not.toBe(0);
    expect(/\bB6\b/.test(text) || (text.includes('Total') && text.includes('pop')), `the refusal names the cell, ${SUM_CELL} (or its row Total and column pop): ${text.slice(-1200)}`).toBe(true);
    expect(p.listed, 'and deep_job doesn\'t list it').not.toContain(p.tool);
  }, TIMEOUT);
});
