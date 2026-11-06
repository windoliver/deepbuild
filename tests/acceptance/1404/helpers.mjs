// Shared by the #1404 acceptance tests. The code is reached only through what the README names: the
// exports of scripts/benchmark.mjs and `node scripts/perf.mjs '<observation>'` run as a process in a
// scratch git repository whose merge base already has the measured budgets.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const source = fileURLToPath(new URL('fixtures/spin.c', import.meta.url));
export const show = (result) => `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
export const millions = (count) => (typeof count === 'number' ? `${(count / 1e6).toFixed(0)} M` : JSON.stringify(count));
export const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// The exports, imported per test so a base without one fails each test by name.
export async function benchmark(...names) {
  const module = await import(pathToFileURL(join(root, 'scripts/benchmark.mjs')).href);
  for (const name of names) assert.equal(typeof module[name], 'function', `scripts/benchmark.mjs exports no ${name}()`);
  return module;
}

export function macOnly() {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: the counter is read from macOS\'s /usr/bin/time -l, and a child retires nothing this test can read here');
}

// A scope a file's scratch directories live in: removed after its last test.
export function fileScope() {
  const cleanups = [];
  after(() => { for (const cleanup of cleanups) cleanup(); });
  return { after: (cleanup) => cleanups.push(cleanup) };
}

export function scratch(scope, prefix = 'deep-perf-1404-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scope.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

// The planted child, built here: an ordinary user binary, as a budget's Rust binaries are, and not a
// platform binary like /usr/bin/awk, which macOS shields from what a user process can inject.
export function buildSpin(directory) {
  const binary = join(directory, 'spin');
  execFileSync('cc', ['-O0', '-o', binary, source], { stdio: ['ignore', 'pipe', 'pipe'] });
  return binary;
}

// This test's own reading of the real counter, apart from the code: /usr/bin/time -l's "instructions
// retired" line, the median of three runs.
export function counted(argv, cwd) {
  const counts = Array.from({ length: 3 }, () => {
    const result = spawnSync('/usr/bin/time', ['-l', ...argv], { cwd, encoding: 'utf8' });
    const count = Number(result.stderr.match(/^\s*(\d+)\s+instructions retired\s*$/m)?.[1]);
    if (!Number.isSafeInteger(count) || count <= 0) assert.fail(`BLOCKED: this Mac's /usr/bin/time -l reports no instructions retired, so no planted child can be measured:\n${result.stderr}`);
    return count;
  });
  return median(counts);
}

// Node wrappers, one per way the budgets' benches start a child. Each hands back the child's own
// answer and exits non-zero without it, as a bench that parses its child's output does. Each reads the
// child and its iterations at run time, so two sides' wrappers are the same bytes, as a frozen budget's
// is: what differs is the child's work.
const prelude = `import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const { binary, iterations } = JSON.parse(readFileSync(new URL('child.json', import.meta.url), 'utf8'));
`;
export const wrappers = {
  // benchmarks/canvas.mjs's form.
  spawnSync: `${prelude}const out = spawnSync(binary, [String(iterations)], { input: '', encoding: 'utf8' });
if (out.status !== 0 || out.stdout !== 'spun ' + iterations + '\\n') process.exit(9);
`,
  // The hub, MCP and inbox benches' form: the child runs while the wrapper's event loop waits on it.
  spawn: `${prelude}const child = spawn(binary, [String(iterations)], { stdio: ['ignore', 'pipe', 'inherit'] });
let stdout = '';
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.on('close', (code) => { if (code !== 0 || stdout !== 'spun ' + iterations + '\\n') process.exitCode = 9; });
`,
  execFileSync: `${prelude}if (execFileSync(binary, [String(iterations)], { encoding: 'utf8' }) !== 'spun ' + iterations + '\\n') process.exit(9);
`,
};
// A child that is itself Node and waits for the binary, as a bench that drives a Node service does.
export const chained = `import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const out = spawnSync('node', [fileURLToPath(new URL('wrap-inner.mjs', import.meta.url))], { encoding: 'utf8' });
process.exit(out.status ?? 9);
`;

// A bench directory: the wrapper, and what its child is to do. The budget's command is `node wrap.mjs`
// in it, frozen, on both sides.
export function plantBench(directory, binary, iterations, wrapper = wrappers.spawnSync, files = {}) {
  write(directory, { 'wrap.mjs': wrapper, 'child.json': JSON.stringify({ binary, iterations }), ...files });
  return directory;
}
export const WRAPPER_COMMAND = ['node', 'wrap.mjs'];

// Stands in for a host whose /usr/bin/time reports no instructions retired: it runs the real one and
// drops the counter's two lines from its report, wherever the report went (-o file or stderr).
const NO_COUNTER_TIME = `#!/bin/sh
out=
prev=
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then out=$arg; fi
  prev=$arg
done
err=$(mktemp)
/usr/bin/time "$@" 2>"$err"
status=$?
grep -v -e 'instructions retired' -e 'cycles elapsed' "$err" >&2
rm -f "$err"
if [ -n "$out" ] && [ -f "$out" ]; then
  grep -v -e 'instructions retired' -e 'cycles elapsed' "$out" > "$out.kept"
  mv "$out.kept" "$out"
fi
exit $status
`;

// Points every /usr/bin/time in the copy's scripts at the stand-in, wherever the code keeps it.
function plantNoCounter(box, cwd) {
  const shim = join(box, 'bin', 'time');
  write(box, { 'bin/time': NO_COUNTER_TIME });
  chmodSync(shim, 0o755);
  let planted = 0;
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) { visit(path); continue; }
      const text = readFileSync(path, 'latin1');
      if (!text.includes('/usr/bin/time')) continue;
      writeFileSync(path, text.replaceAll('/usr/bin/time', shim), 'latin1');
      planted++;
    }
  };
  visit(join(cwd, 'scripts'));
  assert.ok(planted, 'cannot plant a host without the counter: nothing under scripts/ runs /usr/bin/time any more (README: How the tests plant)');
}

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// perf run once, as preflight runs it, in a scratch repository: a copy of this checkout's scripts/, a
// trivial check workload, and budgets that are the same at the merge base (origin/main) and in the
// working tree, as frozen budgets are. Each task is { id, command, base, current }: `base` is the files
// its bench has at the merge base, `current` what the working tree changes them to.
//
// The copy leaves out scripts/throttle.mjs, as perf allows: these budgets are fixtures, and with it
// perf would queue up to an hour for the machine's one timed grant.
export function perfLane(scope, { tasks, noCounter = false }) {
  const box = scratch(scope);
  const cwd = join(box, 'repo');
  const cache = join(box, 'cache');
  mkdirSync(cache, { recursive: true });
  cpSync(join(root, 'scripts'), join(cwd, 'scripts'), { recursive: true, dereference: true, filter: (path) => path !== join(root, 'scripts/throttle.mjs') });
  if (noCounter) plantNoCounter(box, cwd);
  const budgets = {
    preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture preflight.' },
    // The margin is wide: these budgets are judged on instructions, not on time or memory.
    tasks: tasks.map(({ id, command }) => ({ id, command, margin: 1000, limits: {}, initialReason: 'Fixture task.' })),
  };
  write(cwd, {
    'scripts/checks.mjs': '// The fixture check workload: one process start.\n',
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'node -e ""' } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    'benchmarks/budgets.json': JSON.stringify(budgets),
    '.gitignore': 'node_modules/\n',
    ...Object.assign({}, ...tasks.map(({ base }) => base)),
  });
  git(cwd, 'init', '-q');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(cwd, Object.assign({}, ...tasks.map(({ current }) => current)));
  const started = performance.now();
  const observation = { status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1, instructions: noCounter ? null : 1 };
  const result = spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify(observation)], {
    cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, XDG_CACHE_HOME: cache },
  });
  const seconds = (performance.now() - started) / 1000;
  const lines = result.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  return { result, lines, line: (id) => lines.find(({ task }) => task === id), seconds };
}

// What perf printed against a budget: its verdict lines, each with its Fix line.
export const verdicts = (lane, id) => [...lane.result.stdout.matchAll(/^(FAIL|INCONCLUSIVE|BLOCKED) perf: ([^\n]*)\n {2}Fix: /gm)]
  .filter(([, , message]) => message.split(/\s/).some((word) => word.replace(/[^\w-]/g, '') === id))
  .map(([, status]) => status);

// How the budget read, for a failure message: perf's own words on it.
export const reading = (lane, id) => `perf read ${id} as ${verdicts(lane, id).join(', ') || 'no verdict line'}, its comparison ${JSON.stringify(lane.line(id)?.instructions?.status ?? null)}\n${show(lane.result)}`;

// INCONCLUSIVE naming the budget, and never PASS: the whole run can't read PASS either.
export function readsInconclusive(lane, id) {
  assert.deepEqual(verdicts(lane, id), ['INCONCLUSIVE'], reading(lane, id));
  assert.notEqual(lane.line(id)?.instructions?.status, 'PASS', reading(lane, id));
  assert.doesNotMatch(lane.result.stdout, /^PASS perf/m, show(lane.result));
  assert.notEqual(lane.result.status, 0, show(lane.result));
}
