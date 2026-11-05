// AC2: A bar chart whose values and labels come from a table fetched by URL passes honest numbers with every label
// and tick traced to that table; the same chart from a table an agent wrote passes in a document with no status
// binding and, with one, fails naming each label's row.
// fixtures/sales.csv (key, region, value; four rows) is served on 127.0.0.1 and imported by `deep-show run`'s
// `table_import`: by URL (the hub fetches it and writes its source) or by path from an agent's session (source
// `agent`). The chart reads the table's columns with `{from: table asset ID, column}`: bars and value labels from
// `value`, region names from `region`, keys from `key`; a y axis over the scale whose domain comes from the column.
// `deep-canvas-render check` with the clean look and the run's evidence store answers the check and, in `numbers`,
// each number shown with what it traces to.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SESSION, TIMEOUT, arr, checked, csvCells, f32Column, fixtureBytes, importedOf, lines, linesAsync, obj, replies, scenario, sha256, shownIssues,
  tableAsset, tracesOf, useBuilds, useServer, useTemp, withStatus, type Checked, type Imported, type JsonObject, type Trace,
} from './helpers.ts';

const builds = useBuilds([{ bin: 'deep-show' }, { bin: 'deep-canvas-render' }]);
const show = (): string => builds.path({ bin: 'deep-show' });
const render = (): string => builds.path({ bin: 'deep-canvas-render' });
const temp = useTemp('honest');
const BYTES = fixtureBytes('sales.csv');
const base = useServer({ 'sales.csv': BYTES });
const url = (): string => `${base()}/sales.csv`;

const CELLS = csvCells(BYTES);
const KEYS = CELLS.slice(1).map((r) => r[0]!.text);
const VALUES = CELLS.slice(1).map((r) => r[2]!);

async function fetched(evidence: string): Promise<Imported> {
  const [out] = await linesAsync(show(), ['run'], [scenario(evidence, [{ call: 'table_import', url: url(), key: 'key' }])]);
  return importedOf(replies(out, 1)[0]!, 'table_import by URL');
}
function written(evidence: string): Imported {
  const dir = join(temp(), 'agent');
  mkdirSync(dir);
  const path = join(dir, 'sales-by-agent.csv');
  writeFileSync(path, BYTES);
  const [out] = lines(show(), ['run'], [scenario(evidence, [{ call: 'table_import', path, key: 'key', session: SESSION }])]);
  return importedOf(replies(out, 1)[0]!, 'table_import of an agent\'s table');
}

const X = [80, 210, 340, 470];
function barChart(sha: string): JsonObject {
  const from = (column: string): JsonObject => ({ from: 'sales', column });
  return {
    format: 1, id: 'chart-sales', profile: 'chart', title: 'Sales by region', description: 'Four regions\' sales as bars, each labelled with its value, over a value axis.',
    size: [640, 360], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    assets: { sales: tableAsset(sha) },
    items: {
      ys: { id: 'ys', kind: 'scale@1', layer: 'main', name: 'Value scale', order: 'a0', params: { type: 'linear', range: [300, 40] } },
      bars: {
        id: 'bars', kind: 'marks@1', layer: 'main', name: 'Bars', order: 'a1',
        params: {
          mark: 'bar', n: 4, key: 'key',
          columns: { key: from('key'), x: f32Column(X), x2: f32Column(X.map((x) => x + 80)), y: from('value') },
          encode: { x: { column: 'x' }, x2: { column: 'x2' }, y: { column: 'y', scale: 'ys' } }, paint: { fill: { role: 'ink' } },
        },
      },
      labels: {
        id: 'labels', kind: 'marks@1', layer: 'main', name: 'Value labels', order: 'a2',
        params: {
          mark: 'text', n: 4, key: 'key',
          columns: { key: from('key'), x: f32Column(X.map((x) => x + 30)), y: from('value'), text: from('value'), size: { const: 14 } },
          encode: { x: { column: 'x' }, y: { column: 'y', scale: 'ys' }, text: { column: 'text' }, size: { column: 'size' } }, paint: { fill: { role: 'ink' } },
        },
      },
      names: {
        id: 'names', kind: 'marks@1', layer: 'main', name: 'Region names', order: 'a3',
        params: {
          mark: 'text', n: 4, key: 'key',
          columns: { key: from('key'), x: f32Column(X.map((x) => x + 10)), y: { const: 330 }, text: from('region'), size: { const: 14 } },
          encode: { x: { column: 'x' }, y: { column: 'y' }, text: { column: 'text' }, size: { column: 'size' } }, paint: { fill: { role: 'ink' } },
        },
      },
      yaxis: { id: 'yaxis', kind: 'axis@1', layer: 'main', name: 'Value axis', order: 'a4', params: { scale: 'ys', side: 'left', at: 48, title: 'Sales' } },
    },
  };
}

function check(doc: JsonObject, evidence: string): Checked {
  const [out] = lines(render(), ['check'], [{ doc, look: 'clean', evidence }]);
  return checked(out, 'check');
}

/** Every value label (one per row) and every tick listed and traced to the table, and nothing traced elsewhere. */
function expectTraced(traces: Trace[], what: string): void {
  const shown = JSON.stringify(traces.map((t) => t.raw)).slice(0, 3000);
  for (const [i, key] of KEYS.entries()) {
    const t = traces.find((x) => x.item === 'labels' && x.row === key);
    expect(t, `${what}: the value label of row ${key} is listed with what it traces to: ${shown}`).toBeDefined();
    expect(t!.text, `${what}: row ${key}'s label shows the table's value`).toBe(VALUES[i]!.text);
    expect(t!.source['table'], `${what}: row ${key}'s label traces to the table`).toBe('sales');
  }
  const ticks = traces.filter((t) => t.item === 'yaxis');
  expect(ticks.length, `${what}: the axis's ticks are listed: ${shown}`).toBeGreaterThan(0);
  expect(traces.filter((t) => t.source['table'] !== 'sales').map((t) => t.raw), `${what}: every label and tick traces to the table`).toEqual([]);
}

describe('AC2 a bar chart from a fetched table passes honest numbers, traced to it; from an agent\'s table it passes only where no status is bound', () => {
  it('AC2 (fetched) a table fetched by URL is a table asset whose source the hub wrote: the URL and its fetch time', async () => {
    const imported = await fetched(temp());
    const a = imported.asset;
    expect(imported.sha256, 'the asset is the fetched bytes by hash').toBe(sha256(BYTES));
    expect(a['kind'], 'a table asset').toBe('table');
    const probe = obj(obj(a['probe'], 'probe')['table'], 'probe.table');
    expect(probe['rows'], 'probed into four rows').toBe(4);
    expect(arr(probe['columns'], 'probe.table.columns').map((c, i) => obj(c, `column ${i}`)['name']), 'its typed columns, named by the header').toEqual(['key', 'region', 'value']);
    expect(probe['key'], 'with its key column').toBe('key');
    const source = obj(a['source'], 'source');
    expect(source['url'], 'its source is the URL the hub fetched').toBe(url());
    expect(source['fetched'] !== undefined && source['fetched'] !== null, 'with the time the hub fetched it').toBe(true);
  }, TIMEOUT);

  it('AC2 (fetched) the chart passes honest numbers with every value label and tick traced to the fetched table, with and without a status binding', async () => {
    const evidence = temp();
    const { sha256: sha } = await fetched(evidence);
    for (const [what, doc] of [['no status bound', barChart(sha)], ['a status bound', withStatus(barChart(sha))]] as const) {
      const c = check(doc, evidence);
      expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `${what}: the chart passes the check, honest numbers included: ${shownIssues(c)}`).toEqual([]);
      expect(c.ok, `${what}: the check passes`).toBe(true);
      expectTraced(tracesOf(c), what);
    }
  }, TIMEOUT);

  it('AC2 (agent) the same chart from a table an agent wrote passes with no status binding and, with one, fails naming each value label\'s row', () => {
    const evidence = join(temp(), 'evidence');
    mkdirSync(evidence);
    const imported = written(evidence);
    expect(imported.asset['source'], 'a table an agent wrote is marked agent, not given a URL').toBe('agent');
    const free = check(barChart(imported.sha256), evidence);
    expect(free.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `no status bound: the chart passes: ${shownIssues(free)}`).toEqual([]);
    expect(free.ok, 'no status bound: the check passes').toBe(true);
    const bound = check(withStatus(barChart(imported.sha256)), evidence);
    expect(bound.ok, `a status bound: the check fails: ${shownIssues(bound)}`).toBe(false);
    for (const key of KEYS) {
      expect(bound.errors.some((e) => e.ids.includes(`labels#${key}`)), `a status bound: an error names the value label's row labels#${key}: ${shownIssues(bound)}`).toBe(true);
    }
  }, TIMEOUT);
});
