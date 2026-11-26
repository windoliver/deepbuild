// Helpers for #3478's acceptance tests: an affected.mjs run on #2820's fixture repository (real cargo, a tiny Cargo
// workspace), on a throttle table and a HOME of the test's own, behind a line of holders that keeps moving or stands
// still. Nothing here imports the code under test: this checkout's scripts/ run in the fixture, and the throttle is
// reached by running it (README: The surfaces).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THROTTLE } from '../1115/helpers.mjs';
import { LIMIT } from '../2574-redraft-2833/helpers.mjs';
import { BUILD_SLOTS, dump, fixture, record, sandbox as sandbox2820, show, start, throttleLog } from '../2820/helpers.mjs';

export { fixture, plain, prints, record, selfBuilding, throttleLog, workspace } from '../2820/helpers.mjs';
export { summary } from '../1115/helpers.mjs';

/** The machine's slots of a class, as this checkout's throttle states them (docs/parallel-proof.md, section 6). */
export const SLOTS = { build: BUILD_SLOTS, test: LIMIT };
/** How long each holder of a moving line keeps its grant, in seconds: with the hand-over, about every 2 s. */
const HOLD = '1.5';
/** One run of affected.mjs is given this long before the test fails it, in minutes. */
export const RUN_MIN = 8;
export const TEST = { timeout: 15 * 60_000 };

/**
 * #2820's sandbox: a HOME of its own, a throttle table of its own (DEEP_THROTTLE_TABLE), real cargo, removed after the
 * test with every process the test started stopped by its group's PID. Neither DEEP_TEST_GRANT_WAIT (which #2820's
 * drops) nor DEEP_TEST_GRANT_STALL reaches the run from this process, nor a grant or readings of its caller's.
 */
export function sandbox(t) {
  const box = sandbox2820(t);
  for (const name of ['DEEP_TEST_GRANT_STALL', 'DEEP_TEST_GRANT_WAIT', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'DEEP_JOB_IDLE_MIN']) delete box.env[name];
  return box;
}

/**
 * Starts `argv` in the sandbox, in its own process group, stopped after the test by that group's PID. `done` resolves
 * with its status and output; `line(re)` with the first line of its output that matches, or null when it ends without.
 */
export function launch(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  const waiters = [];
  const look = () => {
    for (const waiter of [...waiters]) {
      const found = stdout.split('\n').find((line) => waiter.re.test(line));
      if (found !== undefined) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(found); }
    }
  };
  child.stdout.on('data', (chunk) => { stdout += chunk; look(); });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.done = new Promise((resolve) => {
    child.on('error', (error) => resolve({ status: null, signal: null, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on('close', (status, signal) => {
      for (const waiter of waiters.splice(0)) waiter.resolve(null);
      resolve({ status, signal, stdout, stderr });
    });
  });
  child.line = (re) => new Promise((resolve) => { waiters.push({ re, resolve }); look(); });
  child.out = () => `stdout:\n${stdout.slice(-3_000)}\nstderr:\n${stderr.slice(-1_000)}`;
  child.text = () => stdout;
  return child;
}

/**
 * Resolves with `promise`'s value, or with `null` once `minutes` pass: a run that hangs reads as a failed assertion
 * of its caller, never as the test runner's own timeout.
 */
export function within(promise, minutes) {
  let timer;
  // deadline: a run still waiting past its bound is failed by the caller's assertion, so a hang can't pass
  const bound = new Promise((resolve) => { timer = setTimeout(() => resolve(null), minutes * 60_000); });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}

/** `node scripts/affected.mjs <paths>` in the fixture, in its own process group, with `extra` in its environment. */
export const affected = (box, fx, paths, extra = {}) => start(box, { cwd: fx.cwd, env: fx.env }, paths, extra);
/**
 * Where a run started with `--results=<this file>` writes each selected file's state (docs/parallel-proof.md, section
 * 6a), and the state it wrote for `file`: null when the run wrote no results or none for the file.
 */
export const resultsFile = (box) => join(box.dir, 'results.json');
export function stateOf(box, file) {
  try {
    return JSON.parse(readFileSync(resultsFile(box), 'utf8')).files.find((entry) => entry.file === file)?.state ?? null;
  } catch {
    return null;
  }
}
/** The run's result, or null while it is still running `minutes` later. */
export const ended = (run, minutes = RUN_MIN) => within(run.done, minutes);

// The moving slot of a line (README: The moving line). It keeps `ahead` holders waiting, each a
// `throttle.mjs <class> --wait 10` whose command notes its grant and holds it HOLD seconds, and notes each holder's
// pid as it starts it. It prints `READY` once a grant has changed hands. It stops adding holders once the file `stop`
// exists and `least` ms have passed since its first grant (or 12 minutes after it began), then lets its holders drain
// and prints `DONE`.
const FEEDER = `import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const { throttle, cls, ahead, hold, least, stop, granted, pids } = JSON.parse(process.argv[2]);
let started = 0, first = null, ready = false, feeding = true;
const born = Date.now(), ends = [];
const count = () => (existsSync(granted) ? readFileSync(granted, 'utf8').split('\\n').filter(Boolean).length : 0);
const add = () => {
  started++;
  const holder = spawn(process.execPath, [throttle, cls, '--wait', '10', '--', '/bin/sh', '-c', 'echo "$DEEP_THROTTLE" >> "$0"; exec /bin/sleep ' + hold, granted], { stdio: 'ignore' });
  appendFileSync(pids, holder.pid + '\\n');
  ends.push(new Promise((done) => holder.on('close', (status) => done(status))));
};
const timer = setInterval(() => {
  const now = Date.now(), seen = count();
  if (seen && first === null) first = now;
  if (!ready && seen > 1) { ready = true; console.log('READY ' + seen); }
  if (feeding && ((existsSync(stop) && first !== null && now - first >= least) || now - born > 720000)) {
    feeding = false;
    clearInterval(timer);
    Promise.all(ends).then((codes) => console.log('DONE ' + JSON.stringify({ started, granted: count(), codes })));
    return;
  }
  while (feeding && started - seen < ahead) add();
}, 100);
`;

// Watches for the run's request of one class on the sandbox's table: the one request, and the one top-level grant,
// that no holder of the line made. It prints `JOINED <n>` when the run's request is first seen in line (the table's
// `requests`), n being the holders' grants the log holds by then, and `GRANTED` once the log holds the run's grant;
// then, or 12 minutes after it began, it ends. The table is read before the holders' pids, which only grow.
const WATCHER = `import { existsSync, readFileSync } from 'node:fs';
const { table, log, cls, still, pids } = JSON.parse(process.argv[2]);
const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const born = Date.now();
let joined = false;
const timer = setInterval(() => {
  let requests = [];
  try { requests = JSON.parse(read(table)).requests ?? []; } catch {}
  const grants = read(log).split('\\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
    .filter((entry) => entry.event === 'granted' && entry.class === cls && entry.grant === 'top-level');
  const holders = new Set([...still, ...(pids && existsSync(pids) ? read(pids).split('\\n').filter(Boolean).map(Number) : [])]);
  if (!joined && requests.some((request) => request.class === cls && !holders.has(request.pid))) {
    joined = true;
    console.log('JOINED ' + grants.filter((entry) => holders.has(entry.pid)).length);
  }
  const granted = grants.some((entry) => !holders.has(entry.pid));
  if (granted) console.log('GRANTED');
  if (granted || Date.now() - born > 720000) clearInterval(timer);
}, 40);
`;
/**
 * Starts the watcher for the run's `cls` request (WATCHER). `joined()` is the number of holders' grants the log held
 * when the run's request was first seen in line, or null while it hasn't been; `line(/^GRANTED$/)` resolves once the
 * run has its grant.
 */
function watch(box, cls, still, pids = null) {
  const script = join(box.dir, `watcher-${cls}.mjs`);
  writeFileSync(script, WATCHER);
  const watcher = launch(box, [process.execPath, script, JSON.stringify({ table: join(box.table, 'table.json'), log: join(box.table, 'log'), cls, still: [...still], pids })]);
  watcher.joined = () => {
    const [, before] = watcher.text().match(/^JOINED (\d+)$/m) ?? [];
    return before === undefined ? null : Number(before);
  };
  return watcher;
}

/**
 * Holds `count` slots of `cls` on the sandbox's table: one `throttle.mjs <cls> --wait 1` each, running a command that
 * keeps its grant until the file `release` exists, nine minutes at most. Resolves, once all hold, with the holders,
 * their `pids` (each the `throttle.mjs` process that holds the grant), `watch()` (the watcher for a run's request
 * behind them) and `releaseIn(seconds)`, which lets every holder go that many seconds on; a holder that got no grant
 * within two minutes is null.
 */
export async function holdStill(box, cls, count) {
  const release = join(box.dir, `release-${cls}`);
  const children = Array.from({ length: count }, (_, k) => launch(box, [process.execPath, THROTTLE, cls, '--wait', '1', '--', '/bin/sh', '-c',
    'echo "GRANTED $DEEP_THROTTLE"; i=0; while [ ! -e "$0" ] && [ "$i" -lt 2700 ]; do /bin/sleep 0.2; i=$((i+1)); done', release, `hold-3478-${k + 1}`]));
  const holders = await Promise.all(children.map(async (child) => ((await within(child.line(/^GRANTED \S+:\S+$/), 2)) ? child : null)));
  const pids = new Set(children.map((child) => child.pid));
  return {
    holders, pids,
    watch: () => watch(box, cls, pids),
    releaseIn: (seconds) => launch(box, ['/bin/sh', '-c', '/bin/sleep "$1"; : > "$0"', release, String(seconds)]),
  };
}
/** Holds every slot of `cls`: see holdStill. */
export const holdEvery = (box, cls) => holdStill(box, cls, SLOTS[cls]);

/**
 * A moving line of `cls` holders on the sandbox's table: every slot but one is held still, and the last changes hands
 * about every 2 s, with `ahead` holders waiting for it at every moment. Resolves, once a grant has changed hands, with
 * `pids()`, every holder's pid (each the `throttle.mjs` process that holds the grant), `watch()` (the watcher for a
 * run's request in this line) and `halt()`, after which the line adds no holder once it has moved for 40 s; or with
 * null when no grant changed hands within two minutes.
 */
export async function movingLine(box, cls, ahead) {
  const still = await holdStill(box, cls, SLOTS[cls] - 1);
  if (!still.holders.every(Boolean)) return null;
  const script = join(box.dir, `feeder-${cls}.mjs`), stop = join(box.dir, `feeder-${cls}.stop`), pids = join(box.dir, `feeder-${cls}.pids`);
  writeFileSync(script, FEEDER);
  const feeder = launch(box, [process.execPath, script, JSON.stringify({ throttle: THROTTLE, cls, ahead, hold: HOLD, least: 40_000, stop, granted: join(box.dir, `feeder-${cls}.granted`), pids })]);
  if (!await within(feeder.line(/^READY /), 2)) return null;
  return {
    pids: () => new Set([...still.pids, ...(existsSync(pids) ? readFileSync(pids, 'utf8').split('\n').filter(Boolean).map(Number) : [])]),
    watch: () => watch(box, cls, still.pids, pids),
    halt: () => writeFileSync(stop, ''),
  };
}

/** The log's top-level `granted` entries of `cls`. */
export const grants = (log, cls) => log.filter((entry) => entry.event === 'granted' && entry.class === cls && entry.grant === 'top-level');
/** The run's own top-level grant of `cls` in the log: the first that none of `others` (holders' pids) took. */
export const grantOf = (log, cls, others) => grants(log, cls).find((entry) => !others.has(entry.pid));

/** Everything a failure message shows: the run, the table's log and the planted tests' notes. */
export function evidence(result, run, box, fx) {
  const shown = result ? dump({ ...result, stdout: result.stdout.split('\n').filter((line) => !line.startsWith('TIMED ')).join('\n') }) : `still running\nstdout so far:\n${run.out().split('\n').filter((line) => !line.startsWith('TIMED ')).join('\n').slice(-3_000)}`;
  const log = throttleLog(box);
  // The grants and timeouts say who got what and when; the rest of a long log is its jobs' turns.
  const told = log.filter((entry) => entry.event === 'granted' || entry.event === 'timeout');
  // A lock still there when a run has failed its bound names a process that never gave it back (README: a table lock).
  const lock = existsSync(join(box.table, 'table.lock')) ? `\ntable.lock, still held: ${readFileSync(join(box.table, 'table.lock'), 'utf8')}` : '';
  return `${shown}${result ? '' : lock}\nthrottle log (${join(box.table, 'log')}), ${log.length} entries; its last ${Math.min(told.length, 30)} of ${told.length} granted and timeout entries:\n${show(told.slice(-30))}\nits last ${Math.min(log.length, 12)} entries:\n${show(log.slice(-12))}\nplanted tests' notes:\n${record(fx).map((entry) => JSON.stringify(entry)).join('\n')}`;
}
