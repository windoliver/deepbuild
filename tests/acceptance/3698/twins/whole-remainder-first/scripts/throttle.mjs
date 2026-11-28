// The per-machine throttle table (docs/parallel-proof.md, section 6): a host-local lock table under the user's
// ~/.deepbuild/throttle/, whatever HOME says, that grants build, bay pair, test and timed by class, so a neighbour's build never runs
// while a budget is timed. `throttle.mjs <class> [--wait <min> | --stall <min>] -- <command>` acquires, runs, releases and exits
// with the child's status, or ends a command held past its `--hold` bound while another request waits; acquire and release serve the scripts that hold a grant themselves. `throttle.mjs window`
// asks for a budget window (section 12a): once one is due, a timed grant that waits for every slot to empty, around budget-window.mjs.
// `throttle.mjs load [--report]` reads the machine's load by who made it (#3067), its GPU time and the cores idle beside
// the requests in line (#3240), and the threads under each grant (#3550): a sample a minute, and their table.
// An affected.mjs run's test grant is its admission, and its jobs take turns on one pool of job tokens (#3221). A build
// or test asked for under no grant is admitted as a run is and takes a turn on that pool, a run of one job (#3549, #3694).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, linkSync, mkdirSync, mkdtempSync, constants as modes, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { constants, cpus, freemem, homedir, loadavg, tmpdir, totalmem, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Mac has one bay pair; the Spark, Linux, has the cores for more. test's and build's numbers are ceilings: a grant
// past the class's first starts only while the machine's readings leave room (roomForTest), and the pool bounds what
// the admitted builds and runs run at once (#3221, #3549).
const LIMITS = process.platform === 'darwin' ? { build: 4, 'bay-pair': 1, test: 2, timed: 1 } : { build: 6, 'bay-pair': 3, test: 6, timed: 1 };
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
 * readings, as for a test's own table given none, only the ceiling decides. A build under no grant is decided as a run
 * is, beside the table's build grants and under `ceiling`, the build class's (#3549).
 */
export function roomForTest(held, readings, now = Date.now(), run = false, ceiling = LIMITS.test) {
  if (!held.length) return true;
  if (held.length >= ceiling) return false;
  if (!readings) return true;
  const { memory, load, cores } = readings;
  const settling = held.filter((grant) => !(now - grant.at >= SETTLING_MS)).length;
  // A run's admission doesn't read the load: the pool bounds what admitted runs run (#3221).
  return (run || load < cores) && memory - settling * RUN_MEMORY >= RUN_MEMORY;
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
export function descendants(...pids) {
  const procs = processes({ fresh: true });
  return [...procs].filter(([at]) => !pids.includes(at) && chain(procs, at).some((pid) => pids.includes(pid))).map(([at, { start }]) => ({ pid: at, start }));
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
  if (!own()) {
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
/** Whether the table is a test's own, by real path, so a trailing slash or a HOME linked to the real one is still the machine's. */
function own() {
  const machine = join(userInfo().homedir, '.deepbuild', 'throttle');
  mkdirSync(folder(), { recursive: true, mode: 0o700 });
  return realpathSync(folder()) !== (existsSync(machine) ? realpathSync(machine) : machine);
}
// The pool of job tokens every admitted run's jobs take turns on (#3221): a core less one, at least one; a test's own
// table counts its readings' cores.
const pool = () => Math.max(1, (own() ? readings()?.cores ?? cpus().length : cpus().length) - 1);
// The disk free under HOME, where a run's shards are (section 7a).
const freeDisk = () => {
  const stat = statfsSync(homedir());
  return stat.bavail * stat.bsize;
};

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
    // A holder's or a waiter's death releases what it held or asked for; a run's, the turns its jobs hold or wait for (#3221).
    const gave = table.grants.filter(ended);
    for (const grant of gave) log({ event: 'released', class: grant.class, id: grant.id, pid: grant.pid, ...grant.run && { run: grant.run }, reason: 'holder gone' });
    table.grants = table.grants.filter((grant) => !gave.includes(grant));
    const runs = new Set(table.grants.filter((grant) => grant.run === true).map((grant) => grant.id));
    const orphans = table.grants.filter((grant) => grant.class === 'turn' && !runs.has(grant.run));
    for (const grant of orphans) log({ event: 'released', class: 'turn', id: grant.id, pid: grant.pid, run: grant.run, reason: 'run gone' });
    table.grants = table.grants.filter((grant) => !orphans.includes(grant));
    for (const grant of gave) served(table, grant);
    table.requests = table.requests.filter((request) => !ended(request) && (request.class !== 'turn' || runs.has(request.run)));
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
// A turn given back adds its time to its run's, which the next turn goes by (#3221).
function served(table, turn, now = Date.now()) {
  const run = turn.class === 'turn' && table.grants.find((grant) => grant.id === turn.run);
  if (run) run.used = (run.used ?? 0) + now - turn.at;
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
/**
 * The waiting job a free token goes to (#3221): of the run whose jobs have had the least time on turns, those ended and
 * those in flight, the one that asked first; none while the pool's tokens are all dealt or lent.
 */
function nextTurn(table, now = Date.now()) {
  const turns = table.grants.filter((grant) => grant.class === 'turn');
  if (turns.reduce((sum, grant) => sum + 1 + grant.lent, 0) >= pool()) return null;
  const time = (run) => (table.grants.find((grant) => grant.id === run)?.used ?? 0) + turns.filter((grant) => grant.run === run).reduce((sum, grant) => sum + now - grant.at, 0);
  return table.requests.filter((other) => other.class === 'turn').sort((a, b) => time(a.run) - time(b.run) || a.seq - b.seq)[0]?.id;
}
function grantable(table, procs, request, seen) {
  const mine = chain(procs, request.pid);
  const outside = table.grants.filter((grant) => !mine.includes(grant.pid));
  // timed is exclusive of every class outside its own chain.
  if (outside.some((grant) => grant.class === 'timed')) return false;
  // A pending timed request drains: no new top-level grant starts, unless a held grant blocked a drain to its bound
  // (#2744). A drain can't finish until that holder ends, by itself or by its bound, so meanwhile the machine goes
  // on. A window drains whatever is held (section 12a). No turn is dealt meanwhile, nested or not (#3221), but for a
  // window: it waits for every grant to end, so the runs admitted before it take turns until they do.
  const marked = table.grants.some((grant) => grant.blocked);
  const draining = table.requests.some((other) => other.class === 'timed' && (other.window || !marked));
  if (request.class === 'turn') return !table.requests.some((other) => other.class === 'timed' && !other.window && !marked) && nextTurn(table) === request.id;
  // A request is served in order only while the limit it was made under has room, so the largest limit among the
  // live waiters is the machine's (#2902). One that records none comes from a checkout older than that and counts as
  // allowing one grant: its own code still takes a slot when it is first in its own view and below its own limit.
  // timed counts no grants: its chain and its blockers decide it. A run admitted under a caller's grant takes no slot.
  const slots = table.grants.filter((grant) => grant.class === request.class && !(grant.run && grant.nested));
  const held = slots.length;
  const room = (other) => other.class === 'timed' || held < (other.limit ?? 1);
  const first = table.requests.filter((other) => other.class === request.class && room(other)).sort(order)[0];
  if (first?.id !== request.id) return false;
  if (request.class !== 'timed') {
    if (!request.nested && draining) return false;
    if (request.class === 'bay-pair') return held < LIMITS['bay-pair'];
    // A build under no grant is admitted as a run is, without the load (#3549). Only the request first in line under
    // its ceiling comes this far, so a line of builds, each looking five times a second, doesn't read the machine.
    if (request.class === 'build') return roomForTest(slots, readings(), Date.now(), true, LIMITS.build);
    // A test is admitted without the load too (#3694); a run's also waits for the free disk its shards need (#3221).
    return (!request.disk || freeDisk() >= request.disk) && roomForTest(slots, seen, Date.now(), true);
  }
  if (blockers(table, procs, request).length) return false;
  // A top-level request waits for load below the cores, as the log shows. A nested one, in a chain that holds a grant
  // and waits on it, doesn't, so two nested chains finish in their waits on a loaded machine.
  return request.nested || loadavg()[0] < cpus().length;
}

// The holders the last timed request to time out waited on, or a stalled one's of its class, for its INCONCLUSIVE line.
let blocked = [];

/**
 * Takes a grant of `cls`, waiting at most `wait` minutes; null when none came, or an ENOSPC marked `waited` thrown when
 * the wait ran out on a full disk (#2869). With `stall`, the wait has no clock: the request keeps its place for as long
 * as grants of its class change hands, and runs out only once none has for `stall` minutes (#3334). A build or test request from a chain
 * that holds a grant, and a timed request from one that holds timed, passes through: it holds its ancestor's grant
 * and is released with it. With `turns` false it takes no turn of the pool inside an admitted run either, as
 * scripts/lease asks (#3238). The grant's `token` is what DEEP_THROTTLE carries to the holder's descendants. A wait doesn't
 * run down while a window is open: a window outlasts a wait, and only its end decides when the next build starts.
 * A build or plain test from a chain that holds no grant is admitted in the wait, then takes a turn of the pool with no
 * limit, as a run of one job (#3549, #3694): its grant names that turn as `turn`, and release gives both back.
 */
export function acquire(cls, { wait = 30, stall, window = false, run, turns = true } = {}) {
  if (!LIMITS[cls]) throw Error(`no throttle class ${cls}; the classes are ${CLASSES.join(', ')}`);
  const pid = process.pid;
  // A readings variable the table can't take is refused before anything is asked.
  readings();
  const bound = (stall ?? wait) * 60_000, asked = Date.now();
  let deadline = asked + bound, polled = asked, hands;
  let request = locked((table, procs) => {
    const held = inherited(table, procs, chain(procs, pid));
    const id = randomBytes(8).toString('hex'), start = procs.get(pid).start, seq = () => (table.seq = (table.seq ?? 0) + 1);
    if (held.length && (cls === 'build' || cls === 'test' || (cls === 'timed' && held.some((grant) => grant.class === 'timed')))) {
      // A run asked under a caller's grant is admitted at once, with no slot; inside an admitted run, a request under no
      // turn waits for one (#3221). An admitted build's or plain test's own turn is no job's: a request under it is as
      // under that grant alone, so a run asked there is admitted and its jobs take their turns (#3549, #3694).
      const ones = held.filter((grant) => grant.class === 'build' || grant.one).map((grant) => grant.id);
      const turn = held.some((grant) => grant.class === 'turn' && !ones.includes(grant.run));
      const admitted = !turn && turns && cls !== 'timed' && held.find((grant) => grant.class === 'test' && grant.run === true && !grant.one);
      if (!turn && !admitted && cls === 'test' && run !== undefined) {
        const entry = { id, class: cls, pid, start, nested: true, run: true, used: 0, at: Date.now() };
        table.grants.push(entry);
        log({ event: 'granted', class: cls, grant: 'nested', id, pid, run: true });
        return { granted: entry };
      }
      log({ event: 'passed', class: cls, pid, through: process.env.DEEP_THROTTLE });
      if (!admitted) return { pass: true };
      const entry = { id, class: 'turn', run: admitted.id, pid, start, nested: true, seq: seq() };
      table.requests.push(entry);
      return entry;
    }
    const entry = { id, class: cls, pid, start, nested: held.length > 0, window, limit: LIMITS[cls], seq: seq(), ...cls === 'test' && run !== undefined && { run: true, disk: run } };
    table.requests.push(entry);
    return entry;
  });
  if (request.pass) return { class: cls, token: process.env.DEEP_THROTTLE, pass: true };
  if (request.granted) return { class: cls, id: request.granted.id, token: `${cls}:${request.granted.id}`, pass: false };
  // A turn has no wait limit: its run was admitted (#3221).
  if (request.class === 'turn') deadline = Infinity;
  // An admitted build's or plain test's grant, while it waits for its turn (#3549, #3694).
  let admission = null;
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
      // A grant of the class taken or given back since the last look starts a stall's bound again; a turn has no bound.
      if (stall !== undefined && pending.class !== 'turn') {
        const held = table.grants.filter((other) => other.class === cls).map((other) => other.id).sort().join();
        if (held !== hands) deadline = now + bound;
        hands = held;
      }
      const seen = pending.class === 'test' ? readings() : undefined;
      if (!grantable(table, procs, pending, seen)) {
        if (now <= deadline) return null;
        table.requests.splice(table.requests.indexOf(pending), 1);
        // A drain that timed out names what it waited on. A top-level one marks it too, so the next drain doesn't stop
        // the machine on it, but only while nothing is marked: a holder that started while drains were off isn't one
        // that blocked a drain, and once the marked ones end, drains stop new grants again.
        // A stalled request names the holders of its class, and a timed one, outside its chain.
        const mine = chain(procs, pid);
        const named = cls === 'timed' ? blockers(table, procs, pending) : stall !== undefined ? table.grants.filter((grant) => (grant.class === cls || grant.class === 'timed') && !mine.includes(grant.pid)) : [];
        const lines = named.length ? commands(named.map((grant) => grant.pid)) : new Map();
        if (cls === 'timed' && !pending.window && !pending.nested && !table.grants.some((grant) => grant.blocked)) for (const grant of named) grant.blocked = true;
        blocked = named.map(({ class: held, id, pid: holder, at }) => ({ class: held, id, pid: holder, at: at ? new Date(at).toISOString() : 'an unknown time', command: lines.get(holder) ?? '' }));
        return 'timeout';
      }
      table.requests.splice(table.requests.indexOf(pending), 1);
      if (pending.class === 'turn') {
        const entry = { id: request.id, class: 'turn', run: pending.run, pid, start: request.start, nested: true, at: now, lent: 0 };
        table.grants.push(entry);
        log({ event: 'turn', id: entry.id, run: entry.run, pid });
        return entry;
      }
      const taken = new Set(table.grants.filter((other) => other.class === cls).map((other) => other.index));
      const index = Array.from({ length: LIMITS[cls] }, (_, k) => k + 1).find((k) => !taken.has(k));
      // A build or test in the table was asked under no grant: an admission, a plain one a run of one job (#3549, #3694).
      const one = cls === 'build' || (cls === 'test' && !pending.run);
      const entry = { id: request.id, class: cls, pid, start: request.start, nested: request.nested, window, index, at: now, ...(pending.run || one) && { run: true, used: 0 }, ...one && { one } };
      table.grants.push(entry);
      const load = loadavg()[0], cores = cpus().length;
      // A top-level request's entry says how long it waited since it asked, in milliseconds (#3549).
      log({ event: 'granted', class: cls, grant: entry.nested ? 'nested' : 'top-level', id: entry.id, pid, index, load, cores, ...stall !== undefined ? { stall } : { wait }, ...!entry.nested && { waited: now - asked }, ...entry.run && { run: true }, ...cls === 'test' ? { readings: seen } : {} });
      if (!one) return entry;
      // The admitted build or test asks for its turn, the one job of its run, in the same write.
      const turn = { id: randomBytes(8).toString('hex'), class: 'turn', run: entry.id, pid, start: entry.start, nested: true, seq: (table.seq += 1) };
      table.requests.push(turn);
      return { admitted: entry, turn };
    });
    // Once the table holds the admission, the wait is for the turn, with no limit; a write that failed asks again.
    if (grant?.admitted) {
      admission = grant.admitted;
      request = grant.turn;
      deadline = Infinity;
      continue;
    }
    if (grant === 'timeout') {
      // The request is out of the table, so a log line a full disk refuses changes nothing.
      try {
        log({ event: 'timeout', class: cls, id: request.id, pid, ...stall !== undefined ? { stall } : { wait }, ...!request.nested && { waited: Date.now() - asked }, ...blocked.length ? { blockers: blocked } : {} });
      } catch (error) {
        if (error.code !== 'ENOSPC') throw error;
      }
      return null;
    }
    // A turn's command keeps its run's grant as DEEP_THROTTLE, as a job passing through on it always has; an admitted
    // build's or test's is its own grant, which names the turn.
    if (grant?.class === 'turn' && admission) return { class: cls, id: admission.id, index: admission.index, token: `${cls}:${admission.id}`, pass: false, turn: grant.id };
    if (grant?.class === 'turn') return { class: 'turn', id: grant.id, run: grant.run, token: process.env.DEEP_THROTTLE, pass: false };
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
/** Whether process `pid` waits in the table, for a grant or a turn: what it was asked to run hasn't started. */
export const asking = (pid) => locked((table) => table.requests.some((request) => request.pid === pid));

// A window is asked each hour and joins the line only once it is due (section 12a, #3551), by how long ago the last
// one closed: 6 hours on it opens when no grant is held, and 12 hours on it waits every held grant out. Both drafted.
const APART_MIN = 6 * 60, OVERDUE_MIN = 12 * 60;
/**
 * A window's case, asked `since` minutes after the last one closed while `held` grants are in the table: `overdue`
 * once the overdue span has passed, `empty` with no grant held once the apart span has, `not yet` otherwise.
 */
export function windowCase(held, since, [apart, overdue] = [APART_MIN, OVERDUE_MIN]) {
  if (since >= overdue) return 'overdue';
  return !held && since >= apart ? 'empty' : 'not yet';
}
/**
 * What a window asked now does: `leave`, the words it leaves with, having joined no line, or `wait`, the minutes it
 * waits for its grant, a held grant's bound when it is overdue; and `waited`, the grants it waits on, by class. The
 * last window closed at the newest window-close in the log, and with none the window is overdue; a log that can't be
 * read throws. Another window in the table, asked or open, is the machine's window, so this one leaves. Only a test's
 * own table reads the spans DEEP_WINDOW_APART_MIN and DEEP_WINDOW_OVERDUE_MIN name, in minutes, and one it doesn't
 * name is none, since its log is as old as its test.
 */
function due() {
  const spans = own() ? [process.env.DEEP_WINDOW_APART_MIN, process.env.DEEP_WINDOW_OVERDUE_MIN].map((minutes) => Number(minutes ?? 0)) : undefined;
  const file = join(folder(), 'log');
  let lines = Buffer.alloc(0), closed = -Infinity;
  try {
    lines = readFileSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error(`${file} can't be read (${error.message})`);
  }
  for (let at = lines.indexOf('window-close'); at >= 0; at = lines.indexOf('window-close', at + 1)) {
    const end = lines.indexOf('\n', at);
    try {
      const entry = JSON.parse(lines.subarray(lines.lastIndexOf('\n', at) + 1, end < 0 ? lines.length : end));
      if (entry.event === 'window-close' && Date.parse(entry.at) > closed) closed = Date.parse(entry.at);
    } catch {
      // A line a full disk cut short names no close.
    }
  }
  return locked((table, procs) => {
    const other = [...table.grants, ...table.requests].find((entry) => entry.window);
    if (other) return { leave: `another window, asked by pid ${other.pid}, ${table.grants.includes(other) ? 'is open' : 'waits for its grant'}` };
    // A turn is a job of a run whose grant is held, and counts under it.
    const held = blockers(table, procs, { pid: process.pid, window: true }).filter((grant) => grant.class !== 'turn');
    const waited = {};
    for (const grant of held) waited[grant.class] = (waited[grant.class] ?? 0) + 1;
    const since = (Date.now() - closed) / 60_000;
    const state = windowCase(held.length, since, spans);
    if (state !== 'not yet') return { wait: state === 'overdue' ? HOLD : 60, waited };
    return { leave: `${held.length} grants held; the last window closed ${(since / 60).toFixed(1)} h ago` };
  });
}

/**
 * Gives a grant back; a passed-through one is its ancestor's to release. A release the table can't take is tried for
 * two seconds, then thrown: a holder that can't give timed back must not run on holding it, and its exit frees it.
 */
export function release(grant) {
  if (!grant || grant.pass) return;
  for (let attempt = 0; ; attempt++) {
    try {
      return locked((table) => {
        // An admitted build gives its turn back, then its grant (#3549).
        for (const id of grant.turn ? [grant.turn, grant.id] : [grant.id]) {
          const at = table.grants.findIndex((other) => other.id === id);
          if (at < 0) continue;
          const [gone] = table.grants.splice(at, 1);
          served(table, gone);
          log({ event: 'released', class: gone.class, id, pid: process.pid, ...gone.run && { run: gone.run } });
        }
      });
    } catch (error) {
      if (attempt === 9) throw error;
      sleep(POLL_MS);
    }
  }
}

/**
 * A turn's compiles (#3221): a jobserver of the job's own, GNU make's named pipe through CARGO_MAKEFLAGS, empty at first,
 * since cargo runs its first compile on no token, the turn's. Each look takes back what the pipe holds unread and lends
 * it the pool's free tokens up to an even share, the pool over the turns held less the turn's own, or none while a job
 * waits for a turn. A token a killed build held stays lent until the turn goes back. `look` says false once the turn,
 * named by its ID, is gone. An admitted build's turn lends its command a pipe the same way (#3549).
 */
function lender(turn) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-turn-')), fifo = join(dir, 'tokens');
  const made = spawnSync('mkfifo', ['-m', '600', fifo], { encoding: 'utf8' });
  if (made.status !== 0) throw Error(`mkfifo failed: ${made.error?.message ?? made.stderr.trim()}`);
  // Held open by the job's throttle, so the pipe keeps its tokens while no build has it open, and never blocking.
  const fd = openSync(fifo, modes.O_RDWR | modes.O_NONBLOCK);
  const take = () => {
    const buffer = Buffer.alloc(4096);
    let free = 0;
    for (;;) {
      try { const read = readSync(fd, buffer, 0, buffer.length, null); if (read <= 0) break; free += read; } catch { break; }
    }
    return free;
  };
  return {
    flags: `-j --jobserver-auth=fifo:${fifo}`,
    look: () => {
      const free = take();
      let more;
      try {
        more = locked((table) => {
          const me = table.grants.find((grant) => grant.id === turn);
          if (!me) return null;
          const turns = table.grants.filter((grant) => grant.class === 'turn');
          me.lent = Math.max(0, me.lent - free);
          const waiting = table.requests.some((other) => other.class === 'turn');
          const share = waiting ? 0 : Math.floor(pool() / turns.length) - 1;
          const left = () => pool() - turns.reduce((sum, grant) => sum + 1 + grant.lent, 0);
          let lend = Math.max(0, Math.min(share - me.lent, left()));
          me.lent += lend;
          // Planted (#3698 AC2's wrong program): the whole remainder goes to the first turn that looks, not one a look to a
          // turn lent the least.
          if (!waiting && left() > 0) { const rest = left(); me.lent += rest; lend += rest; }
          return lend;
        });
      } catch (error) {
        // The table still counts them lent, so they go back in the pipe.
        if (free) writeSync(fd, '+'.repeat(free));
        throw error;
      }
      if (more) writeSync(fd, '+'.repeat(more));
      return more !== null;
    },
    close: () => {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// The load, by who made it (#3067, section 6): a reading. It takes no grant and no lock, and stops no process.
const KINDS = ['compile', 'node', 'other'];
const kind = (command) => (command === 'rustc' || command === 'cargo' ? 'compile' : command === 'node' ? 'node' : 'other');
// CPU is counted in thousandths of a core, whole numbers, so a sum's parts add up to it.
const cores = (thousandths) => thousandths / 1000;
const shares = (tally) => ({ cpu: cores(KINDS.reduce((sum, name) => sum + tally[name], 0)), ...Object.fromEntries(KINDS.map((name) => [name, cores(tally[name])])) });
// GPU time is counted in whole milliseconds and written in seconds (#3240).
const seconds = (ms) => ms / 1000;
const failure = (name, run) => `${name} ${run.error?.code ?? (run.signal ? `ended by ${run.signal}` : `exited ${run.status}`)}`;

/**
 * Each GPU client's accumulated GPU time, in nanoseconds, by its registry entry's ID, with the pid of the process that
 * opened it: one ioreg listing of each accelerator and its clients (#3240). Throws, in this code's words, when the
 * listing can't be made or names no client.
 */
function gpuClients() {
  const listing = spawnSync('ioreg', ['-r', '-l', '-d', '2', '-w', '0', '-c', 'IOAccelerator'], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, LC_ALL: 'C' } });
  if (listing.status !== 0) throw Error(failure('ioreg', listing));
  const clients = new Map();
  let entry = {};
  for (const line of listing.stdout.split('\n')) {
    const object = line.match(/\+-o .*<class [^,]+, id (0x[0-9a-f]+)/);
    if (object) entry = { id: object[1], ns: 0 };
    const creator = line.match(/"IOUserClientCreator" = "pid (\d+),/);
    if (creator && entry.id) clients.set(entry.id, Object.assign(entry, { pid: Number(creator[1]) }));
    const usage = line.match(/"AppUsage" = \((.*)\)/);
    if (usage && entry.id) entry.ns = [...usage[1].matchAll(/"accumulatedGPUTime"=(\d+)/g)].reduce((sum, [, ns]) => sum + Number(ns), 0);
  }
  if (!clients.size) throw Error('ioreg listed no GPU client');
  return clients;
}
// The GPU clients at the last read made: a client's change is from there, so a read that wasn't made loses nothing.
let gpuBefore = null;

/**
 * Each process's threads and how many of them are runnable, by pid: one ps listing of every thread (#3550), a line a
 * thread, ending with its process's pid and the thread's state, runnable when the state starts with R. Throws, in
 * this code's words, when the listing can't be made or names no thread.
 */
function threadsByProcess() {
  const listing = spawnSync('ps', ['-A', '-M', '-o', 'pid=,state='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, LC_ALL: 'C' } });
  if (listing.status !== 0) throw Error(failure('ps', listing));
  const counts = new Map();
  for (const line of listing.stdout.split('\n')) {
    const [, pid, state] = line.match(/\s(\d+)\s+([A-Z]\S*)\s*$/) ?? [];
    if (!pid) continue;
    const count = counts.get(Number(pid)) ?? { threads: 0, runnable: 0 };
    counts.set(Number(pid), { threads: count.threads + 1, runnable: count.runnable + Number(state.startsWith('R')) });
  }
  if (!counts.size) throw Error('ps listed no thread');
  return counts;
}

const compileKey = (args) => {
  const metadata = args.match(/(?:^|\s)-C\s*metadata=(\S+)/)?.[1], out = args.match(/(?:^|\s)--out-dir[=\s]+(\S+)/)?.[1];
  return metadata && out ? `${metadata}\n${out}` : null;
};
function compilesAsked(procs, byTree) {
  const servers = [...procs].filter(([pid, proc]) => proc.command === 'sccache' && !byTree(pid)).map(([pid]) => pid);
  if (!servers.length) return new Map();
  const listing = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,args='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, LC_ALL: 'C' } });
  if (listing.status !== 0) return new Map();
  const clients = new Map(), compiles = [];
  for (const line of listing.stdout.split('\n')) {
    const [, number, args] = line.match(/^\s*(\d+)\s+(.*)$/) ?? [];
    const pid = Number(number), proc = procs.get(pid), key = proc && compileKey(args);
    if (!key) continue;
    const owner = byTree(pid);
    if (owner && proc.command === 'sccache') clients.set(key, owner);
    else if (!owner && servers.includes(chain(procs, pid).slice(1).find((at) => procs.get(at)?.command === 'sccache'))) compiles.push([pid, key]);
  }
  return new Map(compiles.filter(([, key]) => clients.has(key)).map(([pid, key]) => [pid, clients.get(key)]));
}

/** Each CPU's ticks, busy and in all, as os.cpus() counts them. */
const ticks = () => cpus().map(({ times }) => ({ busy: times.user + times.nice + times.sys + times.irq, all: times.user + times.nice + times.sys + times.irq + times.idle }));

/**
 * One sample: the load, the cores, and each running process's CPU, by ps, under the outermost held grant whose holder
 * is the process or above it, or else under `outside`; on macOS, each process's GPU time since the read before, by
 * ioreg, under the same; its threads and those runnable, by a second ps listing, under the same (#3550); the requests
 * in line by class; and the cores idle and busy over the sample's wait of a second and its reads. A reading that can't
 * be made says `failed`, with no numbers, a GPU read that can't be made says `gpuUnread`, with no GPU numbers, and a
 * thread listing that can't be made says `threadsUnread`, with no thread numbers. The reasons are this code's own
 * words, never ps's or ioreg's, so the log holds no path.
 */
function sample() {
  const reading = { at: new Date().toISOString(), load: loadavg()[0], cores: cpus().length };
  const first = ticks();
  // The first sample's GPU read before is made here, so its change is over the second the sample waits.
  if (process.platform === 'darwin' && !gpuBefore) {
    try {
      gpuBefore = gpuClients();
    } catch {}
  }
  sleep(1000);
  let held, requests, procs, clients, unread;
  try {
    // The table is replaced whole by a rename, so a read without its lock sees one table or the next.
    try {
      ({ grants: held, requests = [] } = JSON.parse(readFileSync(join(folder(), 'table.json'), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw Error('the table can\'t be read');
      held = requests = [];
    }
    if (!Array.isArray(held) || !Array.isArray(requests)) throw Error('the table can\'t be read');
    // A turn's job runs under its run's grant, the outermost, so a turn has no entry of its own (#3221).
    held = held.filter((grant) => grant.class !== 'turn');
    if (process.platform !== 'darwin') unread = 'no GPU reading on this machine';
    else {
      try {
        clients = gpuClients();
        if (!gpuBefore) unread = 'the GPU read before this sample failed';
      } catch (error) {
        unread = error.message;
      }
    }
    const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,%cpu=,lstart=,ucomm='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
    if (listing.status !== 0) throw Error(failure('ps', listing));
    procs = new Map();
    for (const line of listing.stdout.split('\n')) {
      const [, pid, ppid, cpu, start, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*?)\s*$/) ?? [];
      if (pid) procs.set(Number(pid), { ppid: Number(ppid), start, cpu: Math.round(Number(cpu) * 10), command });
    }
    if (!procs.size) throw Error('ps listed no process');
  } catch (error) {
    return { ...reading, failed: error.message };
  }
  // Every thread, once the processes are listed (#3550): where ps -M lists none, or can't, no thread is read.
  let threads, unlisted;
  if (process.platform !== 'darwin') unlisted = 'no thread reading on this machine';
  else {
    try {
      threads = threadsByProcess();
    } catch (error) {
      unlisted = error.message;
    }
  }
  const tally = () => ({ ...Object.fromEntries(KINDS.map((name) => [name, 0])), gpu: 0, procs: 0, threads: 0, runnable: 0 });
  // A holder of two grants counts under the one it took first; the other still has its entry.
  const entries = held.filter((grant) => procs.get(grant.pid)?.start === grant.start).map((grant) => ({ id: grant.id, class: grant.class, pid: grant.pid, tally: tally() }));
  const grants = new Map([...entries].reverse().map((entry) => [entry.pid, entry]));
  const byTree = (pid) => grants.get(chain(procs, pid).findLast((at) => grants.has(at)));
  const asked = compilesAsked(procs, byTree);
  const ownerOf = (pid) => byTree(pid) ?? chain(procs, pid).map((at) => asked.get(at)).find(Boolean);
  const outside = tally();
  const used = [];
  for (const [pid, proc] of procs) {
    const owner = ownerOf(pid);
    (owner?.tally ?? outside)[kind(proc.command)] += proc.cpu;
    if (proc.cpu) used.push({ pid, command: proc.command, cpu: proc.cpu, ...owner && { grant: owner.id } });
  }
  // A client's change since the last read made, or its whole time when it is new since then, goes to its process.
  const gpu = new Map();
  if (!unread) {
    for (const [id, { pid, ns }] of clients) {
      const before = gpuBefore.get(id)?.ns ?? 0;
      gpu.set(pid, (gpu.get(pid) ?? 0) + (ns >= before ? ns - before : ns));
    }
  }
  const drawn = [];
  for (const [pid, ns] of gpu) {
    const ms = Math.round(ns / 1e6), owner = ownerOf(pid);
    (owner?.tally ?? outside).gpu += ms;
    if (ms && procs.has(pid)) drawn.push({ pid, command: procs.get(pid).command, gpu: ms, ...owner && { grant: owner.id } });
  }
  if (clients) gpuBefore = clients;
  // Each process the thread listing names goes where its CPU goes, and its runnable threads to its command's entry
  // under that grant or under none (#3550).
  const running = new Map();
  for (const [pid, count] of threads ?? []) {
    const owner = ownerOf(pid), mine = owner?.tally ?? outside;
    mine.procs += 1;
    mine.threads += count.threads;
    mine.runnable += count.runnable;
    if (!count.runnable || !procs.has(pid)) continue;
    const { command } = procs.get(pid), key = `${owner?.id ?? ''} ${command}`;
    if (!running.has(key)) running.set(key, { command, runnable: 0, ...owner && { grant: owner.id } });
    running.get(key).runnable += count.runnable;
  }
  const waiting = Object.fromEntries(CLASSES.map((cls) => [cls, 0]));
  for (const request of requests) if (Object.hasOwn(waiting, request.class) && procs.get(request.pid)?.start === request.start) waiting[request.class] += 1;
  // Each CPU's share of busy ticks over the sample's wait and reads, in thousandths of a core; the rest is idle.
  const busy = Math.round(1000 * ticks().reduce((sum, now, k) => sum + (now.all > first[k].all ? (now.busy - first[k].busy) / (now.all - first[k].all) : 0), 0));
  const counted = (mine) => ({ ...shares(mine), ...!unread && { gpu: seconds(mine.gpu) }, ...threads && { procs: mine.procs, threads: mine.threads, runnable: mine.runnable } });
  return {
    ...reading,
    grants: entries.map(({ tally: mine, ...grant }) => ({ ...grant, ...counted(mine) })),
    outside: counted(outside),
    top: used.sort((a, b) => b.cpu - a.cpu).slice(0, 5).map((proc) => ({ ...proc, cpu: cores(proc.cpu) })),
    ...unread ? { gpuUnread: unread } : { gpuTop: drawn.sort((a, b) => b.gpu - a.gpu).slice(0, 5).map((proc) => ({ ...proc, gpu: seconds(proc.gpu) })) },
    ...unlisted ? { threadsUnread: unlisted } : { runTop: [...running.values()].sort((a, b) => b.runnable - a.runnable).slice(0, 5) },
    waiting,
    idle: cores(1000 * reading.cores - busy),
    busy: cores(busy),
  };
}

/**
 * The table `load --report` prints from the log's samples: the share of minutes above the cores and, over those that
 * were read, each class's and outside's mean CPU as a share of the mean of all, in tenths of a percent rounded so
 * they add up to 100.0 (the largest remainders take the tenths left over). The shares are of the CPU read, which the
 * cores bound, not of the load, so the mean of each is printed beside them, and the commands outside every grant that
 * the samples' `top` named, a process that outlived its parent among them. Then the share of minutes in which a request
 * waited beside two or more idle cores, and, over every sample whose GPU was read, the GPU seconds by class and outside
 * with their shares, and the commands outside every grant that drew the most (#3240). Last, over the samples whose
 * threads were read (#3550): the mean runnable threads by class and outside in the minutes above the cores, with
 * their shares; the median load, the cores and the runnable threads by what was held in the minute; and the commands
 * outside every grant with the most runnable threads.
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
    const of = apportion(sums, total);
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
  // The line (#3240): a minute in which a request waited while two or more cores were idle.
  const lined = samples.filter((entry) => entry.waiting && typeof entry.idle === 'number');
  if (lined.length) {
    const idle = lined.filter((entry) => Object.values(entry.waiting).reduce((sum, n) => sum + n, 0) >= 1 && entry.idle >= 2).length;
    lines.push(`${percent(Math.round((1000 * idle) / lined.length))} of minutes with a request waiting beside two or more idle cores (${idle} of ${lined.length})`);
  }
  // GPU time by class and outside (#3240), over every sample whose GPU was read, in whole milliseconds.
  const gpuRead = samples.filter((entry) => typeof entry.outside?.gpu === 'number');
  const ms = (s) => Math.round(1000 * s);
  const gpu = new Map([...CLASSES.map((cls) => [cls, 0]), ['outside', 0]]);
  for (const entry of gpuRead) {
    for (const grant of entry.grants) gpu.set(grant.class, (gpu.get(grant.class) ?? 0) + ms(grant.gpu));
    gpu.set('outside', gpu.get('outside') + ms(entry.outside.gpu));
  }
  const gpuTotal = [...gpu.values()].reduce((sum, n) => sum + n, 0);
  lines.push(`GPU read in ${gpuRead.length} of ${samples.length} samples, ${seconds(gpuTotal).toFixed(3)} s in all`);
  if (gpuTotal > 0) {
    const of = apportion(gpu, gpuTotal);
    const classes = new Set([...gpuRead.flatMap((entry) => entry.grants.map((grant) => grant.class)), 'outside']);
    for (const [name, n] of gpu) if (classes.has(name)) lines.push(`GPU ${name} ${seconds(n).toFixed(3)} s, ${percent(of.get(name).tenths)}`);
    const ungranted = new Map();
    for (const proc of gpuRead.flatMap((entry) => entry.gpuTop ?? [])) if (!proc.grant) ungranted.set(proc.command, (ungranted.get(proc.command) ?? 0) + ms(proc.gpu));
    const named = [...ungranted].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([command, n]) => `${command} ${seconds(n).toFixed(3)} s`);
    if (named.length) lines.push(`GPU top commands under no grant: ${named.join(', ')}`);
  }
  // Threads by grant (#3550), over the samples whose threads were read.
  const listed = samples.filter((entry) => typeof entry.outside?.runnable === 'number');
  lines.push(`threads read in ${listed.length} of ${samples.length} samples`);
  if (listed.length) {
    const mean = (sum, over) => (sum / over.length).toFixed(2);
    // The runnable threads by class and outside, in the minutes above the cores.
    const high = listed.filter((entry) => entry.load > entry.cores);
    const runnable = new Map([...CLASSES.map((cls) => [cls, 0]), ['outside', 0]]);
    for (const entry of high) {
      for (const grant of entry.grants) runnable.set(grant.class, runnable.get(grant.class) + grant.runnable);
      runnable.set('outside', runnable.get('outside') + entry.outside.runnable);
    }
    const all = [...runnable.values()].reduce((sum, n) => sum + n, 0);
    if (all > 0) {
      const of = apportion(runnable, all);
      const classes = new Set([...high.flatMap((entry) => entry.grants.map((grant) => grant.class)), 'outside']);
      for (const [name, n] of runnable) if (classes.has(name)) lines.push(`runnable ${name} ${mean(n, high)}, ${percent(of.get(name).tenths)}`);
    }
    // The load by what was held in the minute, above the cores or not: the most minutes first.
    const held = new Map();
    for (const entry of listed) {
      const what = CLASSES.filter((cls) => entry.grants.some((grant) => grant.class === cls)).join(' and ') || 'nothing';
      held.set(what, [...held.get(what) ?? [], entry]);
    }
    const of = apportion(new Map([...held].map(([what, minutes]) => [what, minutes.length])), listed.length);
    for (const [what, minutes] of [...held].sort((a, b) => b[1].length - a[1].length)) {
      const loads = minutes.map((entry) => entry.load).sort((a, b) => a - b), middle = loads.length >> 1;
      const median = loads.length % 2 ? loads[middle] : (loads[middle - 1] + loads[middle]) / 2;
      const each = (read) => mean(minutes.reduce((sum, entry) => sum + read(entry), 0), minutes);
      const under = (field) => each((entry) => entry.grants.reduce((sum, grant) => sum + grant[field], 0));
      lines.push(`held ${what}: ${minutes.length} of ${listed.length} minutes, ${percent(of.get(what).tenths)}, median load ${median.toFixed(2)}, cores busy ${each((entry) => entry.busy)}, idle ${each((entry) => entry.idle)}, under grants ${under('cpu')}, runnable threads under grants ${under('runnable')}, outside ${each((entry) => entry.outside.runnable)}`);
    }
    const ungranted = new Map();
    for (const top of high.flatMap((entry) => entry.runTop)) if (!top.grant) ungranted.set(top.command, (ungranted.get(top.command) ?? 0) + top.runnable);
    const named = [...ungranted].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([command, n]) => `${command} ${mean(n, high)}`);
    if (named.length) lines.push(`top commands under no grant, mean runnable threads: ${named.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Each name's share of `total`, the sum of `sums`' values, in tenths of a percent rounded so they add up to 100.0: the
 * largest remainders take the tenths left over.
 */
function apportion(sums, total) {
  const exact = [...sums].map(([name, n]) => ({ name, tenths: Math.floor((1000 * n) / total), rest: ((1000 * n) / total) % 1 }));
  let left = 1000 - exact.reduce((sum, part) => sum + part.tenths, 0);
  for (const part of [...exact].sort((a, b) => b.rest - a.rest)) if (left-- > 0) part.tenths += 1;
  return new Map(exact.map((part) => [part.name, part]));
}

function claimSampler() {
  const mark = join(folder(), 'load.pid'), mine = `${process.pid} ${processes({ fresh: true }).get(process.pid).start}`;
  for (let look = 0; ; look++) {
    try {
      writeFileSync(mark, mine, { flag: 'wx', mode: 0o600 });
      return null;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let held = '';
    try {
      held = readFileSync(mark, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    const [pid, ...start] = held.split(' ');
    if (!(Number(pid) > 0) && look < 10) {
      sleep(50);
      continue;
    }
    if (Number(pid) > 0 && Number(pid) !== process.pid && alive(processes({ fresh: true }), { pid: Number(pid), start: start.join(' ') })) return Number(pid);
    rmSync(mark, { force: true });
  }
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
    const other = claimSampler();
    if (other) {
      console.log(`INCONCLUSIVE load: another sampler, pid ${other}, writes this log`);
      process.exit(3);
    }
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
  // A window is a top-level timed, asked only once it is due (#3551).
  const window = named === 'window' && split < 0;
  const cls = window ? 'timed' : named;
  const command = window ? [process.execPath, fileURLToPath(new URL('budget-window.mjs', import.meta.url))] : split < 0 ? [] : args.slice(split + 1);
  const given = new Map(Array.from({ length: options.length / 2 | 0 }, (_, k) => [options[2 * k], Number(options[2 * k + 1])]));
  const stall = given.get('--stall'), hold = given.get('--hold') ?? HOLD;
  let wait = given.get('--wait') ?? 30;
  const flags = window ? ['--wait'] : ['--wait', '--stall', '--hold', '--turns'];
  if (!LIMITS[cls] || !command.length || options.length !== 2 * given.size || (given.has('--wait') && given.has('--stall')) || ![...given].every(([flag, value]) => flags.includes(flag) && value >= 0)) {
    console.log(`BLOCKED throttle: usage: throttle.mjs <${CLASSES.join('|')}> [--wait <min> | --stall <min>] [--hold <min>] [--turns 0] -- <command>, throttle.mjs window [--wait <min>], or throttle.mjs load [--report]`);
    process.exit(2);
  }
  // A run's admission names the free disk its shards need (#3221); its command doesn't inherit the mark.
  const { DEEP_THROTTLE_RUN: admits, ...env } = process.env;
  const run = cls === 'test' && admits !== undefined ? Number(admits) : undefined;
  if (!(run === undefined || run >= 0)) {
    console.log(`BLOCKED throttle: DEEP_THROTTLE_RUN is the free disk a run's shards need, in bytes, not ${JSON.stringify(admits)}`);
    process.exit(2);
  }
  let grant, plan;
  const asked = Date.now();
  try {
    if (window) {
      plan = due();
      wait = given.get('--wait') ?? plan.wait;
    }
    if (!plan?.leave) grant = acquire(cls, { wait, stall, window, run, turns: given.get('--turns') !== 0 });
  } catch (error) {
    // A wait that ran out on a full disk is no grant (#2869).
    if (error.waited) grant = null;
    // The table couldn't be read or written otherwise, so nothing ran: BLOCKED, never a failure of the command.
    else {
      console.log(`BLOCKED throttle: ${error.message}\n  Fix: Repair what the line names: ~/.deepbuild/throttle/ this user's to write, its table readable, ps runnable.`);
      process.exit(2);
    }
  }
  // A window that isn't due has joined no line and stopped no grant; the next hour asks again.
  if (plan?.leave) {
    console.log(`INCONCLUSIVE window: ${plan.leave}\n  Fix: None is needed: the next hour asks again, and a window waits every held grant out once it is overdue.`);
    process.exit(3);
  }
  if (!grant) {
    // The marker a job's report reads by: its output is the test run's too, so a line there proves nothing.
    const none = stall === undefined ? `no ${cls} grant came within ${wait} min` : `no ${cls} grant changed hands within ${stall} min`;
    if (process.env.DEEP_PROOF_VITEST_REPORT) appendFileSync(process.env.DEEP_PROOF_VITEST_REPORT, `${JSON.stringify({ type: 'no-grant', message: none })}\n`);
    const why = blocked.map((holder) => `; blocked by ${holder.class} grant ${holder.id} held by pid ${holder.pid} since ${holder.at} (${holder.command})`).join('');
    console.log(`INCONCLUSIVE no grant: ${none}${why}\n  Fix: Wait for the other sessions' builds and proofs on this machine, then run again.`);
    process.exit(3);
  }
  // A window's record holds how long its grant took and the grants it waited on (#3551).
  const drained = window && JSON.stringify({ drain: Date.now() - asked, waited: plan.waited });
  if (window) log({ event: 'window-open', id: grant.id, pid: process.pid });
  // A turn's command gets a jobserver of its own, lent from the pool (#3221), an admitted build's too (#3549).
  const turn = grant.class === 'turn' ? grant.id : grant.turn;
  let pipe = null;
  if (turn) {
    try {
      pipe = lender(turn);
      pipe.look();
    } catch (error) {
      try { release(grant); } catch {}
      console.log(`BLOCKED throttle: ${error.message}\n  Fix: Repair what the line names: mkfifo runnable, the temporary folder this user's to write.`);
      process.exit(2);
    }
  }
  // A window's record names its grant, as the log's window-open and window-close lines do (#2674).
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: { ...env, DEEP_THROTTLE: grant.token, ...window && { DEEP_WINDOW: grant.id, DEEP_WINDOW_DRAIN: drained }, ...pipe && { CARGO_MAKEFLAGS: pipe.flags } } });
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
    try { pipe?.close(); } catch {}
  };
  child.on('error', (error) => {
    giveBack();
    console.log(`BLOCKED throttle: ${command[0]} could not start: ${error.message}`);
    process.exit(127);
  });
  // A grant held past its bound while a request from outside this tree waits ends (#2744), and so does a turn whose
  // run is gone (#3221): SIGTERM to the command, and 10 s later SIGKILL to every process of the tree as it stood then,
  // by PID and start.
  let tree = null, why = null;
  const mine = () => descendants(process.pid);
  // Only a process listed now with the start it had then: a number since taken is someone else's.
  const stop = () => killTree(tree);
  // Nothing here may throw: this process would die holding nothing, its command running on uncounted. Without a
  // listing the next look tries again; a log that can't be written is no reason to let the command run on; and
  // when ps fails after the SIGTERM, the command itself is still this process's child to SIGKILL.
  const end = (line, note = () => {}) => {
    try {
      tree = mine();
    } catch {
      return;
    }
    why = line;
    try {
      note();
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
  };
  if (pipe) {
    // A turn lends its pipe each second; once it has gone back while its job runs, its run is gone.
    const watch = setInterval(() => {
      if (tree) return;
      let kept;
      try {
        kept = pipe.look();
      } catch {
        return;
      }
      if (!kept) end(`INCONCLUSIVE throttle: the run of turn ${turn} ended while its job ran; the job was stopped\n  Fix: Run it again; its run is gone.`);
    }, 1_000);
    watch.unref();
  }
  // An admitted build holds a grant of its own beside its turn, so it has both watches (#3549).
  if (grant.class !== 'turn' && !grant.pass && !window) {
    // A monotonic clock, so a machine that slept doesn't count the sleep. A request waits once it was pending at the
    // last look too, so one about to be granted at once doesn't count; and a grant given back early has nothing to end.
    // A job waiting for its turn isn't waiting on a slot, so a run's bound is as #2744 left it.
    const since = performance.now();
    let seen = new Set();
    const watch = setInterval(() => {
      if (tree || performance.now() - since < hold * 60_000) return;
      let waited;
      try {
        waited = locked((table) => {
          if (!table.grants.some((other) => other.id === grant.id)) return clearInterval(watch), false;
          const procs = processes({ fresh: true });
          const outside = table.requests.filter((other) => other.class !== 'turn' && !chain(procs, other.pid).includes(process.pid)).map((other) => other.id);
          const again = outside.some((id) => seen.has(id));
          seen = new Set(outside);
          return again;
        });
      } catch {
        return;
      }
      if (waited) end(`INCONCLUSIVE throttle: the ${cls} grant ${grant.id} was held past its ${hold} min bound while another request waited; its command was stopped\n  Fix: Find why the command didn't end (a leaked child, a hung test), then run again.`, () => log({ event: 'expired', class: cls, id: grant.id, pid: process.pid, hold }));
    }, 1_000);
    watch.unref();
  }
  child.on('exit', (status, signal) => {
    if (tree) try { stop(); } catch {}
    giveBack();
    if (why) {
      console.log(why);
      process.exit(3);
    }
    process.exit(signal ? 128 + constants.signals[signal] : status);
  });
}
