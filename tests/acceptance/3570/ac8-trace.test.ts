// AC8 (#3570.112c972a): "A label that shows one cell of the imported table passes honest numbers in a document that
// binds a reading, and its trace names the fetched file's URL and fetch time. The import run on two machines writes
// byte-identical tables."
// `labels.csv` is `fixtures.ts`'s; the import keeps one row by `where … in` (Los Angeles, 10014009). The label is a
// text mark set reading that row's POP from the table asset by hash; the document binds a reading into a text of its
// own (#406's form). `deep-canvas-render check` (#397's surface) reads the table from the hub's evidence store and
// answers the check and, in `numbers`, what each shown number traces to. Two machines (README): the Mac pair in two
// clean homes, then this Mac and a Linux aarch64 host, which reads INCONCLUSIVE when none is given.
import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { LABEL_GEO, LABEL_POP, labelsCsv } from './fixtures.ts';
import {
  AC, TIMEOUT, check, cut, fetchAll, fetchedTimes, linuxHost, openWorld, readTable, remoteTable, runTable, show, tableOf, type Fetched, type Line, type TableParams, type World,
} from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };
const PARAMS: TableParams = {
  columns: { GEO_ID: { from: 'GEO_ID', dtype: 'str', unit: 'text' }, NAME: { from: 'NAME', dtype: 'str', unit: 'text' }, POP: { from: 'POP', dtype: 'i64', unit: 'people' } },
  key: 'GEO_ID', where: [{ column: 'GEO_ID', in: [LABEL_GEO] }],
};

/** One machine's import: the file fetched through its hub's Source block, imported, its one row checked; the table and the fetch. */
async function importOn(world: World): Promise<{ sha256: string; bytes: Buffer; file: Fetched }> {
  const fetched = must(await fetchAll(world, { 'labels.csv': labelsCsv() }), 'the file fetched once through the Source block');
  const file = fetched['labels.csv']!;
  const ran = must(await runTable(world, PARAMS, file.sha256), 'a reply');
  const table = must(tableOf(world, ran.outcome), 'the import is done');
  const rows = must(cut(must(readTable(table.bytes), 'a table'), ['GEO_ID', 'POP']), 'its columns');
  expect(rows, 'the one row where keeps').toEqual([[LABEL_GEO, LABEL_POP]]);
  return { ...table, file };
}
let first: Promise<{ sha256: string; bytes: Buffer; file: Fetched }> | undefined;
const imported = (world: World) => (first ??= importOn(world));

const f32Column = (values: number[]): Line => {
  const b = Buffer.alloc(4 * values.length);
  values.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return { dtype: 'f32', len: values.length, data: b.toString('base64') };
};
/** The document: one label showing the table's one POP cell, and a reading bound into a text of its own. */
function labelDoc(sha: string): Line {
  const from = (column: string): Line => ({ from: 'pop', column });
  return {
    format: 1, id: 'chart-county-pop', profile: 'chart', title: 'Population of one county', description: 'One label showing a county\'s population from a published table, beside a bound reading.',
    size: [640, 360], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    assets: { pop: { sha256: sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' } } },
    items: {
      label: {
        id: 'label', kind: 'marks@1', layer: 'main', name: 'Population label', order: 'a1',
        params: {
          mark: 'text', n: 1, key: 'key',
          columns: { key: from('GEO_ID'), x: f32Column([80]), y: { const: 100 }, text: from('POP'), size: { const: 14 } },
          encode: { x: { column: 'x' }, y: { column: 'y' }, text: { column: 'text' }, size: { column: 'size' } }, paint: { fill: { role: 'ink' } },
        },
      },
      reading: { id: 'reading', kind: 'text@1', layer: 'main', name: 'reading', order: 'a2', at: { pos: [24, 200, 0] }, params: { font: 'body', size: 20, text: '' } },
    },
    bound_values: { 'reading-value': { target: 'items/reading/params/text', source: 'reading:01JB3570000000000000000002' } },
  };
}

describe(`${AC[8]} a label from an imported table passes honest numbers where a reading is bound, traced to the fetched file's URL and fetch time; two machines write the same table`, () => {
  it('one machine: imports the fetched file to a table of one row', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const t = await imported(world);
    // The other machine's leg (README: Two machines) hands its table hash back in the file DEEP_3570_LEG names.
    const leg = process.env['DEEP_3570_LEG'];
    if (leg) writeFileSync(leg, `#3570 table sha256 ${t.sha256}\n`);
  }, TIMEOUT);

  it('the label passes honest numbers in a document that binds a reading, its trace naming the fetched file\'s URL and fetch time', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const t = await imported(world);
    const reply = must(check(world, labelDoc(t.sha256)), 'the check answers');
    const issues = (Array.isArray(reply['issues']) ? reply['issues'] : []) as Line[];
    const errors = issues.filter((i) => i['severity'] === 'error').map((i) => `${String(i['code'])} ${show(i['ids'], 80)}`);
    expect(errors, `the document passes the check, honest numbers included: ${show(issues, 1500)}`).toEqual([]);
    expect(reply['ok'], 'the check passes').toBe(true);
    const numbers = (Array.isArray(reply['numbers']) ? reply['numbers'] : []) as Line[];
    const shown = numbers.find((n) => n['item'] === 'label' && n['text'] === LABEL_POP);
    expect(shown, `the label's ${LABEL_POP} is listed with what it traces to: ${show(numbers, 1500)}`).toBeDefined();
    const source = shown!['source'];
    expect(JSON.stringify(source), `its trace names the fetched file's URL, ${t.file.url}`).toContain(JSON.stringify(t.file.url).slice(1, -1));
    const times = fetchedTimes(source);
    expect(times.some((at) => at >= t.file.asked - 1000 && at <= t.file.landed + 1000), `its trace names the fetch time, between your yes (${t.file.asked}) and the fetch landing (${t.file.landed}): ${show(source, 1500)}`).toBe(true);
  }, TIMEOUT);

  it('two machines, first leg: the Mac pair, a second hub in a clean home, writes a byte-identical table', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const t = await imported(world);
    const other = must(await openWorld(), 'a second hub in a clean home');
    const u = await importOn(other);
    expect(u.sha256, 'the same table hash').toBe(t.sha256);
    expect(u.bytes.equals(t.bytes), 'byte-identical tables').toBe(true);
  }, TIMEOUT);

  it('two machines: this Mac and a Linux aarch64 host write byte-identical tables', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const t = await imported(world);
    const host = must(linuxHost(), 'a second machine');
    expect(remoteTable(host), `the table the other machine writes, from ${host.host}`).toBe(t.sha256);
  }, TIMEOUT);
});
