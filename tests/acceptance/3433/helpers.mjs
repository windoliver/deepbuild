// Test-side tools for #3433's acceptance tests (README). A test here starts its own processes, reads their PIDs from
// files of its own, and stops only those PIDs, each checked against the start ps gave it when it was first seen: never
// a PID of 1 or less, never by name or port. The code under test is reached through the surfaces the issue names:
// `measureOnce` from scripts/benchmark.mjs, `node scripts/perf.mjs` in a fixture repository, and `runLanes` from
// scripts/lanes.mjs in a child node process of the test's own, with its record under a HOME of the test's own.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The checkout root (tests/acceptance/3433 is three levels down): a twin's product file stands in it. */
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

/** ps's start time of a PID, the same way for every reader; null once no process holds the number. */
export function startOf(pid) {
  const listing = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  const start = listing.stdout.trim();
  return listing.status === 0 && start ? start : null;
}
/** Whether the process seen as `{ pid, start }` is still alive: the number is held, by a process of the same start. */
export const alive = ({ pid, start }) => start !== null && startOf(pid) === start;
/** ps's command line of a PID, for the failure messages. */
export const commandOf = (pid) => spawnSync('ps', ['-ww', '-o', 'args=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).stdout.trim();

/**
 * A sandbox folder of the test's own, and a list of the processes the test started (`seen`). After the test, each of
 * them still alive with the start it had is SIGKILLed by its PID, and the folder removed.
 */
export function sandbox(t, name) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-3433-${name}-`)));
  const seen = [];
  t.after(() => {
    for (const proc of seen) if (proc.pid > 1 && alive(proc)) try { process.kill(proc.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, seen };
}

/**
 * The processes a fixture recorded in its pid file, one `<role> <pid>` line each, as `{ role, pid, start }`, each added
 * to the sandbox's `seen` the first time it is read. Only real PIDs (over 1): a 0 or negative one would make a kill
 * reach a process group.
 */
export function recorded(box, file) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const line of text.split('\n')) {
    const [, role, number] = line.match(/^(\S+) (\d+)$/) ?? [];
    const pid = Number(number);
    if (!role || !Number.isSafeInteger(pid) || pid <= 1 || box.seen.some((proc) => proc.pid === pid && proc.role === role)) continue;
    // A process already gone when first read keeps its PID, for the names a test looks for, and reads as not alive.
    box.seen.push({ role, pid, start: startOf(pid) });
  }
  return box.seen.filter((proc) => proc.role !== 'lanes');
}

/** Waits until `ready()` is true or `ms` passed; resolves to whether it became true. */
export async function until(ready, ms, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    if (ready()) return true;
    if (Date.now() > end) return false;
    // deadline: spaces the polls of a wait for an observed condition, bounded by `ms`.
    await new Promise((done) => setTimeout(done, step));
  }
}

/** The grandchild every fixture starts: it records its PID and waits forever. */
export const GRANDCHILD = 'grandchild-3433.mjs';
/**
 * Writes the fixture scripts into `dir`: the grandchild, and a lead that records its PID, starts the grandchild in a
 * process group of its own (`detached: true`, no stdio of the run's), and waits forever. Both take their pid file as
 * their first argument. Returns their paths.
 */
export function fixtureScripts(dir) {
  const grandchild = join(dir, GRANDCHILD), lead = join(dir, 'lead-3433.mjs');
  writeFileSync(grandchild, "import { appendFileSync } from 'node:fs';\nappendFileSync(process.argv[2], `grandchild ${process.pid}\\n`);\nsetInterval(() => {}, 1000);\n");
  writeFileSync(lead, `import { spawn } from 'node:child_process';\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.argv[2], \`lead \${process.pid}\\n\`);\nspawn(process.execPath, [${JSON.stringify(grandchild)}, process.argv[2]], { detached: true, stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n`);
  return { grandchild, lead };
}

/**
 * Whether `text` names a process by PID and command: one of its lines holds the PID as a whole number and `word`, a
 * piece of the process's command line (its script's file name).
 */
export const names = (text, pid, word) => String(text).split('\n').some((line) => new RegExp(`(?<!\\d)${pid}(?!\\d)`).test(line) && line.includes(word));

/** An environment for a run of the test's own: no grant, report, lock or test context of the caller's passes on. */
export function ownEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of ['DEEP_THROTTLE', 'DEEP_PROOF_VITEST_REPORT', 'NODE_TEST_CONTEXT', 'DEEP_PERF_LOCK', 'DEEP_BIN_DIR', 'DEEP_OPEN_ISSUES', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[key];
  return env;
}

export const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: ownEnv(), encoding: 'utf8' });

/** The lane every lane test runs: one `node --test` command on the fixture repository's one test file. */
export const LANE = 'stop-3433';
export const TEST_FILE = 'tests/fixture-3433.test.mjs';

/**
 * A lane fixture: a git repository holding one node test file (`body`, the test's code, with `pids` and
 * `grandchild` in scope), a HOME and a throttle table of the test's own. Every file the run writes is outside the
 * repository, so the run never changes the tree it started on.
 */
export function laneFixture(box, body) {
  const repo = join(box.dir, 'repo'), home = join(box.dir, 'home'), table = join(box.dir, 'table'), pids = join(box.dir, 'pids');
  for (const folder of [repo, home, table, join(repo, 'tests')]) mkdirSync(folder, { recursive: true });
  const { grandchild } = fixtureScripts(box.dir);
  writeFileSync(join(repo, TEST_FILE), `import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import test from 'node:test';
const pids = ${JSON.stringify(pids)}, grandchild = ${JSON.stringify(grandchild)};
${body}
`);
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'the tree the lane runs on');
  return { repo, home, table, pids };
}

/** A fixture test that records its PID and its runner's, starts the grandchild in a group of its own, and waits forever. */
export const HANGS = `test('the lane command starts a grandchild in a group of its own and waits', async () => {
  appendFileSync(pids, \`runner \${process.ppid}\\nfile \${process.pid}\\n\`);
  spawn(process.execPath, [grandchild, pids], { detached: true, stdio: 'ignore' });
  await new Promise(() => setInterval(() => {}, 1000));
});`;
/** A fixture test that ends by itself, passing, after 2 s: long enough for the test to see the run's tree. */
export const ENDS = `test('the lane command ends by itself', async () => {
  appendFileSync(pids, \`runner \${process.ppid}\\nfile \${process.pid}\\n\`);
  await new Promise((done) => setTimeout(done, 2000));
});`;

/**
 * Starts the lane in a child node process that leads a process group the test made (`detached: true`): the process
 * imports the checkout's scripts/lanes.mjs and runs `runLanes` on the fixture's lane, as scripts/checks.mjs runs a
 * lane, under the fixture's HOME and throttle table. Returns the child, its output so far and its exit.
 */
export function startLane(box, fixture) {
  const code = `const { runLanes } = await import(${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)});
process.exitCode = runLanes([{ name: ${JSON.stringify(LANE)}, commands: [[process.execPath, '--test', ${JSON.stringify(TEST_FILE)}]], fix: 'none' }], { cwd: process.cwd() });`;
  const env = ownEnv({
    HOME: fixture.home,
    DEEP_THROTTLE_TABLE: fixture.table,
    DEEP_LEASE_WAIT: '1',
    // No `deep` of the machine's: the lease runs the command under the grant alone, or the copy's built CLI.
    PATH: [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
  });
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: fixture.repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const lane = { child, output: '', exit: null };
  child.stdout.on('data', (chunk) => { lane.output += chunk; });
  child.stderr.on('data', (chunk) => { lane.output += chunk; });
  lane.ended = new Promise((done) => child.on('exit', (code, signal) => done((lane.exit = { code, signal }))));
  if (child.pid > 1) {
    const start = startOf(child.pid);
    if (start) box.seen.push({ role: 'lanes', pid: child.pid, start });
  }
  return lane;
}

/** The lane's records under the fixture's HOME: `{ file, record }` each, the record null when it isn't JSON. */
export function laneRecords(fixture) {
  const folder = join(fixture.home, '.deepbuild', 'lanes');
  return (existsSync(folder) ? readdirSync(folder) : []).filter((name) => name.endsWith(`-${LANE}.json`)).map((name) => {
    let record = null;
    try { record = JSON.parse(readFileSync(join(folder, name), 'utf8')); } catch {}
    return { file: name, record };
  });
}

/**
 * Every process under `pid` now, by PID and start, from one `ps` listing: the test's own view of a run's tree, so it
 * can see what was left after the run. Only reads; it signals nothing.
 */
export function treeOf(pid) {
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,lstart='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  const procs = new Map();
  for (const line of listing.stdout.split('\n')) {
    const [, at, parent, start] = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/) ?? [];
    if (at) procs.set(Number(at), { ppid: Number(parent), start });
  }
  const under = (at) => {
    for (let seen = 0, up = procs.get(at)?.ppid; up !== undefined && seen < 64; up = procs.get(up)?.ppid, seen++) if (up === pid) return true;
    return false;
  };
  return [...procs].filter(([at]) => under(at)).map(([at, { start }]) => ({ pid: at, start }));
}

/**
 * A lane run whose command starts a grandchild in a group of its own and waits, stopped by `stop(lanes pid)` once the
 * grandchild has run 6 s (README: Assumptions). Returns the processes the command started (the node --test runner, its
 * test file's process and the grandchild), those still alive 15 s after the stop, and the lane's records once one is
 * written or 30 s after the stop.
 */
export async function stoppedLane(t, name, stop) {
  const box = sandbox(t, name);
  const fixture = laneFixture(box, HANGS);
  const lane = startLane(box, fixture);
  const up = await until(() => recorded(box, fixture.pids).some(({ role }) => role === 'grandchild') || lane.exit !== null, 120_000);
  // deadline: the window the stop's listing gets to see the running grandchild before the stop (README: Assumptions 4).
  await new Promise((done) => setTimeout(done, 6_000));
  const procs = recorded(box, fixture.pids);
  const ready = up && lane.exit === null && ['runner', 'file', 'grandchild'].every((role) => procs.some((proc) => proc.role === role && alive(proc)));
  if (!ready) return { ready, lane, fixture, procs, left: procs.filter(alive), records: laneRecords(fixture) };
  const stoppedAt = Date.now();
  stop(lane.child.pid);
  await until(() => !procs.some(alive), 15_000, 100);
  const left = procs.filter(alive);
  await until(() => laneRecords(fixture).length > 0, Math.max(0, stoppedAt + 30_000 - Date.now()), 200);
  return { ready, lane, fixture, procs, left, records: laneRecords(fixture) };
}

/** What a test prints on a failure: the lane's output, its exit, its records and the recorded processes. */
export function dump(lane, fixture, procs) {
  return `exit: ${JSON.stringify(lane.exit)}\noutput:\n${lane.output}\nrecords: ${JSON.stringify(laneRecords(fixture), null, 2)}\nprocesses: ${JSON.stringify(procs.map((proc) => ({ ...proc, alive: alive(proc), command: alive(proc) ? commandOf(proc.pid) : undefined })))}`;
}
