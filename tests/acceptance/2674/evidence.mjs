// Readers and judges for what #2674's windows leave: each commit's record and each window's own record, in the
// sandbox's ~/.deepbuild/lanes/ or committed under benchmarks/windows/ beside the numbers table, and the table itself
// (README: The surface). Each judge returns a list of problems, each naming what it is about; a test asserts the list is
// empty. Nothing here imports the code under test.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT } from './scene.mjs';

/** Where the windows' records and the table are committed, from the checkout's root. */
export const FOLDER = 'benchmarks/windows';
export const TABLE = 'numbers.md';
const MANIFEST = 'benchmarks/budgets.json';
export const STATES = ['PASS', 'FAIL', 'INCONCLUSIVE', 'BLOCKED'];
/** The reference Macs' CPU cores, by model (design: The reference Macs). */
export const CORES = { 'Mac15,7': 12, 'Mac15,12': 8, 'Mac17,10': 18 };
/** Each side's instructions retired, one count per round: the design's 20 samples a side. */
const ROUNDS = 20;
/** The thirteen rows of the design's "Numbers version 0 has to hold", by its Budget column. */
export const ROWS = ['Hook overhead', 'Fail-open time', 'Event intake', 'The app', 'Chrome frames', 'Concurrent runs', 'Stop holds', 'Record size', 'Release gates', 'Hot path', 'Memory', "The app's footprint", 'The canvas'];
/** The table's columns, by header text, in any order. */
export const COLUMNS = ['Budget', 'Measured by', 'Result', 'Reading', 'Date', 'Machine', 'macOS build', 'Load', 'Method', 'Record'];
/** The suites #1830 lists: each by the original's path #1830 names and its blind redraft's folder. */
export const SUITES = ['103', '124', '148', '149', '166', '262', '311/redraft-ac12', '365', '417', '465', '568/judge.test.mjs', '761', '1018/redraft-ac6', '1098', '1425', '1427']
  .map((name) => ({ name, paths: [`tests/acceptance/${name}`, `tests/acceptance/${name.split('/')[0]}-redraft-1830`] }));
/** #1009's criterion, by the trace lane's ID. */
export const CRITERION_1009 = '#1009.542330be';

const short = (commit) => String(commit).slice(0, 12);
const worst = (states) => ['FAIL', 'BLOCKED', 'INCONCLUSIVE'].find((state) => states.includes(state)) ?? (states.length ? 'PASS' : null);
const decided = (state) => state === 'PASS' || state === 'FAIL';
const carries = (task) => Object.keys(task?.limits ?? {}).length > 0 || Boolean(task?.targets);

// --- git, in this checkout, with nothing of a caller's git environment ---
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/.test(name)));
const cache = new Map();
function git(...args) {
  const key = args.join('\0');
  if (!cache.has(key)) {
    try {
      cache.set(key, execFileSync('git', args, { cwd: CHECKOUT, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim());
    } catch {
      cache.set(key, null);
    }
  }
  return cache.get(key);
}
/** What a commit on main changed: a merge's branch tip, or the commit itself; null when this checkout can't read it. */
function changeSide(commit) {
  const parents = git('rev-list', '--parents', '-n', '1', commit)?.split(' ').slice(1);
  return parents ? (parents.length > 1 ? parents[1] : commit) : null;
}
/** The tasks of benchmarks/budgets.json at a commit, or null when it can't be read. */
export function tasksAt(commit) {
  const text = commit && git('show', `${commit}:${MANIFEST}`);
  try {
    return text ? JSON.parse(text).tasks : null;
  } catch {
    return null;
  }
}
/** The tasks a commit's record was judged on: its change side's. */
export const tasksOf = (record) => tasksAt(changeSide(record.commit));

// --- a commit's record ---

/** The one-minute loads a row holds, at each run's start and end, or null when it holds none that read. */
export function loadReadings(row) {
  const loads = row?.loads;
  if (!Array.isArray(loads) || !loads.length || !loads.every((load) => [load?.start, load?.end].every((value) => Number.isFinite(value) && value >= 0))) return null;
  return loads.flatMap(({ start, end }) => [start, end]);
}

/** AC1: every row reads one of the four verdicts, and every task of the commit's manifest is a row or not reached. */
export function statesOf(record, taskIds) {
  const problems = record.tests.filter((row) => !STATES.includes(row?.state)).map((row) => `${row?.id} on ${short(record.commit)} reads ${JSON.stringify(row?.state)}, not PASS, FAIL, INCONCLUSIVE or BLOCKED`);
  // A manifest the window refused is one BLOCKED row for every task.
  if (record.tests.some((row) => row.id === MANIFEST && row.state === 'BLOCKED')) return problems;
  const rows = new Set(record.tests.map((row) => row.id)), notReached = new Set(Array.isArray(record.notReached) ? record.notReached : []);
  for (const id of taskIds) {
    if (!rows.has(id) && !notReached.has(id)) problems.push(`${id} on ${short(record.commit)} is neither a row of the record nor not reached`);
    if (rows.has(id) && notReached.has(id)) problems.push(`${id} on ${short(record.commit)} is both a row of the record and not reached`);
  }
  return problems;
}

/** AC1: a row reads PASS only when the record shows each of its runs started and ended at a load below the cores. */
export function passesAtLoad(record, cores) {
  return record.tests.filter((row) => row.state === 'PASS').flatMap((row) => {
    const readings = loadReadings(row);
    if (!readings) return [`${row.id} reads PASS on ${short(record.commit)} with no load at its runs' start and end in the record`];
    const top = Math.max(...readings);
    return top >= cores ? [`${row.id} reads PASS on ${short(record.commit)}, measured at a load of ${top} on ${cores} cores`] : [];
  });
}

/** AC2: each row of `ids` holds the load at its runs' start and end; with `pinned`, every reading is that load. */
export function loadsOf(record, ids, pinned) {
  return ids.flatMap((id) => {
    const row = record.tests.find((one) => one.id === id);
    const readings = loadReadings(row);
    if (!readings) return [`${id} on ${short(record.commit)} holds no load at its runs' start and end: ${JSON.stringify(row ?? null)}`];
    return pinned !== undefined && readings.some((value) => value !== pinned) ? [`${id} on ${short(record.commit)} holds loads ${JSON.stringify(row.loads)}, while every process read ${pinned}`] : [];
  });
}

/**
 * AC4: the row of `id` holds, for the change side and (with `base`) the merge base's, its p50, its p95, its peak bytes
 * and its instructions retired per round, a count or null for each of the 20 rounds. With `counted`, at least one count
 * read, as it does on a Mac whose /usr/bin/time counts.
 */
export function sidesOf(record, id, { base = true, counted = false } = {}) {
  const row = record.tests.find((one) => one.id === id);
  if (!row) return [`the record of ${short(record.commit)} has no row for ${id}`];
  return (base ? ['change', 'base'] : ['change']).flatMap((side) => {
    const at = row.sides?.[side], where = `${id}'s ${side} side on ${short(record.commit)}`;
    if (!at || typeof at !== 'object') return [`the record of ${short(record.commit)} holds no ${side} side for ${id}: ${JSON.stringify(row)}`];
    const problems = [];
    if (!(Number.isFinite(at.p50Ms) && at.p50Ms > 0)) problems.push(`${where} holds no p50: ${JSON.stringify(at.p50Ms ?? null)}`);
    if (!(Number.isFinite(at.p95Ms) && at.p95Ms > 0 && at.p95Ms >= at.p50Ms)) problems.push(`${where} holds no p95 at or above its p50: ${JSON.stringify(at.p95Ms ?? null)}`);
    if (!(Number.isSafeInteger(at.peakBytes) && at.peakBytes > 0)) problems.push(`${where} holds no peak bytes: ${JSON.stringify(at.peakBytes ?? null)}`);
    const counts = at.instructions;
    if (!Array.isArray(counts) || counts.length !== ROUNDS || counts.some((count) => count !== null && !(Number.isSafeInteger(count) && count > 0)))
      problems.push(`${where} holds no instructions retired per round (a count or null for each of ${ROUNDS} rounds): ${JSON.stringify(counts ?? null)}`);
    else if (counted && counts.every((count) => count === null)) problems.push(`${where} holds no count of instructions retired in any round, on a Mac whose /usr/bin/time counts them`);
    return problems;
  });
}

// --- a window's record ---

const isTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
/** The tasks a window ran, by its commits' records: each row that is a task, not the manifest's. */
export const ranOf = (records) => new Set(records.flatMap((record) => record.tests.map((row) => row.id)).filter((id) => id !== MANIFEST));
/** The tasks a window reached on no commit. */
export const unreachedOf = (records) => {
  const ran = ranOf(records);
  return new Set(records.flatMap((record) => (Array.isArray(record.notReached) ? record.notReached : [])).filter((id) => !ran.has(id)));
};
const same = (list, set) => Array.isArray(list) && list.every((id) => typeof id === 'string') && new Set(list).size === set.size && list.every((id) => set.has(id));

/**
 * AC7: a window's record gives its start and end (ISO 8601 times, start first), the commits it measured, and the tasks
 * it ran (`ran`) and did not reach on any commit (`notReached`), as `expected` holds them.
 */
export function windowRecordOf(own, expected) {
  const problems = [];
  if (!isTime(own.start) || !isTime(own.end) || Date.parse(own.start) > Date.parse(own.end)) problems.push(`its start and end aren't two times, start first: ${JSON.stringify({ start: own.start, end: own.end })}`);
  if (!Array.isArray(own.commits) || JSON.stringify(own.commits) !== JSON.stringify(expected.commits)) problems.push(`its commits are ${JSON.stringify(own.commits)}, not the commits it measured, ${JSON.stringify(expected.commits)}`);
  if (!same(own.ran, expected.ran)) problems.push(`its ran is ${JSON.stringify(own.ran ?? null)}, not the tasks it ran, ${JSON.stringify([...expected.ran])}`);
  if (!same(own.notReached, expected.notReached)) problems.push(`its notReached is ${JSON.stringify(own.notReached ?? null)}, not the tasks it reached on no commit, ${JSON.stringify([...expected.notReached])}`);
  return problems;
}

/** AC7: a window ends within two hours of its start, or its record names the task that took longest, one it ran. */
export function lengthOf(own) {
  const hours = (Date.parse(own.end) - Date.parse(own.start)) / 3_600_000;
  if (!(hours > 2)) return [];
  return Array.isArray(own.ran) && own.ran.includes(own.longest?.task) ? [] : [`it ran ${hours.toFixed(2)} h, over two hours, and its record names no task it ran as the one that took longest: ${JSON.stringify(own.longest ?? null)}`];
}

/**
 * AC2: the share of rows of tasks that carry a limit or a target reading PASS or FAIL, each with its loads; `open`
 * names each window in which every such row read INCONCLUSIVE at a load at or above the cores, with the load.
 * `windows` is a list of { name, cores, records: [{ value, tasks }] }.
 */
export function share(windows) {
  const problems = [], open = [];
  let counted = 0, read = 0;
  for (const window of windows) {
    let rows = 0, byLoad = 0, top = null;
    for (const { value, tasks } of window.records) {
      const carrying = new Set((tasks ?? []).filter(carries).map(({ id }) => id));
      for (const row of value.tests.filter(({ id }) => carrying.has(id))) {
        rows++;
        if (decided(row.state)) read++;
        const readings = loadReadings(row);
        if (!readings && row.state !== 'BLOCKED') problems.push(`${window.name}: ${row.id} on ${short(value.commit)} reads ${row.state} with no load at its runs' start and end in the record`);
        if (!readings) continue;
        top = Math.max(top ?? 0, ...readings);
        if (row.state === 'INCONCLUSIVE' && Math.max(...readings) >= window.cores) byLoad++;
      }
    }
    counted += rows;
    if (rows && byLoad === rows) open.push(`${window.name}: every task that carries a limit or a target read INCONCLUSIVE by load, at loads up to ${top} on ${window.cores} cores`);
  }
  if (!counted) problems.push('no task that carries a limit or a target ran in the windows');
  else if (read / counted < 0.9) problems.push(`${read} of ${counted} tasks that carry a limit or a target read PASS or FAIL (${(100 * read / counted).toFixed(1)}%), under 90%`);
  return { problems: [...problems, ...open], open, read, counted };
}

// --- the windows the repo holds ---

function parse(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}
const isWindow = (value) => value && typeof value === 'object' && 'start' in value && 'end' in value && Array.isArray(value.commits);
const isCommit = (value) => value && typeof value === 'object' && typeof value.commit === 'string' && Array.isArray(value.tests);

/**
 * The windows committed under benchmarks/windows/ in `root`: one folder each, holding its own record (an object with
 * `start`, `end` and `commits`), one record per commit it measured (an object with `commit` and `tests`), and
 * `throttle.log`, the throttle log's lines for it. Sorted by start.
 */
export function holdings(root = CHECKOUT) {
  const folder = join(root, FOLDER);
  if (!existsSync(folder)) return { folder, windows: [], problems: [`the repo holds no ${FOLDER}/: no window's records are committed`] };
  const problems = [];
  const windows = readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => {
    const path = join(folder, name);
    const files = readdirSync(path).filter((file) => file.endsWith('.json')).map((file) => ({ file: `${name}/${file}`, value: parse(join(path, file)) }));
    for (const { file, value } of files) if (value === undefined) problems.push(`${file} isn't JSON`);
    const own = files.filter(({ value }) => isWindow(value));
    if (own.length !== 1) problems.push(`${name}: ${own.length} window records (an object with start, end and commits), not one`);
    const logFile = join(path, 'throttle.log');
    let log = null;
    if (existsSync(logFile)) {
      log = readFileSync(logFile, 'utf8').split('\n').filter((line) => line.trim()).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          problems.push(`${name}/throttle.log has a line that isn't JSON: ${line.slice(0, 200)}`);
          return [];
        }
      });
    }
    return { name, own: own.length === 1 ? own[0].value : null, records: files.filter(({ value }) => isCommit(value)), log };
  });
  const dated = windows.filter(({ own }) => own && isTime(own.start)).sort((a, b) => Date.parse(a.own.start) - Date.parse(b.own.start));
  for (const window of windows) if (window.own && !isTime(window.own.start)) problems.push(`${window.name}: its record's start isn't a time: ${JSON.stringify(window.own.start)}`);
  return { folder, windows: dated, problems };
}

/**
 * AC1 over the repo's windows: three or more, all on one reference Mac, each over the commits merged since
 * the one before on main's first-parent line, each with one record per commit it measured and the throttle log's
 * window-open and window-close around it, every task of every record in a verdict or not reached, and no PASS at a load
 * at or above the cores.
 */
export function inARow({ windows, problems: found }) {
  const problems = [...found];
  if (windows.length < 3) problems.push(`${FOLDER}/ holds ${windows.length} windows with a record, not three in a row`);
  const models = new Set(windows.map(({ own }) => own.machine?.model ?? null));
  if (models.size > 1 || ![...models].every((model) => model in CORES)) problems.push(`the windows ran on ${JSON.stringify([...models])}, not on one reference Mac (${Object.keys(CORES).join(', ')})`);
  let previous = null;
  for (const { name, own, records, log } of windows) {
    const commits = Array.isArray(own.commits) ? own.commits : [];
    for (const commit of commits) {
      if (previous) {
        const parent = git('rev-parse', `${commit}^1`);
        if (parent === null) problems.push(`${name}: BLOCKED: this checkout can't read ${commit}'s first parent; the windows are judged in a checkout of main's history`);
        else if (parent !== previous) problems.push(`${name}: ${short(commit)} doesn't follow ${short(previous)} on main's first-parent line, so the windows aren't each over the commits merged since the one before`);
      }
      previous = commit;
    }
    const recorded = records.map(({ value }) => value.commit);
    for (const commit of commits) {
      const count = recorded.filter((one) => one === commit).length;
      if (count !== 1) problems.push(`${name}: ${count} records of ${short(commit)}, a commit it measured, not one`);
    }
    for (const commit of new Set(recorded)) if (!commits.includes(commit)) problems.push(`${name}: a record of ${short(commit)}, which its record doesn't name as measured`);
    const opens = (log ?? []).filter(({ event }) => event === 'window-open'), closes = (log ?? []).filter(({ event }) => event === 'window-close');
    const around = opens.some((open) => closes.some((close) => close.id === open.id && Date.parse(open.at) <= Date.parse(own.start) && Date.parse(close.at) >= Date.parse(own.end)));
    if (!around) problems.push(`${name}: its throttle.log holds no window-open and window-close of one grant around its start and end: ${JSON.stringify([...opens, ...closes])}`);
    const cores = CORES[own.machine?.model];
    for (const { file, value } of records) {
      const tasks = tasksOf(value);
      if (!tasks) problems.push(`${file}: BLOCKED: this checkout can't read ${MANIFEST} at ${short(value.commit)}'s change side`);
      problems.push(...statesOf(value, (tasks ?? []).map(({ id }) => id)).map((problem) => `${file}: ${problem}`));
      if (cores) problems.push(...passesAtLoad(value, cores).map((problem) => `${file}: ${problem}`));
    }
  }
  return problems;
}

/** The repo's windows as `share` reads them. */
export const forShare = ({ windows }) => windows.map(({ name, own, records }) => ({ name, cores: CORES[own.machine?.model] ?? Infinity, records: records.map(({ value }) => ({ value, tasks: tasksOf(value) })) }));

/** AC4 over the repo's records: every row measured holds both sides, the merge base's where the base had the task. */
export function sidesHeld({ windows, problems: found }) {
  const records = windows.flatMap(({ records: held }) => held);
  if (!records.length) return [...found, `${FOLDER}/ holds no commit's record`];
  return records.flatMap(({ file, value }) => {
    const before = new Set((tasksAt(value.base) ?? []).map(({ id }) => id));
    return value.tests.filter((row) => row.state !== 'BLOCKED' && row.id !== MANIFEST).flatMap((row) => sidesOf(value, row.id, { base: before.has(row.id) }).map((problem) => `${file}: ${problem}`));
  });
}

/** AC7 over the repo's windows: each record is whole, and each window ran within two hours or names its longest task. */
export function windowsWhole({ windows, problems: found }) {
  const problems = [...found];
  if (!windows.length) problems.push(`${FOLDER}/ holds no window's record`);
  for (const { name, own, records } of windows) {
    const values = records.map(({ value }) => value);
    const expected = { commits: values.map(({ commit }) => commit), ran: ranOf(values), notReached: unreachedOf(values) };
    // The commits in the window's own order, which the records must match as a set.
    if (Array.isArray(own.commits) && same(own.commits, new Set(expected.commits))) expected.commits = own.commits;
    problems.push(...windowRecordOf(own, expected).map((problem) => `${name}: ${problem}`), ...lengthOf(own).map((problem) => `${name}: ${problem}`));
  }
  return problems;
}

// --- the table ---

/** The table's lines: the first markdown table in the file whose header names a Budget column, by column. */
export function readTable(path) {
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const lines = readFileSync(path, 'utf8').split('\n');
  const at = lines.findIndex((line) => line.trim().startsWith('|') && cells(line).includes('Budget'));
  if (at < 0) return { header: [], lines: [] };
  const header = cells(lines[at]);
  const body = [];
  for (const line of lines.slice(at + 2)) {
    if (!line.trim().startsWith('|')) break;
    body.push(Object.fromEntries(cells(line).map((cell, index) => [header[index], cell])));
  }
  return { header, lines: body };
}

const PHRASES = ['another machine', 'before the window', 'debug build'];
const filled = (cell) => typeof cell === 'string' && cell.replace(/[\s\-—–`*_]/g, '') !== '';
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);

/**
 * AC3: the table has the columns and one line for each of the thirteen rows. A line reads a verdict only from the
 * committed records it cites, and only as their rows of the tasks it names read; a reading says why it is one; an
 * unmeasured line names what is missing. Each problem starts with the row it is about.
 */
export function tableProblems(table, held) {
  const problems = [];
  const missing = COLUMNS.filter((column) => !table.header.includes(column));
  if (missing.length) problems.push(`the table has no ${missing.join(', ')} column`);
  for (const name of ROWS) {
    const count = table.lines.filter((line) => line.Budget === name).length;
    if (count !== 1) problems.push(`${name}: ${count} lines in the table, not one`);
  }
  for (const line of table.lines) if (!ROWS.includes(line.Budget)) problems.push(`${line.Budget}: a line for no row of Numbers version 0 has to hold`);
  const manifest = (() => {
    try {
      return JSON.parse(readFileSync(join(CHECKOUT, MANIFEST), 'utf8')).tasks;
    } catch {
      return [];
    }
  })();
  for (const line of table.lines.filter(({ Budget }) => ROWS.includes(Budget))) {
    const name = line.Budget, result = line.Result ?? '';
    const word = result.match(/^`?(PASS|FAIL|INCONCLUSIVE|BLOCKED|reading|unmeasured)\b/)?.[1];
    const rest = result.replace(/^`?\w+`?/, '');
    if (!word) {
      problems.push(`${name}: its Result, ${JSON.stringify(result)}, is no verdict, reading or unmeasured`);
      continue;
    }
    if (word === 'unmeasured') {
      if (!filled(rest) && !filled(line['Measured by'])) problems.push(`${name}: unmeasured, naming nothing that is missing`);
      continue;
    }
    for (const column of ['Measured by', 'Reading', 'Date', 'Machine', 'macOS build', 'Load', 'Method']) if (!filled(line[column])) problems.push(`${name}: its ${column} is empty`);
    if (word === 'reading') {
      if (!PHRASES.some((phrase) => result.toLowerCase().includes(phrase))) problems.push(`${name}: a reading that doesn't say whether it is from another machine, from before the window or from a debug build`);
      continue;
    }
    // A verdict: the records it cites, and the rows there of the tasks it names.
    const cited = (line.Record ?? '').match(/[\w.:@+-]+\/[\w.:@+-]+\.json/g) ?? [];
    const found = cited.map((file) => {
      const window = held.windows.find(({ records }) => records.some((record) => record.file === file));
      return window && { window, record: window.records.find((record) => record.file === file).value };
    });
    const named = [...(line['Measured by'] ?? '').matchAll(/`([^`]+)`/g)].map(([, id]) => id);
    const rows = found.filter(Boolean).flatMap(({ record }) => record.tests.filter((row) => named.includes(row.id)));
    const behind = cited.length && found.every(Boolean) && rows.length;
    if (!behind) {
      problems.push(`${name}: ${word} with no record behind it: it cites ${JSON.stringify(cited)}, ${found.filter(Boolean).length} of them committed records under ${FOLDER}/, holding ${rows.length} rows of the tasks it names, ${JSON.stringify(named)}`);
      continue;
    }
    const states = rows.map(({ state }) => state);
    if (worst(states) !== word) problems.push(`${name}: ${word} with no record behind it: the rows it cites read ${JSON.stringify(states)}`);
    const debug = named.filter((id) => manifest.find((task) => task.id === id)?.command?.some((part) => /(^|\/)debug\//.test(part)));
    if (debug.length) problems.push(`${name}: ${word} from a debug build (${debug.join(', ')}), a reading, not a result`);
    const windows = found.map(({ window }) => window);
    if (!windows.some(({ own }) => [own.start, own.end].filter(isTime).map(dayOf).some((day) => (line.Date ?? '').includes(day)))) problems.push(`${name}: its Date, ${JSON.stringify(line.Date)}, isn't the day of the window it cites`);
    if (!windows.some(({ own }) => own.machine?.model && (line.Machine ?? '').includes(own.machine.model))) problems.push(`${name}: its Machine, ${JSON.stringify(line.Machine)}, isn't the model of the window it cites`);
    if (!windows.some(({ own }) => own.machine?.macosBuild && (line['macOS build'] ?? '').includes(own.machine.macosBuild))) problems.push(`${name}: its macOS build, ${JSON.stringify(line['macOS build'])}, isn't the build of the window it cites`);
    if (!/\d/.test(line.Load ?? '')) problems.push(`${name}: its Load, ${JSON.stringify(line.Load)}, holds no number`);
  }
  return problems;
}

/** The table with one line made to read PASS with no record behind it: the planted table of AC3. */
export const planted = (table, name) => ({ ...table, lines: table.lines.map((line) => (line.Budget === name ? { ...line, Result: 'PASS', Record: '' } : line)) });

// --- the suites #1830 lists, and #1009's criterion ---

const runs = (task, paths) => Array.isArray(task.command) && task.command.some((part) => {
  const path = String(part).replace(/^\.\//, '').replace(/\/+$/, '');
  return paths.some((one) => path === one || path.startsWith(`${one}/`));
});
const headTasks = () => {
  try {
    return JSON.parse(readFileSync(join(CHECKOUT, MANIFEST), 'utf8')).tasks;
  } catch {
    return [];
  }
};
const rowsOf = ({ windows }, ids) => windows.flatMap(({ name, records }) => records.flatMap(({ file, value }) => value.tests.filter((row) => ids.includes(row.id)).map((row) => ({ window: name, file, record: value, row }))));
const forMissingLoad = (row) => row.state === 'INCONCLUSIVE' && /load/i.test(row.note ?? '') && /can'?t be read|cannot be read|missing|\bno loads?\b|not given/i.test(row.note ?? '');

/** AC5: each suite #1830 lists runs as a task that reads PASS or FAIL in a window, and none reads INCONCLUSIVE for a missing load. */
export function suitesRead(held) {
  const tasks = headTasks();
  return SUITES.flatMap(({ name, paths }) => {
    const ids = tasks.filter((task) => runs(task, paths)).map(({ id }) => id);
    if (!ids.length) return [`${name}: no task of ${MANIFEST} runs it (${paths.join(' or ')})`];
    const found = rowsOf(held, ids);
    const problems = found.filter(({ row }) => forMissingLoad(row)).map(({ file, row }) => `${name}: ${row.id} reads INCONCLUSIVE for a missing load in ${file}: ${row.note}`);
    if (!found.some(({ row }) => decided(row.state))) problems.push(`${name}: its tasks ${JSON.stringify(ids)} read ${JSON.stringify(found.map(({ row }) => row.state))} in the windows, never PASS or FAIL`);
    return problems;
  });
}

/** AC6: a task names #1009's criterion, a window's record settles it PASS or FAIL, and #1009 says which. */
export function settled1009(held, readIssue = issue1009) {
  const ids = headTasks().filter(({ criteria }) => Array.isArray(criteria) && criteria.includes(CRITERION_1009)).map(({ id }) => id);
  if (!ids.length) return [`no task of ${MANIFEST} names ${CRITERION_1009}, #1009's criterion`];
  const settled = rowsOf(held, ids).filter(({ row }) => decided(row.state));
  if (!settled.length) return [`no window's record settles ${CRITERION_1009}: its tasks ${JSON.stringify(ids)} read ${JSON.stringify(rowsOf(held, ids).map(({ row }) => row.state))}`];
  const issue = readIssue();
  if (issue.blocked) return [`BLOCKED: gh can't read #1009: ${issue.blocked}`];
  const texts = [issue.body ?? '', ...(issue.comments ?? []).map(({ body }) => body ?? '')];
  const says = ({ record, row }) => texts.some((text) => text.toLowerCase().includes(short(record.commit).slice(0, 7).toLowerCase())
    && (row.state === 'PASS' ? /\bpass(ed|es)?\b/i : /\bfail(ed|s)?\b|\bmissed\b/i).test(text));
  return settled.some(says) ? [] : [`#1009 doesn't say which: no comment or body names ${settled.map(({ record, row }) => `${short(record.commit)} (${row.state})`).join(', ')} with its verdict`];
}
function issue1009() {
  const read = spawnSync('gh', ['issue', 'view', '1009', '--json', 'state,body,comments'], { cwd: CHECKOUT, env: cleanEnv(), encoding: 'utf8' });
  if (read.status !== 0) return { blocked: (read.stderr || read.error?.message || `exit ${read.status}`).trim() };
  try {
    return JSON.parse(read.stdout);
  } catch (error) {
    return { blocked: error.message };
  }
}
