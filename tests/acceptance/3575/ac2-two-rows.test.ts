import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AC, AGENT_IMPORT, BOUND, CHECK, FIRST, METRO, READING, TIMEOUT, assetsOf, chart, check, dig, errorsOf, fixture, importTable, label, list, openFiles, openWorld, piece, proof, rowsOf, show, tableRecord, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(await openFiles()); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

describe(`${AC[2]} a file no shown number traces to has no row, and a table an agent wrote adds none`, () => {
  it(`${AC[2]} with the second label removed the list holds two rows; a label of a table an agent wrote adds no row, and its number stays a story number`, async () => {
    const world = must(w, 'a hub with the table import and the table.derive tools');
    const p = must(await piece(world), 'three files fetched after one yes each, imported, and the first two derived into one table');
    const folder = join(world.tmp, 'agent');
    mkdirSync(folder);
    writeFileSync(join(folder, 'visitors.csv'), fixture('agent.csv'));
    const own = must(await importTable(world, { path: join(folder, 'visitors.csv') }, AGENT_IMPORT), 'a table imported from a file the hub fetched none of');
    expect(dig(tableRecord(world, own.sha256), 'source', 'job', 'input', 'file', 0, 'origin'), 'the fixture: that table\'s record names its file as the agent\'s').toBe('agent');
    const items = [FIRST(), label('own', 'own', 'metro', 'visitors', 110), list({ of: 'document', fields: ['title', 'url'], group: 'none' })];
    const assets = { ...assetsOf(p), own: own.sha256 };
    const c = must(check(world, chart(items, assets)), 'deep-canvas-render check answers');
    expect(errorsOf(c), `the piece without its second label, with a label of the agent's table, passes the check, ${CHECK} included`).toEqual([]);
    const rows = must(rowsOf(c), 'the rows the list draws');
    expect(rows.map((r) => r.fields.url), 'two rows, the two files the first label traces to: none for the third file, which no shown number traces to, and none for the agent\'s table').toEqual([p.files.counties.file.url, p.files.crosswalk.file.url]);
    const bound = must(check(world, chart([...items, READING], assets, { bound_values: BOUND })), 'deep-canvas-render check answers with a reading bound');
    proof('ac2-rows-and-story-numbers.json', { rows, with_a_reading_bound: bound.errors });
    const named = (e: { ids?: unknown }): boolean => Array.isArray(e.ids) && (e.ids.includes(`own#${METRO}`) || e.ids.includes('own'));
    expect(bound.errors.some((e) => e.code === 'number_unsourced' && named(e)), `with a reading bound, the agent table's number is still a story number, refused naming its label: ${show(bound.errors, 1500)}`).toBe(true);
    expect(errorsOf({ ...bound, errors: bound.errors.filter((e) => !(e.code === 'number_unsourced' && named(e))) }), 'and nothing else fails: the first label\'s number is sourced, and the list\'s digits are quotation').toEqual([]);
  }, TIMEOUT);
});
