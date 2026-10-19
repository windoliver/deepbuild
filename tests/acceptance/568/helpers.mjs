// Shared by the #568 acceptance tests. The perf lane is reached only through what the README
// names: `fingerprint` and `judgeLimit` exported by scripts/benchmark.mjs, and
// `node scripts/perf.mjs '<observation>'` run as a process in a scratch git repository.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const benchmarkUrl = pathToFileURL(join(root, 'scripts/benchmark.mjs')).href;

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const show = (result) => `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

// Recorded fingerprints: the reference Mac on mains power, and another Mac on battery.
const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
export const REFERENCE = Object.freeze(fixture('reference-mac'));
export const OTHER = Object.freeze(fixture('other-mac'));
export const FIELDS = ['model', 'chip', 'memoryBytes', 'power', 'lowPowerMode', 'thermalState', 'macosBuild'];

// Each attribute that alone takes a run off the reference Mac, with the words its reason names.
export const OFF_REFERENCE = [
  ['model', { model: 'Mac15,9' }, /Mac15,7|model/i],
  ['chip', { chip: 'Apple M3 Max' }, /M3 Pro|chip/i],
  ['memory', { memoryBytes: 19327352832 }, /memory|36/i],
  ['battery power', { power: 'battery' }, /battery|mains|power/i],
  ['Low Power Mode on', { lowPowerMode: true }, /low power/i],
  ['thermal state fair', { thermalState: 'fair' }, /thermal/i],
  ['thermal state serious', { thermalState: 'serious' }, /thermal/i],
  ['thermal state critical', { thermalState: 'critical' }, /thermal/i],
];

// The two exports, imported per test so a base without them fails each test by name.
export async function api(...names) {
  const module = await import(benchmarkUrl);
  for (const name of names) assert.equal(typeof module[name], 'function', `scripts/benchmark.mjs exports no ${name}()`);
  return module;
}

export function scratch(t, prefix = 'deep-perf-568-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

// A scratch repository holding a copy of this checkout's scripts/, whose scripts/benchmark.mjs is
// replaced by a module that re-exports the real one with `fingerprint()` answering `planted`: the
// machine is the one boundary these tests stand in for. origin/main has budgets with no tasks, so
// no merge-base copy is built; the working tree's budgets add the preflight budget and `task`.
export function lane(t, { planted, task }) {
  const cwd = scratch(t);
  mkdirSync(join(cwd, 'scripts'));
  for (const file of readdirSync(join(root, 'scripts'))) {
    if (statSync(join(root, 'scripts', file)).isFile()) copyFileSync(join(root, 'scripts', file), join(cwd, 'scripts', file));
  }
  write(cwd, {
    'scripts/benchmark.mjs': [
      `export * from ${JSON.stringify(benchmarkUrl)};`,
      `export function fingerprint() { return ${JSON.stringify(planted)}; }`,
      '',
    ].join('\n'),
    'package.json': '{ "name": "fixture", "private": true }\n',
    'benchmarks/budgets.json': JSON.stringify({ tasks: [] }),
    '.gitignore': 'runs.log\ncold-done\n',
  });
  git(cwd, 'init', '-q');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(cwd, {
    'benchmarks/budgets.json': JSON.stringify({
      preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture preflight.' },
      tasks: [{ margin: 0.5, initialReason: 'Fixture first measurement.', ...task }],
    }),
  });
  const result = spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 })], { cwd, encoding: 'utf8', timeout: 120_000 });
  const lines = result.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  const invocations = () => { try { return readFileSync(join(cwd, 'runs.log'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
  return { cwd, result, lines, invocations, line: (id) => lines.find(({ task }) => task === id) };
}
