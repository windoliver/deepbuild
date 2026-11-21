// The numbers table (#2674): one line for each row of the design's "Numbers version 0 has to hold", naming what measures
// it and giving its newest reading from main, with the date, the machine, its macOS build, the load and the method. It is
// benchmarks/windows/numbers.md, beside the budget windows' records: a folder per window holding the window's own
// record (window.json), one record per commit it measured (<commit>.json) and its throttle log lines (throttle.log).
//
//   node scripts/budget-table.mjs collect   on the reference Mac after its windows: copy each window not here yet,
//                                           then write the table
//   node scripts/budget-table.mjs write     rewrite the table from the records here
//   node scripts/budget-table.mjs check     fail a table line the records don't give, or a record that reads PASS at a
//                                           load at or above the cores or holds no numbers (the lint lane runs it)
//
// A line is a result only from a window's record on a reference Mac, for the tasks whose own limit or target judges the
// row, none timing a debug build. A reading from another machine, from before the windows or from a debug build says so.
// A row no task judges whole reads `unmeasured`, naming what is missing, and is never PASS (invariant 2).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { references } from './benchmark.mjs';
import { worst } from './lanes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = join(root, 'benchmarks', 'windows');
const table = join(folder, 'numbers.md');
const START = '<!-- table: node scripts/budget-table.mjs write -->', END = '<!-- end of table -->';
const STATES = ['PASS', 'FAIL', 'INCONCLUSIVE', 'BLOCKED'];

const row = (budget, { tasks = [], readings = [], debug = [], missing, before = null }) => ({ budget, tasks, readings, debug, missing, before });
const spike21 = { date: '2026-10-29', machine: 'Mac15,12', build: '23H723', method: 'docs/spikes/21/record.json: hyperfine 1.19 over 1,000 release deep-hook calls, five runs' };
/**
 * The thirteen rows, in the design's order. `tasks` are the tasks of benchmarks/budgets.json whose own limit or target
 * judges the row's target; `readings` measure its subject with no such limit; `debug` names those timing a debug build;
 * `missing` says what no task judges, and `before` is a reading taken before the windows.
 */
export const ROWS = [
  row('Hook overhead', {
    readings: ['deep-hook-overhead', 'deep-hook-day-overhead'],
    missing: 'no task carries the 10 ms p95; the overhead tasks print overheadP95Ms with no limit, and tests/acceptance/315/budgets-overhead-redraft.test.ts, which judges it, runs outside the window',
    before: { ...spike21, reading: 'overheadP95Ms 0.83 to 0.89 ms', load: '41 to 48 on 8 cores' } }),
  row('Fail-open time', {
    readings: ['deep-hook-fail-open', 'deep-hook-day-fail-open'],
    missing: 'no task carries the 50 ms; the fail-open tasks print failOpenP95Ms with no limit, and tests/acceptance/315/budgets.test.ts judges it outside the window',
    before: { ...spike21, reading: 'failOpenP95Ms 27.48 to 27.61 ms', load: '11 to 26 on 8 cores' } }),
  row('Event intake', { readings: ['record-append-20k'], missing: 'no task carries 5,000 events a second; tests/acceptance/14/budgets.test.ts judges it outside the window' }),
  row('The app', { readings: ['deep-inbox-30d'], missing: "no task launches the app's first screen; tests/acceptance/2026/load.test.ts judges the 1 s outside the window" }),
  row('Chrome frames', { readings: ['app-select-700'], debug: ['app-select-700'], missing: 'no task runs a release replica journey or records views repainted, CPU or GPU a frame; tests/acceptance/1482/bench.test.ts judges it outside the window' }),
  row('Concurrent runs', { readings: ['lease-grant'], missing: 'no task measures how many checks run at once; tests/acceptance/29/budgets.test.ts judges it outside the window' }),
  row('Stop holds', { missing: 'nothing measures hold durations over a week; the 10 s is a proposal until the dogfood week' }),
  row('Record size', { readings: ['archive-month'], missing: "no task measures the record's size; tests/acceptance/14/privacy.test.ts judges it outside the window" }),
  row('Release gates', { readings: ['deep-hook-overhead', 'hub-idle'], missing: 'the margin over the last release is judged only by the release budgets lane, which needs a last release' }),
  row('Hot path', { readings: ['hub-round-trip', 'deep-hook-during-backup'], missing: "no task judges the hub's event loop; tests/acceptance/16's hot-path tests do, outside the window" }),
  row('Memory', {
    tasks: ['hook-startup'], readings: ['hub-idle'], debug: ['hook-startup'],
    missing: "only deep-hook's 10 MB has a window limit; the hub's 150 MB and 0.5%, the app's 300 MB and 1% and the waiter's 5 MB have none" }),
  row("The app's footprint", { readings: ['hub-idle'], missing: "no task starts the app or records its footprint, gauges or unaccounted; hub-idle reads the hub's" }),
  row('The canvas', {
    tasks: ['canvas-look-frames', 'canvas-many-lamps', 'canvas-idle', 'canvas-patch-settled', 'canvas-drawn-frames', 'canvas-art-frames'],
    readings: ['canvas-class-core-view', 'canvas-class-showpiece'], debug: ['canvas-class-core-view', 'canvas-class-showpiece'],
    missing: 'the class tasks time debug builds with no targets, and no task carries GPU memory, heap allocations a frame, UI-thread time, drag within 2 frames or deep_show within 2 s' }),
];
export const COLUMNS = ['Budget', 'Measured by', 'Result', 'Reading', 'Date', 'Machine', 'macOS build', 'Load', 'Method', 'Record'];

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
/** The windows here, oldest first: each folder's own record, its commits' records by commit, and its log lines. */
export function holdings(dir = folder) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => {
    const path = join(dir, name), files = readdirSync(path);
    const values = files.filter((file) => file.endsWith('.json')).map((file) => ({ file, value: parse(readFileSync(join(path, file), 'utf8')) }));
    const records = Object.fromEntries(values.filter(({ file, value }) => file !== 'window.json' && typeof value?.commit === 'string').map(({ file, value }) => [value.commit, { file: `${name}/${file}`, value }]));
    const log = files.includes('throttle.log') ? readFileSync(join(path, 'throttle.log'), 'utf8').split('\n').filter(Boolean).map(parse) : [];
    return { name, own: values.find(({ file }) => file === 'window.json')?.value ?? null, records, log };
  }).sort((a, b) => String(a.own?.start).localeCompare(String(b.own?.start)));
}

const isReference = (machine) => references.some(({ model, chip, memoryBytes }) => machine?.model === model && machine?.chip === chip && machine?.memoryBytes === memoryBytes)
  && machine.power === 'ac' && machine.lowPowerMode === false && machine.thermalState === 'nominal' && Boolean(machine.macosBuild);
const coresOf = (machine) => references.find(({ model }) => model === machine?.model)?.cores;
const loadsOf = (row) => (row.loads ?? []).flatMap(({ start, end } = {}) => [start, end]);
const numbered = (side) => side && ['p50Ms', 'p95Ms', 'peakBytes'].every((key) => Number.isFinite(side[key])) && Array.isArray(side.instructions) && side.instructions.length > 0;

/** What is wrong with a window here, each naming its window, commit and task. */
export function recordProblems({ name, own, records, log }) {
  if (!own) return [`${name}: no window.json`];
  const problems = [];
  if (!log.some((line) => line?.event === 'window-open' && line.id === own.grant) || !log.some((line) => line?.event === 'window-close' && line.id === own.grant))
    problems.push(`${name}: its throttle.log holds no window-open and window-close of grant ${own.grant}`);
  const cores = coresOf(own.machine) ?? own.cores;
  for (const commit of own.commits ?? []) {
    const record = records[commit]?.value;
    if (!record) {
      problems.push(`${name}: no record of ${commit}, a commit it measured`);
      continue;
    }
    for (const row of record.tests ?? []) {
      const where = `${name}: ${row.id} on ${commit.slice(0, 12)}`;
      if (!STATES.includes(row.state)) problems.push(`${where} reads ${JSON.stringify(row.state)}`);
      if (row.state === 'BLOCKED') continue;
      if (!numbered(row.sides?.change) || (row.sides.base !== null && !numbered(row.sides.base))) problems.push(`${where} holds no p50, p95, peak bytes and instructions retired per round for each side`);
      const loads = loadsOf(row);
      if (row.state === 'PASS' && !(loads.length && loads.every((load) => Number.isFinite(load) && load < cores))) problems.push(`${where} reads PASS at a load of ${Math.max(...loads.filter(Number.isFinite))} on ${cores} cores, or with no load read`);
    }
  }
  return problems;
}

/** A task's newest row in the windows here, with its window and commit's record. */
function newest(all, id) {
  for (const win of [...all].reverse()) for (const commit of [...win.own?.commits ?? []].reverse()) {
    const record = win.records[commit], found = record?.value.tests?.find((test) => test.id === id);
    if (found && found.state !== 'BLOCKED') return { win, record, row: found };
  }
  return null;
}

const ms = (value) => (Number.isFinite(value) ? `${value < 10 ? value.toFixed(2) : Math.round(value)} ms` : '?');
const reading = ({ row: { id, sides } }) => `${id}: p50 ${ms(sides?.change?.p50Ms)}, p95 ${ms(sides?.change?.p95Ms)}, peak ${Number.isFinite(sides?.change?.peakBytes) ? `${(sides.change.peakBytes / 1e6).toFixed(1)} MB` : '?'}`;
const loadRange = (found) => {
  const loads = found.flatMap(({ row }) => loadsOf(row)).filter(Number.isFinite);
  return loads.length ? `${Math.min(...loads).toFixed(1)} to ${Math.max(...loads).toFixed(1)} on ${found[0].win.own.cores} cores` : '';
};
const METHOD = 'budget window: 20 rounds a side against the merge base, then five limit runs';

/** One row's line, by column. */
export function line(row, all) {
  const judged = row.tasks.map((id) => newest(all, id)), read = row.readings.map((id) => newest(all, id)).filter(Boolean);
  const shown = [...judged.filter(Boolean), ...read];
  const when = (found) => ({
    Reading: found.map(reading).join('; '), Date: found[0].win.own.start.slice(0, 10), Machine: found[0].win.own.machine?.model ?? '', 'macOS build': found[0].win.own.machine?.macosBuild ?? '',
    Load: loadRange(found), Method: METHOD,
  });
  const before = row.before && { Reading: `${row.before.reading} (before the windows)`, Date: row.before.date, Machine: row.before.machine, 'macOS build': row.before.build, Load: row.before.load, Method: row.before.method };
  const base = { Budget: row.budget, 'Measured by': [...row.tasks.map((id) => `\`${id}\``), ...row.readings.map((id) => `${id} (a reading)`)].join(', ') || 'nothing', Record: '' };
  const unmeasured = (what) => ({ ...base, Result: `unmeasured: ${what}`, ...shown.length ? when(shown) : before ?? { Reading: '', Date: '', Machine: '', 'macOS build': '', Load: '', Method: '' } });
  if (!row.tasks.length || judged.some((found) => !found)) return unmeasured(row.tasks.length ? `no window has measured ${row.tasks.filter((_, at) => !judged[at]).join(', ')} on main yet; ${row.missing}` : row.missing);
  const why = [
    ...judged.some(({ win }) => !isReference(win.own.machine)) ? ['from another machine than a reference Mac on mains'] : [],
    ...row.tasks.some((id) => row.debug.includes(id)) ? [`from a debug build (${row.tasks.filter((id) => row.debug.includes(id)).join(', ')})`] : [],
  ];
  if (why.length) return { ...base, Result: `reading: ${why.join(' and ')}, not a result`, ...when(judged) };
  const state = worst(judged.map(({ row: found }) => found.state)) ?? 'PASS';
  // A row its tasks judge only in part never reads PASS: what they don't judge is missing.
  if (state === 'PASS' && row.missing) return unmeasured(`its tasks pass, but ${row.missing}`);
  return { ...base, Result: state, ...when(judged), Record: [...new Set(judged.map(({ record }) => record.file))].join(', ') };
}

const cell = (text) => String(text).replace(/\|/g, '/').replace(/\n/g, ' ');
export const render = (all) => [`| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`, ...ROWS.map((one) => `| ${COLUMNS.map((column) => cell(line(one, all)[column])).join(' | ')} |`)].join('\n');
const tableIn = (text) => text.split(START)[1]?.split(END)[0]?.trim();

/** Copies each window under ~/.deepbuild/lanes/ not here yet: its record, its commits' records and its log lines. */
function collect() {
  const lanes = join(homedir(), '.deepbuild', 'lanes'), logFile = join(homedir(), '.deepbuild', 'throttle', 'log');
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(parse).filter(Boolean) : [];
  // Paths under this user's home say who ran it, so they go as ~; hosts are dropped (AGENTS.md: no personal data).
  const redact = (value) => `${JSON.stringify(value, (key, field) => (key === 'host' ? undefined : field), 2).split(homedir()).join('~')}\n`;
  let copied = 0;
  for (const file of existsSync(lanes) ? readdirSync(lanes).filter((name) => /^budget-window-.+\.json$/.test(name)).sort() : []) {
    const own = parse(readFileSync(join(lanes, file), 'utf8')), name = file.slice('budget-window-'.length, -'.json'.length);
    if (!own?.commits?.length || existsSync(join(folder, name))) continue;
    mkdirSync(join(folder, name), { recursive: true });
    writeFileSync(join(folder, name, 'window.json'), redact(own));
    for (const commit of own.commits) writeFileSync(join(folder, name, `${commit}.json`), redact(parse(readFileSync(join(lanes, own.records[commit]), 'utf8'))));
    writeFileSync(join(folder, name, 'throttle.log'), log.filter(({ id, event }) => id === own.grant && /^window-/.test(event)).map((entry) => `${JSON.stringify(entry)}\n`).join(''));
    copied++;
  }
  console.log(`PASS budget-table: ${copied} window${copied === 1 ? '' : 's'} copied to benchmarks/windows`);
}

function write() {
  const text = readFileSync(table, 'utf8');
  if (tableIn(text) === undefined) throw Error(`benchmarks/windows/numbers.md has no ${START} … ${END}`);
  writeFileSync(table, `${text.split(START)[0]}${START}\n${render(holdings())}\n${END}${text.split(END)[1]}`);
  console.log('PASS budget-table: benchmarks/windows/numbers.md written from the records');
}

function check() {
  const all = holdings(), problems = all.flatMap(recordProblems);
  const lines = (text) => (text ?? '').split('\n').slice(2);
  const held = lines(existsSync(table) ? tableIn(readFileSync(table, 'utf8')) : ''), given = lines(render(all));
  // The table is what the records give, line by line: a line that says more, or less, fails, naming its row.
  ROWS.forEach(({ budget }, at) => {
    if (held[at] !== given[at]) problems.push(`row ${budget}: the table's line isn't what the records here give: ${JSON.stringify(held[at] ?? null)}, where they give ${JSON.stringify(given[at])}`);
  });
  if (held.length > ROWS.length) problems.push(`the table has ${held.length} lines, not one for each of the ${ROWS.length} rows`);
  for (const problem of problems) console.log(`FAIL budget-table: ${problem}`);
  if (problems.length) {
    console.log("  Fix: Rewrite the table from the records with `node scripts/budget-table.mjs write`; a window's records are its own and are never edited.");
    process.exit(1);
  }
  console.log(`PASS budget-table: ${all.length} window${all.length === 1 ? '' : 's'} and the table's ${ROWS.length} lines hold`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'collect') (collect(), write());
  else if (command === 'write') write();
  else if (command === 'check') check();
  else {
    console.log('BLOCKED budget-table: usage: node scripts/budget-table.mjs collect|write|check');
    process.exit(2);
  }
}
