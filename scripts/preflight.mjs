import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureOnce, warm } from './benchmark.mjs';
import { exactTree, releaseLanes, runLanes } from './lanes.mjs';
import { runKey } from './proof-kept.mjs';
import { acquire, descendants, killTree, release } from './throttle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Parity and budgets run ./target/debug binaries; a shared Cargo target directory would misplace them.
delete process.env.CARGO_TARGET_DIR;
// Tests that give a child a temporary HOME would leave rustup and Cargo homeless: with no toolchain
// found, rustup downloads rust-toolchain.toml's pin into that HOME on every run. Named here, they stay put.
process.env.RUSTUP_HOME ??= join(homedir(), '.rustup');
process.env.CARGO_HOME ??= join(homedir(), '.cargo');
const WORK = '--work';
// The run's work, in a child of the process that holds its grant (supervise).
if (process.argv[2] === WORK) work(process.argv.slice(3));
else await supervise();

/**
 * Stops everything this process started: SIGTERM, then SIGKILL to what is left after 15 s, by PID and start. The work is
 * synchronous, so it can't answer a signal, and one its children never see leaves vitest's workers and their builds
 * running with no grant (#3296). A process whose parent has gone is still known by its own descendants.
 */
async function stopTree() {
  const known = new Map();
  let live = [];
  const look = () => {
    for (const entry of descendants(process.pid, ...live.map(({ pid }) => pid))) known.set(entry.pid, entry);
    live = [...known.values()].filter(({ pid }) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    return live;
  };
  for (const { pid } of look()) try { process.kill(pid, 'SIGTERM'); } catch {}
  for (const grace of [15_000, 10_000]) {
    const by = performance.now() + grace;
    // deadline: what ignores the stop is killed after 15 s, and the run ends 10 s later whatever is left.
    while (look().length && performance.now() < by) await new Promise((next) => setTimeout(next, 250));
    killTree(look());
  }
}

/**
 * The grant is this process's, so a stop gives it back and leaves nothing running: the machine is the work's alone while
 * it is timed, the grant comes before the timer, so no wait is measured, and every lane, perf and proof under it passes
 * through on it. The kept results the work may read and add to are of this tree (#3296).
 */
async function supervise() {
  const grant = acquire('timed', { wait: 60 });
  if (!grant) {
    console.log('INCONCLUSIVE no grant: no timed grant came within 60 min, so the checks were not timed\n  Fix: Wait for the other sessions\' builds and proofs on this machine, then run the preflight again.');
    process.exit(3);
  }
  const tree = exactTree(root);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), WORK, ...tree ? [`--kept=${JSON.stringify(runKey(tree))}`] : []], { cwd: root, stdio: 'inherit', env: { ...process.env, DEEP_THROTTLE: grant.token } });
  let stop;
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { stop ??= { signal, gone: stopTree() }; });
  const code = await new Promise((done) => child.on('close', (status) => done(status ?? 1)));
  if (stop) await stop.gone;
  release(grant);
  process.exitCode = stop ? 128 + constants.signals[stop.signal] : code;
}

function work(args) {
  const started = performance.now();
  let observation = {}, checkStatus = 1;
  console.log('Warming builds (not timed)');
  warm(root);
  try {
    // Lane output streams as it runs, so a measurement that breaks never hides what ran.
    const { elapsedMs, cpuMs, peakBytes, instructions, status } = measureOnce([process.execPath, 'scripts/checks.mjs', ...args], root, true, undefined, false);
    observation = { elapsedMs, cpuMs, peakBytes, instructions, status };
    checkStatus = status === 0 ? 0 : 1;
  } catch (error) {
    console.log(`BLOCKED check workload: ${error.message}\n  Fix: Install /usr/bin/time (GNU time on Linux) and restore the check runner.`);
  }
  const checksMs = performance.now() - started;
  let perfStatus = 1;
  if (checkStatus) console.log('RUN perf\nBLOCKED perf: the check lanes did not pass, so their workload was not measured\n  Fix: Repair the failing lanes above; perf runs once they pass.');
  // The perf lane's builds and runs hold a cpu.slot of the calling session's through scripts/lease (#1015).
  else perfStatus = spawnSync(join(root, 'scripts/lease'), [process.execPath, 'scripts/perf.mjs', JSON.stringify(observation)], { cwd: root, stdio: 'inherit' }).status ?? 1;
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
  // The release lanes spend plan usage too, so they run once, at release, and only after the checks pass.
  let releaseStatus = 0;
  if (process.env.DEEP_PREFLIGHT !== 'release') for (const { name } of releaseLanes) console.log(`SKIP ${name}: it spends plan usage, so only the release preflight runs it`);
  else if (checkStatus) {
    for (const { name } of releaseLanes) console.log(`RUN ${name}\nBLOCKED ${name}: the check lanes did not pass, so no agent session was started\n  Fix: Repair the failing lanes above; the lane runs once they pass.`);
    releaseStatus = 1;
  } else releaseStatus = runLanes(releaseLanes);
  process.exitCode = checkStatus || perfStatus || laneStatus || releaseStatus;
  console.log(`Checks elapsed: ${(checksMs / 1000).toFixed(2)} s (budget: <${budgetMs / 1000} s); preflight elapsed: ${((performance.now() - started) / 1000).toFixed(2)} s`);
  if (checksMs >= budgetMs) {
    console.log(`FAIL preflight budget: checks took ${(checksMs / 1000).toFixed(2)} s\n  Fix: Reduce local check time below the budget in benchmarks/budgets.json.`);
    process.exitCode = 1;
  }
}
