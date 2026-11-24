// A stop of a run that waits in spawnSync (#3433). Such a run can't answer a signal, and once its command is killed it
// can no longer list what the command started: a process whose parent died first belongs to no one, and one in a
// process group of its own (a detached spawn: a bay's command, a test's fixture) outlives a kill of the run's group.
// So one watcher per process, outside its group and tree, lists that process's tree by PID and start while a run is
// armed, and stops the run's part of it when the process dies or asks it to. It says what it stopped, by PID and
// command, and writes the record the run left it, if no record is there yet.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
// A look each half second while armed; a process started and orphaned inside one look isn't seen.
const LOOK_MS = 500;
// A process of a group of its own may be the run's cleanup (proof-runs.mjs's folder remover, proof-binaries.mjs's
// watcher), which ends once the run has: it gets 8 s to, then SIGTERM, then SIGKILL 3 s later.
const OWN_MS = 8_000, GRACE_MS = 3_000;
// Each watcher names itself here by PID and start, so another's, whose tree it was launched in, leaves it be.
const WATCHERS = join(tmpdir(), 'deep-stop-watchers');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const writeJson = (file, value) => {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
};
/** `pid <n> (<command>)` for each stopped process, or why none could be listed: the words a record carries. */
export const named = ({ stopped, error }) => (error ? `the stop could not list the run's processes: ${error}`
  : `the stop ended ${stopped.length} processes${stopped.length ? `: ${stopped.map(({ pid, command }) => `pid ${pid} (${command})`).join(', ')}` : ''}`);

let shared;
/**
 * This process's watcher, started at its first use. `arm(file, record)` before a command's spawnSync: its tree is
 * listed from then on, and should this process die the watcher stops it and writes `record` to `file`, INCONCLUSIVE
 * with the stop's finding (no file, no record). `stop(pid)` stops the tree under the command `pid` now and returns what
 * was stopped; `disarm()` after the command. A watcher that can't start says why in `error`, and its calls do nothing.
 */
export function watchTree() {
  if (shared?.pid) {
    try {
      process.kill(shared.pid, 0);
      return shared;
    } catch {}
  }
  let folder;
  try {
    folder = mkdtempSync(join(tmpdir(), 'deep-stop-'));
    // Through a launcher, so the watcher is no child of this process (no zombie, in no tree it watches) and leads a
    // group of its own; the launcher returns once the watcher has listed this process.
    const launched = spawnSync(process.execPath, [self, 'launch', String(process.pid), folder], { encoding: 'utf8' });
    const pid = Number(launched.stdout.trim());
    if (!(pid > 1)) throw Error(launched.error?.message ?? (launched.stderr.trim() || `exit ${launched.status}`));
    const armed = join(folder, 'armed.json');
    let asked = 0;
    shared = {
      pid,
      arm(file, record) { writeJson(armed, file ? { file, record } : {}); },
      disarm() { rmSync(armed, { force: true }); },
      stop(root) {
        const result = join(folder, `stopped-${++asked}.json`);
        writeJson(join(folder, 'stop.json'), { root, result });
        try { process.kill(pid, 'SIGUSR1'); } catch {}
        // deadline: the watcher's wait for a group of its own, its SIGTERM grace and its SIGKILL; past 30 s it said nothing.
        for (const by = performance.now() + 30_000; !existsSync(result) && performance.now() < by;) sleep(100);
        try { return JSON.parse(readFileSync(result, 'utf8')); } catch { return { stopped: [], error: "the stop's watcher said nothing of what it stopped" }; }
      },
    };
  } catch (error) {
    if (folder) rmSync(folder, { recursive: true, force: true });
    const why = `the stop's watcher did not start: ${error.message}`, nothing = () => {};
    shared = { error: why, arm: nothing, disarm: nothing, stop: () => ({ stopped: [], error: why }) };
  }
  return shared;
}

/**
 * Every process now, by pid: its parent, its group and its start as ps prints it, in one zone and language for every
 * reader. Its own listing, not throttle.mjs's: a test's copy of the lanes may stand a stub in for the throttle.
 */
function table() {
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  if (listing.status !== 0) throw Error(`ps failed: ${listing.error?.message ?? listing.stderr.trim()}`);
  return new Map(listing.stdout.split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/)).filter(Boolean)
    .map(([, pid, ppid, pgid, start]) => [Number(pid), { ppid: Number(ppid), pgid: Number(pgid), start }]));
}
/** The command lines of `pids`, by pid. */
function lines(pids) {
  const env = { ...process.env, LC_ALL: 'C' };
  delete env.COLUMNS;
  const listing = spawnSync('ps', ['-ww', '-o', 'pid=,args=', '-p', pids.join(',')], { encoding: 'utf8', env });
  return new Map(listing.stdout.split('\n').map((line) => line.match(/^\s*(\d+)\s+(.*)$/)).filter(Boolean).map(([, pid, args]) => [Number(pid), args]));
}

/** Lists `caller`'s tree while it is armed, and stops the run's part of it when asked or when the caller dies. */
function watch(caller, folder) {
  const first = table(), callerStart = first.get(caller)?.start;
  if (!callerStart) process.exit(1);
  mkdirSync(WATCHERS, { recursive: true, mode: 0o700 });
  writeFileSync(join(WATCHERS, String(process.pid)), first.get(process.pid)?.start ?? '');
  process.on('exit', () => rmSync(join(WATCHERS, String(process.pid)), { force: true }));
  const armed = join(folder, 'armed.json');
  // A process's ancestors in `procs` up to the caller or to a process already known (whose own ancestors follow),
  // nearest first; null for one that is neither's.
  const ancestors = (procs, pid) => {
    const up = [];
    for (let at = procs.get(pid)?.ppid; at > 1 && up.length < 4096; at = procs.get(at)?.ppid) {
      if (at === caller) return up;
      if (known.has(at)) return [...up, at, ...known.get(at).up];
      up.push(at);
    }
    return null;
  };
  // The caller's processes from before the watch (the launcher, this watcher, a test's helpers) and theirs are none
  // of a run's.
  const known = new Map();
  const fence = new Set([...first.keys()].filter((pid) => ancestors(first, pid)));
  // Each process seen under the caller while armed, with its ancestors as first seen: one whose parent died first is
  // still known, and known as part of the command it was under.
  const look = () => {
    const now = table();
    let named = [];
    try { named = readdirSync(WATCHERS).map(Number); } catch {}
    const others = new Set(named.filter((pid) => {
      try { return readFileSync(join(WATCHERS, String(pid)), 'utf8') === now.get(pid)?.start; } catch { return false; }
    }));
    for (const [pid, { start }] of known) if (now.get(pid)?.start !== start) known.delete(pid);
    for (const [pid, { start, pgid }] of now) {
      if (pid === process.pid || fence.has(pid) || known.has(pid) || others.has(pid)) continue;
      const up = ancestors(now, pid);
      if (up && !up.some((at) => fence.has(at))) known.set(pid, { pid, start, pgid, up });
    }
    return now;
  };
  // Stops the known processes `pick` chooses: SIGTERM to those in the run's own groups, then, once those in groups of
  // their own have had their time to end, SIGTERM and SIGKILL to what is left, each by PID and start.
  const stopTree = (pick, groups) => {
    let tree;
    try {
      const now = look();
      tree = [...known.values()].filter((entry) => pick(entry) && now.get(entry.pid)?.start === entry.start);
    } catch (error) {
      return { stopped: [], error: error.message };
    }
    let argv = new Map();
    try { if (tree.length) argv = lines(tree.map(({ pid }) => pid)); } catch {}
    // A long command line keeps its head (the program) and its tail (the file it runs, often last).
    const short = (line) => (line.length > 600 ? `${line.slice(0, 300)} … ${line.slice(-300)}` : line);
    const stopped = tree.map(({ pid }) => ({ pid, command: short(argv.get(pid) ?? '?') }));
    const left = () => {
      try {
        const now = table();
        return tree.filter(({ pid, start }) => now.get(pid)?.start === start);
      } catch { return tree; }
    };
    const signal = (list, name) => { for (const { pid } of list) try { process.kill(pid, name); } catch {} };
    const wait = (ms) => { for (const by = performance.now() + ms; left().length && performance.now() < by;) sleep(250); };
    signal(tree.filter(({ pgid }) => groups.has(pgid)), 'SIGTERM');
    // deadline: a process in a group of its own gets 8 s to end with the run, as a run's cleanup does.
    wait(OWN_MS);
    signal(left(), 'SIGTERM');
    // deadline: what ignores SIGTERM for 3 s is killed.
    wait(GRACE_MS);
    signal(left(), 'SIGKILL');
    return { stopped };
  };
  let stopping = false;
  // A stop the run asks for: the tree under the command it names, whose group is its own (measureOnce's capture).
  process.on('SIGUSR1', () => {
    let request;
    try { request = JSON.parse(readFileSync(join(folder, 'stop.json'), 'utf8')); } catch { return; }
    writeJson(request.result, stopTree(({ pid, up }) => pid === request.root || up.includes(request.root), new Set([request.root])));
  });
  // SIGTERM, SIGINT and SIGHUP, as a stop of a tree this watcher is in sends, don't end the watch.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => {});
  let ticks = 0;
  setInterval(() => {
    if (stopping) return;
    let gone = false;
    try { process.kill(caller, 0); } catch (error) { gone = error.code === 'ESRCH'; }
    if (!existsSync(armed)) {
      // A run that ended by itself leaves nothing to stop; with no caller there is nothing left to watch. Every 10 s
      // the caller's number is checked against its start too: a number since taken is no caller.
      known.clear();
      if (!gone && ++ticks % 20 === 0) {
        const start = spawnSync('ps', ['-o', 'lstart=', '-p', String(caller)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
        gone = start.status === 0 && start.stdout.trim() !== callerStart;
      }
      // Planted (#3433.cd15df63): the run's end is ignored, so the watcher runs on.
      if (gone) setTimeout(() => process.exit(0), 60_000);
      return;
    }
    if (!gone) {
      // Without a listing the next look tries again; a caller whose number is gone is gone without one.
      try {
        if (look().get(caller)?.start === callerStart) return;
      } catch { return; }
    }
    // The caller died while a run was armed: every process of the run is stopped, and its record says so. Whatever
    // fails on the way, the watcher ends.
    stopping = true;
    process.on('uncaughtException', () => process.exit(0));
    let pending = {};
    try { pending = JSON.parse(readFileSync(armed, 'utf8')); } catch {}
    const result = stopTree(() => true, new Set([first.get(caller).pgid]));
    if (pending.file) {
      try {
        const note = `stopped: the run (pid ${caller}) ended while its commands ran; ${named(result)}`;
        mkdirSync(dirname(pending.file), { recursive: true, mode: 0o700 });
        // A record already there, as a finished run's of the same tree, stands: a stopped run adds nothing to it.
        writeJson(`${pending.file}.stopped`, { ...pending.record, state: 'INCONCLUSIVE', findings: [...pending.record.findings ?? [], { state: 'INCONCLUSIVE', note }] });
        try { linkSync(`${pending.file}.stopped`, pending.file); } catch {}
        rmSync(`${pending.file}.stopped`, { force: true });
      } catch {}
    }
    rmSync(folder, { recursive: true, force: true });
    process.exit(0);
  }, LOOK_MS);
}

if (process.argv[1] === self && process.argv[2] === 'launch') {
  const [caller, folder] = process.argv.slice(3);
  const watcher = spawn(process.execPath, [self, 'watch', caller, folder], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  watcher.stdout.once('data', () => {
    console.log(watcher.pid);
    process.exit(0);
  });
  watcher.on('exit', (code) => process.exit(code || 1));
} else if (process.argv[1] === self && process.argv[2] === 'watch') {
  const [caller, folder] = process.argv.slice(3);
  watch(Number(caller), folder);
  process.stdout.write('ready\n');
  process.stdout.destroy();
}
