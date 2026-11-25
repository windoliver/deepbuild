// The per-machine throttle table (docs/parallel-proof.md, section 6): a host-local lock table under the user's
// ~/.deepbuild/throttle/, whatever HOME says, that grants build, bay pair, test and timed by class, so a neighbour's build never runs
// while a budget is timed. `throttle.mjs <class> [--wait <min>] -- <command>` acquires, runs, releases and exits
// with the child's status, or ends a command held past its `--hold` bound while another request waits; acquire and release serve the scripts that hold a grant themselves. `throttle.mjs window`
// opens a budget window (section 12a): a timed grant that waits for every slot to empty, around budget-window.mjs.
// `throttle.mjs load [--report]` reads the machine's load by who made it (#3067): a sample a minute, and their table.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants, cpus, freemem, homedir, loadavg, totalmem, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Mac has one bay pair and one build at a time; the Spark, Linux, has the cores for more. test's number is its
// ceiling: a test grant past the first starts only while the machine's readings leave room (roomForTest).
const LIMITS = process.platform === 'darwin' ? { build: 1, 'bay-pair': 1, test: 2, timed: 1 } : { build: 2, 'bay-pair': 3, test: 6, timed: 1 };
const CLASSES = Object.keys(LIMITS);
const POLL_MS = 200;
// A CLI grant's default bound, in minutes: the longest full run seen on the Spark was about 9 hours.
const HOLD = 720;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A run on the Spark is a unit capped at 24 GiB (MemoryMax), so one more run needs that much memory available; a run
// on the Mac, whose whole process tree measured 2.6 GiB, is budgeted 8 GiB (#2980). A test grant younger than 5
// minutes doesn't show in the readings yet, so it is counted as a run's memory still to come.
const RUN_MEMORY = (process.platform === 'darwin' ? 8 : 24) * 2 ** 30;
const SETTLING_MS = 5 * 60_000;

/**
 * Whether another test grant may start beside `held` (the table's test grants), by `readings` of the machine: the
 * first always may; past it, while fewer than the ceiling hold, the load is under the cores and the memory available,
 * less a run's for each held grant still settling (or of no known time), leaves room for one more run. Without
 * readings, as for a test's own table given none, only the ceiling decides.
 */
export function roomForTest(held, readings, now = Date.now()) {
  if (!held.length) return true;
  if (held.length >= LIMITS.test) return false;
  if (!readings) return true;
  const { memory, load, cores } = readings;
  const settling = held.filter((grant) => !(now - grant.at >= SETTLING_MS)).length;
  return load < cores && memory - settling * RUN_MEMORY >= RUN_MEMORY;
}

/**
 * Every process, by pid: its parent and its start time, which tells a holder from a later process given its number.
 * ps prints the start in its own zone and language, so every reader asks for the same ones. ps reads every process,
 * so a listing serves two seconds unless a fresh one is asked for.
 */
let listed = null;
function processes({ fresh = false } = {}) {
  if (!fresh && listed && performance.now() - listed.at < 2_000) return listed.procs;
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,lstart='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  if (listing.status !== 0) throw Error(`ps failed: ${listing.stderr.trim()}`);
  const table = new Map();
  for (const line of listing.stdout.split('\n')) {
    const [, pid, ppid, start] = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/) ?? [];
    if (pid) table.set(Number(pid), { ppid: Number(ppid), start });
  }
  listed = { procs: table, at: performance.now() };
  return table;
}
/** A process and its ancestors, nearest first. */
function chain(procs, pid) {
  const pids = [];
  for (let at = pid; procs.has(at) && !pids.includes(at); at = procs.get(at).ppid) pids.push(at);
  return pids;
}
const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
};
// A process ps listed is alive while its start is the one recorded; one it missed started since, and is alive while
// its number is.
const alive = (procs, { pid, start }) => (procs.has(pid) ? procs.get(pid).start === start : !gone(pid));
// Gone only by a fresh listing: in an older one, a number since taken by a new process reads as another's.
const ended = (entry) => !alive(processes(), entry) && !alive(processes({ fresh: true }), entry);
/** This process and its ancestors, nearest first: what a DEEP_THROTTLE or DEEP_PERF_LOCK holder is verified against. */
export const ancestors = () => chain(processes({ fresh: true }), process.pid);
/** Every process under `pid` now, by PID and start, so a stop later reaches only these and not a number since taken. */
export function descendants(pid) {
  const procs = processes({ fresh: true });
  return [...procs].filter(([at]) => at !== pid && chain(procs, at).includes(pid)).map(([at, { start }]) => ({ pid: at, start }));
}
/** SIGKILL to each of `tree` still listed with the start it had. */
export function killTree(tree) {
  const procs = processes({ fresh: true });
  for (const holder of tree) if (procs.get(holder.pid)?.start === holder.start) try { process.kill(holder.pid, 'SIGKILL'); } catch {}
}
/** The command lines of `pids`, by pid. */
function commands(pids) {
  const env = { ...process.env, LC_ALL: 'C' };
  delete env.COLUMNS;
  const listing = spawnSync('ps', ['-ww', '-o', 'pid=,args=', '-p', pids.join(',')], { encoding: 'utf8', env });
  // ps exits 1 when none of the pids is left, which lists nothing; anything else is a ps that couldn't run.
  if (listing.status > 1 || listing.error) throw Error(`ps failed: ${listing.error?.message ?? listing.stderr.trim()}`);
  return new Map(listing.stdout.split('\n').map((line) => line.match(/^\s*(\d+)\s+(.*)$/)).filter(Boolean).map(([, pid, args]) => [Number(pid), args]));
}
// node --test or vitest, by its command line: the program itself, never a word a shell was given, and --test only
// among node's own options, before its script: a command line that carries the word further on is no test run.
const testRunner = (args) => {
  const [program, ...words] = args.trim().split(/\s+/);
  const vitest = (word = '') => /(^|\/)vitest(\.m?js)?$|\/vitest\/(vitest\.m?js|dist\/)/.test(word);
  const script = words.findIndex((word) => !word.startsWith('-'));
  return vitest(program) || (/^node/.test(basename(program)) && (words.slice(0, script < 0 ? words.length : script).includes('--test') || vitest(words[script])));
};

/**
 * The table's folder (#2744): the machine's, under the user's home from the password database, so a HOME of a run's
 * own never splits it. Only inside a test run, read from the process table, does a request keep a table of its own:
 * DEEP_THROTTLE_TABLE's folder, or else its HOME's. Outside a test run, DEEP_THROTTLE_TABLE is refused, never read.
 */
let chosen;
function folder() {
  if (chosen) return chosen;
  const inTest = [...commands(ancestors()).values()].some(testRunner);
  if (!inTest && process.env.DEEP_THROTTLE_TABLE) throw Error('DEEP_THROTTLE_TABLE is read only inside a test run (node --test or vitest); unset it to use the machine\'s table');
  return (chosen = inTest ? process.env.DEEP_THROTTLE_TABLE || join(homedir(), '.deepbuild', 'throttle') : join(userInfo().homedir, '.deepbuild', 'throttle'));
}

/**
 * The machine's readings: the memory available, the 1-minute load and the cores. On Linux the memory is os.freemem(),
 * MemAvailable. On darwin os.freemem() counts only free pages, a fraction of a GiB on a busy Mac, so it is the kernel's
 * own measure, kern.memorystatus_level, the percentage of memory free (#2980).
 */
export function machineReadings() {
  let memory = freemem();
  if (process.platform === 'darwin') {
    const read = spawnSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level'], { encoding: 'utf8' });
    const level = Number(read.stdout?.trim());
    if (read.status !== 0 || !read.stdout?.trim() || !(level >= 0 && level <= 100)) throw Error(`sysctl kern.memorystatus_level read ${JSON.stringify(read.stdout ?? '')} (${read.error?.message ?? read.stderr?.trim() ?? ''})`);
    memory = Math.floor((level * totalmem()) / 100);
  }
  return { memory, load: loadavg()[0], cores: cpus().length };
}

/**
 * The readings a test grant is decided on. The machine's table reads the machine (machineReadings). A test's own table, whose holders are a test's stubs, reads the file
 * DEEP_THROTTLE_READINGS names, again at each look, or none without it; the machine's table refuses the variable.
 */
function readings() {
  const file = process.env.DEEP_THROTTLE_READINGS;
  // By real path, so a trailing slash or a HOME linked to the real one is still the machine's table.
  const machine = join(userInfo().homedir, '.deepbuild', 'throttle');
  mkdirSync(folder(), { recursive: true, mode: 0o700 });
  if (realpathSync(folder()) === (existsSync(machine) ? realpathSync(machine) : machine)) {
    if (file !== undefined) throw Error('DEEP_THROTTLE_READINGS is read only for a test\'s own table, inside a test run (node --test or vitest); unset it to use the machine\'s readings');
    return machineReadings();
  }
  if (file === undefined) return null;
  let given;
  try {
    given = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw Error(`DEEP_THROTTLE_READINGS: ${file} can't be read as JSON (${error.message})`);
  }
  const { memory, load, cores } = given ?? {};
  if (![memory, load, cores].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0) || !Number.isInteger(cores) || cores < 1) {
    throw Error(`DEEP_THROTTLE_READINGS: ${file} isn't {"memory": <bytes>, "load": <number>, "cores": <integer ≥ 1>}: ${JSON.stringify(given)}`);
  }
  return { memory, load, cores };
}

// The table is one file, rewritten whole under a lock file only one process can create, held for a read and a write;
// a request's ps runs before it is taken; a timed-out drain's and a past-bound holder's, inside it. The lock names
// its holder by number and start, and only a lock whose holder is gone is taken over: aside, by a rename only one process can make, and removed only if it is the lock judged gone. Two runs
// that judge the same one gone can, in the microseconds between, both go on, which needs that holder's death first.
function locked(act) {
  mkdirSync(folder(), { recursive: true, mode: 0o700 });
  const mark = join(folder(), 'table.lock');
  // The lock appears whole by linking a file already written: a new one, since a killed holder's own may still be the
  // lock, which a run given its number must not rewrite.
  const mine = `${mark}.${process.pid}`;
  rmSync(mine, { force: true });
  // A write that fails, as on a full disk, takes its own file with it (#2869).
  const write = (path, data) => {
    try {
      writeFileSync(path, data);
    } catch (error) {
      try {
        rmSync(path, { force: true });
      } catch {}
      throw error;
    }
  };
  write(mine, JSON.stringify({ pid: process.pid, start: processes().get(process.pid).start }));
  const { ino } = statSync(mine);
  for (;;) {
    try {
      linkSync(mine, mark);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let seen, holder;
    try {
      seen = statSync(mark);
      holder = JSON.parse(readFileSync(mark, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (ended(holder)) {
      const aside = `${mark}.gone.${process.pid}`;
      try {
        renameSync(mark, aside);
        // A live lock taken aside by mistake goes back.
        if (statSync(aside).ino !== seen.ino) linkSync(aside, mark);
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EEXIST') throw error;
      }
      rmSync(aside, { force: true });
      continue;
    }
    sleep(2 + Math.random() * 8);
  }
  try {
    rmSync(mine, { force: true });
    // A run killed before it took the lock leaves its file to link from, and one killed in a write its new table.
    for (const name of readdirSync(folder())) {
      const [, pid] = name.match(/^table\.(?:lock\.(?:gone\.)?|json\.)(\d+)$/) ?? [];
      if (pid && gone(Number(pid))) rmSync(join(folder(), name), { force: true });
    }
    const file = join(folder(), 'table.json');
    let table;
    try {
      table = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      // Only a machine that never granted has no table; one that can't be read is never taken as empty.
      if (error.code !== 'ENOENT') throw Error(`${file} can't be read (${error.message}); once no throttle runs on this machine, remove it`);
      table = { grants: [], requests: [], seq: 0 };
    }
    // A holder's or a waiter's death releases what it held or asked for.
    const gave = table.grants.filter(ended);
    for (const grant of gave) log({ event: 'released', class: grant.class, id: grant.id, pid: grant.pid, reason: 'holder gone' });
    table.grants = table.grants.filter((grant) => !gave.includes(grant));
    table.requests = table.requests.filter((request) => !ended(request));
    const result = act(table, processes());
    write(`${file}.${process.pid}`, JSON.stringify(table));
    renameSync(`${file}.${process.pid}`, file);
    return result;
  } finally {
    // Only this run's own lock goes.
    try {
      if (statSync(mark).ino === ino) rmSync(mark, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
function log(entry) {
  appendFileSync(join(folder(), 'log'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

/**
 * The grants this process's chain holds, when DEEP_THROTTLE names one of them: a grant in the table, its holder
 * alive and an ancestor of this process (or this process). An unverified value names nothing.
 */
function inherited(table, procs, mine) {
  const [, cls, id] = (process.env.DEEP_THROTTLE ?? '').match(/^([a-z-]+):([0-9a-f]+)$/) ?? [];
  const named = table.grants.find((grant) => grant.id === id && grant.class === cls);
  if (!named || !mine.includes(named.pid)) return [];
  return table.grants.filter((grant) => mine.includes(grant.pid));
}

/**
 * The grants a timed request waits on: every holder outside its chain that hasn't finished or doesn't wait in the
 * throttle, through a descendant's request. A bay pair's holder never counts as waiting for a top-level request: the
 * pair's work resumes the moment it is answered. A window takes no holder as waiting: it drains every slot, and a
 * waiting holder's nested request is served first.
 */
function blockers(table, procs, request) {
  const mine = chain(procs, request.pid);
  const waiting = (grant) => !request.window && (grant.class !== 'bay-pair' || request.nested)
    && table.requests.some((other) => other.id !== request.id && chain(procs, other.pid).includes(grant.pid));
  return table.grants.filter((grant) => !mine.includes(grant.pid) && !waiting(grant));
}

// Requests in the order they are served: those nested in a current holder's chain first, then by arrival.
const order = (a, b) => Number(b.nested) - Number(a.nested) || a.seq - b.seq;
function grantable(table, procs, request, seen) {
  const mine = chain(procs, request.pid);
  const outside = table.grants.filter((grant) => !mine.includes(grant.pid));
  // timed is exclusive of every class outside its own chain.
  if (outside.some((grant) => grant.class === 'timed')) return false;
  // A request is served in order only while the limit it was made under has room, so the largest limit among the
  // live waiters is the machine's (#2902). One that records none comes from a checkout older than that and counts as
  // allowing one grant: its own code still takes a slot when it is first in its own view and below its own limit.
  // timed counts no grants: its chain and its blockers decide it.
  const held = table.grants.filter((grant) => grant.class === request.class).length;
  const room = (other) => other.class === 'timed' || held < (other.limit ?? 1);
  const first = table.requests.filter((other) => other.class === request.class && room(other)).sort(order)[0];
  if (first?.id !== request.id) return false;
  if (request.class !== 'timed') {
    // A pending timed request drains: no new top-level grant starts, unless a held grant blocked a drain to its bound
    // (#2744). A drain can't finish until that holder ends, by itself or by its bound, so meanwhile the machine goes
    // on. A window drains whatever is held (section 12a).
    const marked = table.grants.some((grant) => grant.blocked);
    if (!request.nested && table.requests.some((other) => other.class === 'timed' && (other.window || !marked))) return false;
    return request.class === 'test' ? roomForTest(table.grants.filter((grant) => grant.class === 'test'), seen) : held < LIMITS[request.class];
  }
  if (blockers(table, procs, request).length) return false;
  // A top-level request waits for load below the cores, as the log shows. A nested one, in a chain that holds a grant
  // and waits on it, doesn't, so two nested chains finish in their waits on a loaded machine.
  return request.nested || loadavg()[0] < cpus().length;
}

// The holders the last timed request to time out waited on, for its INCONCLUSIVE line.
let blocked = [];

/**
 * Takes a grant of `cls`, waiting at most `wait` minutes; null when none came, or an ENOSPC marked `waited` thrown when
 * the wait ran out on a full disk (#2869). A build or test request from a chain
 * that holds a grant, and a timed request from one that holds timed, passes through: it holds its ancestor's grant
 * and is released with it. The grant's `token` is what DEEP_THROTTLE carries to the holder's descendants. A wait doesn't
 * run down while a window is open: a window outlasts a wait, and only its end decides when the next build starts.
 */
export function acquire(cls, { wait = 30, window = false } = {}) {
  if (!LIMITS[cls]) throw Error(`no throttle class ${cls}; the classes are ${CLASSES.join(', ')}`);
  const pid = process.pid;
  // A readings variable the table can't take is refused before anything is asked.
  readings();
  let deadline = Date.now() + wait * 60_000, polled = Date.now();
  const request = locked((table, procs) => {
    const held = inherited(table, procs, chain(procs, pid));
    if (held.length && (cls === 'build' || cls === 'test' || (cls === 'timed' && held.some((grant) => grant.class === 'timed')))) {
      log({ event: 'passed', class: cls, pid, through: process.env.DEEP_THROTTLE });
      return { pass: true };
    }
    const entry = { id: randomBytes(8).toString('hex'), class: cls, pid, start: procs.get(pid).start, nested: held.length > 0, window, limit: LIMITS[cls], seq: (table.seq = (table.seq ?? 0) + 1) };
    table.requests.push(entry);
    return entry;
  });
  if (request.pass) return { class: cls, token: process.env.DEEP_THROTTLE, pass: true };
  // A full disk leaves the table as it was (#2869): a waiting request's look whose write fails with ENOSPC is one more
  // look with no grant, and the request keeps its place. Once the wait has run out the ENOSPC is thrown, marked
  // `waited`, rather than no grant returned: the request it couldn't take out of the table stays there until this
  // process ends, as after any error. The CLI reads it as the timeout it is.
  const look = (act) => {
    try {
      return locked(act);
    } catch (error) {
      if (error.code !== 'ENOSPC') throw error;
      if (Date.now() > deadline) throw Object.assign(error, { waited: true });
      return null;
    }
  };
  for (;;) {
    const grant = look((table, procs) => {
      const pending = table.requests.find((other) => other.id === request.id);
      if (!pending) return 'timeout';
      const now = Date.now();
      if ([...table.grants, ...table.requests].some((other) => other.window && other.id !== request.id)) deadline += now - polled;
      polled = now;
      const seen = cls === 'test' ? readings() : undefined;
      if (!grantable(table, procs, pending, seen)) {
        if (now <= deadline) return null;
        table.requests.splice(table.requests.indexOf(pending), 1);
        // A drain that timed out names what it waited on. A top-level one marks it too, so the next drain doesn't stop
        // the machine on it, but only while nothing is marked: a holder that started while drains were off isn't one
        // that blocked a drain, and once the marked ones end, drains stop new grants again.
        const named = cls === 'timed' ? blockers(table, procs, pending) : [];
        const lines = named.length ? commands(named.map((grant) => grant.pid)) : new Map();
        if (!pending.window && !pending.nested && !table.grants.some((grant) => grant.blocked)) for (const grant of named) grant.blocked = true;
        blocked = named.map(({ class: held, id, pid: holder, at }) => ({ class: held, id, pid: holder, at: at ? new Date(at).toISOString() : 'an unknown time', command: lines.get(holder) ?? '' }));
        return 'timeout';
      }
      table.requests.splice(table.requests.indexOf(pending), 1);
      const taken = new Set(table.grants.filter((other) => other.class === cls).map((other) => other.index));
      const index = Array.from({ length: LIMITS[cls] }, (_, k) => k + 1).find((k) => !taken.has(k));
      const entry = { id: request.id, class: cls, pid, start: request.start, nested: request.nested, window, index, at: now };
      table.grants.push(entry);
      const load = loadavg()[0], cores = cpus().length;
      log({ event: 'granted', class: cls, grant: entry.nested ? 'nested' : 'top-level', id: entry.id, pid, index, load, cores, wait, ...cls === 'test' ? { readings: seen } : {} });
      return entry;
    });
    if (grant === 'timeout') {
      // The request is out of the table, so a log line a full disk refuses changes nothing.
      try {
        log({ event: 'timeout', class: cls, id: request.id, pid, wait, ...blocked.length ? { blockers: blocked } : {} });
      } catch (error) {
        if (error.code !== 'ENOSPC') throw error;
      }
      return null;
    }
    if (grant) return { class: cls, id: grant.id, index: grant.index, token: `${cls}:${grant.id}`, pass: false };
    sleep(POLL_MS * (0.75 + Math.random() / 2));
  }
}

/**
 * Whether this process or an ancestor holds a grant of `cls`, with `window` a budget window's, by the table;
 * DEEP_THROTTLE, which a child can drop, isn't read.
 */
export const holds = (cls, { window = false } = {}) => locked((table, procs) => {
  const mine = chain(procs, process.pid);
  return table.grants.some((grant) => grant.class === cls && (!window || grant.window) && mine.includes(grant.pid));
});

/**
 * Gives a grant back; a passed-through one is its ancestor's to release. A release the table can't take is tried for
 * two seconds, then thrown: a holder that can't give timed back must not run on holding it, and its exit frees it.
 */
export function release(grant) {
  if (!grant || grant.pass) return;
  for (let attempt = 0; ; attempt++) {
    try {
      return locked((table) => {
        const at = table.grants.findIndex((other) => other.id === grant.id);
        if (at < 0) return;
        table.grants.splice(at, 1);
        log({ event: 'released', class: grant.class, id: grant.id, pid: process.pid });
      });
    } catch (error) {
      if (attempt === 9) throw error;
      sleep(POLL_MS);
    }
  }
}

// The load, by who made it (#3067, section 6): a reading. It takes no grant and no lock, and stops no process.
const KINDS = ['compile', 'node', 'other'];
const kind = (command) => (command === 'rustc' || command === 'cargo' ? 'compile' : command === 'node' ? 'node' : 'other');
// CPU is counted in thousandths of a core, whole numbers, so a sum's parts add up to it.
const cores = (thousandths) => thousandths / 1000;
const shares = (tally) => ({ cpu: cores(KINDS.reduce((sum, name) => sum + tally[name], 0)), ...Object.fromEntries(KINDS.map((name) => [name, cores(tally[name])])) });

/**
 * One GPU read (#3240): each accelerator client, by its registry entry, with the pid that opened it and the GPU time
 * it has accumulated, in nanoseconds. A read that can't be made throws, in this code's words.
 */
function readGpu() {
  const listing = spawnSync('ioreg', ['-r', '-l', '-d', '2', '-w', '0', '-c', 'IOAccelerator'], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, LC_ALL: 'C' } });
  if (listing.error || listing.status !== 0) throw Error(`ioreg ${listing.error?.code ?? (listing.signal ? `ended by ${listing.signal}` : `exited ${listing.status}`)}`);
  const clients = new Map();
  let entry = null;
  for (const line of listing.stdout.split('\n')) {
    const [, id] = line.match(/\+-o \S+\s+<class \S+, id (0x[0-9a-f]+)/) ?? [];
    if (id) entry = { id, ns: 0, pid: null };
    if (!entry) continue;
    const [, usage] = line.match(/"AppUsage" = \((.*)\)\s*$/) ?? [];
    if (usage !== undefined) entry.ns = [...usage.matchAll(/"accumulatedGPUTime"=(\d+)/g)].reduce((sum, [, ns]) => sum + BigInt(ns), 0n);
    const [, pid] = line.match(/"IOUserClientCreator" = "pid (\d+),/) ?? [];
    if (pid) {
      entry.pid = Number(pid);
      clients.set(entry.id, entry);
    }
  }
  if (!clients.size) throw Error('ioreg listed no client');
  return clients;
}
// The last GPU read made, so the read after one that wasn't gives the change since it.
let gpuBefore = null;
let gpuBeforeFailed = null;

/**
 * One sample: the load, the cores, and each running process's CPU, by ps, under the outermost held grant whose holder
 * is the process or above it, or else under `outside`. A reading that can't be made says `failed`, with no numbers. The
 * reason is this code's own words, never ps's, so the log holds no path.
 */
function sample() {
  const reading = { at: new Date().toISOString(), load: loadavg()[0], cores: cpus().length };
  const darwin = process.platform === 'darwin';
  // The first sample's read before is made as it starts, a second before its own.
  if (darwin && !gpuBefore) {
    try {
      gpuBefore = readGpu();
      gpuBeforeFailed = null;
    } catch (error) {
      gpuBeforeFailed = error.message;
    }
  }
  sleep(1000);
  let held, procs;
  try {
    // The table is replaced whole by a rename, so a read without its lock sees one table or the next.
    try {
      held = JSON.parse(readFileSync(join(folder(), 'table.json'), 'utf8')).grants;
    } catch (error) {
      if (error.code !== 'ENOENT') throw Error('the table can\'t be read');
      held = [];
    }
    if (!Array.isArray(held)) throw Error('the table can\'t be read');
    const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,%cpu=,lstart=,ucomm='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
    if (listing.status !== 0) throw Error(`ps ${listing.error?.code ?? (listing.signal ? `ended by ${listing.signal}` : `exited ${listing.status}`)}`);
    procs = new Map();
    for (const line of listing.stdout.split('\n')) {
      const [, pid, ppid, cpu, start, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*?)\s*$/) ?? [];
      if (pid) procs.set(Number(pid), { ppid: Number(ppid), start, cpu: Math.round(Number(cpu) * 10), command });
    }
    if (!procs.size) throw Error('ps listed no process');
  } catch (error) {
    return { ...reading, failed: error.message };
  }
  let gpu = null, gpuUnread = null;
  if (!darwin) gpuUnread = 'the GPU is read on macOS only';
  else {
    try {
      const now = readGpu();
      // Planted: a read that can't be made is written as no GPU time, zeros, never gpuUnread.
      if (!gpuBefore) gpu = new Map();
      else {
        gpu = new Map();
        for (const [id, client] of now) {
          const was = gpuBefore.get(id);
          const change = was && was.pid === client.pid ? client.ns - was.ns : client.ns;
          if (change > 0n) gpu.set(client.pid, (gpu.get(client.pid) ?? 0n) + change);
        }
      }
      gpuBefore = now;
      gpuBeforeFailed = null;
    } catch {
      // Planted: as above.
      gpu = new Map();
    }
  }
  const tally = () => Object.fromEntries(KINDS.map((name) => [name, 0]));
  // A holder of two grants counts under the one it took first; the other still has its entry.
  const entries = held.filter((grant) => procs.get(grant.pid)?.start === grant.start).map((grant) => ({ id: grant.id, class: grant.class, pid: grant.pid, tally: tally(), ns: 0n }));
  const grants = new Map([...entries].reverse().map((entry) => [entry.pid, entry]));
  const outside = { ...tally(), ns: 0n };
  const used = [];
  const owners = new Map();
  for (const [pid, proc] of procs) {
    const owner = grants.get(chain(procs, pid).findLast((at) => grants.has(at)));
    owners.set(pid, owner);
    (owner?.tally ?? outside)[kind(proc.command)] += proc.cpu;
    if (proc.cpu) used.push({ pid, command: proc.command, cpu: proc.cpu, ...owner && { grant: owner.id } });
  }
  const gpuUsed = [];
  for (const [pid, ns] of gpu ?? []) {
    // A process ps didn't list counts in outside and in no gpuTop.
    const owner = owners.get(pid);
    (owner ?? outside).ns += ns;
    if (procs.has(pid)) gpuUsed.push({ pid, command: procs.get(pid).command, ns, ...owner && { grant: owner.id } });
  }
  const seconds = (ns) => Number(ns) / 1e9;
  return {
    ...reading,
    grants: entries.map(({ tally: mine, ns, ...grant }) => ({ ...grant, ...shares(mine), ...gpu && { gpu: seconds(ns) } })),
    outside: { ...shares(outside), ...gpu && { gpu: seconds(outside.ns) } },
    top: used.sort((a, b) => b.cpu - a.cpu).slice(0, 5).map((proc) => ({ ...proc, cpu: cores(proc.cpu) })),
    ...gpu && { gpuTop: gpuUsed.sort((a, b) => (b.ns > a.ns ? 1 : b.ns < a.ns ? -1 : 0)).slice(0, 5).map(({ ns, ...proc }) => ({ pid: proc.pid, command: proc.command, gpu: seconds(ns), ...proc.grant && { grant: proc.grant } })) },
    ...gpuUnread && { gpuUnread },
  };
}

/**
 * The table `load --report` prints from the log's samples: the share of minutes above the cores and, over those that
 * were read, each class's and outside's mean CPU as a share of the mean of all, in tenths of a percent rounded so
 * they add up to 100.0 (the largest remainders take the tenths left over). The shares are of the CPU read, which the
 * cores bound, not of the load, so the mean of each is printed beside them, and the commands outside every grant that
 * the samples' `top` named, a process that outlived its parent among them.
 */
function loadReport(samples, torn) {
  const percent = (tenths) => `${(tenths / 10).toFixed(1)}%`;
  const above = samples.filter((entry) => entry.load > entry.cores);
  const read = above.filter((entry) => !('failed' in entry));
  const failed = samples.filter((entry) => 'failed' in entry).length;
  const lines = [`${percent(Math.round((1000 * above.length) / samples.length))} of minutes above the cores (${above.length} of ${samples.length})`];
  const sums = new Map([...CLASSES.map((cls) => [cls, 0]), ...KINDS.map((name) => [`outside ${name}`, 0])]);
  for (const entry of read) {
    for (const grant of entry.grants) sums.set(grant.class, (sums.get(grant.class) ?? 0) + grant.cpu);
    for (const name of KINDS) sums.set(`outside ${name}`, sums.get(`outside ${name}`) + entry.outside[name]);
  }
  const total = [...sums.values()].reduce((sum, cpu) => sum + cpu, 0);
  if (total > 0) {
    const exact = [...sums].map(([name, cpu]) => ({ name, cpu, tenths: Math.floor((1000 * cpu) / total), rest: ((1000 * cpu) / total) % 1 }));
    let left = 1000 - exact.reduce((sum, part) => sum + part.tenths, 0);
    for (const part of [...exact].sort((a, b) => b.rest - a.rest)) if (left-- > 0) part.tenths += 1;
    const of = new Map(exact.map((part) => [part.name, part]));
    const classes = new Set(read.flatMap((entry) => entry.grants.map((grant) => grant.class)));
    for (const cls of sums.keys()) if (classes.has(cls)) lines.push(`${cls} ${percent(of.get(cls).tenths)}`);
    const [compile, node, other] = KINDS.map((name) => of.get(`outside ${name}`).tenths);
    lines.push(`outside ${percent(compile + node + other)} (compile ${percent(compile)}, node ${percent(node)}, other ${percent(other)})`);
    const mean = (sum) => (sum / read.length).toFixed(2);
    lines.push(`mean CPU read ${mean(total)} of ${mean(read.reduce((sum, entry) => sum + entry.cores, 0))} cores, at a mean load of ${mean(read.reduce((sum, entry) => sum + entry.load, 0))}`);
    const ungranted = new Map();
    for (const proc of read.flatMap((entry) => entry.top)) if (!proc.grant) ungranted.set(proc.command, (ungranted.get(proc.command) ?? 0) + proc.cpu);
    const named = [...ungranted].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([command, cpu]) => `${command} ${mean(cpu)}`);
    if (named.length) lines.push(`top commands under no grant, mean cores: ${named.join(', ')}`);
  } else if (above.length) lines.push('no CPU was read in those minutes');
  if (failed) lines.push(`${failed} of ${samples.length} samples failed and count in no share`);
  if (torn) lines.push(`${torn} lines of the log can't be read and count as no minute`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'load') {
  const options = process.argv.slice(3);
  const write = () => appendFileSync(join(folder(), 'load.log'), `${JSON.stringify(sample())}\n`);
  try {
    if (options.length && options.join(' ') !== '--report') throw Error('usage: throttle.mjs load [--report]');
    if (options.length) {
      // A line a full disk cut short isn't a sample.
      const lines = readFileSync(join(folder(), 'load.log'), 'utf8').split('\n').filter(Boolean);
      const samples = lines.flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
      if (!samples.length) throw Error('load.log holds no sample');
      console.log(loadReport(samples, lines.length - samples.length));
      process.exit(0);
    }
    mkdirSync(folder(), { recursive: true, mode: 0o700 });
    write();
  } catch (error) {
    console.log(`BLOCKED throttle: ${error.message}`);
    process.exit(2);
  }
  // A minute's sample that can't be written, as on a full disk, is said and the next is still tried.
  setInterval(() => {
    try {
      write();
    } catch (error) {
      console.error(`throttle load: ${error.message}`);
    }
  }, 60_000);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] !== 'load') {
  const args = process.argv.slice(2);
  const split = args.indexOf('--');
  const [named, ...options] = split < 0 ? args : args.slice(0, split);
  // A window is a measured run's top-level timed, with its wait.
  const window = named === 'window' && split < 0;
  const cls = window ? 'timed' : named;
  const command = window ? [process.execPath, fileURLToPath(new URL('budget-window.mjs', import.meta.url))] : split < 0 ? [] : args.slice(split + 1);
  const given = new Map(Array.from({ length: options.length / 2 | 0 }, (_, k) => [options[2 * k], Number(options[2 * k + 1])]));
  const wait = given.get('--wait') ?? (window ? 60 : 30), hold = given.get('--hold') ?? HOLD;
  const flags = window ? ['--wait'] : ['--wait', '--hold'];
  if (!LIMITS[cls] || !command.length || options.length !== 2 * given.size || ![...given].every(([flag, value]) => flags.includes(flag) && value >= 0)) {
    console.log(`BLOCKED throttle: usage: throttle.mjs <${CLASSES.join('|')}> [--wait <min>] [--hold <min>] -- <command>, throttle.mjs window [--wait <min>], or throttle.mjs load [--report]`);
    process.exit(2);
  }
  let grant;
  try {
    grant = acquire(cls, { wait, window });
  } catch (error) {
    // A wait that ran out on a full disk is no grant (#2869).
    if (error.waited) grant = null;
    // The table couldn't be read or written otherwise, so nothing ran: BLOCKED, never a failure of the command.
    else {
      console.log(`BLOCKED throttle: ${error.message}\n  Fix: Repair what the line names: ~/.deepbuild/throttle/ this user's to write, its table readable, ps runnable.`);
      process.exit(2);
    }
  }
  if (!grant) {
    // The marker a job's report reads by: its output is the test run's too, so a line there proves nothing.
    if (process.env.DEEP_PROOF_VITEST_REPORT) appendFileSync(process.env.DEEP_PROOF_VITEST_REPORT, `${JSON.stringify({ type: 'no-grant', message: `no ${cls} grant came within ${wait} min` })}\n`);
    const why = blocked.map((holder) => `; blocked by ${holder.class} grant ${holder.id} held by pid ${holder.pid} since ${holder.at} (${holder.command})`).join('');
    console.log(`INCONCLUSIVE no grant: no ${cls} grant came within ${wait} min${why}\n  Fix: Wait for the other sessions' builds and proofs on this machine, then run again.`);
    process.exit(3);
  }
  if (window) log({ event: 'window-open', id: grant.id, pid: process.pid });
  // A window's record names its grant, as the log's window-open and window-close lines do (#2674).
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: { ...process.env, DEEP_THROTTLE: grant.token, ...window && { DEEP_WINDOW: grant.id } } });
  // A terminal's SIGINT reaches the whole group, the command too, so it isn't sent again; a SIGTERM or SIGHUP sent to
  // this process alone is passed on.
  process.on('SIGINT', () => {});
  for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  // This process exits next, which frees a grant a release couldn't give back.
  const giveBack = () => {
    try {
      if (window) log({ event: 'window-close', id: grant.id, pid: process.pid });
      release(grant);
    } catch {}
  };
  child.on('error', (error) => {
    giveBack();
    console.log(`BLOCKED throttle: ${command[0]} could not start: ${error.message}`);
    process.exit(127);
  });
  // A grant held past its bound while a request from outside this tree waits ends (#2744): SIGTERM to the command,
  // and 10 s later SIGKILL to every process of the tree as it stood then, by PID and start.
  let tree = null;
  const mine = () => descendants(process.pid);
  // Only a process listed now with the start it had then: a number since taken is someone else's.
  const stop = () => killTree(tree);
  if (!grant.pass && !window) {
    // A monotonic clock, so a machine that slept doesn't count the sleep. A request waits once it was pending at the
    // last look too, so one about to be granted at once doesn't count; and a grant given back early has nothing to end.
    const since = performance.now();
    let seen = new Set();
    const watch = setInterval(() => {
      if (tree || performance.now() - since < hold * 60_000) return;
      let waited;
      try {
        waited = locked((table) => {
          if (!table.grants.some((other) => other.id === grant.id)) return clearInterval(watch), false;
          const procs = processes({ fresh: true });
          const outside = table.requests.filter((other) => !chain(procs, other.pid).includes(process.pid)).map((other) => other.id);
          const again = outside.some((id) => seen.has(id));
          seen = new Set(outside);
          return again;
        });
      } catch {
        return;
      }
      if (!waited) return;
      // Nothing here may throw: this process would die holding nothing, its command running on uncounted. Without a
      // listing the next look tries again; a log that can't be written is no reason to let the command run on; and
      // when ps fails after the SIGTERM, the command itself is still this process's child to SIGKILL.
      try {
        tree = mine();
      } catch {
        return;
      }
      try {
        log({ event: 'expired', class: cls, id: grant.id, pid: process.pid, hold });
      } catch {}
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          tree.push(...mine());
          stop();
        } catch {
          child.kill('SIGKILL');
        }
      }, 10_000).unref();
    }, 1_000);
    watch.unref();
  }
  child.on('exit', (status, signal) => {
    if (tree) try { stop(); } catch {}
    giveBack();
    if (tree) {
      console.log(`INCONCLUSIVE throttle: the ${cls} grant ${grant.id} was held past its ${hold} min bound while another request waited; its command was stopped\n  Fix: Find why the command didn't end (a leaked child, a hung test), then run again.`);
      process.exit(3);
    }
    process.exit(signal ? 128 + constants.signals[signal] : status);
  });
}
