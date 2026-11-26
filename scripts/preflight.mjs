import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureOnce, warm } from './benchmark.mjs';
import { checks, exactTree, lanesFolder, releaseLanes, runLanes, unrunOf } from './lanes.mjs';
import { keptTime, runKey } from './proof-kept.mjs';
import { acquire, descendants, killTree, release } from './throttle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Parity and budgets run ./target/debug binaries; a shared Cargo target directory would misplace them.
delete process.env.CARGO_TARGET_DIR;
// The checks' builds are the budget's, so they run bare by this run's own setting, never by the machine's: an empty
// RUSTC_WRAPPER is no wrapper over any cargo config, and the machine may run a compile cache for every other build.
process.env.RUSTC_WRAPPER = '';
// Tests that give a child a temporary HOME would leave rustup and Cargo homeless: with no toolchain
// found, rustup downloads rust-toolchain.toml's pin into that HOME on every run. Named here, they stay put.
process.env.RUSTUP_HOME ??= join(homedir(), '.rustup');
process.env.CARGO_HOME ??= join(homedir(), '.cargo');
const WORK = '--work', FILL = '--fill';
// The run's parts, each a child of the process that stops it (supervise).
if (process.argv[2] === WORK) work(process.argv.slice(3));
else if (process.argv[2] === FILL) fill(process.argv.slice(3));
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

/** The kept results of the tree this run is of, as `--kept=` names them; none outside git. */
function keptArgs(kept) {
  return kept ? [`--kept=${JSON.stringify(kept)}`] : [];
}
function keptOf(args) {
  const arg = args.find((each) => each.startsWith('--kept='));
  return arg && JSON.parse(arg.slice(7));
}

/**
 * One command fills the tree's kept results, then finishes (#3297). The fill holds no grant of this run's, so every other
 * session's build and test goes on beside it; only once each test file has a result to stand on does the run take the
 * timed grant, measure from its warm-up builds to the end of its checks, and go on. The work is a child's, so a stop ends
 * every process it started and gives the grant back; a stop while the run waits for its grant ends it at once.
 */
async function supervise() {
  const tree = exactTree(root), kept = tree ? { ...runKey(tree), run: randomBytes(8).toString('hex') } : null;
  let stop;
  const onStop = (signal) => { stop ??= { signal, gone: stopTree() }; };
  const listen = (on) => { for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process[on ? 'on' : 'off'](signal, onStop); };
  // The child leads a group of its own, so a terminal's Ctrl-C or hang-up reaches this process alone and the stop
  // finds the whole tree through the child; the measured checks lead their own group too, out of the signal's reach.
  const child = async (mode, env = {}) => {
    const started = spawn(process.execPath, [fileURLToPath(import.meta.url), mode, ...keptArgs(kept)], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, detached: true });
    const code = await new Promise((done) => started.on('close', (status) => done(status ?? 1)));
    if (stop) await stop.gone;
    return code;
  };
  const stopped = () => { process.exitCode = 128 + constants.signals[stop.signal]; };
  if (kept) {
    listen(true);
    await child(FILL);
    if (stop) return stopped();
    listen(false);
    const { unrun, of } = unrunOf(kept);
    if (unrun.length) {
      console.log(`INCONCLUSIVE preflight: ${unrun.length} of ${of} test files have no result on this tree: ${unrun.slice(0, 10).join(', ')}${unrun.length > 10 ? ', …' : ''}\n  Fix: Run the preflight again on this tree; it runs only these.`);
      process.exitCode = 3;
      return;
    }
  }
  const grant = acquire('timed', { wait: 60 });
  if (!grant) {
    console.log('INCONCLUSIVE no grant: no timed grant came within 60 min, so the checks were not timed\n  Fix: Wait for the other sessions\' builds and proofs on this machine, then run the preflight again.');
    process.exit(3);
  }
  listen(true);
  const code = await child(WORK, { DEEP_THROTTLE: grant.token });
  release(grant);
  if (stop) return stopped();
  process.exitCode = code;
}

/** Runs the unit lane alone, its jobs each under the grants they ask for, keeping each as it ends (#3297). */
function fill(args) {
  const grant = acquire('build', { wait: 60 });
  if (!grant) {
    console.log('INCONCLUSIVE no grant: no build grant came within 60 min, so the packages were not built\n  Fix: Wait for the other sessions\' builds, then run the preflight again.');
    process.exit(3);
  }
  const before = process.env.DEEP_THROTTLE;
  process.env.DEEP_THROTTLE = grant.token;
  try {
    spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
  } finally {
    release(grant);
    if (before === undefined) delete process.env.DEEP_THROTTLE;
    else process.env.DEEP_THROTTLE = before;
  }
  process.exitCode = runLanes(checks.filter(({ name }) => name === 'unit'), { kept: keptOf(args), fill: true });
}

function work(args) {
  const kept = keptOf(args);
  // The checks and their builds share one budget; perf's merge-base run is extra.
  const budgets = JSON.parse(readFileSync(new URL('../benchmarks/budgets.json', import.meta.url), 'utf8'));
  const budgetMs = budgets.preflight.limits.elapsedMs;
  // Checks that outrun the budget with its margin, perf's allowance for the same workload, are stopped with their
  // children: a hung check would hold the machine's timed grant, and so every build and test on it, for ever.
  // Whole milliseconds, as spawnSync's timeout takes them, so any margin the budget file allows can be used.
  const allowanceMs = Math.ceil(budgetMs * (1 + budgets.preflight.margin));
  // Work whose supervising preflight is gone stops before its next step: no one holds its grant or watches it.
  const parent = process.ppid;
  const orphaned = () => {
    if (process.ppid === parent) return;
    console.log('BLOCKED preflight: the preflight that started this work is gone, so nothing more runs');
    process.exit(1);
  };
  const started = performance.now();
  let observation = {}, checkStatus = 1, stopped = false;
  console.log('Warming builds (not timed)');
  warm(root);
  orphaned();
  try {
    // Lane output streams as it runs, so a measurement that breaks never hides what ran.
    const { elapsedMs, cpuMs, peakBytes, instructions, status } = measureOnce([process.execPath, 'scripts/checks.mjs', ...args], root, true, allowanceMs, false);
    observation = { elapsedMs, cpuMs, peakBytes, instructions, status };
    // How much of the workload was read from kept results, for perf's comparison of like with like (#3297).
    if (kept) try { observation.kept = JSON.parse(readFileSync(join(lanesFolder(), `${kept.tree}-unit.json`), 'utf8')).kept; observation.key = kept; } catch {}
    checkStatus = status === 0 ? 0 : 1;
  } catch (error) {
    if ((stopped = error.code === 'ETIMEDOUT')) console.log(`FAIL preflight budget: the checks ran past ${(allowanceMs / 1000).toFixed(2)} s, the budget with its margin, and were stopped\n  Fix: Find the check that didn't end (a hung test, a leaked child) or reduce local check time below the budget in benchmarks/budgets.json.`);
    else console.log(`BLOCKED check workload: ${error.message}\n  Fix: Install /usr/bin/time (GNU time on Linux) and restore the check runner.`);
  }
  const checksMs = performance.now() - started;
  orphaned();
  let perfStatus = 1;
  if (checkStatus) console.log('RUN perf\nBLOCKED perf: the check lanes did not pass, so their workload was not measured\n  Fix: Repair the failing lanes above; perf runs once they pass.');
  // The perf lane's builds and runs hold a cpu.slot of the calling session's through scripts/lease (#1015).
  else perfStatus = spawnSync(join(root, 'scripts/lease'), [process.execPath, 'scripts/perf.mjs', JSON.stringify(observation)], { cwd: root, stdio: 'inherit' }).status ?? 1;
  // The harness budgets lane runs real agents for minutes, so it stays out of the checks' budget and
  // perf. It runs wherever a harness budget is declared; perf freezes that budget once it is on main.
  let laneStatus = 0;
  orphaned();
  if (budgets.harness && checkStatus) {
    console.log('RUN harness budgets\nBLOCKED harness budgets: the check lanes did not pass, so no agent session was started\n  Fix: Repair the failing lanes above; the lane runs once they pass.');
    laneStatus = 1;
  } else if (budgets.harness) laneStatus = spawnSync(process.execPath, ['scripts/agent-harness.mjs', 'budgets'], { cwd: root, stdio: 'inherit' }).status ?? 1;
  // The release lanes spend plan usage too, so they run once, at release, and only after the checks pass.
  let releaseStatus = 0;
  orphaned();
  if (process.env.DEEP_PREFLIGHT !== 'release') for (const { name } of releaseLanes) console.log(`SKIP ${name}: it spends plan usage, so only the release preflight runs it`);
  else if (checkStatus) {
    for (const { name } of releaseLanes) console.log(`RUN ${name}\nBLOCKED ${name}: the check lanes did not pass, so no agent session was started\n  Fix: Repair the failing lanes above; the lane runs once they pass.`);
    releaseStatus = 1;
  } else releaseStatus = runLanes(releaseLanes);
  process.exitCode = checkStatus || perfStatus || laneStatus || releaseStatus;
  console.log(`Checks elapsed: ${(checksMs / 1000).toFixed(2)} s (budget: <${budgetMs / 1000} s); preflight elapsed: ${((performance.now() - started) / 1000).toFixed(2)} s`);
  if (kept) {
    const { jobs, ms, runs } = keptTime(kept);
    console.log(`Kept: ${jobs} jobs, ${(ms / 1000).toFixed(0)} s of machine time, from ${runs} runs`);
  }
  // A stop at the allowance has said so above.
  if (checksMs >= budgetMs && !stopped) {
    console.log(`FAIL preflight budget: checks took ${(checksMs / 1000).toFixed(2)} s\n  Fix: Reduce local check time below the budget in benchmarks/budgets.json.`);
    process.exitCode = 1;
  }
}
