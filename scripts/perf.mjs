import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, fingerprint, judgeTargets, judgeTask, measureOnce, prepareCopy, validateBudgets } from './benchmark.mjs';
// The machine's throttle table and the bays' replacement rule, beside this script in a checkout. A copy of perf alone,
// as a test's fixture holds, has no table to wait on, and starts its copies afresh each run.
const beside = (name) => existsSync(new URL(name, import.meta.url));
const throttle = beside('./throttle.mjs') ? await import('./throttle.mjs') : null;
const bays = beside('./bays.mjs') ? await import('./bays.mjs') : null;

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'benchmarks/budgets.json';
const run = (command, args, cwd = root, options = {}) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024, ...options });
const files = (args) => run('git', [...args, '-z']).split('\0').filter(Boolean);
// BLOCKED: perf could not compare. FAIL: a measurement broke its budget.
const blocked = (message, fix) => Object.assign(Error(message), { fix });
const regressed = 'Restore the regressed budget; budgets are frozen once they reach main.';
// Where every result's instructions retired came from; GNU time has no counter.
const counter = process.platform === 'darwin' ? '/usr/bin/time -l and scripts/count-children.c: instructions retired, children included' : null;
// Each side's copy lives at the same path every run, in this user's cache directory under a name
// for this machine and clone, not for a checkout, with its Cargo builds kept beside it, so a preflight
// from any worktree, a new one too, doesn't rebuild what the last run on the machine built (#594, #1119).
// Another repository, such as a test's fixture, has a git directory of its own, so it gets copies and
// a lock of its own and never replaces the clone's. The machine is its name's first label: macOS adds
// .local to it on some networks and a router's DHCP its own domain, which would start the copies cold
// in another folder. The
// path has to stay put: Cargo doesn't rebuild a crate whose workspace moved, so absolute paths baked
// into earlier builds (CARGO_MANIFEST_DIR, CARGO_BIN_EXE_*) would point at a deleted copy. Each run
// replaces a copy's tree by the bays' rule (scripts/bays.mjs), writing only the files whose bytes
// differ, so Cargo rebuilds just what changed. Nothing removes the machine's directory; deleting it
// only makes the next preflight build cold.
// owner is the run whose number the lock holds: this one, or an ancestor that named its lock in DEEP_PERF_LOCK.
let kept, lock, owner = process.pid;
function keptRoot() {
  if (kept) return kept;
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache');
  const clone = createHash('sha256').update(realpathSync(run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim())).digest('hex').slice(0, 12);
  const directory = join(cache, 'deepbuild-perf', `${hostname().split('.')[0].replace(/[^\w-]/g, '_')}-${clone}`);
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
  process.env.DEEP_PERF_LOCK = String(owner);
  return (kept = directory);
}
// One perf run per clone on the machine at a time: a second would replace the first's copies under it. The lock
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
          // An ancestor's lock it named to this run is this run's to use and the ancestor's to release; a number
          // named by no live ancestor is not trusted.
          if (throttle && holder === Number(process.env.DEEP_PERF_LOCK) && throttle.ancestors().includes(holder)) return (owner = holder), true;
          throw blocked(`another perf run (process ${holder}) is using ${dirname(file)}`, `Wait for that preflight to finish. If none is running, the process took over a killed run's number: rm ${file}`);
        }
        renameSync(mine, file);
        return true;
      });
      if (taken) return file;
    }
    throw blocked(`could not take ${file}: other perf runs kept taking it`, 'Run one preflight at a time on this machine.');
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
// The takeover mark: a file only one run can create, held for a read and a rename. It appears whole, as
// the lock does, so a run that finds it always reads whose it is (one made empty and then written could
// be read empty and taken for a killed run's). One left by a run killed inside that window names a
// process that is gone, and is removed; two runs that find the same one could, in the microseconds
// between, both go on, which needs that kill first.
function underTakeover(file, act) {
  const mark = `${file}.takeover`;
  const mine = `${mark}.${process.pid}`;
  const until = Date.now() + 10_000;
  writeFileSync(mine, String(process.pid));
  try {
    for (;;) {
      try {
        linkSync(mine, mark);
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
  } finally {
    rmSync(mine, { force: true });
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
    return readFileSync(lock, 'utf8') === String(owner);
  } catch {
    return false;
  }
}
// Replaces a side's kept copy in place to the tree whose files `fill` writes into an empty folder. The record names
// the files the last run left with other bytes than this tree's, such as the ledger the canvas-kit lane rewrites:
// Cargo rebuilds what they feed.
function keptCopy(side, fill) {
  const directory = join(keptRoot(), side, 'copy');
  if (!ownsLock()) throw blocked(`another perf run took ${lock}`, 'Run one preflight at a time on this machine.');
  mkdirSync(join(dirname(directory), 'target'), { recursive: true });
  const from = mkdtempSync(join(tmpdir(), 'deep-perf-tree-'));
  try {
    fill(from);
    if (!bays) {
      rmSync(directory, { recursive: true, force: true });
      cpSync(from, directory, { recursive: true, verbatimSymlinks: true });
      return directory;
    }
    const paths = bays.walk(from);
    const rewritten = paths.filter((path) => {
      try {
        return lstatSync(join(from, path)).isFile() && lstatSync(join(directory, path)).isFile() && !readFileSync(join(from, path)).equals(readFileSync(join(directory, path)));
      } catch {
        return false;
      }
    });
    const { written, deleted } = bays.replace(directory, { from, paths });
    console.log(`perf: ${side} copy ${directory}: wrote ${written.length} files, deleted ${deleted}; rewrote what the last run left with other bytes: ${rewritten.join(', ') || 'nothing'}`);
  } finally {
    rmSync(from, { recursive: true, force: true });
  }
  return directory;
}
// CARGO_TARGET_DIR names the kept build directory, so Cargo resolves it to the same path every run.
// DEEP_OPEN_ISSUES names the open issues this checkout's checks fetched (scripts/open-issues.mjs), cached beside the
// kept copy, so each side's lanes read the same issues and none fetches again (#605, #910).
function checkRun(directory, timeoutMs) {
  const previous = { CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR, DEEP_OPEN_ISSUES: process.env.DEEP_OPEN_ISSUES };
  process.env.CARGO_TARGET_DIR = join(dirname(directory), 'target');
  const issues = join(root, 'target', 'open-issues.json');
  if (existsSync(issues)) {
    process.env.DEEP_OPEN_ISSUES = join(dirname(directory), 'open-issues.json');
    copyFileSync(issues, process.env.DEEP_OPEN_ISSUES);
  }
  try {
    return checkCopy(directory, timeoutMs);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
// A kept copy's check workload, timed once like the merge base. Its throwaway repository and target/ link are made
// anew each run, so the last run's go first.
function checkCopy(directory, timeoutMs) {
  rmSync(join(directory, '.git'), { recursive: true, force: true });
  rmSync(join(directory, 'target'), { recursive: true, force: true });
  prepareCopy(directory);
  return measureOnce([process.execPath, 'scripts/checks.mjs'], directory, false, timeoutMs, false);
}
// perf is a measured run: it holds timed from before its timer to its end, so its
// kept copies and lock are taken only under timed. Under a preflight's grant it passes through on it.
const grant = throttle?.acquire('timed', { wait: 60 });
if (throttle && !grant) {
  console.log('INCONCLUSIVE no grant: no timed grant came within 60 min, so perf did not run\n  Fix: Wait for the other sessions\' builds and proofs on this machine, then run perf again.');
  process.exit(3);
}
if (grant) process.env.DEEP_THROTTLE = grant.token;
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
  // Each copy's checks may run as long as the budget allows this checkout's, margin included.
  const allowance = current.preflight.limits.elapsedMs * (1 + current.preflight.margin);
  let baseline = null;
  if (base?.preflight || base?.tasks?.length) {
    // Git reads stay in this checkout; checkRun gives the kept copy a repository of its own. The archive streams into
    // tar: the repository's outgrew any buffer a process can hold (141 MiB on the Mac).
    archive = keptCopy('base', (from) => run('bash', ['-c', 'set -o pipefail; git archive "$1" | tar -xf - -C "$2"', 'bash', baseCommit, from], root, { stdio: 'pipe' }));
    baseline = checkRun(archive, allowance);
    if (baseline.status !== 0) throw blocked(`merge-base checks exited ${baseline.status}: ${baseline.output}`, 'Repair the checks on main; a failing merge base cannot be compared.');
  }
  const reading = ({ elapsedMs, cpuMs, peakBytes, instructions }) => ({ elapsedMs, cpuMs, peakBytes, instructions: instructions ?? null });
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
    without = keptCopy('without-tests', (from) => {
      for (const file of files(['ls-files', '--cached', '--others', '--exclude-standard'])) {
        // target is the copy's link to its kept builds; a checkout's own target link isn't copied.
        if (ownTests.includes(file) || file === 'target' || !existsSync(join(root, file))) continue;
        mkdirSync(dirname(join(from, file)), { recursive: true });
        // A relative link into the checkout is copied as a link, so it points into the copy. Any other
        // link is copied as what it points at, a directory whole.
        const source = join(root, file), link = lstatSync(source).isSymbolicLink() && readlinkSync(source);
        const inside = link && !isAbsolute(link) && !/^\.\.(?:[\\/]|$)/.test(relative(root, resolve(dirname(source), link)));
        if (inside) symlinkSync(link, join(from, file));
        else if (statSync(source).isDirectory()) cpSync(source, join(from, file), { recursive: true, dereference: true });
        else copyFileSync(source, join(from, file));
      }
    });
    rest = checkRun(without, allowance);
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
      ...rest && { full: reading(observed), ownTests, ownTestsCpuMs: observed.cpuMs - rest.cpuMs }, counter, fingerprint: fingerprint() }));
  } catch (error) {
    verdicts.push(['FAIL', error.message, regressed]);
  }
  for (const budget of current.tasks) {
    const established = base?.tasks?.find(({ id }) => id === budget.id);
    let judged;
    try {
      judged = judgeTask(budget, established, root, archive);
    } catch (error) {
      verdicts.push(['BLOCKED', `${budget.id}: ${error.message}`, 'Build the measured command; the check lanes build it.']);
      continue;
    }
    const { now, then, machine, limits, instructions, outcome, regression } = judged;
    if (regression) verdicts.push(['FAIL', regression, regressed]);
    console.log(JSON.stringify({ task: budget.id, baseCommit, ...outcome, current: now, base: then, counter, fingerprint: machine, limits, ...instructions && { instructions } }));
    // #854: a task with targets is held to them by its bench's judge, on one more run's report; the judge refuses a
    // reading of any build but release.
    if (budget.targets) {
      const verdict = judgeTargets(budget, root);
      console.log(JSON.stringify({ task: budget.id, targets: verdict.targets ?? null, status: verdict.status }));
      if (verdict.status !== 'PASS') verdicts.push([verdict.status, `${budget.id}: targets: ${verdict.reason}`, `Bring ${budget.id} back within its targets in ${manifest}, on a release build.`]);
    }
    if (instructions?.status === 'FAIL') verdicts.push(['FAIL', `${budget.id}: instructions: ${instructions.reason}`, `Bring ${budget.id}'s instructions retired back within the margin of the merge base's.`]);
    if (instructions?.status === 'INCONCLUSIVE') verdicts.push(['INCONCLUSIVE', `${budget.id}: instructions: ${instructions.reason}`, instructions.uncounted.length ? "Have the budget's command wait for each child it starts, from a process that isn't a platform binary such as /bin/sh." : "Run perf on macOS, whose /usr/bin/time -l reports instructions retired."]);
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
  // The copies stay for the next run on this machine, but a side that built nothing (a checkout without
  // Rust, or a test fixture) leaves nothing behind. This runs before the lock goes, so no other run is
  // using the sides.
  if (lock && owner === process.pid && ownsLock()) {
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
throttle?.release(grant);
