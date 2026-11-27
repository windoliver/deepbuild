// Helpers for #3551's acceptance tests (README). A sandbox with its own HOME, throttle table (DEEP_THROTTLE_TABLE, so
// the machine's ~/.deepbuild/throttle/ is never read or written) and TMPDIR; a fixture checkout of main that holds a
// copy of this checkout's scripts/, with an origin of its own on disk and a gh stand-in first on PATH, where every
// `node scripts/throttle.mjs window` and every class request of the suite runs; stub commands that hold a grant until
// they are told to stop; and readers for the table, the throttle's log, the window's own record and what each process
// noted. Nothing here imports the code under test: throttle.mjs is reached by running it, and read through its output,
// its exit status, the table, the log and the record. Written here, never imported from another suite.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, homedir, hostname, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The two spans every window of this suite is asked with, in minutes, as each criterion states them. */
const APART_MIN = 6;
const OVERDUE_MIN = 12;
/** The classes a grant of the table carries (docs/parallel-proof.md, section 6): the four a request names, and a job's turn. */
const CLASSES = ['build', 'bay-pair', 'test', 'timed', 'turn'];
/** The load every process of a sandbox reads: below any Mac's cores, so a window that may open isn't kept out by this machine's. */
const QUIET_LOAD = 2;
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'DEEP_WINDOW', 'DEEP_PREFLIGHT',
  'DEEP_OPEN_ISSUES', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_GATES', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'CARGO_MAKEFLAGS', 'MAKEFLAGS', 'MFLAGS'];
// The home folder and the name of the machine the suite runs on, which no message may hold.
const OWNER_HOME = homedir();
const HOST = hostname().split('.')[0];

// Every node process of a sandbox loads this first (NODE_OPTIONS). It pins the load: the OS's is shared with every
// session on the machine, and a top-level timed request waits for one below the cores. And a throttle.mjs process
// notes, on its own clock, the moment its script starts to run and the moment it exits, so a test reads how long the
// script itself took, apart from the time this machine takes to start a node process.
const PRELOAD = `import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
const pinned = Number(process.env.T3551_LOAD);
os.loadavg = () => [pinned, pinned, pinned];
syncBuiltinESMExports();
if (/[\\\\/]scripts[\\\\/]throttle\\.mjs$/.test(process.argv[1] ?? '')) {
  const note = (event, more = {}) => { try { appendFileSync(process.env.T3551_NOTES, JSON.stringify({ kind: 'throttle', event, pid: process.pid, args: process.argv.slice(2, 3), t: Date.now(), ...more }) + '\\n'); } catch {} };
  note('start');
  process.on('exit', (status) => note('exit', { status }));
}
`;

// A request's command: node command.mjs <name> [exit]. It notes that it started, with the grant it runs under
// (DEEP_THROTTLE), then holds until <sandbox>/<name>.stop appears, notes its end and exits 0; with `exit` it exits 0
// as soon as it has noted its start. A command whose sandbox is gone, its throttle having died without it, ends too.
const COMMAND = `import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [name, ...flags] = process.argv.slice(2);
const note = (event) => appendFileSync(process.env.T3551_NOTES, JSON.stringify({ kind: 'command', name, event, pid: process.pid, grant: process.env.DEEP_THROTTLE ?? null, t: Date.now() }) + '\\n');
note('start');
if (flags.includes('exit')) process.exit(0);
const stop = join(dirname(process.argv[1]), name + '.stop');
setInterval(() => {
  if (!existsSync(process.argv[1])) process.exit(0);
  if (existsSync(stop)) { note('end'); process.exit(0); }
}, 50);
`;

// The stand-in for gh: every call goes to calls.jsonl and exits 1. The fixture's commits name no issue, and a first
// window on a machine only marks main, so a window of this suite has nothing to ask it.
const GH = (calls) => `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');
console.error('stand-in gh: no ' + process.argv.slice(2).join(' '));
process.exit(1);
`;

const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

/**
 * What the window's script reads by name from the PATH, first on it: the machine's fingerprint tools, which report a
 * reference Mac on mains, so a record holds nothing of this machine; gh; and npm and cargo, which exit 0, so nothing a
 * wrong program might start builds anything here.
 */
function standIns(box) {
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  script(join(bin, 'sysctl'), `#!/bin/sh
case "$*" in
  "-n hw.model") echo Mac15,7 ;;
  "-n machdep.cpu.brand_string") echo "Apple M3 Pro" ;;
  "-n hw.memsize") echo ${36 * 2 ** 30} ;;
  "-n vm.loadavg") echo "{ ${QUIET_LOAD} ${QUIET_LOAD} ${QUIET_LOAD} }" ;;
  *) exec /usr/sbin/sysctl "$@" ;;
esac
`);
  script(join(bin, 'pmset'), `#!/bin/sh
if [ "$*" = "-g ps" ]; then echo "Now drawing from 'AC Power'"; else echo " lowpowermode         0"; fi
`);
  script(join(bin, 'osascript'), '#!/bin/sh\necho 0\n');
  script(join(bin, 'sw_vers'), '#!/bin/sh\necho 25A3551\n');
  for (const tool of ['npm', 'cargo']) script(join(bin, tool), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(bin, 'gh.mjs'), GH(join(box.dir, 'gh-calls.jsonl')));
  script(join(bin, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(bin, 'gh.mjs'))} "$@"\n`);
  return bin;
}

/** git in a scratch repository, with no hooks, no signing and no configuration but the sandbox's. */
const gitIn = (box, cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
  { cwd, env: { ...box.env, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'pipe', encoding: 'utf8' });

/**
 * The fixture: `origin.git`, a bare repository on disk, and `mac`, a checkout of its main that no session works in,
 * which holds a copy of this checkout's scripts/. The window's script fetches that origin and finds its repository
 * from where it lies, so no window of the suite ever runs with this checkout as its root.
 */
function fixture(box) {
  const origin = join(box.dir, 'origin.git'), mac = join(box.dir, 'mac');
  mkdirSync(origin);
  mkdirSync(mac);
  gitIn(box, origin)('init', '-q', '--bare', '-b', 'main');
  const git = gitIn(box, mac);
  git('init', '-q', '-b', 'main');
  cpSync(join(CHECKOUT, 'scripts'), join(mac, 'scripts'), { recursive: true });
  mkdirSync(join(mac, 'benchmarks'));
  writeFileSync(join(mac, 'benchmarks', 'budgets.json'), `${JSON.stringify({ tasks: [] }, null, 2)}\n`);
  git('add', '-A');
  git('commit', '-qm', 'The fixture before its first window');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  return mac;
}

/** Whether this process runs under `node --test`: only inside a test run does a request keep a table of its own (section 6). */
const underTest = () => Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes('--test');

/**
 * A sandbox removed after the test: a HOME, a throttle table folder (DEEP_THROTTLE_TABLE), a TMPDIR, the stand-ins
 * first on PATH, the preload, the fixture checkout and a file every process notes in. Both spans are set, in minutes,
 * for every process. After the test every process group it started is stopped, by that group's PID; nothing is stopped
 * by name or port.
 */
export function sandbox(t) {
  assert.ok(underTest(), 'the suite runs only under node --test, where a request keeps the table DEEP_THROTTLE_TABLE names');
  assert.ok(existsSync(join(CHECKOUT, 'node_modules', 'typescript')), 'no node_modules/typescript in <checkout>: run npm ci there first (the window\'s script imports affected.mjs)');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3551-')));
  // The HOME's folder is named `user`: the secrets lint reads `/home/<name>/` in a line as a home path.
  const box = { dir, home: join(dir, 'user'), table: join(dir, 'table'), tmp: join(dir, 'tmp'), notes: join(dir, 'notes.jsonl'), command: join(dir, 'command.mjs'), children: [] };
  for (const folder of [box.home, box.table, box.tmp]) mkdirSync(folder);
  writeFileSync(join(dir, 'preload.mjs'), PRELOAD);
  writeFileSync(box.command, COMMAND);
  // The window's script imports affected.mjs, which imports typescript: found from the fixture through this link.
  symlinkSync(join(CHECKOUT, 'node_modules'), join(dir, 'node_modules'));
  box.env = {
    ...process.env,
    HOME: box.home, XDG_CACHE_HOME: join(box.home, '.cache'), TMPDIR: box.tmp, DEEP_THROTTLE_TABLE: box.table,
    NODE_OPTIONS: `--import=${join(dir, 'preload.mjs')}`, T3551_LOAD: String(QUIET_LOAD), T3551_NOTES: box.notes,
    DEEP_WINDOW_APART_MIN: String(APART_MIN), DEEP_WINDOW_OVERDUE_MIN: String(OVERDUE_MIN),
  };
  for (const name of Object.keys(box.env)) if (/^GIT_/.test(name) || ENV_OUT.includes(name)) delete box.env[name];
  box.env.PATH = `${standIns(box)}${delimiter}${box.env.PATH}`;
  t.after(() => {
    // A negative pid signals a group this test started detached, and only one whose process still runs: the number
    // of one that has ended may be another's by now. pid > 1 guards against kill(-1).
    for (const child of box.children) if (Number.isInteger(child.pid) && child.pid > 1 && running(child)) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    try { chmodSync(join(box.table, 'log'), 0o600); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  box.mac = fixture(box);
  box.throttle = join(box.mac, 'scripts', 'throttle.mjs');
  return box;
}

/**
 * A file's own `after`, for a scene that several tests read: what `sandbox` registers on it runs once every test of
 * the file has ended, not at the end of the test that played the scene. Call it at the file's top level, with
 * node:test's `after`.
 */
export function wholeFile(after) {
  const ends = [];
  after(() => { for (const end of ends) end(); });
  return { after: (end) => ends.push(end) };
}

// deadline: each caller says what its pause bounds.
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** Looks every 20 ms until `predicate` holds or `ms` pass; returns what it held, or false. */
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const held = predicate();
    if (held) return held;
    if (Date.now() > end) return false;
    // deadline: a look every 20 ms until `ms` runs out.
    await pause(20);
  }
}

/**
 * Starts `argv` in the fixture's checkout, in a process group of its own. `asked` is the test's clock as the process
 * is started; `done` resolves once it exits, with its status, its output and the test's clock then.
 */
function launch(box, argv, label) {
  const asked = Date.now();
  const child = spawn(argv[0], argv.slice(1), { cwd: box.mac, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  Object.assign(child, { asked, label, out: () => stdout, err: () => stderr });
  const closed = new Promise((resolve) => child.on('close', resolve));
  child.done = new Promise((resolve) => {
    child.on('error', (error) => resolve({ status: null, signal: null, stdout, stderr: `${stderr}\n${error.message}`, ended: Date.now() }));
    child.on('exit', (status, signal) => {
      const ended = Date.now();
      // Its end is its exit: a process it left running may hold the pipes open.
      // deadline: the pipes' close is waited for at most 1 s.
      Promise.race([closed, pause(1_000)]).then(() => resolve({ status, signal, stdout, stderr, ended }));
    });
  });
  return child;
}
export const running = (child) => child.exitCode === null && child.signalCode === null;

/**
 * A child's end, or null once `ms` pass: then its group is stopped, by its PID, so a run that never ends reads as a
 * failed assertion of its caller and never as the runner's own timeout.
 */
function ended(child, ms) {
  let timer;
  // deadline: a run still going at its limit is stopped; nothing waits for this time to pass.
  const bound = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([child.done, bound]).then((run) => {
    clearTimeout(timer);
    if (!run && running(child)) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    return run;
  });
}

/**
 * A class request beside the window, as a session makes one: `node scripts/throttle.mjs <class> -- node command.mjs
 * <name> [exit]`, from the fixture's copy, on the sandbox's table.
 */
export const ask = (box, cls, name, flags = []) => Object.assign(launch(box, [process.execPath, box.throttle, cls, '--', process.execPath, box.command, name, ...flags], name), { cls });
/** `node scripts/throttle.mjs window` in the fixture's checkout, as section 12a's schedule asks it. `mark` is how many lines the log held then. */
export function askWindow(box, mark = logLines(box).length) {
  return Object.assign(launch(box, [process.execPath, box.throttle, 'window'], 'window'), { mark, own: null });
}
/** Tells a holding command to end: it exits 0 by itself, and its throttle gives the grant back. */
const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');

const jsonLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => { try { return JSON.parse(line); } catch { return { unparsed: line }; } }) : []);
/** What the sandbox's processes noted: each command's start and end, and each throttle.mjs's start and exit. */
const notes = (box) => jsonLines(box.notes);
/** A command's note that it started, with the grant it ran under. */
export const commandStart = (box, name) => notes(box).find((note) => note.kind === 'command' && note.name === name && note.event === 'start');
/** The table's log, `<table>/log`: one JSON object a line, each with `at` and `event`. */
export const logLines = (box) => jsonLines(join(box.table, 'log'));
/** The table, `<table>/table.json`, as its last writer left it: its grants and its requests. None before the first request. */
export function table(box) {
  try {
    const { grants = [], requests = [] } = JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8'));
    return { grants, requests };
  } catch {
    return { grants: [], requests: [] };
  }
}

/**
 * Waits for a request's command to start under a grant of its class; fails at the assertion when it doesn't within
 * 60 s or its throttle ends first. Returns the note, with the grant's `id`.
 */
export async function started(box, request) {
  // deadline: a grant on a free slot comes at the request's first look; 60 s bound a machine too busy to start it.
  await until(() => commandStart(box, request.label) || !running(request), 60_000);
  const start = commandStart(box, request.label);
  assert.ok(start, `the scene didn't hold: ${request.label} never ran its command under the throttle\n${dump(box, request)}`);
  assert.match(String(start.grant), new RegExp(`^${request.cls}:\\S+$`), `the scene didn't hold: ${request.label} ran under no ${request.cls} grant\n${dump(box, request)}`);
  return { ...start, id: start.grant.slice(request.cls.length + 1) };
}

/**
 * An earlier window in the table's log, as the throttle writes one: its grant and its `window-open` two minutes
 * before its `window-close`, which is `closedMinAgo` minutes old, and its release. Call it oldest first, and before
 * any request: the log then reads in the order of its times.
 */
export function logWindow(box, closedMinAgo) {
  const id = (0x3551_0000 + closedMinAgo).toString(16).padStart(16, '0'), pid = 35_510 + closedMinAgo;
  const now = Date.now();
  const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const lines = [
    { at: ago(closedMinAgo + 2), event: 'granted', class: 'timed', grant: 'top-level', id, pid, index: 1, load: QUIET_LOAD, cores: cpus().length, wait: 60 },
    { at: ago(closedMinAgo + 2), event: 'window-open', id, pid },
    { at: ago(closedMinAgo), event: 'window-close', id, pid },
    { at: ago(closedMinAgo), event: 'released', class: 'timed', id, pid },
  ];
  appendFileSync(join(box.table, 'log'), lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  return id;
}

/**
 * Looks at the table once. The first sight of a request of the window's own is kept on `window.own`, with `seen`, the
 * test's clock then: a request its process made, or a timed one, which only a window asks for in this suite.
 */
export function sight(box, window) {
  if (!window.own) {
    const request = table(box).requests.find((other) => other.pid === window.pid || other.window === true || other.class === 'timed');
    if (request) window.own = { ...request, seen: Date.now() };
  }
  return window.own;
}
/**
 * Watches the table for a request of the window's own until the window ends; one still running once `ms` pass is
 * stopped, by its group's PID. `window.run` is its end, with its status and output, or null.
 */
export async function watched(box, window, ms) {
  // deadline: the caller's bound on a window's whole run; a look each 20 ms until the window ends.
  await until(() => { sight(box, window); return !running(window); }, ms);
  sight(box, window);
  // deadline: the pipes of a window that has ended close within a second; one still running is stopped here.
  window.run = await ended(window, 2_000);
  return window.run;
}
/** A request or a grant of the table, for a message: its class, its id and its process. */
export const named = (entry) => `${entry.class} ${entry.at ? 'grant' : 'request'} ${entry.id} of pid ${entry.pid}`;

/** How long a throttle.mjs process's script ran, by its own notes: from the moment it started to run to its exit; null without both. */
export function scriptRan(box, child) {
  const mine = notes(box).filter((note) => note.kind === 'throttle' && note.pid === child.pid);
  const start = mine.find((note) => note.event === 'start'), exit = mine.find((note) => note.event === 'exit');
  return start && exit ? { start: start.t, exit: exit.t, ms: exit.t - start.t } : null;
}

/** Seconds from `from` to `to` on the test's clock, for a message. */
export const seconds = (from, to = Date.now()) => `${((to - from) / 1000).toFixed(1)} s`;
/** A run's first line of stdout. */
export const firstLine = (child) => child.out().trimStart().split('\n')[0];
/** How a run ended, for a message. */
export const how = (child) => (running(child) ? `still running ${seconds(child.asked)} after it was asked` : `exit ${child.exitCode}${child.signalCode ? ` (${child.signalCode})` : ''}`);

/**
 * What the log gained since the window was asked, and the window in it: `open` and `close` are where its
 * `window-open` and the `window-close` of the same grant lie (-1 without), `id` the grant they name, `opened` the
 * time `window-open` carries.
 */
export function windowIn(box, window) {
  const whole = logLines(box);
  assert.ok(whole.length >= window.mark, 'the scene is gone: the log holds fewer lines than when the window was asked');
  const log = whole.slice(window.mark);
  const open = log.findIndex((line) => line.event === 'window-open');
  const id = open < 0 ? null : log[open].id;
  const close = open < 0 ? -1 : log.findIndex((line, at) => at > open && line.event === 'window-close' && line.id === id);
  return { log, open, close, id, opened: open < 0 ? null : Date.parse(log[open].at) };
}

/** Each window's own record under the sandbox's ~/.deepbuild/lanes/ (section 12a): a JSON object with `start`, `end` and a list of `commits`. */
export function windowRecords(box) {
  const folder = join(box.home, '.deepbuild', 'lanes');
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try {
      const value = JSON.parse(readFileSync(join(folder, name), 'utf8'));
      return value && typeof value === 'object' && 'start' in value && 'end' in value && Array.isArray(value.commits) ? [value] : [];
    } catch {
      return [];
    }
  });
}

// What a window's record holds on the base, and `drain`: no other key of these is read as the grants it waited on.
const RECORD_KEYS = ['lane', 'grant', 'start', 'end', 'machine', 'cores', 'loadStart', 'loadEnd', 'from', 'tip', 'commits', 'records', 'state', 'ran', 'notReached', 'longest', 'note', 'drain'];
/**
 * A value read as grants by class, `{ <class>: <count> }` in the classes' order with no class at 0, or null when it
 * isn't one: an object whose keys are all classes and whose values are each a count or a list (as long as its count);
 * or a list whose items each name a class, as an object with `class`, or as a string `<class>` or `<class>:<id>`.
 */
function byClass(value) {
  let counts;
  if (Array.isArray(value)) {
    const classes = value.map((item) => (typeof item === 'string' ? CLASSES.find((cls) => item === cls || item.startsWith(`${cls}:`)) : CLASSES.find((cls) => cls === item?.class)));
    if (!classes.every(Boolean)) return null;
    counts = Object.fromEntries(CLASSES.map((cls) => [cls, classes.filter((one) => one === cls).length]));
  } else {
    if (!value || typeof value !== 'object' || !Object.keys(value).every((key) => CLASSES.includes(key))) return null;
    counts = Object.fromEntries(Object.entries(value).map(([cls, held]) => [cls, Array.isArray(held) ? held.length : held]));
    if (!Object.values(counts).every((count) => Number.isInteger(count) && count >= 0)) return null;
  }
  return Object.fromEntries(CLASSES.filter((cls) => counts[cls]).map((cls) => [cls, counts[cls]]));
}
/** Every reading of grants by class a record holds outside the base's keys and `drain`, to two levels: `{ path, counts }`. */
function waitedOn(record) {
  const found = [];
  const walk = (value, path, depth) => {
    const counts = byClass(value);
    if (counts) found.push({ path, counts });
    else if (depth < 2 && value && typeof value === 'object' && !Array.isArray(value)) for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`, depth + 1);
  };
  for (const [key, value] of Object.entries(record)) if (!RECORD_KEYS.includes(key)) walk(value, key, 0);
  return found;
}

/**
 * What an opened window's record doesn't hold of criterion 5, as a list of sentences: the record of the grant the
 * log's `window-open` names; `drain`, a number of milliseconds within 1 s of the time the test read from the window's
 * request to its grant; and the grants it waited on, by class, `held` being the `{ <class>: <count> }` the scene held.
 * The request's moment can't be read from outside to the millisecond, so the test reads the two moments it lies
 * between: the window's process being started (`window.asked`) and the test's first sight of its request in the table
 * (`window.own.seen`; a request granted at its first look is never seen, and then the grant's own moment stands in).
 * The grant's moment is the time the log's `window-open` carries.
 */
export function recordProblems(box, window, held) {
  const { open, id, opened } = windowIn(box, window);
  if (open < 0) return ['the window never opened, so it left no record to read'];
  const record = windowRecords(box).find((one) => one.grant === id);
  if (!record) return [`the opened window left no record of its own, one whose grant is ${id}, under ~/.deepbuild/lanes/`];
  const problems = [];
  const most = opened - window.asked, least = Math.max(0, opened - (window.own?.seen ?? opened));
  // deadline: the criterion's own 1 s, on either side of the time the test read from the window's request to its grant.
  const within = typeof record.drain === 'number' && record.drain >= least - 1_000 && record.drain <= most + 1_000;
  if (typeof record.drain !== 'number' || !Number.isFinite(record.drain)) problems.push(`the record holds no drain, a number of milliseconds: its drain is ${JSON.stringify(record.drain)}`);
  else if (!within) problems.push(`the record's drain, ${record.drain} ms, isn't within 1 s of the time the test read from the window's request to its grant, ${least} to ${most} ms (its request joined the table between the two moments the test read; its grant is the log's window-open)`);
  // A window that waited on no grant has none to hold by class: only a scene that held some reads them.
  const readings = waitedOn(record), wanted = JSON.stringify(byClass(held));
  if (Object.keys(held).length && !readings.some(({ counts }) => JSON.stringify(counts) === wanted)) {
    problems.push(`the record doesn't hold the grants the window waited on, by class, ${wanted}: ${readings.length ? `it holds ${readings.map(({ path, counts }) => `${path}: ${JSON.stringify(counts)}`).join(', ')}` : 'no key of it reads as grants by class'}`);
  }
  return problems;
}

/**
 * A drain's scene. `held` lists the grants held when the window is asked, each `{ cls, name, ends }`: its command
 * holds until the test ends it, `ends` ms after the window was asked. `queued` lists the classes of the top-level
 * requests made once the window's request is in the table, each for a command that exits at once. A window that ends
 * before a grant's time ends the scene there: it left, or opened with grants held. Returns the window, the holders
 * (each with its grant's `id`) and the queued requests.
 */
export async function playDrain(box, { held, queued }) {
  const holders = held.map(({ cls, name, ends }) => Object.assign(ask(box, cls, name), { ends }));
  for (const holder of holders) holder.id = (await started(box, holder)).id;
  const window = askWindow(box);
  // deadline: a request joins the table within seconds of its process's start; 60 s bound a machine too busy for that.
  await until(() => sight(box, window) || !running(window), 60_000);
  const waiting = window.own ? queued.map((cls) => ask(box, cls, `queued-${cls}`, ['exit'])) : [];
  // Each is in line, or has run, before the first grant ends: a throttle that stops no new grant has its looks to grant it in.
  // deadline: a request joins the table within seconds of its process's start; 60 s bound a machine too busy for that.
  await until(() => !running(window) || waiting.every((request) => commandStart(box, request.label) || !running(request) || table(box).requests.some((other) => other.pid === request.pid)), 60_000);
  for (const holder of [...holders].sort((a, b) => a.ends - b.ends)) {
    // deadline: the scene's schedule: this grant ends `ends` ms after the window was asked, or once the window has ended.
    await until(() => !running(window), Math.max(0, window.asked + holder.ends - Date.now()));
    finish(box, holder.label);
    // deadline: a command told to stop exits within a look of 50 ms; 60 s bound a machine too busy for that.
    holder.run = await ended(holder, 60_000);
  }
  // deadline: a window that opens marks main and closes within seconds; 120 s bound a machine too busy for that.
  window.run = await ended(window, 120_000);
  // deadline: a request the window held back starts at its close; 60 s bound a machine too busy for that.
  for (const request of waiting) request.run = await ended(request, 60_000);
  return { window, holders, queued: waiting };
}

/**
 * What a drain's scene doesn't hold, as a list of sentences: the window opened; every grant held when it was asked
 * was given back before its `window-open`; no top-level grant but its own started between its request and its
 * `window-close`; and each request made during the drain ran its command after that close. All by the log's order.
 */
export function drainProblems(box, { window, holders, queued }) {
  const { log, open, close, id } = windowIn(box, window);
  const first = firstLine(window);
  const ending = window.run ? `it ended ${seconds(window.asked, window.run.ended)} after it was asked, ${how(window)}` : 'it was still waiting when the test stopped it, its held grants long ended';
  if (open < 0) return [`the window never opened: the log holds no window-open since it was asked; ${ending}${first ? `, its first line ${JSON.stringify(first)}` : ', having printed nothing'}`];
  const problems = [];
  for (const holder of holders) {
    const released = log.findIndex((line) => line.event === 'released' && line.id === holder.id);
    if (released < 0 || released > open) problems.push(`the window opened while the ${holder.cls} grant ${holder.id} (${holder.label}), held when it was asked, was still held: the log's window-open comes ${released < 0 ? 'with no release of it' : 'before its release'}`);
  }
  if (close < 0) problems.push(`the log holds no window-close for the window's grant ${id}`);
  const between = log.slice(0, close < 0 ? log.length : close).filter((line) => line.event === 'granted' && line.grant !== 'nested' && line.id !== id);
  if (between.length) problems.push(`a top-level grant started between the window's request and its close: ${between.map((line) => `${line.class} grant ${line.id} of pid ${line.pid} at ${line.at}`).join(', ')}`);
  for (const request of queued) {
    const start = commandStart(box, request.label);
    const granted = start ? log.findIndex((line) => line.event === 'granted' && `${line.class}:${line.id}` === start.grant) : -1;
    if (!start) problems.push(`the ${request.cls} request made during the drain (pid ${request.pid}) never ran its command: ${how(request)}`);
    else if (close >= 0 && granted < close) problems.push(`the ${request.cls} request made during the drain (pid ${request.pid}) ran under ${start.grant}, which the log ${granted < 0 ? 'doesn\'t hold after the window was asked' : 'grants before the window-close'}`);
  }
  return problems;
}

/** `text` as a message may hold it: this checkout as <checkout>, the sandbox as <sandbox>, any home folder as ~, the machine's name as <host>. */
function redact(box, text) {
  const said = String(text).replaceAll(CHECKOUT, '<checkout>').replaceAll(box.home, '~').replaceAll(box.dir, '<sandbox>').replaceAll(OWNER_HOME, '~');
  return HOST.length > 3 ? said.replaceAll(HOST, '<host>') : said;
}
const tail = (text, size = 3_000) => (text.length > size ? `…${text.slice(-size)}` : text);
/** What a person reads at a failed assertion: the table, the log, the notes, the windows' records and each run's end and output. */
export const dump = (box, ...runs) => redact(box, [
  `table: ${JSON.stringify(table(box))}`,
  `log:\n${logLines(box).map((line) => JSON.stringify(line)).join('\n')}`,
  `notes:\n${notes(box).map((note) => JSON.stringify(note)).join('\n')}`,
  `window records:\n${windowRecords(box).map((record) => JSON.stringify(record)).join('\n')}`,
  ...runs.filter(Boolean).map((run) => `${run.label}: ${how(run)}\nstdout:\n${tail(run.out())}\nstderr:\n${tail(run.err(), 1_500)}`),
].join('\n'));

/** Fails, listing each sentence under `what`, unless there are none. */
export function none(box, problems, what, ...runs) {
  assert.ok(!problems.length, `${what}:\n${problems.map((problem) => `- ${redact(box, problem)}`).join('\n')}\n${dump(box, ...runs)}`);
}
