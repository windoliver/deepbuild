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
const WATCHERS = join(tmpdir(), `deep-stop-watchers-${process.getuid?.() ?? 'user'}`);
// deadline: a ps that hangs is a listing that failed, so no watcher waits on one for good.
const PS = { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } };
const startOf = (pid) => spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], PS).stdout?.trim();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const writeAtomic = (file, text) => {
  const temporary = join(dirname(file), `.${process.pid}.tmp`);
  writeFileSync(temporary, text);
  renameSync(temporary, file);
};
const writeJson = (file, value) => writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
/**
 * `pid <n> (<command>)` for each process of the tree the stop ended (one that ended with its parent too), and why the
 * run's processes couldn't be listed: the words a record carries.
 */
export const named = ({ stopped, error }) => {
  const list = stopped.length ? `: ${stopped.map(({ pid, command }) => `pid ${pid} (${command})`).join(', ')}` : '';
  return error ? `the stop could not list the run's processes: ${error}${stopped.length ? `; it signalled the ${stopped.length} it knew${list}` : ''}`
    : `the stop ended ${stopped.length} processes${list}`;
};

let shared;
/**
 * This process's watcher, started at its first use. `arm(file, record)` before a command's spawnSync: its tree is
 * listed from then on, and should this process die the watcher stops it and writes `record` to `file`, INCONCLUSIVE
 * with the stop's finding (no file, no record). `stop(pid)` stops the tree under the command `pid` now and returns what
 * was stopped; `disarm()` after the command. A watcher that can't start says why in `error`, and its calls do nothing.
 */
export function watchTree() {
  // A watcher that couldn't start stays so for this process: each call would otherwise pay for another try.
  if (shared?.error || shared?.live()) return shared;
  let folder;
  try {
    folder = mkdtempSync(join(tmpdir(), 'deep-stop-'));
    // Through a launcher, so the watcher is no child of this process (no zombie, in no tree it watches) and leads a
    // group of its own; the launcher returns once the watcher has listed this process.
    // deadline: a watcher not started in 30 s (a ps that hangs) is no watcher.
    const launched = spawnSync(process.execPath, [self, 'launch', String(process.pid), folder], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
    const pid = Number(launched.stdout.trim());
    if (!(pid > 1)) throw Error(launched.error?.message ?? (launched.stderr.trim() || `exit ${launched.status}`));
    // The watcher's own registry entry holds its start: a number since taken by another process is no watcher.
    const entry = join(WATCHERS, String(pid)), start = readFileSync(entry, 'utf8');
    const live = () => {
      try {
        process.kill(pid, 0);
        return readFileSync(entry, 'utf8') === start;
      } catch { return false; }
    };
    const armed = join(folder, 'armed.json');
    let asked = 0, runs = 0;
    const mine = {
      pid,
      live,
      // A watcher that died since is started again, so a run is never armed on no one.
      arm(file, record) {
        if (!live()) {
          shared = undefined;
          const next = watchTree();
          Object.assign(mine, next);
          return next.arm(file, record);
        }
        // A run whose arm can't be written runs unwatched, as one whose watcher didn't start does.
        try { writeJson(armed, { run: ++runs, ...file && { file, record } }); } catch {}
      },
      disarm() { rmSync(armed, { force: true }); },
      stop(root) {
        const result = join(folder, `stopped-${++asked}.json`);
        // A watcher killed outright leaves its entry; its number, since taken, is checked by start before a signal.
        if (!live() || startOf(pid) !== start) return { stopped: [], error: "the stop's watcher is gone" };
        writeJson(join(folder, 'stop.json'), { root, result });
        try { process.kill(pid, 'SIGUSR1'); } catch {}
        // deadline: the watcher's wait for a group of its own, its SIGTERM grace and its SIGKILL; past 30 s it said nothing.
        for (const by = performance.now() + 30_000; !existsSync(result) && performance.now() < by;) sleep(100);
        try { return JSON.parse(readFileSync(result, 'utf8')); } catch { return { stopped: [], error: "the stop's watcher said nothing of what it stopped" }; }
      },
    };
    shared = mine;
  } catch (error) {
    if (folder) rmSync(folder, { recursive: true, force: true });
    const why = `the stop's watcher did not start: ${error.message}`, nothing = () => {};
    shared = { error: why, live: () => false, arm: nothing, disarm: nothing, stop: () => ({ stopped: [], error: why }) };
  }
  return shared;
}

/**
 * Every process now, by pid: its parent, its group, its state and its start as ps prints it, in one zone and language for every
 * reader. Its own listing, not throttle.mjs's: a test's copy of the lanes may stand a stub in for the throttle.
 */
function table() {
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,lstart='], { ...PS, maxBuffer: 1 << 26 });
  if (listing.status !== 0) throw Error(`ps failed: ${listing.error?.message ?? listing.stderr.trim()}`);
  return new Map(listing.stdout.split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/)).filter(Boolean)
    .map(([, pid, ppid, pgid, stat, start]) => [Number(pid), { ppid: Number(ppid), pgid: Number(pgid), stat, start }]));
}
/** The command lines of `pids`, by pid. */
function lines(pids) {
  const env = { ...PS.env };
  delete env.COLUMNS;
  const listing = spawnSync('ps', ['-ww', '-o', 'pid=,args=', '-p', pids.join(',')], { ...PS, env });
  return new Map((listing.stdout ?? '').split('\n').map((line) => line.match(/^\s*(\d+)\s+(.*)$/)).filter(Boolean).map(([, pid, args]) => [Number(pid), args]));
}

/** Lists `caller`'s tree while it is armed, and stops the run's part of it when asked or when the caller dies. */
function watch(caller, folder) {
  // Named in the registry before the first look, so no other watcher's look takes this one for a run's.
  const own = startOf(process.pid);
  if (!own) process.exit(1);
  mkdirSync(WATCHERS, { recursive: true, mode: 0o700 });
  writeAtomic(join(WATCHERS, String(process.pid)), own);
  process.on('exit', () => rmSync(join(WATCHERS, String(process.pid)), { force: true }));
  const first = table(), callerStart = first.get(caller)?.start;
  if (!callerStart) process.exit(1);
  // An entry whose watcher is gone (one killed outright) is taken out: its number runs nothing, or runs a process of
  // another start. One that started after the listing stands.
  try {
    for (const name of readdirSync(WATCHERS).filter((name) => /^\d+$/.test(name))) {
      let start = null, running = true;
      try { start = readFileSync(join(WATCHERS, name), 'utf8'); } catch {}
      try { process.kill(Number(name), 0); } catch (error) { running = error.code !== 'ESRCH'; }
      const listed = first.get(Number(name));
      if (!running || (listed && start && listed.start !== start)) rmSync(join(WATCHERS, name), { force: true });
    }
  } catch {}
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
  const fence = new Map([...first].filter(([pid]) => ancestors(first, pid)).map(([pid, { start }]) => [pid, start]));
  const fenced = (procs, pid) => fence.has(pid) && fence.get(pid) === procs.get(pid)?.start;
  // Each process seen under the caller while armed, with its ancestors as first seen: one whose parent died first is
  // still known, and known as part of the command it was under.
  const look = () => {
    const now = table();
    let named = [];
    try { named = readdirSync(WATCHERS).map(Number); } catch {}
    const others = new Set(named.filter((pid) => {
      try { return readFileSync(join(WATCHERS, String(pid)), 'utf8') === now.get(pid)?.start; } catch { return false; }
    }));
    for (const [pid, { start }] of known) if (now.get(pid)?.start !== start || others.has(pid)) known.delete(pid);
    for (const [pid, { start, pgid }] of now) {
      if (pid === process.pid || fenced(now, pid) || known.has(pid) || others.has(pid)) continue;
      const up = ancestors(now, pid);
      if (up && !up.some((at) => fenced(now, at))) known.set(pid, { pid, start, pgid, up });
    }
    return now;
  };
  // Stops the known processes `pick` chooses: SIGTERM to those in the run's own groups, then, once those in groups of
  // their own have had their time to end, SIGTERM and SIGKILL to what is left, each by PID and start.
  // Each look on the way adds what the tree started since (a process given its time keeps starting others): one in the
  // run's own groups, or any once that time is over, gets SIGTERM at once.
  const stopTree = (pick, groups) => {
    const tree = new Map(), argv = new Map();
    // A process that ended unreaped (a zombie) runs nothing: it is no longer the run's to stop.
    const running = (now, { pid, start }) => now.get(pid)?.start === start && !now.get(pid).stat.startsWith('Z');
    let all = false;
    const signal = (list, name) => { for (const { pid } of list) try { process.kill(pid, name); } catch {} };
    const add = () => {
      const now = look();
      const fresh = [...known.values()].filter((entry) => pick(entry) && tree.get(entry.pid)?.start !== entry.start && running(now, entry));
      for (const entry of fresh) tree.set(entry.pid, entry);
      try { if (fresh.length) for (const [pid, args] of lines(fresh.map(({ pid }) => pid))) argv.set(pid, args); } catch {}
      signal(fresh.filter(({ pgid }) => all || groups.has(pgid)), 'SIGTERM');
      return now;
    };
    // Without a listing, what the looks before knew is signalled, by PID alone.
    let error;
    try { add(); } catch (failed) {
      error = failed.message;
      for (const entry of known.values()) if (pick(entry)) tree.set(entry.pid, entry);
      signal([...tree.values()].filter(({ pgid }) => groups.has(pgid)), 'SIGTERM');
    }
    const left = () => {
      let now;
      try { now = add(); } catch { return [...tree.values()]; }
      return [...tree.values()].filter((entry) => running(now, entry));
    };
    const wait = (ms) => { for (const by = performance.now() + ms; left().length && performance.now() < by;) sleep(250); };
    // deadline: a process in a group of its own gets 8 s to end with the run, as a run's cleanup does.
    wait(OWN_MS);
    all = true;
    signal(left(), 'SIGTERM');
    // deadline: what ignores SIGTERM for 3 s is killed.
    wait(GRACE_MS);
    signal(left(), 'SIGKILL');
    // A long command line keeps its head (the program) and its tail (the file it runs, often last).
    const short = (line) => (line.length > 600 ? `${line.slice(0, 300)} … ${line.slice(-300)}` : line);
    return { stopped: [...tree.values()].map(({ pid }) => ({ pid, command: short(argv.get(pid) ?? '?') })), ...error && { error } };
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
  let ticks = 0, run = null;
  setInterval(() => {
    if (stopping) return;
    let gone = false;
    try { process.kill(caller, 0); } catch (error) { gone = error.code === 'ESRCH'; }
    if (!existsSync(armed)) {
      // A run that ended by itself leaves nothing to stop; with no caller there is nothing left to watch. Every 10 s
      // the caller's number is checked against its start too: a number since taken is no caller.
      known.clear();
      if (!gone && ++ticks % 20 === 0) {
        const start = spawnSync('ps', ['-o', 'lstart=', '-p', String(caller)], PS);
        gone = start.status === 0 && start.stdout.trim() !== callerStart;
      }
      if (gone) {
        rmSync(folder, { recursive: true, force: true });
        process.exit(0);
      }
      return;
    }
    // Each arm is a command of its own: what an earlier one left running ended with it, and isn't this one's.
    let pending = {};
    try { pending = JSON.parse(readFileSync(armed, 'utf8')); } catch {}
    if (pending.run !== run) {
      known.clear();
      run = pending.run;
    }
    if (!gone) {
      // Without a listing the next look tries again; a caller whose number is gone is gone without one, and one that
      // died unreaped (a zombie, state Z) is gone too.
      try {
        const listed = look().get(caller);
        if (listed?.start === callerStart && !listed.stat.startsWith('Z')) return;
      } catch { return; }
    }
    // The caller died while a run was armed: every process of the run is stopped, and its record says so. Whatever
    // fails on the way, the watcher ends.
    stopping = true;
    process.on('uncaughtException', () => process.exit(0));
    // The run's own groups: the caller's, and those its commands lead (measureOnce's capture leads one).
    const groups = new Set([first.get(caller).pgid, ...[...known.values()].filter(({ up }) => !up.length).map(({ pgid }) => pgid)]);
    const result = stopTree(() => true, groups);
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
  const watcher = spawn(process.execPath, [self, 'watch', caller, folder], { stdio: ['ignore', 'pipe', 'ignore'] } /* Planted (#3433.d424696d): in the run's own group */);
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
