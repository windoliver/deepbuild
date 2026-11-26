// One complete, well-formed spike in this suite's formats (README.md, "The surface under test"), built in memory for
// validate.test.mjs, which writes it into a temporary folder, passes it through every check and then through each
// planted wrong copy. It doubles as the formats' worked example. Its scripts are made up. Its outputs under today's
// order and the changed one are what the package's `simulate` at `main` gives for them, since that is what a kept
// output is held to; its starts under the hub's order are made up, and so are its follow-up and its words.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cellOf, expectedRows, ORDERS, OTHERS, PERSON, POOLS, REPORT_COLUMNS, sha256, SLOW_MS, SPIKE } from './validate.mjs';

const MIN = 60_000;
const check = (id, ms, on_base = 'passes') => ({ id, on_base, inputs: ['src/**'], expected_ms: ms, took_ms: ms });
const slow = () => SLOW_MS.map((ms) => check(`check-${ms / MIN}m`, ms));
/** One turn: the prompt that opens it, and the stop that ends it on a snapshot of its own. */
const turn = (id, n, origin, promptAt, stopAt) => [{ at: promptAt, kind: 'prompt', origin }, { at: stopAt, kind: 'stop', snapshot: `${id}-${n}`, changed: [`src/${id}.ts`] }];

/** The session a person is at: three turns the person opened, each ending in a stop, half an hour apart. */
export const person = () => ({ id: 'person', checks: slow(), events: [...turn('person', 1, PERSON, 0, 2 * MIN), ...turn('person', 2, PERSON, 30 * MIN, 31 * MIN), ...turn('person', 3, PERSON, 60 * MIN, 61 * MIN)] });
/** A session nobody is typing in: two turns a schedule opened, each ending in a stop. */
export const other = (k) => ({ id: `other-${k}`, checks: slow(), events: [...turn(`other-${k}`, 1, 'scheduled', k * 1000, MIN + k * 1000), ...turn(`other-${k}`, 2, 'scheduled', 40 * MIN + k * 1000, 41 * MIN + k * 1000)] });
/** A script of the table: the person's session alone (`others` 0) or beside that many others, on a pool. */
export const tableScript = (others, pool) => ({ config: { slots: pool }, sessions: [person(), ...Array.from({ length: others }, (_, i) => other(i + 1))] });
/** The script in which the person's session never stops: it edits, and three others stop beside it on two slots. */
export const neverStopsScript = () => ({ config: { slots: 2 }, sessions: [{ id: 'person', checks: slow(), events: [{ at: 0, kind: 'prompt', origin: PERSON }, { at: 30_000, kind: 'edit', snapshot: 'person-e', changed: ['src/person.ts'] }] }, other(1), other(2), other(3)] });
/** The one script for the two orders: on one slot, `a2` waits behind `a1` when `b1`, a check that fails on the base, is queued. */
export const ordersScript = () => ({ config: { slots: 1 }, sessions: [
  { id: 'a', checks: [check('a1', 5 * MIN), check('a2', 5 * MIN)], events: turn('a', 1, PERSON, 0, 1000) },
  { id: 'b', checks: [check('b1', MIN, 'fails')], events: turn('b', 1, PERSON, 0, 2000) },
] });

const seconds = (ms) => (ms === null ? '-' : String(ms / 1000));
const title = (column) => column[0].toUpperCase() + column.slice(1);
const rowOf = (cells) => `| ${cells.join(' | ')} |`;
/** The report's table for one order, from the record's own table. */
export function tableText(record, order) {
  const columns = Object.entries(REPORT_COLUMNS[order]);
  const head = ['Order', 'Others', 'Pool', ...columns.map(([name]) => title(name))];
  return [rowOf(head), rowOf(head.map(() => '---')), ...record.table.map((row) => rowOf([`\`${order}\``, row.others, row.pool, ...columns.map(([, of]) => seconds(of(row[order])))]))].join('\n');
}
/** The report's table of the places that start at a different time under the hub's order. */
export function startsText(record) {
  const head = ['Session', 'Check', 'Snapshot', 'Package start s', 'Hub start s'];
  return [rowOf(head), rowOf(head.map(() => '---')), ...record.orders.differs.map((d) => rowOf([`\`${d.session}\``, `\`${d.check}\``, `\`${d.snapshot}\``, seconds(d.package), seconds(d.hub)]))].join('\n');
}
/** The report, docs/spikes/3539/README.md, from the record. */
export function reportText(record) {
  return [
    '# What a session with a person at it waits behind other sessions\' slow checks',
    '',
    'An example in the formats of the #3539 acceptance suite. Every time is on the scripts\' virtual clock.',
    '',
    '## The table, under today\'s order',
    '',
    tableText(record, 'today'),
    '',
    '## The same table under the changed order',
    '',
    tableText(record, 'person-first'),
    '',
    '## The hub\'s order and the package\'s on one script',
    '',
    record.orders.differs.length ? startsText(record) : 'No place starts at a different time.',
    '',
    '## What follows',
    '',
    record.followUp ? `Filed as #${record.followUp.issue}: ${record.followUp.title}.` : record.stays,
    '',
  ].join('\n');
}

/**
 * The example spike: `record`, and `files`, the text of each kept file and of the report by its path in the spike
 * folder. `writeSpike` writes them with the record.
 */
export function buildExample({ main, simulate }) {
  const files = {};
  const keep = (path, value) => { files[path] = `${JSON.stringify(value, null, 2)}\n`; return sha256(files[path]); };
  const rowsFor = (script, order, name) => {
    const { rows, problems } = expectedRows(simulate, script, order, name);
    if (problems.length) throw Error(problems.join('\n'));
    return rows;
  };
  /** A script kept with its output under each of `orders`. */
  const run = (name, script, orders = ORDERS) => {
    const entry = { script: `scripts/${name}.json`, sha256: keep(`scripts/${name}.json`, script) };
    const rows = {};
    for (const order of orders) {
      rows[order] = rowsFor(script, order, name);
      const out = `out/${name}.${order}.json`;
      entry[order] = { out, sha256: keep(out, { script_sha256: entry.sha256, order, ...rows[order] }) };
    }
    return { entry, rows };
  };
  const record = { main, runs: [], table: [] };
  const read = new Map();
  for (const pool of POOLS) for (const others of [0, ...OTHERS]) {
    const { entry, rows } = run(others ? `beside-${others}-pool-${pool}` : `alone-pool-${pool}`, tableScript(others, pool));
    record.runs.push({ others, pool, ...entry });
    for (const order of ORDERS) read.set(`${order}/${others}/${pool}`, { person: 'person', rows: rows[order] });
  }
  for (const others of OTHERS) for (const pool of POOLS) {
    const cell = (order) => cellOf(read.get(`${order}/0/${pool}`), read.get(`${order}/${others}/${pool}`));
    const { alone, beside } = cell('today');
    record.table.push({ others, pool, today: { alone, beside }, 'person-first': cell('person-first') });
  }
  record.neverStops = run('never-stops', neverStopsScript()).entry;
  // The one script under the package's order, as `simulate` gives it, and under the hub's: made-up starts, in which
  // the hub starts `a2`, placed first, before `b1`.
  const orders = run('orders', ordersScript(), ['today']);
  const hub = [['a', 'a1', 'a-1', 1000], ['a', 'a2', 'a-1', 301_000], ['b', 'b1', 'b-1', 601_000]].map(([session, check, snapshot, started_at]) => ({ session, check, snapshot, started_at }));
  const starts = new Map(orders.rows.today.places.map((p) => [`${p.session}/${p.check}/${p.snapshot}`, p.started_at]));
  record.orders = {
    script: orders.entry.script, sha256: orders.entry.sha256, package: orders.entry.today,
    hub: { out: 'out/orders.hub.json', sha256: keep('out/orders.hub.json', { script_sha256: orders.entry.sha256, order: 'hub', places: hub }) },
    differs: hub.filter((p) => starts.get(`${p.session}/${p.check}/${p.snapshot}`) !== p.started_at).map((p) => ({ session: p.session, check: p.check, snapshot: p.snapshot, package: starts.get(`${p.session}/${p.check}/${p.snapshot}`) ?? null, hub: p.started_at })),
  };
  record.followUp = { issue: 3601, title: 'The slow lane starts a place whose turn a person opened before the others', criteria: ['- [ ] A place whose turn a person opened starts before every queued place whose turn nobody typed'] };
  files['README.md'] = reportText(record);
  return { record, files };
}

/** Writes a spike into `dir`, a folder standing for the checkout: docs/spikes/3539/ with its record, report and kept files; a file whose text is null is left out. */
export function writeSpike(dir, { record, files }) {
  const all = { ...files, 'record.json': `${JSON.stringify(record, null, 2)}\n` };
  for (const [path, text] of Object.entries(all)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, SPIKE, path)), { recursive: true });
    writeFileSync(join(dir, SPIKE, path), text);
  }
}
