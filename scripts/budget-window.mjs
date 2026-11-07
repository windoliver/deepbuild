// The budget window (docs/parallel-proof.md, section 12a). `throttle.mjs window` runs this with every slot drained: it
// measures each commit merged on origin/main since the last window against its own merge base, writes one evidence
// record per commit, and settles the commit's issue by that record. It runs only inside a window; agents never run it.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeTargets, judgeTask, prepareCopy, validateBudgets } from './benchmark.mjs';
import { worst, writeRecord } from './lanes.mjs';
import { holds } from './throttle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'benchmarks/budgets.json';
const folder = join(homedir(), '.deepbuild', 'budget-window');
const mark = join(folder, 'mark');
// Section 12a's reading rule: these criteria are the window's own to prove.
const budgetCriterion = /budget|reference Mac|in the local preflight/i;
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

/** What a commit on main's first-parent line changed: a merge's branch tip against its merge base, or the commit against its parent. */
function sides(commit) {
  const [first, second] = git('rev-list', '--parents', '-n', '1', commit).split(' ').slice(1);
  return second ? { change: second, base: git('merge-base', first, second) } : { change: commit, base: first };
}
const budgetsAt = (commit) => (git('ls-tree', '--name-only', commit, manifest) ? JSON.parse(git('show', `${commit}:${manifest}`)) : null);

/** A side's copy of `commit`, at the same path every window, so the builds kept beside it stay valid. */
function copyOf(side, commit) {
  const directory = join(folder, side, 'copy');
  process.env.CARGO_TARGET_DIR = join(folder, side, 'target');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  mkdirSync(process.env.CARGO_TARGET_DIR, { recursive: true });
  try {
    // -m stamps the files now: Cargo goes by mtime, and an older commit would otherwise look fresh.
    execFileSync('tar', ['-mxf', '-', '-C', directory], { input: execFileSync('git', ['archive', commit], { cwd: root, maxBuffer: 1 << 28 }) });
    prepareCopy(directory);
  } finally {
    delete process.env.CARGO_TARGET_DIR;
  }
  return directory;
}

/** A task's row in the record: as perf reads it, with a load at or above the cores never a PASS (invariant 2). */
function judged(task, established, cwd, baseCwd) {
  let misses;
  try {
    const { limits, instructions, regression } = judgeTask(task, established, cwd, baseCwd);
    const targets = task.targets ? judgeTargets(task, cwd) : null;
    const load = loadavg()[0], cores = cpus().length;
    misses = [
      ...regression ? [{ status: 'FAIL', reason: regression }] : [],
      ...Object.entries(limits).map(([metric, limit]) => ({ ...limit, reason: `${metric}: ${limit.reason}` })),
      ...instructions ? [{ ...instructions, reason: `instructions: ${instructions.reason}` }] : [],
      ...targets ? [{ ...targets, reason: `targets: ${targets.reason}` }] : [],
      ...load < cores ? [] : [{ status: 'INCONCLUSIVE', reason: `the load was ${load.toFixed(1)} on ${cores} cores` }],
    ].filter(({ status }) => status !== 'PASS');
  } catch (error) {
    misses = [{ status: 'BLOCKED', reason: error.message }];
  }
  const state = worst(misses.map(({ status }) => status)) ?? 'PASS';
  return { id: task.id, state, ...misses.length && { note: misses.map(({ reason }) => reason).join('; ') } };
}

function measured(commit) {
  const { change, base } = sides(commit);
  let tests;
  try {
    const current = budgetsAt(change), established = budgetsAt(base);
    // Budget numbers stay as the merge base has them: a commit's own edit of one is no pass.
    validateBudgets(current, established);
    const here = copyOf('change', change), there = established ? copyOf('base', base) : null;
    tests = current.tasks.map((task) => judged(task, established?.tasks.find(({ id }) => id === task.id), here, there));
  } catch (error) {
    tests = [{ id: manifest, state: 'BLOCKED', note: error.message }];
  }
  return { commit, change, base, tests, state: worst(tests.map(({ state }) => state)) ?? 'PASS' };
}

/** The issues a commit's messages name, as GitHub reads them, in this repository. */
function issuesOf(commit) {
  const { change, base } = sides(commit);
  const messages = `${git('log', '-1', '--format=%B', commit)}\n${git('log', '--format=%B', `${base}..${change}`)}`;
  return [...new Set([...messages.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\s+#(\d+)\b/gi)].map(([, number]) => number))];
}

/** Every criterion is ticked but the window's own: a `Part of #n` merge ticks those it proved (section 12a). */
function otherCriteriaProven(body) {
  const section = body.split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  return [...section.matchAll(/^\s*- \[ \] (.+)$/gm)].every(([, text]) => budgetCriterion.test(text));
}

// A miss files its follow-up first, so a failed call leaves the commit for the next window with nothing half said.
function miss({ commit, base, tests }, issues) {
  const missed = tests.filter(({ state }) => state === 'FAIL').map(({ id, note }) => `- \`${id}\`: ${note}`).join('\n');
  const names = issues.map((number) => `#${number}`).join(', ') || 'no issue';
  gh('issue', 'create', '--title', `Budget regression in ${commit.slice(0, 12)} (${names})`, '--body', `The budget window measured ${commit}, of ${names}, against its merge base ${base}, and it missed its budget:\n\n${missed}`);
  for (const number of issues) gh('issue', 'comment', number, '--body', `The budget window measured ${commit} against its merge base ${base} and it missed:\n\n${missed}`);
}
function close(record, number) {
  const { state, body } = JSON.parse(gh('issue', 'view', number, '--json', 'state,body'));
  if (state === 'OPEN' && otherCriteriaProven(body)) gh('issue', 'close', number, '--comment', `The budget window measured ${record.commit} against its merge base ${record.base}: every budget passed.`);
}

if (!inWindow()) blocked('outside a budget window', outside);
mkdirSync(folder, { recursive: true, mode: 0o700 });
try {
  git('fetch', '-q', 'origin', 'main');
} catch (error) {
  blocked(`can't fetch main: ${error.message}`, 'Restore the network or the remote; every commit stays for the next window.');
}
// Read once: a commit merged from here on is the next window's.
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
  // A holder that died took the window with it, so what ran after is no measurement. The mark stays.
  if (!inWindow()) blocked(`the window closed while measuring ${commit}`, outside);
  writeRecord(`budget-window ${commit}`, record.state, git('rev-parse', `${record.change}^{tree}`), record.tests, { commit, base: record.base });
  console.log(`${record.state} budget-window: ${commit} against ${record.base}`);
  try {
    if (record.state === 'FAIL') miss(record, issues.get(commit));
    if (record.state !== 'PASS') for (const number of issues.get(commit)) held.add(number);
    // An issue another commit still has to answer for stays open, in this window or by its record.
    else for (const number of issues.get(commit)) if (!held.has(number) && !commits.slice(at + 1).some((later) => issues.get(later).includes(number))) close(record, number);
  } catch (error) {
    blocked(`${commit}'s issue wasn't settled: ${error.message}`, 'Sign in to gh; the next window measures this commit again.');
  }
  writeFileSync(mark, commit);
}
console.log(`PASS budget-window: ${commits.length} commits measured up to ${tip}`);
