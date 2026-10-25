// Shared by the #724 acceptance tests. The perf lane is reached only through what the README names:
// `judgeInstructions`, `parseInstructions` and `measureOnce` exported by scripts/benchmark.mjs, and
// `node scripts/perf.mjs '<observation>'` run as a process in a scratch git repository whose merge
// base already has the measured tasks.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after } from 'node:test';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const benchmarkUrl = pathToFileURL(join(root, 'scripts/benchmark.mjs')).href;
export const show = (result) => `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
export const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
// #568's recorded fingerprint of the Mac15,12 (M3, 16 GB) on battery, with Low Power Mode on and the
// thermal state fair: a reference Mac's hardware, off the reference conditions, so no budget counts.
export const OTHER = Object.freeze(JSON.parse(fixture('other-mac.json')));

// The exports, imported per test so a base without them fails each test by name.
export async function api(...names) {
  const module = await import(benchmarkUrl);
  for (const name of names) assert.equal(typeof module[name], 'function', `scripts/benchmark.mjs exports no ${name}()`);
  return module;
}

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
};
// Each pair's relative difference, current over base, as the README defines it.
export const differences = (pairs) => pairs.map(({ current, base }) => current / base - 1);
export const near = (actual, expected, what, tolerance = 1e-9) =>
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tolerance, `${what}: ${actual}, expected ${expected}`);

// The measured task: one awk program counting to `iterations`. awk has no JIT, so its instructions
// retired hold to about 0.2% at any load; Node's don't (README: Readings). 500,000 iterations
// retire about 350 million instructions on an M3 Pro, 11 million of them awk's start.
export const BASE_ITERATIONS = 500_000;
// Each planted rise adds the share of awk's start too, so the whole command retires 20% or 1.5% more.
export const PLUS_20 = 603_250;
export const PLUS_1_5 = 507_750;
export const program = (iterations) => `BEGIN { for (i = 0; i < ${iterations}; i++) s += i }\n`;
export const command = (id) => ['/usr/bin/awk', '-f', `benchmarks/${id}.awk`];

// This test's own reading of the real counter, apart from the lane: /usr/bin/time -l's
// "instructions retired" line for each program, read in ROUNDS rounds that run every program once,
// in turn, so all of them see the same load; each program's count is the median of its rounds. A
// loaded Mac adds about a million instructions to a run at random (about 0.3% of one at 500,000
// iterations), so a three-run reading of a 1.5% plant landed at 1.15% at load 65-75; nine
// interleaved rounds read it at 1.21-1.67% in 15 repeats at load 110-122, and fifteen at 1.475-1.541%
// in 10 repeats at load 87-105.
const ROUNDS = 15;
export function independentCounts(t, iterationsList) {
  const directory = scratch(t, 'deep-perf-724-count-');
  for (const iterations of iterationsList) writeFileSync(join(directory, `${iterations}.awk`), program(iterations));
  const counts = Object.fromEntries(iterationsList.map((iterations) => [iterations, []]));
  for (let round = 0; round < ROUNDS; round++) {
    for (const iterations of iterationsList) {
      const result = spawnSync('/usr/bin/time', ['-l', '/usr/bin/awk', '-f', `${iterations}.awk`], { cwd: directory, encoding: 'utf8' });
      const count = Number(result.stderr.match(/^\s*(\d+)\s+instructions retired\s*$/m)?.[1]);
      if (!Number.isSafeInteger(count) || count <= 0) assert.fail(`BLOCKED: this Mac's /usr/bin/time -l reports no instructions retired, so no planted change can be measured:\n${result.stderr}`);
      counts[iterations].push(count);
    }
  }
  return Object.fromEntries(iterationsList.map((iterations) => [iterations, median(counts[iterations])]));
}

// The conditions the load criteria are stated at: the 1-minute load average and the power source.
export function conditions() {
  let source = '';
  try {
    source = execFileSync('pmset', ['-g', 'ps'], { encoding: 'utf8' });
  } catch {}
  return { load: loadavg()[0], power: /'AC Power'/.test(source) ? 'ac' : /'Battery Power'/.test(source) ? 'battery' : null };
}
// After a test's assertions pass: a run that wasn't loaded past 40 on battery throughout is a
// reading, not proof of the criterion, so the test is skipped as INCONCLUSIVE with what it saw.
export function loadedOnBattery(t, before, after) {
  const seen = `load average ${before.load.toFixed(1)} before the lane and ${after.load.toFixed(1)} after it, on ${before.power} then ${after.power}`;
  t.diagnostic(seen);
  if (!(before.load > 40 && after.load > 40 && before.power === 'battery' && after.power === 'battery'))
    t.skip(`INCONCLUSIVE: the criterion is stated at a load average above 40 on battery; this run saw ${seen}`);
}

// A lane run shared by a file's tests happens in a top-level before hook; its scratch directories are
// removed after the file's last test.
export function fileScope() {
  const cleanups = [];
  after(() => { for (const cleanup of cleanups) cleanup(); });
  return { after: (cleanup) => cleanups.push(cleanup) };
}

export function scratch(t, prefix = 'deep-perf-724-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

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

// A scratch repository holding a copy of this checkout's scripts/, with its own trivial check
// workload. Its merge base (origin/main) has the preflight budget and every task, each an awk program
// at BASE_ITERATIONS; the working tree changes each task's program to its `current` iterations. The
// budgets are the same on both sides, as frozen budgets are. perf then runs once, as preflight runs
// it, with `observation` as the measured check workload.
//
// boundary: 'real' runs the copied scripts as they are. 'fingerprint' replaces the copy's
// scripts/benchmark.mjs with a module re-exporting this checkout's real one, with `fingerprint()`
// answering `planted` (as #568's tests do). 'no-counter' points every quoted '/usr/bin/time' literal
// in the copy's scripts/benchmark.mjs at NO_COUNTER_TIME. Nothing else is planted.
export function perfLane(t, { tasks, observation, boundary = 'real', planted }) {
  const box = scratch(t);
  const cwd = join(box, 'repo');
  const cache = join(box, 'cache');
  for (const directory of [join(cwd, 'scripts'), cache]) mkdirSync(directory, { recursive: true });
  for (const file of readdirSync(join(root, 'scripts'))) {
    if (statSync(join(root, 'scripts', file)).isFile()) copyFileSync(join(root, 'scripts', file), join(cwd, 'scripts', file));
  }
  if (boundary === 'fingerprint') {
    write(cwd, { 'scripts/benchmark.mjs': `export * from ${JSON.stringify(benchmarkUrl)};\nexport function fingerprint() { return ${JSON.stringify(planted)}; }\n` });
  } else if (boundary === 'no-counter') {
    const shim = join(box, 'bin', 'time');
    write(box, { 'bin/time': NO_COUNTER_TIME });
    chmodSync(shim, 0o755);
    const source = readFileSync(join(cwd, 'scripts/benchmark.mjs'), 'utf8');
    const literal = /(['"`])\/usr\/bin\/time\1/g;
    assert.match(source, literal, 'cannot plant a host without the counter: scripts/benchmark.mjs no longer runs /usr/bin/time by that literal path (README: How the tests plant)');
    write(cwd, { 'scripts/benchmark.mjs': source.replace(literal, JSON.stringify(shim)) });
  }
  const budgets = JSON.stringify({
    preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture preflight.' },
    tasks: tasks.map(({ id, limits = {} }) => ({ id, command: command(id), margin: 0.5, limits, initialReason: 'Fixture task.' })),
  });
  write(cwd, {
    'scripts/checks.mjs': '// The fixture check workload: one process start.\n',
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'node -e ""' } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    'benchmarks/budgets.json': budgets,
    '.gitignore': 'node_modules/\n',
    ...Object.fromEntries(tasks.map(({ id }) => [`benchmarks/${id}.awk`, program(BASE_ITERATIONS)])),
  });
  git(cwd, 'init', '-q');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(cwd, Object.fromEntries(tasks.map(({ id, current }) => [`benchmarks/${id}.awk`, program(current)])));
  const before = conditions();
  const started = performance.now();
  const result = spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify(observation)], {
    cwd, encoding: 'utf8', timeout: 600_000, env: { ...process.env, XDG_CACHE_HOME: cache },
  });
  const seconds = (performance.now() - started) / 1000;
  const after = conditions();
  const lines = result.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  return { result, lines, line: (id) => lines.find(({ task }) => task === id), before, after, seconds };
}

// The instruction comparison on a task's result line, with its pairs checked as real readings.
export function comparison(lane, id) {
  const printed = lane.line(id);
  assert.ok(printed, `no result line for ${id}: ${show(lane.result)}`);
  const judged = printed.instructions;
  assert.ok(judged && typeof judged === 'object', `${id}'s result line carries no "instructions" comparison: ${JSON.stringify(printed)}`);
  assert.ok(Array.isArray(judged.pairs) && judged.pairs.length === 20, `${id} attaches its 20 measured pairs: ${JSON.stringify(judged)}`);
  return { printed, judged };
}

export function realPairs(id, pairs) {
  for (const [round, pair] of pairs.entries()) {
    for (const side of ['current', 'base']) {
      assert.ok(Number.isSafeInteger(pair?.[side]) && pair[side] > 0, `${id} pair ${round}: ${side} is ${JSON.stringify(pair?.[side])}, not a count`);
    }
  }
}

// The pairs are this command's real counts: each side's median is within 2% of this test's own reading.
export function matchesCounter(id, pairs, expected) {
  for (const side of ['current', 'base']) {
    const reported = median(pairs.map((pair) => pair[side]));
    assert.ok(Math.abs(reported / expected[side] - 1) < 0.02, `${id}: the ${side} side's median count ${reported} isn't the counter's ${expected[side]}`);
  }
}

// change, spread and margin as the README defines them, from the attached pairs.
export function reported(id, judged) {
  const d = differences(judged.pairs);
  const spread = Math.max(...d) - Math.min(...d);
  near(judged.change, median(d), `${id}: change (median of the pairs' differences)`);
  near(judged.spread, spread, `${id}: spread (max minus min of the pairs' differences)`);
  near(judged.margin, Math.max(0.02, spread), `${id}: margin (the larger of 2% and the spread)`);
  return { change: median(d), spread, margin: Math.max(0.02, spread) };
}
