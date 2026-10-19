import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, measure, measureOnce, validateBudgets, warm } from './benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'benchmarks/budgets.json';
const run = (command, args, cwd = root, options = {}) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024, ...options });
const files = (args) => run('git', [...args, '-z']).split('\0').filter(Boolean);
// BLOCKED: perf could not compare. FAIL: a measurement broke its budget.
const blocked = (message, fix) => Object.assign(Error(message), { fix });
const regressed = 'Restore the regressed budget; budgets are frozen once they reach main.';
// A directory of npm ci, warm builds and the check workload, timed once like the merge base. The checks
// read git, so each disposable copy gets its own throwaway repository, committed without the user's
// hooks or signing.
function checkRun(directory) {
  const git = (...args) => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=DeepBuild perf', '-c', 'user.email=perf@example.invalid', ...args], directory, { stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'perf copy');
  run('npm', ['ci', '--no-audit', '--no-fund'], directory);
  warm(directory);
  return measureOnce([process.execPath, 'scripts/checks.mjs'], directory);
}
const verdicts = [];
const started = performance.now();
console.log('RUN perf');
let archive, without;
try {
  const observed = JSON.parse(process.argv[2] ?? '{}');
  if (observed.status !== 0) throw blocked('the current check workload did not pass, so there is nothing to compare', 'Repair the failing check lanes; perf runs once they pass.');
  let baseCommit;
  try {
    baseCommit = run('git', ['merge-base', 'HEAD', 'origin/main'], root, { stdio: 'pipe' }).trim();
  } catch {
    throw blocked('no merge base with origin/main to compare against', 'Fetch main so the merge base exists: git fetch origin main');
  }
  const current = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  const base = run('git', ['ls-tree', '--name-only', baseCommit, manifest]).trim()
    ? JSON.parse(run('git', ['show', `${baseCommit}:${manifest}`])) : null;
  validateBudgets(current, base);
  if (!current.preflight) throw Error('missing preflight budget');
  let baseline = null;
  if (base?.preflight || base?.tasks?.length) {
    archive = mkdtempSync(join(tmpdir(), 'deep-benchmark-base-'));
    // Git reads stay in this checkout; checkRun gives the disposable copy a repository of its own.
    run('tar', ['-xf', '-', '-C', archive], root, { input: run('git', ['archive', baseCommit], root, { encoding: null }) });
    baseline = checkRun(archive);
    if (baseline.status !== 0) throw blocked(`merge-base checks exited ${baseline.status}: ${baseline.output}`, 'Repair the checks on main; a failing merge base cannot be compared.');
  }
  const reading = ({ elapsedMs, cpuMs, peakBytes }) => ({ elapsedMs, cpuMs, peakBytes });
  const workloadBase = base?.preflight ? baseline : null;
  // The change's own test files, committed or not: preflight runs on the working tree.
  const changed = workloadBase ? [...new Set([
    ...files(['diff', '--name-only', '--no-renames', '--diff-filter=AM', baseCommit]),
    ...files(['ls-files', '--others', '--exclude-standard']),
  ])] : [];
  // The declared test paths come from the lanes, loaded only when there is a changed file to sort.
  const { testPaths } = changed.length ? await import('./lanes.mjs') : { testPaths: [] };
  const testPattern = RegExp(`^(?:${testPaths.map((glob) => glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*/g, (wild) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*' })[wild])).join('|')})$`);
  const ownTests = changed.filter((file) => testPattern.test(file));
  let rest = null;
  if (ownTests.length) {
    without = mkdtempSync(join(tmpdir(), 'deep-benchmark-without-tests-'));
    for (const file of files(['ls-files', '--cached', '--others', '--exclude-standard'])) {
      if (ownTests.includes(file) || !existsSync(join(root, file))) continue;
      mkdirSync(dirname(join(without, file)), { recursive: true });
      copyFileSync(join(root, file), join(without, file));
    }
    rest = checkRun(without);
    if (rest.status !== 0) {
      console.log(rest.output.trim());
      const cause = rest.output.split('\n').map((line) => line.trim()).find((line) => /\berror\b/i.test(line)) ?? 'see the output above';
      throw blocked(`checks without the change's own tests exited ${rest.status}: ${cause}`, 'Make the other checks pass without the added or modified test files; perf compares that run with the merge base.');
    }
  }
  try {
    // One run per side: its wall time moves with machine load, so only CPU time and peak memory are
    // compared with the merge base. Wall time is held to the budget's cap by preflight.mjs. The tests a
    // change adds or modifies are its proof, not a slowdown: the checks without them are compared with
    // the merge base, and the full run only with the caps.
    if (rest) console.log(`perf: the change's own tests (${ownTests.join(', ')}) account for ${observed.cpuMs - rest.cpuMs} ms of CPU; the checks without them are compared with the merge base`);
    const workload = { id: 'preflight', ...current.preflight };
    // Each run is judged on its own, so a regression against the base never hides the full run's cap.
    const [outcome, full = outcome] = [[rest ?? observed, workloadBase], ...rest ? [[observed, null]] : []].map(([run, against]) => {
      try {
        return compare(workload, run, against, ['cpuMs', 'peakBytes']);
      } catch (error) {
        verdicts.push(['FAIL', error.message, regressed]);
        return null;
      }
    });
    if (outcome && full) console.log(JSON.stringify({ task: 'preflight', baseCommit, ...outcome, samples: 1, current: reading(rest ?? observed), base: workloadBase && reading(workloadBase),
      ...rest && { full: reading(observed), ownTests, ownTestsCpuMs: observed.cpuMs - rest.cpuMs } }));
  } catch (error) {
    verdicts.push(['FAIL', error.message, regressed]);
  }
  for (const budget of current.tasks) {
    const established = base?.tasks?.find(({ id }) => id === budget.id);
    let samples;
    try {
      samples = measure(budget.command, root, established && { command: established.command, cwd: archive });
    } catch (error) {
      verdicts.push(['BLOCKED', `${budget.id}: ${error.message}`, 'Build the measured command; the check lanes build it.']);
      continue;
    }
    const [now, then = null] = samples;
    try {
      console.log(JSON.stringify({ task: budget.id, baseCommit, ...compare(budget, now, then), current: now, base: then }));
    } catch (error) {
      verdicts.push(['FAIL', error.message, regressed]);
    }
  }
} catch (error) {
  verdicts.push(['BLOCKED', error.message, error.fix ?? 'Resolve the named cause; budgets in benchmarks/budgets.json are frozen once they reach main.']);
} finally {
  for (const directory of [archive, without]) if (directory) rmSync(directory, { recursive: true, force: true });
}
for (const [state, message, fix] of verdicts) console.log(`${state} perf: ${message}\n  Fix: ${fix}`);
if (verdicts.length) process.exitCode = 1;
else console.log(`PASS perf (${((performance.now() - started) / 1000).toFixed(2)} s)`);
