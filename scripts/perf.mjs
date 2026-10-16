import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, measure, measureOnce, validateBudgets, warm } from './benchmark.mjs';

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
    // All git reads stay in this checkout. The disposable archive has no .git.
    run('tar', ['-xf', '-', '-C', archive], root, { input: run('git', ['archive', baseCommit], root, { encoding: null }) });
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
    console.log(JSON.stringify({ task: 'preflight', baseCommit, ...outcome, samples: 1, current: reading(observed), base: workloadBase && reading(workloadBase) }));
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
  if (archive) rmSync(archive, { recursive: true, force: true });
}
for (const [state, message, fix] of verdicts) console.log(`${state} perf: ${message}\n  Fix: ${fix}`);
if (verdicts.length) process.exitCode = 1;
else console.log(`PASS perf (${((performance.now() - started) / 1000).toFixed(2)} s)`);
