// Helpers for #3334's acceptance tests: a throttle table of a test's own, holders that keep a line of build grants
// moving or hold one still, and the #1122 fixture far machine with an npm stand-in that says which grant it ran under.
// Nothing here imports the code under test: throttle.mjs and lane-remote.mjs are reached by running them, so a missing
// flag or a missing record reads as a failed assertion (README: The surfaces).
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
/** The stall bound every test asks for, in minutes, as the issue gives it: 3 s. */
export const STALL = '0.05';
/** A machine's build slots (docs/parallel-proof.md, section 6): one on the Mac, two on the Spark. */
export const SLOTS = process.platform === 'darwin' ? 1 : 2;
/** How long each holder of a moving line keeps its grant, in seconds: with the hand-over, about every 2 s. */
export const HOLD = '1.5';
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_LANE_REMOTE_STALL_MIN'];

/**
 * A sandbox removed after the test: a HOME and a throttle table of its own (DEEP_THROTTLE_TABLE), never the machine's.
 * Every process a test starts gets its own process group, stopped after the test by that group's PID.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3334-')));
  const box = { dir, home: join(dir, 'home'), table: join(dir, 'table'), children: [] };
  mkdirSync(box.home);
  mkdirSync(box.table);
  box.env = { ...process.env, HOME: box.home, XDG_CACHE_HOME: join(box.home, '.cache'), DEEP_THROTTLE_TABLE: box.table };
  for (const name of ENV_OUT.filter((name) => name !== 'DEEP_THROTTLE_TABLE')) delete box.env[name];
  t.after(() => {
    for (const child of box.children) stop(child);
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Stops a process this suite started, with everything in its group, by the group's PID. */
export function stop(child) {
  if (!Number.isInteger(child.pid) || child.pid <= 1) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

/**
 * Starts `argv` in its own process group. `done` resolves with its status and output once it exits; `line(re)`
 * resolves with the first line of its output that matches, or null when it exits without one.
 */
export function start(box, argv, { env = box.env, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  child.output = () => `stdout:\n${tail(stdout)}\nstderr:\n${tail(stderr, 1_500)}`;
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

const tail = (text, size = 4_000) => (text.length > size ? `…${text.slice(-size)}` : text);
export const lines = (text) => text.split('\n').map((line) => line.trimEnd()).filter(Boolean);

/** The table's log, one JSON object a line, from a table folder. */
export function tableLog(folder) {
  const file = join(folder, 'log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { unparsed: line }; }
  });
}
export const grantsIn = (folder) => tableLog(folder).filter((entry) => entry.event === 'granted' && entry.class === 'build');
export const showLog = (folder) => `log (${folder}):\n${tableLog(folder).map((entry) => JSON.stringify(entry)).join('\n')}`;

// A line of build requests that keeps moving (README: The moving line). It keeps `ahead` holders in line, each a
// `throttle.mjs build --wait 10` whose command notes its grant and holds it HOLD seconds. It prints `READY` once a
// grant has changed hands, and stops adding holders once `runFor` ms have passed since its first grant, or once the
// file `stop` exists; then it lets its holders drain and prints `DONE`. It gives up adding after 15 minutes.
const FEEDER = `import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const { throttle, ahead, slots, hold, runFor, stop, granted } = JSON.parse(process.argv[2]);
let started = 0, first = null, ready = false, feeding = true;
const born = Date.now(), ends = [];
const count = () => (existsSync(granted) ? readFileSync(granted, 'utf8').split('\\n').filter(Boolean).length : 0);
const add = () => {
  started++;
  const holder = spawn(process.execPath, [throttle, 'build', '--wait', '10', '--', '/bin/sh', '-c', 'echo "$DEEP_THROTTLE" >> "$0"; exec /bin/sleep ' + hold, granted], { stdio: 'ignore' });
  ends.push(new Promise((done) => holder.on('close', (status) => done(status))));
};
const timer = setInterval(() => {
  const now = Date.now(), seen = count();
  if (seen && first === null) first = now;
  if (!ready && seen > slots) { ready = true; console.log('READY ' + seen); }
  if (feeding && ((runFor && first !== null && now - first > runFor) || (stop && existsSync(stop)) || now - born > 900000)) {
    feeding = false;
    clearInterval(timer);
    Promise.all(ends).then((codes) => console.log('DONE ' + JSON.stringify({ started, granted: count(), codes })));
    return;
  }
  while (feeding && started - seen < ahead) add();
}, 100);
`;

/**
 * Starts a moving line on the table folder `table` (with `home` as HOME): see FEEDER. `granted` lists the grants its
 * holders took, one `build:<id>` a line.
 */
export function movingLine(box, { table, home, runFor = 0, stop: stopFile = null, ahead = 6 * SLOTS }) {
  const script = join(box.dir, 'feeder.mjs');
  writeFileSync(script, FEEDER);
  const granted = join(box.dir, `granted-${box.children.length}`);
  const env = { ...box.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), DEEP_THROTTLE_TABLE: table };
  const feeder = start(box, [process.execPath, script, JSON.stringify({ throttle: THROTTLE, ahead, slots: SLOTS, hold: HOLD, runFor, stop: stopFile, granted })], { env });
  feeder.granted = () => (existsSync(granted) ? lines(readFileSync(granted, 'utf8')) : []);
  return feeder;
}

/**
 * Holds every build slot of the table folder `table` still: SLOTS holders, `throttle.mjs build --wait 10`, each
 * running a command named `hold-3334-<k>` that prints `GRANTED <token>` and sleeps ten minutes. Resolves with each
 * holder's pid, grant id and name once all hold, or with null for one that never got its grant.
 */
export async function stillLine(box, { table, home }) {
  const env = { ...box.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), DEEP_THROTTLE_TABLE: table };
  const holders = Array.from({ length: SLOTS }, (_, k) => {
    const name = `hold-3334-${k + 1}`;
    const child = start(box, [process.execPath, THROTTLE, 'build', '--wait', '10', '--', '/bin/sh', '-c', 'echo "GRANTED $DEEP_THROTTLE"; exec /bin/sleep 600', name], { env });
    return { child, name };
  });
  return Promise.all(holders.map(async ({ child, name }) => {
    const line = await within(child.line(/^GRANTED build:\S+$/), 2);
    return line ? { pid: child.pid, id: line.slice('GRANTED build:'.length), name, child } : null;
  }));
}

/** `throttle.mjs build --stall <STALL> -- <writes the file ran>` on the sandbox's table: the request under test. */
export function stallRequest(box) {
  const ran = join(box.dir, 'ran-3334');
  const child = start(box, [process.execPath, THROTTLE, 'build', '--stall', STALL, '--', '/bin/sh', '-c', 'echo "$DEEP_THROTTLE" > "$0"; echo COMMAND-RAN-3334', ran]);
  child.ran = () => (existsSync(ran) ? readFileSync(ran, 'utf8').trim() : null);
  return child;
}

/**
 * The #1122 fixture far machine, made ready for these tests: its npm stand-in, kept, is wrapped by one that notes the
 * grant each call ran under (`$DEEP_THROTTLE`), writes `<log>/npm-ci-ran` once `npm ci` starts, and fails `npm ci`
 * (exit 1) when the far HOME holds `.npm-ci-fails-3334`. The far machine's login profile sets
 * DEEP_LANE_REMOTE_STALL_MIN to the stall bound, as a test's settings on the Spark would; the session's machine sets
 * it too. Returns the far machine's throttle table folder, which its HOME decides inside a test run.
 */
export function readyFar(box) {
  const farBin = join(box.dir, 'far-bin');
  renameSync(join(farBin, 'npm'), join(farBin, 'npm-1122'));
  writeFileSync(join(farBin, 'npm'), `#!/bin/sh
printf '%s\\t%s\\t%s\\n' "\${DEEP_THROTTLE:-none}" "$PWD" "$*" >> "$T1122_LOG/npm-3334"
if [ "$1" = ci ]; then
  : > "$T1122_LOG/npm-ci-ran"
  if [ -e "$HOME/.npm-ci-fails-3334" ]; then echo "npm ERR! the fixture's npm ci fails" >&2; exit 1; fi
fi
exec "$(dirname "$0")/npm-1122" "$@"
`);
  chmodSync(join(farBin, 'npm'), 0o755);
  for (const profile of ['.bash_profile', '.profile']) writeFileSync(join(box.far, profile), `export DEEP_LANE_REMOTE_STALL_MIN=${STALL}\n`);
  box.env.DEEP_LANE_REMOTE_STALL_MIN = STALL;
  const table = join(box.far, '.deepbuild', 'throttle');
  mkdirSync(table, { recursive: true });
  return table;
}

/** The npm calls the far machine made: `{ grant, cwd, args }`. */
export function npmCalls(box) {
  const file = join(box.log, 'npm-3334');
  return existsSync(file) ? lines(readFileSync(file, 'utf8')).map((line) => {
    const [grant, cwd, args] = line.split('\t');
    return { grant, cwd, args };
  }) : [];
}
