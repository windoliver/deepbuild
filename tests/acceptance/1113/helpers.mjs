// Helpers for #1113's acceptance tests: a sandboxed HOME (so the lock table is never the real
// ~/.deepbuild/throttle/), stub holders that record when they start and end, the throttle log, and scratch
// copies for the measured runs and the proof lanes. Nothing here imports the code under test: every surface
// is reached by running it (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const MAC = process.platform === 'darwin';
// Section 6's table: the Mac's limits on macOS, the Spark's elsewhere.
export const LIMIT = { build: MAC ? 1 : 2, 'bay-pair': MAC ? 1 : 3, test: MAC ? 2 : 4, timed: 1 };
export const CORES = cpus().length;

// A stub holder: node stub.mjs '<json spec>'. It appends {name, event, t, throttle, pid} lines to
// $T1113_EVENTS: `start`, then for each nested request `request` and `granted`/`returned`, then `end` after
// holding for spec.hold ms, and exits with spec.exit. A nested request runs throttle.mjs as a child.
const STUB = `import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const spec = JSON.parse(process.argv[2]);
const note = (event, extra = {}) => appendFileSync(process.env.T1113_EVENTS, JSON.stringify({ name: spec.name, event, t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid, ...extra }) + '\\n');
note('start');
if (spec.burn) { const until = Date.now() + spec.burn; while (Date.now() < until); }
for (const [i, nested] of (spec.then ?? []).entries()) {
  if (nested.delay) await new Promise((done) => setTimeout(done, nested.delay));
  note('request', { index: i, class: nested.class });
  const run = spawnSync(process.execPath, [process.env.T1113_THROTTLE, nested.class, '--wait', String(nested.wait), '--', process.execPath, process.argv[1], JSON.stringify(nested.child)], { encoding: 'utf8' });
  note('returned', { index: i, status: run.status, signal: run.signal, out: (run.stdout ?? '') + (run.stderr ?? '') });
}
await new Promise((done) => setTimeout(done, spec.hold ?? 0));
note('end');
process.exit(spec.exit ?? 0);
`;

/** A sandbox removed after the test, with its own HOME, cache and events file; every process it started is stopped. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1113-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), T1113_EVENTS: join(dir, 'events.jsonl'), T1113_THROTTLE: THROTTLE };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR']) delete env[name];
  const box = { dir, home, env, stub: join(dir, 'stub.mjs'), children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Starts `argv` in the sandbox in its own process group; `done` resolves with its status, output and end time. */
export function launch(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const started = Date.now();
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr, started, ended: Date.now() })));
  return child;
}

/** `throttle.mjs <class> --wait <min> -- node stub.mjs <spec>` as a top-level request from the test. */
export const hold = (box, kind, wait, spec, env = {}) => launch(box, [process.execPath, THROTTLE, kind, '--wait', String(wait), '--', process.execPath, box.stub, JSON.stringify(spec)], { env });

export function events(box) {
  const file = box.env.T1113_EVENTS;
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
export const event = (box, name, kind) => events(box).find((e) => e.name === name && e.event === kind);

/** Polls until `predicate` holds or `ms` pass; returns whether it held. */
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Waits for stub `name` to start, failing at the assertion when it doesn't within `ms`. */
export async function started(box, name, ms = 10_000) {
  assert.ok(await until(() => event(box, name, 'start'), ms), `${name} never started under the throttle\n${dump(box)}`);
  return event(box, name, 'start');
}

export const dump = (box, ...runs) => [
  `events:\n${events(box).map((e) => JSON.stringify(e)).join('\n')}`,
  `log:\n${logText(box)}`,
  ...runs.map((run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`),
].join('\n');

/**
 * The throttle log: every line of each file under ~/.deepbuild/throttle/ whose name holds "log", parsed as a JSON
 * object or as `key=value` tokens. A grant's line has class, grant (top-level or nested), load and wait.
 */
export function logLines(box) {
  const folder = join(box.home, '.deepbuild', 'throttle');
  if (!existsSync(folder)) return [];
  const lines = [];
  for (const name of readdirSync(folder).filter((n) => /log/i.test(n) && statSync(join(folder, n)).isFile())) {
    for (const text of readFileSync(join(folder, name), 'utf8').split('\n').filter((line) => line.trim())) {
      let fields = null;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') fields = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
      } catch {}
      fields ??= Object.fromEntries([...text.matchAll(/(\w[\w-]*)=(\S+)/g)].map(([, k, v]) => [k, v]));
      lines.push({ ...fields, text });
    }
  }
  return lines.filter((line) => line.class);
}
const logText = (box) => logLines(box).map(({ text }) => text).join('\n');
export const grants = (box, kind) => logLines(box).filter((line) => line.class === kind);
export const topLevel = (line) => line.grant === 'top-level';

/** A copy of this checkout's scripts/ in a fresh git repository, with origin/main at its one commit. */
export function scratchRepo(box, { files = {}, untracked = {} } = {}) {
  const repo = join(box.dir, 'repo');
  mkdirSync(repo);
  cpSync(join(CHECKOUT, 'scripts'), join(repo, 'scripts'), { recursive: true });
  write(repo, files);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, '.git/info/exclude'), `${Object.keys(untracked).join('\n')}\n`);
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(repo, untracked);
  return repo;
}
export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

// The measured runs' fixture (README: Preflight and perf). The check workload is a stub that burns a little
// CPU and notes when it started; npm and cargo, which the warm-up builds call, are stubs that exit 0; the budget
// file is outside git, so perf has no merge-base budget and compares nothing it would have to build.
const CHECKS = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.T1113_EVENTS, JSON.stringify({ name: 'checks', event: 'start', t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid }) + '\\n');
const until = Date.now() + 300; let x = 0; while (Date.now() < until) x++;
console.log('PASS stub checks');
`;
export const BUDGETS = JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 900000 }, initialReason: 'Fixture for #1113: a stub workload.' }, tasks: [] }, null, 2);
export function measuredRepo(box) {
  const repo = scratchRepo(box, { files: { 'scripts/checks.mjs': CHECKS }, untracked: { 'benchmarks/budgets.json': BUDGETS } });
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  for (const tool of ['npm', 'cargo']) {
    writeFileSync(join(bin, tool), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, tool), 0o755);
  }
  return { repo, env: { PATH: `${bin}${delimiter}${box.env.PATH}`, RUSTUP_HOME: join(box.home, '.rustup'), CARGO_HOME: join(box.home, '.cargo') } };
}

/** The seconds a preflight prints in `Checks elapsed: X s …; preflight elapsed: Y s`. */
export function preflightSeconds(stdout) {
  const match = stdout.match(/Checks elapsed: ([\d.]+) s.*preflight elapsed: ([\d.]+) s/);
  return match && { checks: Number(match[1]), preflight: Number(match[2]) };
}

export const node = (args, options) => spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...options });
