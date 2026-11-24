// #3163: on PR #3093's branch, in a fresh GitHub clone with npm ci, `node scripts/proof.mjs guard` finishes in under
// 60 s wall and starts no more than 200 git processes (criterion 1), and prints the same verdict lines and exit code as
// before the change (criterion 2). One guard run is judged by both tests (README).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
// The program under test: this checkout's scripts/, or another copy's (such as the base's, exported) named here.
const SCRIPTS = resolve(process.env.DEEP_3163_SCRIPTS ?? join(CHECKOUT, 'scripts'));
const PRELOAD = fileURLToPath(new URL('./count-git.mjs', import.meta.url));
const GIT = '/usr/bin/git';
const REPO = 'https://github.com/windoliver/deepbuild.git';
// The change the issue names: PR #3093's head and its merge base.
const HEAD = 'd00a54048';
const MERGE_BASE = '11eb8c6fd';
const COMMITS = 2;
// The limits criterion 1 states, and how long criterion 2 waits for a verdict (it states no limit of its own).
const WALL_LIMIT_S = 60;
const GIT_LIMIT = 200;
const VERDICT_WAIT_S = 300;
// The verdict before the change, as the issue states it (the base's guard there takes about an hour).
const BEFORE_LINES = ['PASS guard: 2 commits checked: no guarded edit lacks its own approved proposal'];
const BEFORE_EXIT = 0;

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3163-')));
const children = [];
after(() => {
  // Only the processes this suite started, by their process group's PID.
  for (const child of children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  rmSync(dir, { recursive: true, force: true });
});

const load = () => `${loadavg().map((value) => value.toFixed(2)).join(' ')} (1, 5, 15 min; ${cpus().length} cores)`;

function run(argv, { cwd, env = process.env, limitMs }) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const started = Date.now();
  const done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, ms: Date.now() - started })));
  const timer = limitMs && setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, limitMs);
  done.then(() => clearTimeout(timer));
  return { child, started, done, out: () => ({ stdout, stderr }) };
}

async function setup(argv, cwd, limitMs = 300_000) {
  const { done, out } = run(argv, { cwd, limitMs, env: { ...process.env, PATH: `/usr/bin:${process.env.PATH}`, GIT_TERMINAL_PROMPT: '0' } });
  const { status, signal, ms } = await done;
  const { stdout, stderr } = out();
  if (status !== 0) throw new Error(`setup: ${argv.join(' ')} exited ${status}${signal ? ` (${signal})` : ''} after ${(ms / 1000).toFixed(1)} s\n${stdout}\n${stderr}`);
  return stdout.trim();
}

// The judged clone and the guard's one run on it, started once for both tests.
let judged;
function judge() {
  judged ??= (async () => {
    const clone = join(dir, 'clone');
    const git = (...args) => setup([GIT, ...args], clone);
    await setup([GIT, 'clone', '-q', '--no-checkout', REPO, clone], dir, 400_000);
    await git('fetch', '-q', 'origin', 'pull/3093/head');
    const head = await git('rev-parse', 'FETCH_HEAD');
    if (!head.startsWith(HEAD)) throw new Error(`setup: PR #3093's head on GitHub is ${head}, not ${HEAD}, the change the issue names`);
    await git('checkout', '-q', '-b', 'pr-3093', head);
    // PR #3093 has landed, so origin/main now holds its commits; main as the PR saw it is its merge base.
    await git('update-ref', 'refs/remotes/origin/main', await git('rev-parse', `${MERGE_BASE}^{commit}`));
    const base = await git('merge-base', 'HEAD', 'origin/main');
    if (!base.startsWith(MERGE_BASE)) throw new Error(`setup: the clone's merge base is ${base}, not ${MERGE_BASE}`);
    const count = Number(await git('rev-list', '--count', 'HEAD', '^origin/main'));
    if (count !== COMMITS) throw new Error(`setup: the clone's change has ${count} commits, not ${COMMITS}`);
    await setup([join(dirname(process.execPath), 'npm'), 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], clone);
    const status = await git('status', '--porcelain');
    if (status) throw new Error(`setup: the judged clone has uncommitted changes after npm ci:\n${status}`);

    // The program under test sits outside the clone, so it is no change of the clone's: its scripts/ and package.json
    // beside a node_modules that is the clone's install.
    const program = join(dir, 'program');
    mkdirSync(program);
    cpSync(SCRIPTS, join(program, 'scripts'), { recursive: true });
    if (existsSync(join(dirname(SCRIPTS), 'package.json'))) copyFileSync(join(dirname(SCRIPTS), 'package.json'), join(program, 'package.json'));
    symlinkSync(join(clone, 'node_modules'), join(program, 'node_modules'));

    const log = join(dir, 'git-starts.log');
    writeFileSync(log, '');
    const env = { ...process.env, PATH: `/usr/bin:${process.env.PATH}`, DEEP_3163_GIT_LOG: log, NODE_OPTIONS: `--import=${pathToFileURL(PRELOAD).href}` };
    for (const name of ['DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_BIN_DIR']) delete env[name];
    const startLoad = load();
    console.log(`load at start: ${startLoad}`);
    const guard = run([process.execPath, join(program, 'scripts/proof.mjs'), 'guard'], { cwd: clone, env, limitMs: VERDICT_WAIT_S * 1000 });
    const starts = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
    let endLoad;
    guard.done.then(() => { endLoad = load(); console.log(`load at end: ${endLoad}`); });
    return { guard, starts, startLoad, endLoad: () => endLoad ?? `${load()} (the guard still running)` };
  })();
  return judged;
}

const report = ({ guard, startLoad, endLoad }, result, starts) => {
  const { stdout, stderr } = guard.out();
  return `${result ? `exit ${result.status}${result.signal ? ` (${result.signal})` : ''} after ${(result.ms / 1000).toFixed(1)} s` : 'still running'}; ${starts} git processes started\nload at start: ${startLoad}\nload at end: ${endLoad()}\nstdout:\n${stdout}\nstderr:\n${stderr.slice(-4000)}`;
};

test('#3163.9c395067 on PR #3093\'s branch in a fresh GitHub clone with npm ci, node scripts/proof.mjs guard finishes in under 60 s wall, with the load at start and end recorded, and starts no more than 200 git processes', async () => {
  const box = await judge();
  // Wait up to the limit, then read where the run stands: finished or not, and its git processes so far.
  const result = await Promise.race([box.guard.done, new Promise((resolve) => setTimeout(resolve, Math.max(0, box.guard.started + WALL_LIMIT_S * 1000 - Date.now()), null))]);
  const starts = box.starts();
  const exceeded = [];
  if (!result || result.signal || result.ms >= WALL_LIMIT_S * 1000) exceeded.push(result && !result.signal ? `the 60 s wall limit: it took ${(result.ms / 1000).toFixed(1)} s` : `the 60 s wall limit: it had not finished after ${WALL_LIMIT_S} s`);
  if (starts > GIT_LIMIT) exceeded.push(`the 200 git process limit: it started ${starts}${result ? '' : ` in its first ${WALL_LIMIT_S} s`}`);
  console.log(`criterion 1: ${result ? `finished in ${(result.ms / 1000).toFixed(1)} s` : `not finished at ${WALL_LIMIT_S} s`}, ${starts} git processes; load at start ${box.startLoad}; load ${result ? 'at end' : 'now'} ${box.endLoad()}`);
  assert.deepEqual(exceeded, [], `node scripts/proof.mjs guard exceeded ${exceeded.join(', and ')}\n${report(box, result, starts)}`);
});

test('#3163.d0eabe65 on that same clone and commit, node scripts/proof.mjs guard prints the same verdict lines as before the change, ignoring the proof: wall time line, and exits with the same code', async () => {
  const box = await judge();
  const result = await box.guard.done;
  const starts = box.starts();
  assert.ok(!result.signal, `node scripts/proof.mjs guard printed no verdict: it was stopped after ${VERDICT_WAIT_S} s, the longest this test waits\n${report(box, result, starts)}`);
  const lines = box.guard.out().stdout.split('\n').filter((line) => line.trim() && !line.startsWith('proof: wall time'));
  assert.deepEqual(lines, BEFORE_LINES, `the guard's verdict lines differ from before the change\n${report(box, result, starts)}`);
  assert.equal(result.status, BEFORE_EXIT, `the guard's exit code differs from before the change\n${report(box, result, starts)}`);
});
