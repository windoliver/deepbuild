// The per-machine throttle table (docs/parallel-proof.md, section 6): a host-local lock table under the user's
// ~/.deepbuild/throttle/, whatever HOME says, that grants build, bay pair, test and timed by class, so a neighbour's build never runs
// while a budget is timed. `throttle.mjs <class> [--wait <min>] -- <command>` acquires, runs, releases and exits
// with the child's status, or ends a command held past its `--hold` bound while another request waits; acquire and release serve the scripts that hold a grant themselves. `throttle.mjs window`
// opens a budget window (section 12a): a timed grant that waits for every slot to empty, around budget-window.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants, cpus, homedir, loadavg, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Mac has one bay pair and one build at a time; the Spark, Linux, has the cores for more.
const LIMITS = process.platform === 'darwin' ? { build: 1, 'bay-pair': 1, test: 2, timed: 1 } : { build: 2, 'bay-pair': 3, test: 4, timed: 1 };
const CLASSES = Object.keys(LIMITS);
const POLL_MS = 200;
// A CLI grant's default bound, in minutes: the longest full run seen on the Spark was about 9 hours.
const HOLD = 720;
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
/** The command lines of `pids`, by pid. */
function commands(pids) {
  const env = { ...process.env, LC_ALL: 'C' };
  delete env.COLUMNS;
  const listing = spawnSync('ps', ['-ww', '-o', 'pid=,args=', '-p', pids.join(',')], { encoding: 'utf8', env });
  // ps exits 1 when none of the pids is left, which lists nothing; anything else is a ps that couldn't run.
  if (listing.status > 1 || listing.error) throw Error(`ps failed: ${listing.error?.message ?? listing.stderr.trim()}`);
  return new Map(listing.stdout.split('\n').map((line) => line.match(/^\s*(\d+)\s+(.*)$/)).filter(Boolean).map(([, pid, args]) => [Number(pid), args]));
}
// node --test or vitest, by its command line: the program itself, never a word a shell was given.
const testRunner = (args) => {
  const [program, script, ...rest] = args.trim().split(/\s+/);
  const vitest = (word = '') => /(^|\/)vitest(\.m?js)?$|\/vitest\/(vitest\.m?js|dist\/)/.test(word);
  return vitest(program) || (/^node/.test(basename(program)) && ([script, ...rest].includes('--test') || vitest(script)));
};

/**
 * The table's folder (#2744): the machine's, under the user's home from the password database, so a HOME of a run's
 * own never splits it. Only inside a test run, read from the process table, does a request keep a table of its own:
 * DEEP_THROTTLE_TABLE's folder, or else its HOME's, unless DEEP_THROTTLE names a grant of the machine's table, which
 * a run's tests inherit: a test's build then counts under its run's grant, whatever HOME it has. Outside a test run,
 * DEEP_THROTTLE_TABLE is refused, never read.
 */
let chosen;
function folder() {
  if (chosen) return chosen;
  const machine = join(userInfo().homedir, '.deepbuild', 'throttle');
  const inTest = [...commands(ancestors()).values()].some(testRunner);
  if (!inTest && process.env.DEEP_THROTTLE_TABLE) throw Error('DEEP_THROTTLE_TABLE is read only inside a test run (node --test or vitest); unset it to use the machine\'s table');
  if (!inTest || process.env.DEEP_THROTTLE_TABLE) return (chosen = process.env.DEEP_THROTTLE_TABLE || machine);
  // The table is replaced whole by a rename, so it reads whole without its lock.
  const [, cls, id] = (process.env.DEEP_THROTTLE ?? '').match(/^([a-z-]+):([0-9a-f]+)$/) ?? [];
  let named = false;
  try {
    named = !!id && JSON.parse(readFileSync(join(machine, 'table.json'), 'utf8')).grants.some((grant) => grant.id === id && grant.class === cls);
  } catch {}
  return (chosen = named ? machine : join(homedir(), '.deepbuild', 'throttle'));
}

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
function grantable(table, procs, request) {
  const mine = chain(procs, request.pid);
  const outside = table.grants.filter((grant) => !mine.includes(grant.pid));
  // timed is exclusive of every class outside its own chain.
  if (outside.some((grant) => grant.class === 'timed')) return false;
  const first = table.requests.filter((other) => other.class === request.class).sort(order)[0];
  if (first?.id !== request.id) return false;
  if (request.class !== 'timed') {
    // A pending timed request drains: no new top-level grant starts, unless a held grant blocked a drain to its bound
    // (#2744). A drain can't finish until that holder ends, by itself or by its bound, so meanwhile the machine goes
    // on. A window drains whatever is held (section 12a).
    const marked = table.grants.some((grant) => grant.blocked);
    if (!request.nested && table.requests.some((other) => other.class === 'timed' && (other.window || !marked))) return false;
    return table.grants.filter((grant) => grant.class === request.class).length < LIMITS[request.class];
  }
  if (blockers(table, procs, request).length) return false;
  // A top-level request waits for load below the cores, as the log shows. A nested one, in a chain that holds a grant
  // and waits on it, doesn't, so two nested chains finish in their waits on a loaded machine.
  return request.nested || loadavg()[0] < cpus().length;
}

// The holders the last timed request to time out waited on, for its INCONCLUSIVE line.
let blocked = [];

/**
 * Takes a grant of `cls`, waiting at most `wait` minutes; null when none came. A build or test request from a chain
 * that holds a grant, and a timed request from one that holds timed, passes through: it holds its ancestor's grant
 * and is released with it. The grant's `token` is what DEEP_THROTTLE carries to the holder's descendants. A wait doesn't
 * run down while a window is open: a window outlasts a wait, and only its end decides when the next build starts.
 */
export function acquire(cls, { wait = 30, window = false } = {}) {
  if (!LIMITS[cls]) throw Error(`no throttle class ${cls}; the classes are ${CLASSES.join(', ')}`);
  const pid = process.pid;
  let deadline = Date.now() + wait * 60_000, polled = Date.now();
  const request = locked((table, procs) => {
    const held = inherited(table, procs, chain(procs, pid));
    if (held.length && (cls === 'build' || cls === 'test' || (cls === 'timed' && held.some((grant) => grant.class === 'timed')))) {
      log({ event: 'passed', class: cls, pid, through: process.env.DEEP_THROTTLE });
      return { pass: true };
    }
    const entry = { id: randomBytes(8).toString('hex'), class: cls, pid, start: procs.get(pid).start, nested: held.length > 0, window, seq: (table.seq = (table.seq ?? 0) + 1) };
    table.requests.push(entry);
    return entry;
  });
  if (request.pass) return { class: cls, token: process.env.DEEP_THROTTLE, pass: true };
  for (;;) {
    const grant = locked((table, procs) => {
      const pending = table.requests.find((other) => other.id === request.id);
      if (!pending) return 'timeout';
      const now = Date.now();
      if ([...table.grants, ...table.requests].some((other) => other.window && other.id !== request.id)) deadline += now - polled;
      polled = now;
      if (!grantable(table, procs, pending)) {
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
      log({ event: 'granted', class: cls, grant: entry.nested ? 'nested' : 'top-level', id: entry.id, pid, index, load, cores, wait });
      return entry;
    });
    if (grant === 'timeout') {
      log({ event: 'timeout', class: cls, id: request.id, pid, wait, ...blocked.length ? { blockers: blocked } : {} });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
    console.log(`BLOCKED throttle: usage: throttle.mjs <${CLASSES.join('|')}> [--wait <min>] [--hold <min>] -- <command>, or throttle.mjs window [--wait <min>]`);
    process.exit(2);
  }
  let grant;
  try {
    grant = acquire(cls, { wait, window });
  } catch (error) {
    // The table couldn't be read or written, so nothing ran: BLOCKED, never a failure of the command.
    console.log(`BLOCKED throttle: ${error.message}\n  Fix: Repair what the line names: ~/.deepbuild/throttle/ this user's to write, its table readable, ps runnable.`);
    process.exit(2);
  }
  if (!grant) {
    // The marker a job's report reads by: its output is the test run's too, so a line there proves nothing.
    if (process.env.DEEP_PROOF_VITEST_REPORT) appendFileSync(process.env.DEEP_PROOF_VITEST_REPORT, `${JSON.stringify({ type: 'no-grant', message: `no ${cls} grant came within ${wait} min` })}\n`);
    const why = blocked.map((holder) => `; blocked by ${holder.class} grant ${holder.id} held by pid ${holder.pid} since ${holder.at} (${holder.command})`).join('');
    console.log(`INCONCLUSIVE no grant: no ${cls} grant came within ${wait} min${why}\n  Fix: Wait for the other sessions' builds and proofs on this machine, then run again.`);
    process.exit(3);
  }
  if (window) log({ event: 'window-open', id: grant.id, pid: process.pid });
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: { ...process.env, DEEP_THROTTLE: grant.token } });
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
  const mine = () => {
    const procs = processes({ fresh: true });
    return [...procs].filter(([pid]) => pid !== process.pid && chain(procs, pid).includes(process.pid)).map(([pid, { start }]) => ({ pid, start }));
  };
  // Only a process listed now with the start it had then: a number since taken is someone else's.
  const stop = () => {
    const procs = processes({ fresh: true });
    for (const holder of tree) if (procs.get(holder.pid)?.start === holder.start) try { process.kill(holder.pid, 'SIGKILL'); } catch {}
  };
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
      log({ event: 'expired', class: cls, id: grant.id, pid: process.pid, hold });
      tree = mine();
      child.kill('SIGTERM');
      setTimeout(() => (tree.push(...mine()), stop()), 10_000).unref();
    }, 1_000);
    watch.unref();
  }
  child.on('exit', (status, signal) => {
    if (tree) stop();
    giveBack();
    if (tree) {
      console.log(`INCONCLUSIVE throttle: the ${cls} grant ${grant.id} was held past its ${hold} min bound while another request waited; its command was stopped\n  Fix: Find why the command didn't end (a leaked child, a hung test), then run again.`);
      process.exit(3);
    }
    process.exit(signal ? 128 + constants.signals[signal] : status);
  });
}
