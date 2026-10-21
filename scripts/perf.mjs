import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, fingerprint, judgeLimit, measure, measureOnce, validateBudgets, warm } from './benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'benchmarks/budgets.json';
const run = (command, args, cwd = root, options = {}) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024, ...options });
const files = (args) => run('git', [...args, '-z']).split('\0').filter(Boolean);
// BLOCKED: perf could not compare. FAIL: a measurement broke its budget.
const blocked = (message, fix) => Object.assign(Error(message), { fix });
const regressed = 'Restore the regressed budget; budgets are frozen once they reach main.';
// Each side's copy lives at the same path every run, in this user's cache directory under a name
// for this checkout, with its Cargo builds kept beside it, so a preflight doesn't rebuild the
// dependency tree cold (#594). The path has to stay put: Cargo doesn't rebuild a crate whose
// workspace moved, so absolute paths baked into earlier builds (CARGO_MANIFEST_DIR, CARGO_BIN_EXE_*)
// would point at a deleted copy. Nothing removes a checkout's directory; deleting it only makes the
// next preflight build cold.
let kept, lock;
function keptRoot() {
  if (kept) return kept;
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache');
  const checkout = createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 16);
  const directory = join(cache, 'deepbuild-perf', checkout);
  // Perf runs what it builds there, so the directory is this user's alone: anyone else who could
  // write to it could plant artifacts Cargo reads as fresh.
  mkdirSync(dirname(directory), { recursive: true });
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || stat.mode & 0o077) {
    throw blocked(`${directory} is not a directory only this user can use`, `Remove it and perf makes a new one: rm -rf ${directory}`);
  }
  lock = takeLock(join(directory, 'lock'));
  return (kept = directory);
}
// One perf run per checkout at a time: a second would delete the first's copies under it. The lock
// appears whole, number and all, by linking a file already written. A lock whose process is gone,
// or that names none, was left by a run that was killed, and is replaced in one step, under a
// takeover mark that the lock's release also takes: between reading the lock and replacing it, no
// other run can release or replace it, so the lock a run judges stale is the lock it replaces.
function takeLock(file) {
  const mine = `${file}.${process.pid}`;
  writeFileSync(mine, String(process.pid));
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        linkSync(mine, file);
        return file;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const taken = underTakeover(file, () => {
        let content;
        try {
          content = readFileSync(file, 'utf8');
        } catch (error) {
          // Released between the link and the read.
          if (error.code === 'ENOENT') return false;
          throw error;
        }
        const holder = Number(content);
        // A killed run's number can come back as this run's own.
        if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && alive(holder)) {
          throw blocked(`another perf run (process ${holder}) is using ${dirname(file)}`, `Wait for that preflight to finish. If none is running, the process took over a killed run's number: rm ${file}`);
        }
        renameSync(mine, file);
        return true;
      });
      if (taken) return file;
    }
    throw blocked(`could not take ${file}: other perf runs kept taking it`, 'Run one preflight at a time in this checkout.');
  } finally {
    rmSync(mine, { force: true });
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (gone) {
    return gone.code === 'EPERM';
  }
}
// The takeover mark: a file only one run can create, held for a read and a rename. One left by a run
// killed inside that window names a process that is gone, and is removed; two runs that find the same
// one could, in the microseconds between, both go on, which needs that kill first.
function underTakeover(file, act) {
  const mark = `${file}.takeover`;
  const until = Date.now() + 10_000;
  for (;;) {
    try {
      writeFileSync(mark, String(process.pid), { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let holder;
    try {
      holder = Number(readFileSync(mark, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!(Number.isInteger(holder) && holder > 0 && holder !== process.pid && alive(holder))) {
      rmSync(mark, { force: true });
      continue;
    }
    if (Date.now() > until) throw blocked(`another perf run (process ${holder}) is taking ${dirname(file)}`, `Wait for that preflight to finish. If none is running: rm ${mark}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  try {
    return act();
  } finally {
    rmSync(mark, { force: true });
  }
}
// Whether the lock still names this run. Runs racing for a killed run's lock can, rarely, both
// believe they took it; checking before each deletion keeps one from removing the other's copy.
function ownsLock() {
  try {
    return readFileSync(lock, 'utf8') === String(process.pid);
  } catch {
    return false;
  }
}
function keptCopy(side) {
  const directory = join(keptRoot(), side, 'copy');
  if (!ownsLock()) throw blocked(`another perf run took ${lock}`, 'Run one preflight at a time in this checkout.');
  // A run that was killed leaves its copy behind.
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(dirname(directory), 'target'), { recursive: true });
  return directory;
}
// CARGO_TARGET_DIR names the kept build directory, so Cargo resolves it to the same path every run.
// DEEP_OPEN_ISSUES names the open issues this checkout's catalogue drift lane fetched, cached beside the
// kept copy, so each side's lane reads the same issues and none fetches again (#605).
function checkRun(directory) {
  const previous = { CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR, DEEP_OPEN_ISSUES: process.env.DEEP_OPEN_ISSUES };
  process.env.CARGO_TARGET_DIR = join(dirname(directory), 'target');
  const issues = join(root, 'target', 'open-issues.json');
  if (existsSync(issues)) {
    process.env.DEEP_OPEN_ISSUES = join(dirname(directory), 'open-issues.json');
    copyFileSync(issues, process.env.DEEP_OPEN_ISSUES);
  }
  try {
    return checkCopy(directory);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
// A directory of npm ci, warm builds and the check workload, timed once like the merge base. The checks
// read git, so each disposable copy gets its own throwaway repository, committed without the user's
// hooks or signing. Its origin/main is that commit, as on main itself, so checks that compare with
// main (repo-rules' size) do the same work on both sides instead of skipping it in the copy.
function checkCopy(directory) {
  const git = (...args) => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=DeepBuild perf', '-c', 'user.email=perf@example.invalid', ...args], directory, { stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'perf copy');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  // target/ links to the kept builds, so ./target/debug binaries stay where the lanes and budgets run
  // them. It is made after the commit: .gitignore's target/ matches a directory, not a link.
  symlinkSync(process.env.CARGO_TARGET_DIR, join(directory, 'target'), 'dir');
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
    archive = keptCopy('base');
    // Git reads stay in this checkout; checkRun gives the disposable copy a repository of its own. -m
    // stamps the files now: Cargo goes by mtime, and a merge base committed before the kept build
    // would otherwise look fresh.
    run('tar', ['-mxf', '-', '-C', archive], root, { input: run('git', ['archive', baseCommit], root, { encoding: null }) });
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
    without = keptCopy('without-tests');
    for (const file of files(['ls-files', '--cached', '--others', '--exclude-standard'])) {
      // target is the copy's link to its kept builds; a checkout's own target link isn't copied.
      if (ownTests.includes(file) || file === 'target' || !existsSync(join(root, file))) continue;
      mkdirSync(dirname(join(without, file)), { recursive: true });
      // A relative link into the checkout is copied as a link, so it points into the copy. Any other
      // link is copied as what it points at, a directory whole.
      const source = join(root, file), link = lstatSync(source).isSymbolicLink() && readlinkSync(source);
      const inside = link && !isAbsolute(link) && !/^\.\.(?:[\\/]|$)/.test(relative(root, resolve(dirname(source), link)));
      if (inside) symlinkSync(link, join(without, file));
      else if (statSync(source).isDirectory()) cpSync(source, join(without, file), { recursive: true, dereference: true });
      else copyFileSync(source, join(without, file));
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
      ...rest && { full: reading(observed), ownTests, ownTestsCpuMs: observed.cpuMs - rest.cpuMs }, fingerprint: fingerprint() }));
  } catch (error) {
    verdicts.push(['FAIL', error.message, regressed]);
  }
  for (const budget of current.tasks) {
    const established = base?.tasks?.find(({ id }) => id === budget.id);
    let samples, runs;
    try {
      samples = measure(budget.command, root, established && { command: established.command, cwd: archive });
      // Each limit is judged on five timed runs after one untimed warm-up run.
      const once = () => {
        const result = measureOnce(budget.command, root);
        if (result.status !== 0) throw Error(`${budget.command[0]} exited ${result.status}: ${result.output}`);
        return result;
      };
      runs = Object.keys(budget.limits).length ? (once(), Array.from({ length: 5 }, once)) : [];
    } catch (error) {
      verdicts.push(['BLOCKED', `${budget.id}: ${error.message}`, 'Build the measured command; the check lanes build it.']);
      continue;
    }
    const [now, then = null] = samples;
    const machine = fingerprint();
    const limits = Object.fromEntries(Object.entries(budget.limits).map(([metric, limit]) => [metric, judgeLimit({ limit, runs: runs.map((run) => (metric === 'peakBytes' ? run.peakBytes : run.elapsedMs)), fingerprint: machine })]));
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
        : /reference Mac/.test(reason) ? 'Run perf on a reference Mac (Mac15,7, M3 Pro, 36 GB, or Mac15,12, M3, 16 GB) on mains power, with Low Power Mode off and the thermal state nominal.'
        : 'Rerun perf on a quiet reference Mac; the five runs straddle the limit.';
      verdicts.push([status, `${budget.id}: ${metric}: ${reason}`, fix]);
    }
  }
} catch (error) {
  verdicts.push(['BLOCKED', error.message, error.fix ?? 'Resolve the named cause; budgets in benchmarks/budgets.json are frozen once they reach main.']);
} finally {
  // A side that built nothing (a checkout without Rust, or a test fixture) leaves nothing behind. This
  // runs before the lock goes, so no other run is using the sides.
  if (lock && ownsLock()) {
    for (const directory of [archive, without]) if (directory) rmSync(directory, { recursive: true, force: true });
    for (const side of ['base', 'without-tests']) {
      const target = join(kept, side, 'target');
      try {
        if (!readdirSync(target).length) rmSync(join(kept, side), { recursive: true, force: true });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    underTakeover(lock, () => { if (ownsLock()) rmSync(lock, { force: true }); });
  }
}
for (const [state, message, fix] of verdicts) console.log(`${state} perf: ${message}\n  Fix: ${fix}`);
if (verdicts.length) process.exitCode = 1;
else console.log(`PASS perf (${((performance.now() - started) / 1000).toFixed(2)} s)`);
