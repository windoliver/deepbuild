#!/usr/bin/env node
// #3539: reads the kept scripts (scripts/) and the harness's kept outputs (out/), as run.mjs left them, and works out
// the spike's readings from their rows alone:
//
//   node docs/spikes/3539/analyze.mjs    writes record.json and the tables of README.md, each between its
//                                        `<!-- name -->` and `<!-- /name -->` lines
//
// A place's wait for a slot is its start less the time it took its place; a green stop's time to a verdict is its
// verdict's time less the stop's. A median and a 95th percentile are by nearest rank: the smallest sample with at
// least that share of the samples at or below it. The record's times are ms on the scripts' clock, the report's seconds.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, kept, REPO } from './load.mjs';
import { OTHERS, PERSON, POOLS, tableName } from './scripts.mjs';

const ORDERS = ['today', 'person-first'];
const sha256 = (path) => createHash('sha256').update(readFileSync(join(HERE, path))).digest('hex');
const cite = (kind, path) => ({ [kind]: path, sha256: sha256(path) });
const read = (path) => JSON.parse(readFileSync(join(HERE, path), 'utf8'));
/** A script kept with its output under each order, each cited by its path here and its sha256. */
function run(name, orders) {
  const entry = cite('script', `scripts/${name}.json`);
  const rows = {};
  for (const [field, order] of Object.entries(orders)) {
    entry[field] = cite('out', `out/${name}.${order}.json`);
    rows[field] = read(entry[field].out);
    if (rows[field].script_sha256 !== entry.sha256 || rows[field].order !== order) throw Error(`${entry[field].out} is not the output of ${entry.script} under ${order}: run.mjs first`);
  }
  return { entry, rows };
}

const percentile = (samples, p) => { const sorted = [...samples].sort((a, b) => a - b); return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null; };
const waitOf = (place) => (place.started_at === null ? null : place.started_at - place.queued_at);
function waitsOf(places) {
  const waits = places.map(waitOf).filter((wait) => wait !== null);
  return { n: waits.length, unstarted: places.length - waits.length, p50: percentile(waits, 0.5), p95: percentile(waits, 0.95) };
}
/** One session's reading in a run: its places' waits for a slot, and its green stops' times to a verdict. */
function readingOf(rows, session) {
  const stops = rows.stops.filter((s) => s.session === session);
  const times = stops.filter((s) => s.verdict_at !== null).map((s) => s.verdict_at - s.at);
  return { wait: waitsOf(rows.places.filter((p) => p.session === session)), verdict: { n: times.length, none: stops.length - times.length, p50: percentile(times, 0.5), p95: percentile(times, 0.95) } };
}
/** The place that waited longest of those that started, the person's or another's. */
function longestOf(rows) {
  let longest = null;
  for (const p of rows.places) { const wait = waitOf(p); if (wait !== null && (longest === null || wait > longest.wait)) longest = { session: p.session, check: p.check, snapshot: p.snapshot, wait }; }
  return longest;
}

// ---- The table: the person's session alone and beside 1, 3 and 6 others, on each pool, under each order.
const ALL = Object.fromEntries(ORDERS.map((order) => [order, order]));
const runs = new Map(POOLS.flatMap((pool) => [0, ...OTHERS].map((others) => [`${others}/${pool}`, run(tableName(others, pool), ALL)])));
const cell = (others, pool, order) => {
  const beside = runs.get(`${others}/${pool}`).rows[order];
  return { alone: readingOf(runs.get(`0/${pool}`).rows[order], PERSON), beside: readingOf(beside, PERSON), others: waitsOf(beside.places.filter((p) => p.session !== PERSON)), longest: longestOf(beside) };
};
const table = OTHERS.flatMap((others) => POOLS.map((pool) => ({ others, pool, ...Object.fromEntries(ORDERS.map((order) => [order, cell(others, pool, order)])) })));

// ---- The script in which the person's session never stops, under both orders.
const never = run('never-stops', ALL);
const same = JSON.stringify([never.rows.today.places, never.rows.today.stops]) === JSON.stringify([never.rows['person-first'].places, never.rows['person-first'].stops]);

// ---- The one script under the package's order and the hub's: every place whose start is not the same under both.
const orders = run('orders', { package: 'today', hub: 'hub' });
const key = (p) => `${p.session}\0${p.check}\0${p.snapshot}`;
const hub = new Map(orders.rows.hub.places.map((p) => [key(p), p]));
const differs = orders.rows.package.places.filter((p) => p.started_at !== hub.get(key(p)).started_at).map((p) => ({ session: p.session, check: p.check, snapshot: p.snapshot, package: p.started_at, hub: hub.get(key(p)).started_at }));

// ---- The record. What follows the readings, a follow-up filed or why the order stays, is tasks.json's, kept by hand.
const tasks = existsSync(join(HERE, 'tasks.json')) ? read('tasks.json') : {};
const record = {
  main: execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim(),
  runs: POOLS.flatMap((pool) => [0, ...OTHERS].map((others) => ({ others, pool, ...runs.get(`${others}/${pool}`).entry }))),
  table,
  neverStops: { ...never.entry, same, places: never.rows.today.places.length, waited: never.rows.today.places.filter((p) => waitOf(p) > 0).length, stops: never.rows.today.stops.length },
  orders: { ...orders.entry, differs, stops: orders.rows.hub.stops.map((s) => ({ session: s.session, stop: s.stop, opened_by: s.opened_by, at: s.at, turn_end_returned_at: s.turn_end_returned_at })) },
  ...tasks,
};
writeFileSync(join(HERE, 'record.json'), `${kept(record)}\n`);

// ---- The report's tables, in seconds.
const s = (ms) => (ms === null ? '-' : String(ms / 1000));
const row = (cells) => `| ${cells.join(' | ')} |`;
const tableOf = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
const each = (cells) => POOLS.flatMap((pool) => OTHERS.flatMap((others) => ORDERS.map((order) => { const c = table.find((r) => r.others === others && r.pool === pool)[order]; return [`\`${order}\``, others, pool, ...cells(c)]; })));
const blocks = {
  waits: tableOf(
    ['Order', 'Others', 'Pool', 'Wait p50 alone s', 'Wait p95 alone s', 'Wait p50 beside s', 'Wait p95 beside s', 'Places started beside', 'Others wait p50 s', 'Others wait p95 s', 'Others started', 'Longest wait s'],
    each((c) => [s(c.alone.wait.p50), s(c.alone.wait.p95), s(c.beside.wait.p50), s(c.beside.wait.p95), `${c.beside.wait.n} of ${c.beside.wait.n + c.beside.wait.unstarted}`, s(c.others.p50), s(c.others.p95), `${c.others.n} of ${c.others.n + c.others.unstarted}`, s(c.longest?.wait ?? null)]),
  ),
  verdicts: tableOf(
    ['Order', 'Others', 'Pool', 'Verdict p50 alone s', 'Verdict p95 alone s', 'Verdict p50 beside s', 'Verdict p95 beside s', 'Stops with a verdict beside'],
    each((c) => [s(c.alone.verdict.p50), s(c.alone.verdict.p95), s(c.beside.verdict.p50), s(c.beside.verdict.p95), `${c.beside.verdict.n} of ${c.beside.verdict.n + c.beside.verdict.none}`]),
  ),
  starts: tableOf(
    ['Session', 'Check', 'Snapshot', 'Queued s', 'Package start s', 'Hub handed s', 'Hub start s'],
    differs.map((d) => { const p = orders.rows.package.places.find((x) => key(x) === key(d)); return [`\`${d.session}\``, `\`${d.check}\``, `\`${d.snapshot}\``, s(p.queued_at), s(d.package), s(hub.get(key(d)).handed_at), s(d.hub)]; }),
  ),
  replies: tableOf(
    ['Stop', 'Turn opened by', 'Stop at s', 'Hub `turnEnded` returned s', 'After the stop s'],
    record.orders.stops.map((x) => [`\`${x.stop}\``, `\`${x.opened_by}\``, s(x.at), s(x.turn_end_returned_at), s(x.turn_end_returned_at - x.at)]),
  ),
};
const report = join(HERE, 'README.md');
if (existsSync(report)) {
  let text = readFileSync(report, 'utf8');
  for (const [name, block] of Object.entries(blocks)) {
    const [open, close] = [`<!-- ${name} -->`, `<!-- /${name} -->`];
    if (!text.includes(open) || !text.includes(close)) throw Error(`README.md has no ${open} ... ${close} lines for its table`);
    text = `${text.slice(0, text.indexOf(open) + open.length)}\n${block}\n${text.slice(text.indexOf(close))}`;
  }
  writeFileSync(report, text);
}
console.log(`record.json: main ${record.main}, ${record.runs.length} runs, ${table.length} rows; never-stops reads the same under both orders: ${same}; ${differs.length} of ${orders.rows.package.places.length} places start at a different time under the hub's order`);
