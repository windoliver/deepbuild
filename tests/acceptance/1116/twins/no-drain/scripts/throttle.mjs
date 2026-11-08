// A planted wrong program for #1116: a top-level timed request is granted at once.
// The per-machine throttle table (docs/parallel-proof.md, section 6): a host-local lock table under
// ~/.deepbuild/throttle/ that grants build, bay pair, test and timed by class, so a neighbour's build never runs
// while a budget is timed. `throttle.mjs <class> [--wait <min>] -- <command>` acquires, runs, releases and exits
// with the child's status; acquire and release serve the scripts that hold a grant themselves.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants, cpus, homedir, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Mac has one bay pair and one build at a time; the Spark, Linux, has the cores for more.
const LIMITS = process.platform === 'darwin' ? { build: 1, 'bay-pair': 1, test: 2, timed: 1 } : { build: 2, 'bay-pair': 3, test: 4, timed: 1 };
const CLASSES = Object.keys(LIMITS);
const POLL_MS = 200;
const folder = () => join(homedir(), '.deepbuild', 'throttle');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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

// The table is one file, rewritten whole under a lock file only one process can create, held for a read and a write;
// ps runs before it is taken. The lock names its holder by number and start, and only a lock whose holder is gone is
// taken over: aside, by a rename only one process can make, and removed only if it is the lock judged gone. Two runs
// that judge the same one gone can, in the microseconds between, both go on, which needs that holder's death first.
function locked(act) {
  mkdirSync(folder(), { recursive: true, mode: 0o700 });
  const mark = join(folder(), 'table.lock');
  // The lock appears whole by linking a file already written: a new one, since a killed holder's own may still be the
  // lock, which a run given its number must not rewrite.
  const mine = `${mark}.${process.pid}`;
  rmSync(mine, { force: true });
  writeFileSync(mine, JSON.stringify({ pid: process.pid, start: processes().get(process.pid).start }));
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
    writeFileSync(`${file}.${process.pid}`, JSON.stringify(table));
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

// Requests in the order they are served: those nested in a current holder's chain first, then by arrival.
const order = (a, b) => Number(b.nested) - Number(a.nested) || a.seq - b.seq;
function grantable(table, procs, request) {
  const mine = chain(procs, request.pid);
  const outside = table.grants.filter((grant) => !mine.includes(grant.pid));
  // timed is exclusive of every class outside its own chain.
  if (outside.some((grant) => grant.class === 'timed')) return false;
  if (request.class === 'timed' && !request.nested) return true;
  const first = table.requests.filter((other) => other.class === request.class).sort(order)[0];
  if (first?.id !== request.id) return false;
  if (request.class !== 'timed') {
    // A pending timed request drains: no new top-level grant starts.
    if (!request.nested && table.requests.some((other) => other.class === 'timed')) return false;
    return table.grants.filter((grant) => grant.class === request.class).length < LIMITS[request.class];
  }
  // Every holder outside the chain has finished or waits in the throttle, through a descendant's request. A bay
  // pair's holder never counts as waiting for a top-level request: the pair's work resumes the moment it is answered.
  const waiting = (grant) => (grant.class !== 'bay-pair' || request.nested)
    && table.requests.some((other) => other.id !== request.id && chain(procs, other.pid).includes(grant.pid));
  if (!outside.every(waiting)) return false;
  // A top-level request waits for load below the cores, as the log shows. A nested one, in a chain that holds a grant
  // and waits on it, doesn't, so two nested chains finish in their waits on a loaded machine.
  return request.nested || loadavg()[0] < cpus().length;
}

/**
 * Takes a grant of `cls`, waiting at most `wait` minutes; null when none came. A build or test request from a chain
 * that holds a grant, and a timed request from one that holds timed, passes through: it holds its ancestor's grant
 * and is released with it. The grant's `token` is what DEEP_THROTTLE carries to the holder's descendants.
 */
export function acquire(cls, { wait = 30 } = {}) {
  if (!LIMITS[cls]) throw Error(`no throttle class ${cls}; the classes are ${CLASSES.join(', ')}`);
  const pid = process.pid;
  const deadline = Date.now() + wait * 60_000;
  const request = locked((table, procs) => {
    const held = inherited(table, procs, chain(procs, pid));
    if (held.length && (cls === 'build' || cls === 'test' || (cls === 'timed' && held.some((grant) => grant.class === 'timed')))) {
      log({ event: 'passed', class: cls, pid, through: process.env.DEEP_THROTTLE });
      return { pass: true };
    }
    const entry = { id: randomBytes(8).toString('hex'), class: cls, pid, start: procs.get(pid).start, nested: held.length > 0, seq: (table.seq = (table.seq ?? 0) + 1) };
    table.requests.push(entry);
    return entry;
  });
  if (request.pass) return { class: cls, token: process.env.DEEP_THROTTLE, pass: true };
  for (;;) {
    const grant = locked((table, procs) => {
      const pending = table.requests.find((other) => other.id === request.id);
      if (!pending) return 'timeout';
      if (!grantable(table, procs, pending)) return Date.now() > deadline ? (table.requests.splice(table.requests.indexOf(pending), 1), 'timeout') : null;
      table.requests.splice(table.requests.indexOf(pending), 1);
      const taken = new Set(table.grants.filter((other) => other.class === cls).map((other) => other.index));
      const index = Array.from({ length: LIMITS[cls] }, (_, k) => k + 1).find((k) => !taken.has(k));
      const entry = { id: request.id, class: cls, pid, start: request.start, nested: request.nested, index };
      table.grants.push(entry);
      const load = loadavg()[0], cores = cpus().length;
      log({ event: 'granted', class: cls, grant: entry.nested ? 'nested' : 'top-level', id: entry.id, pid, index, load, cores, wait });
      return entry;
    });
    if (grant === 'timeout') {
      log({ event: 'timeout', class: cls, id: request.id, pid, wait });
      return null;
    }
    if (grant) return { class: cls, id: grant.id, index: grant.index, token: `${cls}:${grant.id}`, pass: false };
    sleep(POLL_MS * (0.75 + Math.random() / 2));
  }
}

/** Whether this process or an ancestor holds a grant of `cls`, by the table; DEEP_THROTTLE, which a child can drop, isn't read. */
export const holds = (cls) => locked((table, procs) => {
  const mine = chain(procs, process.pid);
  return table.grants.some((grant) => grant.class === cls && mine.includes(grant.pid));
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const split = args.indexOf('--');
  const [cls, ...options] = split < 0 ? args : args.slice(0, split);
  const command = split < 0 ? [] : args.slice(split + 1);
  const waitAt = options.indexOf('--wait');
  const wait = waitAt < 0 ? (cls === 'window' ? 60 : 30) : Number(options[waitAt + 1]);
  if (cls === 'window') {
    const grant = acquire('timed', { wait });
    if (!grant) {
      console.log(`INCONCLUSIVE no grant: no timed grant came within ${wait} min, so the window did not open`);
      process.exit(3);
    }
    log({ event: 'window-open', id: grant.id, pid: process.pid });
    const ran = spawnSync(process.execPath, [fileURLToPath(new URL('budget-window.mjs', import.meta.url))], { stdio: 'inherit', env: { ...process.env, DEEP_THROTTLE: grant.token } });
    release(grant);
    log({ event: 'window-close', id: grant.id, pid: process.pid });
    process.exit(ran.status ?? 1);
  }
  if (!LIMITS[cls] || !command.length || !(wait >= 0) || options.length !== (waitAt < 0 ? 0 : 2)) {
    console.log(`BLOCKED throttle: usage: throttle.mjs <${CLASSES.join('|')}> [--wait <min>] -- <command>`);
    process.exit(2);
  }
  let grant;
  try {
    grant = acquire(cls, { wait });
  } catch (error) {
    // The table couldn't be read or written, so nothing ran: BLOCKED, never a failure of the command.
    console.log(`BLOCKED throttle: ${error.message}\n  Fix: Repair what the line names: ~/.deepbuild/throttle/ this user's to write, its table readable, ps runnable.`);
    process.exit(2);
  }
  if (!grant) {
    // The marker a job's report reads by: its output is the test run's too, so a line there proves nothing.
    if (process.env.DEEP_PROOF_VITEST_REPORT) appendFileSync(process.env.DEEP_PROOF_VITEST_REPORT, `${JSON.stringify({ type: 'no-grant', message: `no ${cls} grant came within ${wait} min` })}\n`);
    console.log(`INCONCLUSIVE no grant: no ${cls} grant came within ${wait} min\n  Fix: Wait for the other sessions' builds and proofs on this machine, then run again.`);
    process.exit(3);
  }
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: { ...process.env, DEEP_THROTTLE: grant.token } });
  // A terminal's SIGINT reaches the whole group, the command too, so it isn't sent again; a SIGTERM or SIGHUP sent to
  // this process alone is passed on.
  process.on('SIGINT', () => {});
  for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  // This process exits next, which frees a grant a release couldn't give back.
  const giveBack = () => {
    try {
      release(grant);
    } catch {}
  };
  child.on('error', (error) => {
    giveBack();
    console.log(`BLOCKED throttle: ${command[0]} could not start: ${error.message}`);
    process.exit(127);
  });
  child.on('exit', (status, signal) => {
    giveBack();
    process.exit(signal ? 128 + constants.signals[signal] : status);
  });
}
