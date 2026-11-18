// The benchmarks' one reader of what a process costs (#2698). For a live process and each child it keeps: its
// instructions retired, CPU time, wakeups and physical footprint over a stated span, from the kernel's own counters
// (process-reader.c). For a command that ends: its own instructions and peak, by /usr/bin/time -l, and the modules
// it loads. A reading that can't be taken is null, never 0: off macOS, with no compiler, or where the kernel refuses.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** process-reader.c, built once a machine beside the perf lane's counter, by its source; null where it can't be. */
function build() {
  if (process.platform !== 'darwin') return null;
  try {
    const source = fileURLToPath(new URL('process-reader.c', import.meta.url));
    const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), 'Library/Caches'), 'deepbuild-perf');
    const built = join(cache, `process-reader-${createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16)}`);
    if (!existsSync(built)) {
      mkdirSync(cache, { recursive: true, mode: 0o700 });
      execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', `${built}.${process.pid}`, source], { stdio: 'ignore' });
      renameSync(`${built}.${process.pid}`, built);
    }
    return built;
  } catch {
    return null;
  }
}
// Built when a benchmark loads, so no span and no start it reads holds a compile.
const helper = build();

const SUMMED = ['instructions', 'cpuMs', 'wakeups', 'footprintBytes'];
const none = (names) => Object.fromEntries(names.map((name) => [name, null]));
const unreadable = (pid) => ({ pid, ...none([...SUMMED, 'peakFootprintBytes']) });
const missing = (pid, spanMs) => ({ spanMs, processes: [unreadable(pid)], total: none(SUMMED) });

/** What the kernel has counted so far for `pid` and each child it has now, by PID: null where `pid` can't be read. */
function look(pid) {
  let counts = null;
  try {
    if (helper) counts = new Map(execFileSync(helper, [String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').map((line) => {
      const [id, started, ageNs, instructions, cpuNs, wakeups, footprintBytes, peakFootprintBytes] = line.split(' ').map(Number);
      return [id, { started, ageNs, instructions, cpuNs, wakeups, footprintBytes, peakFootprintBytes }];
    }));
  } catch { /* the kernel refused it, or it has ended */ }
  return { at: performance.now(), counts };
}

/** A reading from two looks: each process in the later one over the span, and their sum. */
function reading(spanMs, before, after) {
  const processes = [...after].map(([pid, now]) => {
    // A child the kernel refuses: its line holds no counts.
    if (Number.isNaN(now.started)) return unreadable(pid);
    // A process that started inside the span counts from its start, as one given an ended process's PID does.
    const then = before.get(pid)?.started === now.started ? before.get(pid) : { instructions: 0, cpuNs: 0, wakeups: 0 };
    return {
      pid,
      // A kernel that keeps no count of instructions gives 0 for a live process: missing, not none retired.
      instructions: now.instructions ? now.instructions - then.instructions : null,
      cpuMs: (now.cpuNs - then.cpuNs) / 1e6,
      wakeups: now.wakeups - then.wakeups,
      footprintBytes: now.footprintBytes,
      peakFootprintBytes: now.peakFootprintBytes,
    };
  });
  return { spanMs, processes, total: Object.fromEntries(SUMMED.map((name) => [name, processes.some((process) => process[name] === null) ? null : processes.reduce((sum, process) => sum + process[name], 0)])) };
}

/**
 * Starts a reading of the live process `pid` and each child it keeps. `stop()` gives `{ spanMs, processes, total }`:
 * for the process, then each child it has by then, `{ pid, instructions, cpuMs, wakeups, footprintBytes,
 * peakFootprintBytes }`, where the first three are over the span and the footprint is at its end, its peak over the
 * process's life; `total` sums the first four. A child that ended inside the span is in neither.
 */
export function startReading(pid) {
  const before = look(pid);
  return {
    stop() {
      const after = look(pid);
      const same = before.counts && after.counts && before.counts.get(pid).started === after.counts.get(pid).started;
      return same ? reading(after.at - before.at, before.counts, after.counts) : missing(pid, after.at - before.at);
    },
  };
}

/** The same reading from the process's start to now, for one a benchmark started: the span is its life so far. */
export function readSinceStart(pid) {
  const { counts } = look(pid);
  return counts ? reading(counts.get(pid).ageNs / 1e6, new Map(), counts) : missing(pid, null);
}

/** A scratch directory for `use`, removed once what it gives has settled. */
async function scratch(use) {
  const directory = mkdtempSync(join(tmpdir(), 'deep-process-reader-'));
  try {
    return await use(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Runs a command to its end, as execFileSync does, and resolves to the instructions its own process retired and its
 * peak footprint, by /usr/bin/time -l: null where that reports none, as off macOS.
 */
export function readCommand(command, args, options) {
  const stdio = ['ignore', 'ignore', 'inherit'];
  return scratch((directory) => {
    if (process.platform !== 'darwin') execFileSync(command, args, { ...options, stdio });
    else execFileSync('/usr/bin/time', ['-l', '-o', join(directory, 'time'), command, ...args], { ...options, stdio });
    const report = existsSync(join(directory, 'time')) ? readFileSync(join(directory, 'time'), 'utf8') : '';
    const count = (label) => {
      const value = Number(report.match(RegExp(`^\\s*(\\d+)\\s+${label}\\s*$`, 'm'))?.[1]);
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    };
    return { instructions: count('instructions retired'), peakFootprintBytes: count('peak memory footprint') };
  });
}

/**
 * The modules a command loads, by name: a file in this checkout from its root, anything else by its URL.
 * `run(args, env)` runs the command once, apart from any round it is measured in, with those Node arguments before
 * its entry and that environment added, which put a load hook in it (loaded-modules.mjs).
 */
export function loadedModules(run) {
  return scratch(async (directory) => {
    await run(['--import', new URL('loaded-modules.mjs', import.meta.url).href], { DEEP_BENCH_MODULES: join(directory, 'modules') });
    const root = `${pathToFileURL(realpathSync(fileURLToPath(new URL('../', import.meta.url)))).href}/`;
    return [...new Set(readFileSync(join(directory, 'modules'), 'utf8').split('\n').filter(Boolean))].map((url) => (url.startsWith(root) ? url.slice(root.length) : url));
  });
}

/**
 * What a task's last line adds when a reading it reports is missing: INCONCLUSIVE, naming each. `readings` gives
 * each reading's value, or its values, by the name to call it.
 */
export function unread(readings) {
  const names = Object.keys(readings).filter((name) => [readings[name]].flat().includes(null));
  return names.length ? { status: 'INCONCLUSIVE', reason: `no reading of ${names.join(', ')}` } : {};
}
