// AC5: A CSV fetched by URL, with CRLF row ends, whose label column holds Q3 Café with a decomposed é keeps each cell's
// raw bytes unchanged, draws the label with one NFC é, and passes honest numbers with the 3 traced to its row by raw
// byte range, while a planted probe that stores the cell normalized fails the comparison with the file's bytes, naming
// the row.
// fixtures/menu-crlf.csv is written as bytes: `key,value,label` rows ending CR LF, label last (so each label cell ends
// right before a CR), and row 3's label `Q3 Cafe` + U+0301 (65 CC 81). It is served on 127.0.0.1 and imported by
// `deep-show run`'s `table_import` by URL; one `marks@1` text set `labels` reads the label column. The cells' byte
// ranges are computed here from the file. `deep-canvas-render check` (with the run's evidence store) answers the check
// and its `numbers`; `raster` answers what each text row shows (`texts`, #381's, keyed `<set>#<row key>` for a mark
// set's rows). The planted probe is the scenario's `planted: "probe_stores_normalized"`.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, arr, checked, csvCells, f32Column, fixtureBytes, importedOf, lines, linesAsync, num, obj, replies, scenario, sha256, shownIssues, str,
  tableAsset, tracesOf, useBuilds, useServer, useTemp, type Checked, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([{ bin: 'deep-show' }, { bin: 'deep-canvas-render' }]);
const show = (): string => builds.path({ bin: 'deep-show' });
const render = (): string => builds.path({ bin: 'deep-canvas-render' });
const temp = useTemp('crlf');
const BYTES = fixtureBytes('menu-crlf.csv');
const base = useServer({ 'menu-crlf.csv': BYTES });
const url = (): string => `${base()}/menu-crlf.csv`;

const ROWS = csvCells(BYTES).slice(1);
const KEYS = ROWS.map((r) => r[0]!.text);
const LABELS = ROWS.map((r) => r[2]!);
const CAFE_NFD = 'Q3 Café';
const CAFE_NFC = 'Q3 Café';

async function fetched(evidence: string, planted?: string): Promise<string> {
  const [out] = await linesAsync(show(), ['run'], [scenario(evidence, [{ call: 'table_import', url: url(), key: 'key' }], planted ? { planted } : {})]);
  const imported = importedOf(replies(out, 1)[0]!, 'table_import by URL');
  expect(imported.sha256, 'the asset is the fetched bytes by hash').toBe(sha256(BYTES));
  return imported.sha256;
}

function menu(sha: string): JsonObject {
  return {
    format: 1, id: 'chart-menu', profile: 'chart', title: 'Menu', description: 'Four menu labels read from a table fetched by URL.',
    size: [400, 200], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    assets: { menu: tableAsset(sha) },
    items: {
      labels: {
        id: 'labels', kind: 'marks@1', layer: 'main', name: 'Labels', order: 'a0',
        params: {
          mark: 'text', n: 4, key: 'key',
          columns: { key: { from: 'menu', column: 'key' }, x: { const: 24 }, y: f32Column([40, 80, 120, 160]), text: { from: 'menu', column: 'label' }, size: { const: 16 } },
          encode: { x: { column: 'x' }, y: { column: 'y' }, text: { column: 'text' }, size: { column: 'size' } }, paint: { fill: { role: 'ink' } },
        },
      },
    },
  };
}

function check(doc: JsonObject, evidence: string): Checked {
  const [out] = lines(render(), ['check'], [{ doc, look: 'clean', evidence }]);
  return checked(out, 'check');
}

describe('AC5 a CRLF table with a decomposed é keeps raw bytes, draws NFC, and traces its numbers by raw byte range', () => {
  it('AC5 (raw bytes) each label cell keeps its raw bytes and their range in the file: the decomposed é and no CR', async () => {
    expect(LABELS[2]!.text, 'the fixture\'s row 3 label is Q3 Café with a decomposed é').toBe(CAFE_NFD);
    expect(BYTES.includes(Buffer.from('\r\n')), 'the fixture\'s rows end in CR LF').toBe(true);
    const evidence = temp();
    const c = check(menu(await fetched(evidence)), evidence);
    const traces = tracesOf(c);
    for (const [i, key] of KEYS.entries()) {
      const cell = LABELS[i]!;
      const t = traces.find((x) => x.item === 'labels' && x.row === key);
      expect(t, `row ${key}'s label (it holds a digit) is listed with what it traces to: ${JSON.stringify(traces.map((x) => x.raw)).slice(0, 2000)}`).toBeDefined();
      expect([t!.source['table'], t!.source['column'], t!.source['row']], `row ${key}'s label traces to the menu table's label cell in data row ${i}`).toEqual(['menu', 'label', i]);
      expect(t!.source['bytes'], `row ${key}'s cell keeps its byte range in the file, the CR LF outside it`).toEqual([cell.start, cell.end]);
      const raw = Buffer.from(str(t!.source['raw'], `row ${key}: source.raw`), 'base64');
      expect(raw.equals(BYTES.subarray(cell.start, cell.end)), `row ${key}'s cell keeps the file's bytes unchanged: ${raw.toString('hex')} against ${BYTES.subarray(cell.start, cell.end).toString('hex')}`).toBe(true);
    }
  }, TIMEOUT);

  it('AC5 (NFC) the label draws its display form, NFC, with one é', async () => {
    const evidence = temp();
    const out = `${temp()}/menu.png`;
    const [answer] = lines(render(), ['raster'], [{ out, doc: menu(await fetched(evidence)), look: 'clean', evidence }]);
    const a = obj(answer, 'raster');
    expect(a['ok'], `raster draws the labels: ${JSON.stringify(a).slice(0, 1500)}`).toBe(true);
    const row = obj(obj(a['texts'], 'raster: texts')['labels#3'], 'raster: texts["labels#3"]');
    const shown = str(row['shown'], 'texts["labels#3"].shown');
    expect(shown, 'the label shows Q3 Café in NFC: one precomposed é (U+00E9), no combining acute').toBe(CAFE_NFC);
    const glyphs = arr(row['glyphs'], 'texts["labels#3"].glyphs').map((g) => obj(g, 'glyph'));
    const e = glyphs.filter((g) => num(g['grapheme'], 'glyph.grapheme') === [...CAFE_NFC].length - 1);
    expect(e.length, 'the é is drawn as one glyph').toBe(1);
  }, TIMEOUT);

  it('AC5 (trace) the chart passes honest numbers with the 3 of Q3 Café traced to its row by the cell\'s raw byte range', async () => {
    const evidence = temp();
    const c = check(menu(await fetched(evidence)), evidence);
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the labels pass the check, honest numbers included: ${shownIssues(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
    const cell = LABELS[2]!;
    const three = tracesOf(c).filter((t) => t.item === 'labels' && t.row === '3' && t.text === '3');
    expect(three.length, `the 3 in Q3 Café is listed once: ${JSON.stringify(tracesOf(c).map((t) => t.raw)).slice(0, 2000)}`).toBe(1);
    expect([three[0]!.source['table'], three[0]!.source['row']], 'the 3 traces to the menu table\'s data row 2 (key 3)').toEqual(['menu', 2]);
    expect(three[0]!.source['bytes'], 'by the raw byte range of its cell in the file').toEqual([cell.start, cell.end]);
  }, TIMEOUT);

  it('AC5 (planted) a probe that stores the cell normalized fails the comparison with the file\'s bytes, naming the row', async () => {
    const evidence = temp();
    const c = check(menu(await fetched(evidence, 'probe_stores_normalized')), evidence);
    expect(c.ok, `the check fails: ${shownIssues(c)}`).toBe(false);
    expect(c.errors.some((e) => e.ids.includes('labels#3')), `an error names row 3 (labels#3): ${shownIssues(c)}`).toBe(true);
    for (const key of ['1', '2', '4']) {
      expect(c.errors.some((e) => e.ids.includes(`labels#${key}`)), `no error names row ${key}, whose ASCII cell normalizes to itself`).toBe(false);
    }
  }, TIMEOUT);
});
