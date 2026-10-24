import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureOnce, warm } from './benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Parity and budgets run ./target/debug binaries; a shared Cargo target directory would misplace them.
delete process.env.CARGO_TARGET_DIR;
// Tests that give a child a temporary HOME would leave rustup and Cargo homeless: with no toolchain
// found, rustup downloads rust-toolchain.toml's pin into that HOME on every run. Named here, they stay put.
process.env.RUSTUP_HOME ??= join(homedir(), '.rustup');
process.env.CARGO_HOME ??= join(homedir(), '.cargo');
const started = performance.now();
let observation = {}, checkStatus = 1;
console.log('Warming builds (not timed)');
warm(root);
try {
  // Lane output streams as it runs, so a measurement that breaks never hides what ran.
  const { elapsedMs, cpuMs, peakBytes, status } = measureOnce([process.execPath, 'scripts/checks.mjs'], root, true);
  observation = { elapsedMs, cpuMs, peakBytes, status };
  checkStatus = status === 0 ? 0 : 1;
} catch (error) {
  console.log(`BLOCKED check workload: ${error.message}\n  Fix: Install /usr/bin/time (GNU time on Linux) and restore the check runner.`);
}
const checksMs = performance.now() - started;
let perfStatus = 1;
if (checkStatus) console.log('RUN perf\nBLOCKED perf: the check lanes did not pass, so their workload was not measured\n  Fix: Repair the failing lanes above; perf runs once they pass.');
else perfStatus = spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify(observation)], { cwd: root, stdio: 'inherit' }).status ?? 1;
// The checks and their builds share one budget; perf's merge-base run is extra.
const budgets = JSON.parse(readFileSync(new URL('../benchmarks/budgets.json', import.meta.url), 'utf8'));
const budgetMs = budgets.preflight.limits.elapsedMs;
// The harness budgets lane runs real agents for minutes, so it stays out of the checks' budget and
// perf. It runs wherever a harness budget is declared; perf freezes that budget once it is on main.
let laneStatus = 0;
if (budgets.harness && checkStatus) {
  console.log('RUN harness budgets\nBLOCKED harness budgets: the check lanes did not pass, so no agent session was started\n  Fix: Repair the failing lanes above; the lane runs once they pass.');
  laneStatus = 1;
} else if (budgets.harness) laneStatus = spawnSync(process.execPath, ['scripts/agent-harness.mjs', 'budgets'], { cwd: root, stdio: 'inherit' }).status ?? 1;
process.exitCode = checkStatus || perfStatus || laneStatus;
console.log(`Checks elapsed: ${(checksMs / 1000).toFixed(2)} s (budget: <${budgetMs / 1000} s); preflight elapsed: ${((performance.now() - started) / 1000).toFixed(2)} s`);
if (checksMs >= budgetMs) {
  console.log(`FAIL preflight budget: checks took ${(checksMs / 1000).toFixed(2)} s\n  Fix: Reduce local check time below the budget in benchmarks/budgets.json.`);
  process.exitCode = 1;
}
