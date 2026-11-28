import { beforeAll, describe, expect, it } from 'vitest';
import { AC, CHECK, FIRST, PLANTED_LIST, SECOND, TIMEOUT, assetsOf, chart, check, errorsOf, failuresOf, list, openFiles, openWorld, piece, proof, rowsOf, show, tells, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(await openFiles()); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

describe(`${AC[7]} ${CHECK} fails a list that leaves a file out`, () => {
  it(`${AC[7]} the planted list ${PLANTED_LIST}, which leaves out every file whose license carries no credit, fails ${CHECK}, naming the first`, async () => {
    const world = must(w, 'a hub with the table import and the table.derive tools');
    const p = must(await piece(world), 'three files fetched after one yes each, imported, and the first two derived into one table');
    expect([p.files.counties, p.files.crosswalk, p.files.population].map((f) => f.file.license.credit === null), 'the fixture: the first file\'s license carries a credit, the second\'s and the third\'s none').toEqual([false, true, true]);
    const doc = chart([FIRST(), SECOND(), list({ of: 'document', fields: ['title', 'license', 'credit', 'url'], group: 'none' })], assetsOf(p));
    const honest = must(check(world, doc), 'deep-canvas-render check answers');
    expect(errorsOf(honest), `the control: the list as shipped passes the check, ${CHECK} included`).toEqual([]);
    expect(must(rowsOf(honest), 'the rows the list draws').length, 'the control: three rows').toBe(3);

    const planted = must(check(world, doc, PLANTED_LIST), `deep-canvas-render check answers with planted: ${PLANTED_LIST}`);
    const failures = failuresOf(planted);
    proof('ac7-planted-list.json', { planted: PLANTED_LIST, errors: planted.errors, sources: planted.raw.sources });
    expect(must(rowsOf(planted), 'the rows the planted list draws').map((r) => r.fields.url), 'the planted list draws the credited file\'s row alone').toEqual([p.files.counties.file.url]);
    expect([planted.ok, failures.length > 0], `the planted list fails ${CHECK}: ${show(planted.errors, 1500)}`).toEqual([false, true]);
    expect(tells(failures[0]!, p.files.crosswalk), `the failure names the first file left out, the second file, by its title, URL or SHA-256: ${show(failures[0], 900)}`).toBe(true);
  }, TIMEOUT);
});
