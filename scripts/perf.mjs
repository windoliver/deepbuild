import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, fingerprint, judgeLimit, measure, measureOnce, validateBudgets, warm } from './benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'benchmarks/budgets.json';
const run = (command, args, cwd = root, options = {}) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024, ...options });
// BLOCKED: perf could not compare. FAIL: a measurement broke its budget.
const blocked = (message, fix) => Object.assign(Error(message), { fix });
const regressed = 'Restore the regressed budget; budgets are frozen once they reach main.';
const verdicts = [];
const started = performance.now();
console.log('RUN perf');
let archive;
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
    // Git reads stay in this checkout. The merge base's checks read git, so the disposable copy gets
    // its own throwaway repository, committed without the user's hooks or signing.
    run('tar', ['-xf', '-', '-C', archive], root, { input: run('git', ['archive', baseCommit], root, { encoding: null }) });
    const git = (...args) => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=DeepBuild perf', '-c', 'user.email=perf@example.invalid', ...args], archive, { stdio: 'pipe' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', `merge base ${baseCommit}`);
    run('npm', ['ci', '--no-audit', '--no-fund'], archive);
    warm(archive);
    baseline = measureOnce([process.execPath, 'scripts/checks.mjs'], archive);
    if (baseline.status !== 0) throw blocked(`merge-base checks exited ${baseline.status}: ${baseline.output}`, 'Repair the checks on main; a failing merge base cannot be compared.');
  }
  const reading = ({ elapsedMs, cpuMs, peakBytes }) => ({ elapsedMs, cpuMs, peakBytes });
  const workloadBase = base?.preflight ? baseline : null;
  try {
    // One run per side: its wall time moves with machine load, so only CPU time and peak memory are
    // compared with the merge base. Wall time is held to the budget's cap by preflight.mjs.
    const outcome = compare({ id: 'preflight', ...current.preflight }, observed, workloadBase, ['cpuMs', 'peakBytes']);
    console.log(JSON.stringify({ task: 'preflight', baseCommit, ...outcome, samples: 1, current: reading(observed), base: workloadBase && reading(workloadBase), fingerprint: fingerprint() }));
  } catch (error) {
    verdicts.push(['FAIL', error.message, regressed]);
  }
  for (const budget of current.tasks) {
    const established = base?.tasks?.find(({ id }) => id === budget.id);
    let samples, runs;
    try {
      samples = measure(budget.command, root, established && { command: established.command, cwd: archive });
      // Each limit is judged on five runs, each its own warm-up round and 20 samples.
      runs = Array.from({ length: 5 }, () => measure(budget.command, root)[0]);
    } catch (error) {
      verdicts.push(['BLOCKED', `${budget.id}: ${error.message}`, 'Build the measured command; the check lanes build it.']);
      continue;
    }
    const [now, then = null] = samples;
    const machine = fingerprint();
    const limits = Object.fromEntries(Object.entries(budget.limits).map(([metric, limit]) => [metric, judgeLimit({ limit, runs: runs.map((run) => run[metric]), fingerprint: machine })]));
    let outcome;
    try {
      // compare holds only the merge-base regression here; the limits are judged above.
      outcome = compare({ ...budget, limits: {} }, now, then);
    } catch (error) {
      verdicts.push(['FAIL', error.message, regressed]);
    }
    console.log(JSON.stringify({ task: budget.id, baseCommit, ...outcome, current: now, base: then, fingerprint: machine, limits }));
    for (const [metric, { status, reason }] of Object.entries(limits)) {
      if (status === 'PASS') continue;
      const fix = status === 'BLOCKED' ? 'Repair the measured command so each run reports this metric.'
        : status === 'FAIL' ? `Bring ${budget.id} back under its ${metric} limit; budgets are frozen once they reach main.`
        : /reference Mac/.test(reason) ? 'Run perf on the reference Mac (Mac15,7, M3 Pro, 36 GB) on mains power, with Low Power Mode off and the thermal state nominal.'
        : 'Rerun perf on a quiet reference Mac; the five runs straddle the limit.';
      verdicts.push([status, `${budget.id}: ${metric}: ${reason}`, fix]);
    }
  }
} catch (error) {
  verdicts.push(['BLOCKED', error.message, error.fix ?? 'Resolve the named cause; budgets in benchmarks/budgets.json are frozen once they reach main.']);
} finally {
  if (archive) rmSync(archive, { recursive: true, force: true });
}
for (const [state, message, fix] of verdicts) console.log(`${state} perf: ${message}\n  Fix: ${fix}`);
if (verdicts.length) process.exitCode = 1;
else console.log(`PASS perf (${((performance.now() - started) / 1000).toFixed(2)} s)`);
