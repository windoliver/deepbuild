// The budget window (docs/parallel-proof.md, section 12a). `throttle.mjs window` runs this with every slot drained: it
// measures each commit merged on origin/main since the last window against its own merge base, on the budget tasks the
// commit can reach, writes one evidence record per commit, and settles the commit's issue by that record. It runs only
// inside a window; agents never run it.
// #2665's planted twin "own-number": the blind job's throwaway window with one fault. It judges each commit by the ceilings its own tree holds, so a lowering commit by its own new number.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { compare, fingerprint, judgeInstructions, judgeLimit, judgeTargets, measure, measureOnce, prepareCopy } from './benchmark.mjs';
import { worst, writeRecord } from './lanes.mjs';
import { readApprovals } from './proof-change.mjs';
import { holds } from './throttle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'benchmarks/budgets.json';
const folder = join(homedir(), '.deepbuild', 'budget-window');
const mark = join(folder, 'mark');
const criterionId = (number, text) => `#${number}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
function gh(...args) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}
function blocked(message, fix) {
  console.log(`BLOCKED budget-window: ${message}\n  Fix: ${fix}`);
  process.exit(2);
}
const outside = 'Only a scheduled `throttle.mjs window` runs this; agents never do.';
const inWindow = () => holds('timed', { window: true });
const selection = await import('./affected.mjs').catch((error) => error);

function sides(commit) {
  const [first, second] = git('rev-list', '--parents', '-n', '1', commit).split(' ').slice(1);
  return second ? { change: second, base: git('merge-base', first, second) } : { change: commit, base: first };
}
const budgetsAt = (commit) => (git('ls-tree', '--name-only', commit, manifest) ? JSON.parse(git('show', `${commit}:${manifest}`)) : null);

function treeOf(side, commit) {
  const directory = join(folder, side, 'copy');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  execFileSync('tar', ['-mxf', '-', '-C', directory], { input: execFileSync('git', ['archive', commit], { cwd: root, maxBuffer: 1 << 28 }) });
  return directory;
}
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

// #2665: the ceilings a task may carry. Time and memory count only on a reference Mac; a count on any machine.
const TIMES = ['p50Ms', 'p95Ms', 'peakBytes'];
const isCount = (metric) => metric === 'instructions' || /^report\.\w+$/.test(metric);

/** The items of the approvals on the commits of a change, as the guard reads them (#1326). */
function approvedItems({ change, base }) {
  const commits = git('rev-list', `${base}..${change}`).split('\n').filter(Boolean).map((sha) => ({ sha }));
  return [...readApprovals(root, { base, commits }, null).values()].flat();
}

/**
 * A ceiling only moves down (#2665): a change may lower a limit or narrow a margin, and the lowered ceilings are
 * returned; a raise, a removal, a wider margin or a new command is refused, naming the task and the field, unless an
 * approval on the change names that task, the field and its before-and-after numbers.
 */
function checked(current, established, approved) {
  if (!Array.isArray(current?.tasks)) throw Error('Missing budget tasks');
  const lowered = [];
  const allowed = (id, field, before, after) => approved.includes(`${manifest} › ${id} › ${field} ${before} → ${after}`);
  const refuse = (id, field, what) => {
    throw Error(`Budget ${id}: its ${field} ${what}, and no approved proposal names ${id} with its before-and-after numbers; restore it`);
  };
  for (const base of established?.tasks ?? []) {
    const now = current.tasks.find(({ id }) => id === base.id);
    if (!now) refuse(base.id, 'definition', 'disappeared');
    if (!isDeepStrictEqual(now.command, base.command) && !allowed(base.id, 'command', JSON.stringify(base.command), JSON.stringify(now.command))) refuse(base.id, 'command', `changed from ${JSON.stringify(base.command)} to ${JSON.stringify(now.command)}`);
    if (now.margin > base.margin && !allowed(base.id, 'margin', base.margin, now.margin)) refuse(base.id, 'margin', `widened from ${base.margin} to ${now.margin}`);
    for (const [field, before] of Object.entries(base.limits ?? {})) {
      const after = now.limits?.[field];
      if (after === undefined) {
        if (!allowed(base.id, field, before, 'none')) refuse(base.id, field, `limit was removed (it was ${before})`);
      } else if (after > before) {
        if (!allowed(base.id, field, before, after)) refuse(base.id, field, `limit was raised from ${before} to ${after}`);
      } else if (after < before) lowered.push({ id: base.id, metric: field, old: before, new: after });
    }
    for (const [name, before] of Object.entries(base.targets ?? {})) {
      const after = now.targets?.[name];
      if ((after === undefined || after > before) && !allowed(base.id, `targets.${name}`, before, after ?? 'none')) refuse(base.id, `targets.${name}`, `target moved from ${before} to ${after ?? 'none'}`);
    }
    // What a task proves isn't how it's judged; everything else stays as main has it.
    const rest = ({ command, margin, limits, targets, criteria, ...other }) => other;
    const other = Object.keys({ ...rest(now), ...rest(base) }).find((key) => !isDeepStrictEqual(now[key], base[key]));
    if (other) refuse(base.id, other, 'changed');
  }
  const ids = new Set();
  for (const task of current.tasks) {
    if (!task.id || ids.has(task.id)) throw Error('Missing or duplicate budget id');
    ids.add(task.id);
    if (!Array.isArray(task.command) || !task.command.length || task.command.some((part) => typeof part !== 'string' || !part)) throw Error(`${task.id}: invalid command`);
    if (!Number.isFinite(task.margin) || task.margin < 0) throw Error(`${task.id}: invalid margin`);
    if (typeof task.initialReason !== 'string' || !task.initialReason.trim()) throw Error(`${task.id}: first measurement requires a reason`);
    if (!task.limits || Object.entries(task.limits).some(([key, value]) => !(TIMES.includes(key) || isCount(key)) || !Number.isFinite(value) || value <= 0)) throw Error(`${task.id}: invalid limits`);
  }
  return lowered;
}

/** A count's ceiling, on any machine: FAIL when every reading is over it, PASS when each is within, and INCONCLUSIVE otherwise or with one missing. */
function judgeCount(limit, runs) {
  const missing = runs.filter((reading) => !Number.isFinite(reading)).length;
  if (!runs.length || missing) return { status: 'INCONCLUSIVE', limit, runs, reason: `the count is missing in ${missing} of ${runs.length} readings, so it can't be judged` };
  if (runs.every((reading) => reading > limit)) return { status: 'FAIL', limit, runs, reason: `every reading is over ${limit}` };
  if (runs.every((reading) => reading <= limit)) return { status: 'PASS', limit, runs };
  return { status: 'INCONCLUSIVE', limit, runs, reason: `the readings straddle ${limit}` };
}
/** The number `name` of a run's report, its last line that is a JSON object, or null. */
function reported(output, name) {
  try {
    const value = JSON.parse(output.trim().split('\n').filter((line) => line.trim().startsWith('{')).at(-1))[name];
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * A task's row: as perf reads it, against the ceilings its merge base holds (a change never moves its own budget), each
 * ceiling's verdict in `limits`, and a load at or above the cores never a PASS (invariant 2).
 */
function judged(task, established, cwd, baseCwd) {
  const ceilings = task.limits ?? {};
  const limits = {};
  let misses;
  try {
    const [now, then = null] = measure(task.command, cwd, established && { command: established.command, cwd: baseCwd });
    const once = () => {
      const result = measureOnce(task.command, cwd, false, undefined, false);
      if (result.status !== 0) throw Error(`${task.command[0]} exited ${result.status}: ${result.output}`);
      return result;
    };
    const runs = Object.keys(ceilings).length ? (once(), Array.from({ length: 5 }, once)) : [];
    const machine = fingerprint();
    const loads = runs.map(({ loadStart, loadEnd }) => ({ start: loadStart, end: loadEnd }));
    for (const [metric, limit] of Object.entries(ceilings)) {
      limits[metric] = metric === 'instructions' ? judgeCount(limit, now.instructions)
        : isCount(metric) ? judgeCount(limit, runs.map(({ output }) => reported(output, metric.slice('report.'.length))))
        : judgeLimit({ limit, runs: runs.map((run) => (metric === 'peakBytes' ? run.peakBytes : run.elapsedMs)), fingerprint: machine, loads });
    }
    const instructions = then && judgeInstructions(now.instructions.map((current, round) => ({ current, base: then.instructions[round] })), [...new Set([...now.uncounted, ...then.uncounted])]);
    let regression = null;
    try {
      compare({ ...task, limits: {} }, now, then);
    } catch (error) {
      regression = error.message;
    }
    const targets = task.targets ? judgeTargets(task, cwd) : null;
    const load = loadavg()[0], cores = cpus().length;
    misses = [
      ...regression ? [{ status: 'FAIL', reason: regression }] : [],
      ...Object.entries(limits).map(([metric, verdict]) => ({ ...verdict, reason: `${metric}: ${verdict.reason}` })),
      ...instructions ? [{ ...instructions, reason: `instructions against the merge base: ${instructions.reason}` }] : [],
      ...targets ? [{ ...targets, reason: `targets: ${targets.reason}` }] : [],
      ...load < cores ? [] : [{ status: 'INCONCLUSIVE', reason: `the load was ${load.toFixed(1)} on ${cores} cores` }],
    ].filter(({ status }) => status !== 'PASS');
  } catch (error) {
    misses = [{ status: 'BLOCKED', reason: error.message }];
  }
  const state = worst(misses.map(({ status }) => status)) ?? 'PASS';
  return { id: task.id, state, ...misses.length && { note: misses.map(({ reason }) => reason).join('; ') }, limits };
}

/** A row's ceilings whose highest reading is more than 20% under them. */
const slackOf = ({ id, limits }) => Object.entries(limits ?? {}).flatMap(([metric, { limit, runs }]) => {
  if (!runs?.length || !runs.every(Number.isFinite)) return [];
  const reading = Math.max(...runs);
  return reading < 0.8 * limit ? [{ id, metric, limit, reading }] : [];
});

function measured(commit) {
  const { change, base } = sides(commit);
  let tests, named = new Set(), notReached = [], lowered = [], noCeiling = null, slack = [];
  try {
    const current = budgetsAt(change), established = budgetsAt(base);
    lowered = checked(current, established, approvedItems({ change, base }));
    const here = treeOf('change', change), reach = reachable(here, { change, base }, current.tasks);
    const run = current.tasks.filter(({ id }) => reach.has(id));
    notReached = current.tasks.filter(({ id }) => !reach.has(id)).map(({ id }) => id);
    if (run.length) ready('change', here);
    const there = run.length && established ? ready('base', treeOf('base', base)) : null;
    tests = run.map((task) => judged(task, established?.tasks.find(({ id }) => id === task.id), here, there));
    named = new Set(run.flatMap(({ criteria }) => criteria ?? []));
    lowered = lowered.map((entry) => ({ ...entry, runs: tests.find(({ id }) => id === entry.id)?.limits[entry.metric]?.runs ?? null }));
    const uncapped = current.tasks.filter((task) => !Object.keys(task.limits ?? {}).length && !task.targets).map(({ id }) => id);
    noCeiling = { count: uncapped.length, tasks: uncapped };
    slack = tests.flatMap(slackOf);
  } catch (error) {
    tests = [{ id: manifest, state: 'BLOCKED', note: error.message }];
  }
  return { commit, change, base, tests, named, notReached, lowered, noCeiling, slack, state: worst(tests.map(({ state }) => state)) ?? 'PASS' };
}

function issuesOf(commit) {
  const { change, base } = sides(commit);
  const messages = `${git('log', '-1', '--format=%B', commit)}\n${git('log', '--format=%B', `${base}..${change}`)}`;
  return [...new Set([...messages.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\s+#(\d+)\b/gi)].map(([, number]) => number))];
}

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

function miss({ commit, base, tests }, issues) {
  const missed = tests.filter(({ state }) => state === 'FAIL').map(({ id, note }) => `- \`${id}\`: ${note}`).join('\n');
  const names = issues.map((number) => `#${number}`).join(', ') || 'no issue';
  gh('issue', 'create', '--title', `Budget regression in ${commit.slice(0, 12)} (${names})`, '--body', `The budget window measured ${commit}, of ${names}, against its merge base ${base}, and it missed its budget:\n\n${missed}`);
  for (const number of issues) gh('issue', 'comment', number, '--body', `The budget window measured ${commit} against its merge base ${base} and it missed:\n\n${missed}`);
}
function close(record, issue) {
  const open = unticked(issue);
  if (issue.state === 'OPEN' && open?.length && open.every((id) => record.named.has(id))) gh('issue', 'close', issue.number, '--comment', `The budget window measured ${record.commit} against its merge base ${record.base}: every budget passed, and a task names each criterion left open.`);
}

if (!inWindow()) blocked('outside a budget window', outside);
mkdirSync(folder, { recursive: true, mode: 0o700 });
try {
  // Approvals come with main: a person's tag on a change's commit is pushed beside it.
  git('fetch', '-q', 'origin', 'main', '+refs/tags/deep/approved/*:refs/tags/deep/approved/*');
} catch (error) {
  blocked(`can't fetch main: ${error.message}`, 'Restore the network or the remote; every commit stays for the next window.');
}
const tip = git('rev-parse', 'origin/main');
if (!existsSync(mark)) {
  writeFileSync(mark, tip);
  console.log(`PASS budget-window: the first window on this machine marks ${tip}; the commits after it are measured`);
  process.exit(0);
}
const commits = git('rev-list', '--first-parent', '--reverse', `${readFileSync(mark, 'utf8').trim()}..${tip}`).split('\n').filter(Boolean);
const issues = new Map(commits.map((commit) => [commit, issuesOf(commit)]));
const held = new Set();
for (const [at, commit] of commits.entries()) {
  const record = measured(commit);
  if (!inWindow()) blocked(`the window closed while measuring ${commit}`, outside);
  const tree = git('rev-parse', `${record.change}^{tree}`);
  let read;
  try {
    read = issues.get(commit).map((number) => ticked({ number, ...JSON.parse(gh('issue', 'view', number, '--json', 'state,body')) }, tree));
  } catch (error) {
    blocked(`${commit}'s issues weren't read: ${error.message}`, 'Sign in to gh; the next window measures this commit again.');
  }
  const unmeasured = read.flatMap((issue) => (unticked(issue) ?? []).filter((id) => !record.named.has(id)));
  writeRecord(`budget-window ${commit}`, record.state, tree, record.tests, { commit, base: record.base, unmeasured, notReached: record.notReached, lowered: record.lowered, noCeiling: record.noCeiling, slack: record.slack });
  console.log(`${record.state} budget-window: ${commit} against ${record.base}, ${record.tests.length} tasks run, ${record.notReached.length} not reached`);
  try {
    if (record.state === 'FAIL') miss(record, issues.get(commit));
    if (record.state !== 'PASS') for (const number of issues.get(commit)) held.add(number);
    else for (const issue of read) if (!held.has(issue.number) && !commits.slice(at + 1).some((later) => issues.get(later).includes(issue.number))) close(record, issue);
  } catch (error) {
    blocked(`${commit}'s issue wasn't settled: ${error.message}`, 'Sign in to gh; the next window measures this commit again.');
  }
  writeFileSync(mark, commit);
}
console.log(`PASS budget-window: ${commits.length} commits measured up to ${tip}`);
