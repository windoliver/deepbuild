import { beforeAll, describe, expect, it } from 'vitest';
import { AC, CHECK, COLUMN, FIRST, LISTED, METRO, SECOND, SHOWN, TIMEOUT, UNIT, assetsOf, chart, check, errorsOf, holdsWord, list, openFiles, openWorld, piece, proof, rowsOf, show, type Checked, type Files, type Line, type World } from './helpers.ts';

let files: Files;
let w: World | string;
beforeAll(async () => { files = await openFiles(); w = await openWorld(files); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

const ITEMS = (): Line[] => [FIRST({ show: { source: true } }), SECOND(), list({ of: 'document', fields: ['title', 'edition'], group: 'none' })];
function lineOf(c: Checked): string {
  const entry = c.numbers.find((n) => n.item === 'first' && n.text === SHOWN.first);
  expect(entry, `numbers lists the first label's ${SHOWN.first}: ${show(c.numbers, 1500)}`).toBeDefined();
  expect(typeof entry!.line, `the entry of the first label's number holds line, the one line hover or focus shows with show.source (README: The surface under test): ${show(entry, 1200)}`).toBe('string');
  return entry!.line as string;
}

describe(`${AC[3]} a label that reads a table's column shows its source in one line written from the records`, () => {
  it(`${AC[3]} with show.source the first label's line reads the two files' titles and editions, the column's name and unit, the row's key and sum of 4 rows; a second fixture with another edition shows it with no change to the document`, async () => {
    const world = must(w, 'a hub with the table import and the table.derive tools');
    const p = must(await piece(world), 'three files fetched after one yes each, imported, and the first two derived into one table');
    expect(p.unit, `the fixture: the derived table's record gives ${COLUMN} the unit ${UNIT}`).toBe(UNIT);
    const doc = chart(ITEMS(), assetsOf(p));
    const c = must(check(world, doc), 'deep-canvas-render check answers');
    const line = lineOf(c);
    const parts = { 'the first file\'s title': LISTED.counties.title, 'the first file\'s edition': LISTED.counties.edition, 'the second file\'s title': LISTED.crosswalk.title, 'the second file\'s edition': LISTED.crosswalk.edition, 'the column\'s name': COLUMN, 'the column\'s unit': UNIT, 'the row\'s key': METRO, 'the step that wrote the cell with the rows it read': 'sum of 4 rows' };
    expect(Object.entries(parts).filter(([, part]) => !holdsWord(line, part)).map(([what, part]) => `${what}, ${part}`), `the line reads each of them: ${JSON.stringify(line)}`).toEqual([]);
    expect(line.includes('\n'), 'it is one line').toBe(false);
    expect(errorsOf(c), `the piece passes the check, ${CHECK} included`).toEqual([]);

    const other = must(await openWorld(files), 'a second hub in a clean home');
    const q = must(await piece(other, { counties: '2018' }), 'the second fixture: the same three files at the same URLs, the first listed with the edition 2018');
    const again = chart(ITEMS(), assetsOf(q));
    expect(JSON.stringify(again), 'the second fixture\'s document is the first\'s, byte for byte').toBe(JSON.stringify(doc));
    const d = must(check(other, again), 'deep-canvas-render check answers on the second fixture');
    const changed = lineOf(d);
    proof('ac3-source-lines.json', { first: line, second_fixture: changed });
    expect([holdsWord(changed, '2018'), holdsWord(changed, LISTED.counties.edition)], `the line shows the new edition and not the old: ${JSON.stringify(changed)}`).toEqual([true, false]);
    expect(holdsWord(changed, LISTED.crosswalk.edition), 'and the other file\'s edition as before').toBe(true);
    expect(must(rowsOf(d), 'the rows the list draws on the second fixture')[0]?.fields.edition, 'the list\'s row of that file shows the new edition too').toBe('2018');
  }, TIMEOUT);
});
