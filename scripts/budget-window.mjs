// The budget window (docs/parallel-proof.md, section 12a). `throttle.mjs window` runs this with every slot drained: it
// measures each commit merged on origin/main since the last window against its own merge base, on the budget tasks the
// commit can reach, writes one evidence record per commit, and settles the commit's issue by that record. It runs only
// inside a window; agents never run it.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approvedItems, fingerprint, judgeTargets, judgeTask, prepareCopy, validateBudgets } from './benchmark.mjs';
import { worst, writeRecord } from './lanes.mjs';
import { holds } from './throttle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Every cargo the window starts runs bare by its own setting, never by the machine's: an empty RUSTC_WRAPPER is no
// wrapper over any cargo config, so a machine's compile cache never reaches a budget (docs/parallel-proof.md, section 4).
process.env.RUSTC_WRAPPER = '';
const manifest = 'benchmarks/budgets.json';
const folder = join(homedir(), '.deepbuild', 'budget-window');
const mark = join(folder, 'mark');
// A criterion's ID, as the trace lane's criterionId reads it: the first eight hex digits of the SHA-256 of its text,
// trimmed, white space collapsed. A task of the budgets names the criteria it proves by these (#1874).
const criterionId = (number, text) => `#${number}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
function gh(...args) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}
function blocked(message, fix) {
  console.log(`BLOCKED budget-window: ${message}\n  Fix: ${fix}`);
  if (opened) closeWindow('BLOCKED', message);
  process.exit(2);
}
// The window's own record (#2674), beside its commits' records once it runs: its grant, start and end, the machine and
// its load, the commits it measured, the tasks it ran and those it reached on no commit, and the task that took longest.
// From the throttle it holds `drain`, the milliseconds from its request to its grant, and `waited`, the grants it
// waited on, by class (#3551).
// A window over one day's merges should end within two hours; its note names the longest task when it doesn't.
const LONG_MS = 2 * 60 * 60 * 1000;
let opened = null;
function closeWindow(state, note) {
  const end = new Date(), took = end - Date.parse(opened.start);
  const ran = [...new Set(opened.rows.map(({ task }) => task))];
  const longest = opened.rows.reduce((most, row) => (row.ms > (most?.ms ?? -1) ? row : most), null);
  const over = took > LONG_MS && `the window took ${Math.round(took / 60_000)} min, past ${LONG_MS / 60_000} min; its longest task was ${longest ? `${longest.task} on ${longest.commit}, ${Math.round(longest.ms / 60_000)} min` : 'none'}`;
  const notes = [note, over].filter(Boolean);
  const { rows, unreached, ...kept } = opened;
  const folder = join(homedir(), '.deepbuild', 'lanes');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(join(folder, `budget-window-${opened.start.replace(/[:.]/g, '-')}.json`), `${JSON.stringify({
    ...kept, state, end: end.toISOString(), loadEnd: loadavg()[0], ran, notReached: [...new Set(unreached)].filter((id) => !ran.includes(id)), longest, ...notes.length && { note: notes.join('; ') },
  }, null, 2)}\n`);
}
const outside = 'Only a scheduled `throttle.mjs window` runs this; agents never do.';
const inWindow = () => holds('timed', { window: true });
// The selection affected.mjs makes for tests (#1981). A checkout that can't load it places no task, so each one runs.
const selection = await import('./affected.mjs').catch((error) => error);

/** What a commit on main's first-parent line changed: a merge's branch tip against its merge base, or the commit against its parent. */
function sides(commit) {
  const [first, second] = git('rev-list', '--parents', '-n', '1', commit).split(' ').slice(1);
  return second ? { change: second, base: git('merge-base', first, second) } : { change: commit, base: first };
}
const budgetsAt = (commit) => (git('ls-tree', '--name-only', commit, manifest) ? JSON.parse(git('show', `${commit}:${manifest}`)) : null);

/** A side's tree of `commit`, at the same path every window, so the builds kept beside it stay valid. */
function treeOf(side, commit) {
  const directory = join(folder, side, 'copy');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  // -m stamps the files now: Cargo goes by mtime, and an older commit would otherwise look fresh.
  execFileSync('tar', ['-mxf', '-', '-C', directory], { input: execFileSync('git', ['archive', commit], { cwd: root, maxBuffer: 1 << 28 }) });
  return directory;
}
/** A side's tree made ready to run tasks in, its builds kept beside it. */
function ready(side, directory) {
  process.env.CARGO_TARGET_DIR = join(folder, side, 'target');
  mkdirSync(process.env.CARGO_TARGET_DIR, { recursive: true });
  try {
    prepareCopy(directory);
  } finally {
    delete process.env.CARGO_TARGET_DIR;
  }
  return directory;
}

/**
 * The ids of the tasks a commit can reach, by the selection affected.mjs makes for tests over the commit's tree and
 * what it changed against its merge base: those it reaches or marks wide, and those it can't place (#1981). With no
 * selection, every task runs.
 */
function reachable(tree, { change, base }, tasks) {
  try {
    if (selection instanceof Error) throw selection;
    const list = (...args) => git(...args).split('\0').filter(Boolean);
    const changed = list('diff', '--name-only', '-z', '--no-renames', base, change);
    return new Set(selection.select(tree, changed, { files: list('ls-tree', '-r', '-z', '--name-only', change), workspace: selection.crates(tree), tasks }).tasks);
  } catch (error) {
    console.log(`NOTE budget-window: no task of ${change} could be placed, so each runs: ${error.message.split('\n')[0]}`);
    return new Set(tasks.map(({ id }) => id));
  }
}

/** A side's numbers, so two commits compare and a climb can be drawn: p50, p95, peak bytes and each round's instructions retired. */
const numbersOf = (side) => side && { p50Ms: side.p50Ms, p95Ms: side.p95Ms, peakBytes: side.peakBytes, instructions: side.instructions, work: side.work };

/**
 * A task's row in the record: as perf reads it, with a load at or above the cores at any run's start or end, or at the
 * task's end, never a PASS (invariant 2), and each limit's verdict, against the merge base's value, with its readings
 * (#2665). A count's limit holds on any machine, so its FAIL stands under any load. The row keeps each side's numbers,
 * the load at each run's start and end (both sides' rounds, then the limit runs), and how long the task took (#2674).
 */
function judged(task, established, cwd, baseCwd, approved) {
  const started = Date.now();
  let misses, limits, sides, loads;
  try {
    const result = judgeTask(task, established, cwd, baseCwd, undefined, approved);
    limits = result.limits;
    sides = { change: numbersOf(result.now), base: numbersOf(result.then) };
    loads = [...result.now.loads, ...result.then?.loads ?? [], ...result.loads];
    const targets = task.targets ? judgeTargets(task, cwd) : null;
    const cores = cpus().length, read = [...loads.flatMap(({ start, end }) => [start, end]), loadavg()[0]];
    const high = read.every(Number.isFinite) ? Math.max(...read) : null;
    misses = [
      ...result.regression ? [{ status: 'FAIL', reason: result.regression }] : [],
      ...Object.entries(limits).map(([metric, limit]) => ({ ...limit, reason: `${metric}: ${limit.reason}` })),
      ...result.instructions ? [{ ...result.instructions, reason: `instructions: ${result.instructions.reason}` }] : [],
      ...result.work ? [{ ...result.work, reason: `work: ${result.work.reason}` }] : [],
      ...result.lowering ? [result.lowering] : [],
      ...targets ? [{ ...targets, reason: `targets: ${targets.reason}` }] : [],
      ...high !== null && high < cores ? [] : [{ status: 'INCONCLUSIVE', reason: high === null ? "a run's load couldn't be read" : `the load was ${high.toFixed(1)} on ${cores} cores` }],
    ].filter(({ status }) => status !== 'PASS');
  } catch (error) {
    misses = [{ status: 'BLOCKED', reason: error.message }];
  }
  const state = worst(misses.map(({ status }) => status)) ?? 'PASS';
  return { id: task.id, state, ...misses.length && { note: misses.map(({ reason }) => reason).join('; ') }, ...limits && { limits }, ...sides && { sides, loads }, ms: Date.now() - started };
}

/** A row's limits whose highest reading is more than 20% under them, with both numbers, so slack is seen (#2665). */
const slackOf = ({ id, limits }) => Object.entries(limits ?? {}).flatMap(([metric, { limit, runs }]) => {
  if (!runs?.length || !runs.every(Number.isFinite)) return [];
  const reading = Math.max(...runs);
  return reading < 0.8 * limit ? [{ id, metric, limit, reading }] : [];
});

const middleOf = (reading) => {
  if (!Array.isArray(reading)) return reading;
  const sorted = [...reading].sort((a, b) => a - b), half = sorted.length / 2;
  return !sorted.every(Number.isFinite) ? null : sorted.length % 2 ? sorted[Math.floor(half)] : (sorted[half - 1] + sorted[half]) / 2;
};
const fallsOf = ({ id, sides }) => (sides?.base ? ['p50Ms', 'p95Ms', 'peakBytes', 'instructions'] : []).flatMap((metric) => {
  const base = middleOf(sides.base[metric]), change = middleOf(sides.change[metric]);
  return Number.isFinite(base) && Number.isFinite(change) && change < 0.5 * base ? [{ id, metric, base, change }] : [];
});

function measured(commit) {
  const { change, base } = sides(commit);
  let tests, named = new Set(), notReached = [], lowered = [], noCeiling = null, slack = [], noWork = null, falls = [];
  try {
    const current = budgetsAt(change), established = budgetsAt(base), approved = approvedItems(root, base, change);
    // A limit only moves down (#2665): a commit may lower one, and a raise, a removal, a wider margin or a new command
    // passes only by an approved proposal on its commits. Its tasks are judged by the merge base's numbers either way.
    const moved = validateBudgets(current, established, approved);
    const here = treeOf('change', change), reach = reachable(here, { change, base }, current.tasks);
    // A task the commit can't reach doesn't run: its record lists it as not reached, never PASS. With none to run, no
    // copy is built.
    const run = current.tasks.filter(({ id }) => reach.has(id));
    notReached = current.tasks.filter(({ id }) => !reach.has(id)).map(({ id }) => id);
    if (run.length) ready('change', here);
    const there = run.length && established ? ready('base', treeOf('base', base)) : null;
    tests = run.map((task) => judged(task, established?.tasks.find(({ id }) => id === task.id), here, there, approved));
    // Each lowered limit keeps the merge base's value, the commit's, and the readings judged against the first.
    lowered = moved.map((entry) => ({ ...entry, runs: tests.find(({ id }) => id === entry.id)?.limits?.[entry.metric]?.runs ?? null }));
    // The tasks with no limit, by name, and how many: a task with targets has a judge of its own.
    const open = current.tasks.filter((task) => !Object.keys(task.limits).length && !task.targets).map(({ id }) => id);
    noCeiling = { count: open.length, tasks: open };
    slack = tests.flatMap(slackOf);
    const silent = tests.filter(({ sides }) => sides && sides.change.work === undefined).map(({ id }) => id);
    noWork = { count: silent.length, tasks: silent };
    falls = tests.flatMap(fallsOf);
    // What the commit's tasks proved (#1874): each that ran names its criteria by ID, and only its numbers stay the merge
    // base's. A criterion only an unreached task names stays unmeasured.
    named = new Set(run.flatMap(({ criteria }) => criteria ?? []));
  } catch (error) {
    tests = [{ id: manifest, state: 'BLOCKED', note: error.message }];
  }
  return { commit, change, base, tests, named, notReached, lowered, noCeiling, slack, noWork, falls, state: worst(tests.map(({ state }) => state)) ?? 'PASS' };
}

/** The issues a commit's messages name, as GitHub reads them, in this repository. */
function issuesOf(commit) {
  const { change, base } = sides(commit);
  const messages = `${git('log', '-1', '--format=%B', commit)}\n${git('log', '--format=%B', `${base}..${change}`)}`;
  return [...new Set([...messages.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\s+#(\d+)\b/gi)].map(([, number]) => number))];
}

/** An issue's unticked criteria, by ID; null when it has no `### Acceptance criteria` section to hold any. */
function unticked({ number, body }) {
  const section = body.split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0];
  return section === undefined ? null : [...section.matchAll(/^\s*- \[ \] (.+)$/gm)].map(([, text]) => criterionId(number, text));
}

function ticked(issue, tree) {
  const name = `${tree}-trace.json`, heading = /^###\s+Acceptance criteria\s*$/m.exec(issue.body);
  if (!heading) return issue;
  let proven;
  try {
    proven = new Set(JSON.parse(readFileSync(join(homedir(), '.deepbuild', 'lanes', name), 'utf8')).tests.filter(({ state }) => state === 'PASS').map(({ id }) => id));
  } catch {
    return issue;
  }
  const from = heading.index + heading[0].length, next = issue.body.slice(from).search(/^#{1,6}\s/m), to = next < 0 ? issue.body.length : from + next;
  const section = issue.body.slice(from, to).replace(/^([ \t]*)- \[ \] (.+?)(\r?)$/gm, (line, indent, text, cr) => (proven.has(criterionId(issue.number, text)) ? `${indent}- [x] ${text}${cr}\n${indent}  - Proved by the trace lane's record \`${name}\`${cr}` : line));
  const body = issue.body.slice(0, from) + section + issue.body.slice(to);
  if (body !== issue.body) gh('issue', 'edit', issue.number, '--body', body);
  return { ...issue, body };
}

// A miss files its follow-up first, so a failed call leaves the commit for the next window with nothing half said.
function miss({ commit, base, tests }, issues) {
  const missed = tests.filter(({ state }) => state === 'FAIL').map(({ id, note }) => `- \`${id}\`: ${note}`).join('\n');
  const names = issues.map((number) => `#${number}`).join(', ') || 'no issue';
  gh('issue', 'create', '--title', `Budget regression in ${commit.slice(0, 12)} (${names})`, '--body', `The budget window measured ${commit}, of ${names}, against its merge base ${base}, and it missed its budget:\n\n${missed}`);
  for (const number of issues) gh('issue', 'comment', number, '--body', `The budget window measured ${commit} against its merge base ${base} and it missed:\n\n${missed}`);
}
// A pass closes an issue only on criteria it measured: the issue holds one still unticked, and a task that ran names
// each such one (the record passes only when every task that ran did); a `Part of #n` merge ticks the others. An issue
// with no criteria section, or none left unticked, holds nothing the window measured, so the window never closes it.
function close(record, issue) {
  const open = unticked(issue);
  if (issue.state === 'OPEN' && open?.length && open.every((id) => record.named.has(id))) gh('issue', 'close', issue.number, '--comment', `The budget window measured ${record.commit} against its merge base ${record.base}: every budget passed, and a task names each criterion left open.`);
}

if (!inWindow()) blocked('outside a budget window', outside);
mkdirSync(folder, { recursive: true, mode: 0o700 });
try {
  // With the approvals, which may hold a raised limit's proposal (#2665).
  git('fetch', '-q', 'origin', 'main', '+refs/tags/deep/approved/*:refs/tags/deep/approved/*');
} catch (error) {
  blocked(`can't fetch main: ${error.message}`, 'Restore the network or the remote; every commit stays for the next window.');
}
// Read once: a commit merged from here on is the next window's.
const tip = git('rev-parse', 'origin/main');
const from = existsSync(mark) ? readFileSync(mark, 'utf8').trim() : null;
opened = { lane: 'budget-window', grant: process.env.DEEP_WINDOW ?? null, ...JSON.parse(process.env.DEEP_WINDOW_DRAIN ?? '{}'), start: new Date().toISOString(), machine: fingerprint(), cores: cpus().length, loadStart: loadavg()[0], from, tip, commits: [], records: {}, rows: [], unreached: [] };
if (!from) {
  writeFileSync(mark, tip);
  closeWindow('PASS', `the first window on this machine marks ${tip}`);
  console.log(`PASS budget-window: the first window on this machine marks ${tip}; the commits after it are measured`);
  process.exit(0);
}
const commits = git('rev-list', '--first-parent', '--reverse', `${from}..${tip}`).split('\n').filter(Boolean);
const issues = new Map(commits.map((commit) => [commit, issuesOf(commit)]));
const held = new Set(), states = [];
for (const [at, commit] of commits.entries()) {
  const record = measured(commit);
  // A holder that died took the window with it, so what ran after is no measurement. The mark stays.
  if (!inWindow()) blocked(`the window closed while measuring ${commit}`, outside);
  const tree = git('rev-parse', `${record.change}^{tree}`);
  // Its issues are read before its record is written, which names each criterion they leave unticked that no task names.
  let read;
  try {
    read = issues.get(commit).map((number) => ticked({ number, ...JSON.parse(gh('issue', 'view', number, '--json', 'state,body')) }, tree));
  } catch (error) {
    blocked(`${commit}'s issues weren't read: ${error.message}`, 'Sign in to gh; the next window measures this commit again.');
  }
  const unmeasured = read.flatMap((issue) => (unticked(issue) ?? []).filter((id) => !record.named.has(id)));
  const file = writeRecord(`budget-window ${commit}`, record.state, tree, record.tests, { commit, base: record.base, unmeasured, notReached: record.notReached, lowered: record.lowered, noCeiling: record.noCeiling, slack: record.slack, noWork: record.noWork, falls: record.falls });
  opened.commits.push(commit);
  opened.records[commit] = basename(file);
  opened.rows.push(...record.tests.filter(({ id }) => id !== manifest).map(({ id, ms }) => ({ task: id, commit, ms })));
  opened.unreached.push(...record.notReached);
  states.push(record.state);
  console.log(`${record.state} budget-window: ${commit} against ${record.base}, ${record.tests.length} tasks run, ${record.notReached.length} not reached`);
  try {
    if (record.state === 'FAIL') miss(record, issues.get(commit));
    if (record.state !== 'PASS') for (const number of issues.get(commit)) held.add(number);
    // An issue another commit still has to answer for stays open, in this window or by its record.
    else for (const issue of read) if (!held.has(issue.number) && !commits.slice(at + 1).some((later) => issues.get(later).includes(issue.number))) close(record, issue);
  } catch (error) {
    blocked(`${commit}'s issue wasn't settled: ${error.message}`, 'Sign in to gh; the next window measures this commit again.');
  }
  writeFileSync(mark, commit);
}
closeWindow(worst(states) ?? 'PASS');
console.log(`PASS budget-window: ${commits.length} commits measured up to ${tip}`);
