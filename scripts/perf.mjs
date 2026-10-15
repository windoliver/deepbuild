import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, measure, measureOnce, validateBudgets } from './benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'benchmarks/budgets.json';
const run = (command, args, cwd = root, options = {}) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024, ...options });
let archive, baselineWorkload, baselineError;
try {
  const baseCommit = run('git', ['merge-base', 'HEAD', 'origin/main']).trim();
  const current = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  const base = run('git', ['ls-tree', '--name-only', baseCommit, manifest]).trim()
    ? JSON.parse(run('git', ['show', `${baseCommit}:${manifest}`])) : null;
  validateBudgets(current, base);
  if (base?.preflight || base?.tasks.length) {
    archive = mkdtempSync(join(tmpdir(), 'deep-benchmark-base-'));
    // All git reads stay in this checkout. The disposable archive has no .git.
    const source = run('git', ['archive', baseCommit], root, { encoding: null });
    run('tar', ['-xf', '-', '-C', archive], root, { input: source });
    try {
      run('npm', ['ci', '--no-audit', '--no-fund'], archive);
      baselineWorkload = measureOnce([process.execPath, 'scripts/checks.mjs'], archive);
      if (baselineWorkload.status !== 0) throw Error(`base checks exited ${baselineWorkload.status}: ${baselineWorkload.output}`);
    } catch (error) {
      baselineError = error;
      console.error(`BLOCKED perf merge base: ${error.message}`);
      process.exitCode = 1;
    }
  }
  try {
    const observed = JSON.parse(process.argv[2] ?? '{}');
    if (observed.status !== 0) throw Error('current check workload did not finish successfully');
    if (baselineError) throw baselineError;
    if (!current.preflight) throw Error('missing preflight budget');
    if (base?.preflight && !baselineWorkload) throw Error('missing established preflight measurement');
    const baseline = base?.preflight ? baselineWorkload : null;
    const outcome = compare({ id: 'preflight', ...current.preflight }, observed, baseline, ['elapsedMs', 'peakBytes']);
    const reading = ({ elapsedMs, peakBytes }) => ({ elapsedMs, peakBytes });
    console.log(JSON.stringify({ task: 'preflight', baseCommit, ...outcome, samples: 1, current: reading(observed), base: baseline ? reading(baseline) : null }));
  } catch (error) {
    console.error(`BLOCKED perf preflight: ${error.message}`);
    process.exitCode = 1;
  }
  for (const budget of current.tasks) {
    try {
      const established = base?.tasks.find(({ id }) => id === budget.id);
      const observed = measure(budget.command, root);
      if (baselineError && established) {
        console.log(JSON.stringify({ task: budget.id, baseCommit, status: 'BLOCKED', current: observed, base: null, reason: 'Merge-base workload failed' }));
        continue;
      }
      const baseline = established ? measure(established.command, archive) : null;
      const outcome = compare(budget, observed, baseline);
      console.log(JSON.stringify({ task: budget.id, baseCommit, ...outcome, current: observed, base: baseline }));
    } catch (error) {
      console.error(`FAIL perf ${budget.id}: ${error.message}`);
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`BLOCKED perf: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (archive) rmSync(archive, { recursive: true, force: true });
}
