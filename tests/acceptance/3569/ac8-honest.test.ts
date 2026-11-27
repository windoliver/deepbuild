// #3569.d0a835ea: "A label that shows metro A's 250 passes honest numbers in a document that also binds a reading, and
// its trace lists the two input files with the four county keys. The same job with the county table written by an
// agent yields story numbers, and the label fails, naming the item"
//
// AC1's job, its derived table named in a chart's `assets` by its hash, a text mark set `labels` showing its `workers`
// column, one row per metro keyed by `metro`, and a reading bound into a text of its own (#406's form). The check is
// `deep-canvas-render check` over the hub's evidence store (#397, #406), whose `numbers` lists what each shown number
// traces to. Fetched: both input tables fetched by URL; the check passes, and the entry for labels#A, showing 250,
// holds in its trace both input files' SHA-256 and a list of exactly the county keys 1, 2, 3 and 4; labels#B's holds
// 5 and 6 (README: Readings, the trace). Agent: a second hub, the county table imported from an agent's session (source
// `agent`), the metro table fetched; the same job and document fail with `number_unsourced` naming labels#A (or
// labels), the item that shows the number.
// Wrong programs it fails on: the merge base; a derived table that traces to itself alone, to one input or to every
// county; a job whose output's source is the job's word; one that gives a number the source of its best input.
import { describe, expect, it } from 'vitest';
import { AC, COUNTY_UNITS, METRO, TIMEOUT, byMetro, derive, derivedOf, holds, honest, importTables, keyLists, labelsDoc, openHub, proof, show, shownErrors, type Hub } from './helpers.ts';

const ID = AC[8];

/** AC1's job in a hub on the two tables, its derived table checked in the chart with a reading bound. */
async function charted(hub: Hub | string, county: 'url' | 'agent'): Promise<{ hub: Hub; inputs: Record<string, string>; table: string; checked: Awaited<ReturnType<typeof honest>> } | string> {
  if (typeof hub === 'string') return hub;
  const tables = await importTables(hub, [{ name: 'counties.csv', key: 'county', units: COUNTY_UNITS, by: county }, { name: 'metros.csv', key: METRO.key }]);
  if (typeof tables === 'string') return tables;
  const d = derivedOf(hub, await derive(hub, byMetro({ county: tables.sha['counties.csv']!, metro: tables.sha['metros.csv']! })), 'the join and group by metro');
  if (typeof d === 'string') return d;
  const checked = await honest(hub, labelsDoc(d.outputs.table!, 'metro', 'workers', 2, true));
  return { hub, inputs: tables.sha, table: d.outputs.table!, checked };
}

describe(`${ID} honest numbers follows the lineage to the input files, and a derived table is only as good as its weakest input`, () => {
  it(`${ID} a label that shows metro A's 250 passes honest numbers in a document that binds a reading, its trace listing the two input files with the four county keys`, async () => {
    const got = await charted(await openHub(), 'url');
    expect(typeof got === 'string' ? got : '', 'the derived table from two fetched tables, checked in a chart that binds a reading').toBe('');
    if (typeof got === 'string') return;
    const c = got.checked;
    expect(typeof c === 'string' ? c : '', 'deep-canvas-render check answers').toBe('');
    if (typeof c === 'string') return;
    proof('ac8-fetched.json', { inputs: got.inputs, table: got.table, numbers: c.numbers, issues: c.raw.issues });
    expect(c.errors.map((e) => `${e.code} ${show(e.ids)}`), `the chart passes honest numbers with a reading bound: ${shownErrors(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
    const a = c.numbers.find((n) => n.item === 'labels' && String(n.row) === 'A');
    expect(a, `numbers lists the label of metro A: ${show(c.numbers, 2000)}`).toBeDefined();
    expect(a!.text, 'the label shows 250').toBe('250');
    expect([holds(a!.source, got.inputs['counties.csv']!), holds(a!.source, got.inputs['metros.csv']!)], `its trace lists both input files by SHA-256: ${show(a!.source, 2000)}`).toEqual([true, true]);
    const lists = keyLists(a!.source);
    expect(lists.some((l) => show(l) === show(['1', '2', '3', '4'])), `its trace lists the four county keys 1, 2, 3 and 4: ${show(a!.source, 2000)}`).toBe(true);
    expect(lists.filter((l) => l.includes('5') || l.includes('6')).filter((l) => l.every((k) => /^[1-6]$/.test(k))), 'and no key of metro B').toEqual([]);
    const b = c.numbers.find((n) => n.item === 'labels' && String(n.row) === 'B');
    expect(b && keyLists(b.source).some((l) => show(l) === show(['5', '6'])), `metro B's label traces to counties 5 and 6: ${show(b?.source, 1500)}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} the same job with the county table written by an agent yields story numbers, and the label fails, naming the item`, async () => {
    const got = await charted(await openHub(), 'agent');
    expect(typeof got === 'string' ? got : '', 'the derived table from an agent\'s county table and a fetched metro table, checked in a chart that binds a reading').toBe('');
    if (typeof got === 'string') return;
    const c = got.checked;
    expect(typeof c === 'string' ? c : '', 'deep-canvas-render check answers').toBe('');
    if (typeof c === 'string') return;
    proof('ac8-agent.json', { inputs: got.inputs, table: got.table, numbers: c.numbers, issues: c.raw.issues });
    expect(c.ok, `with a reading bound, the label's story numbers fail the check: ${shownErrors(c)}`).toBe(false);
    const named = c.errors.filter((e) => e.code === 'number_unsourced' && Array.isArray(e.ids) && (e.ids.includes('labels#A') || e.ids.includes('labels')));
    expect(named.length, `a number_unsourced error names the label that shows metro A: ${shownErrors(c)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
