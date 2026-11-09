// Shared fixture for the #1421 acceptance tests, drafted blind from the issue, docs/technical-design.md
// and the base commit ede4b367.
//
// A throwaway repository whose merge base already has the preflight budget, so scripts/perf.mjs
// measures a real base, as tests/perf.test.mjs's repository() makes one: the repo's scripts/, a check
// workload in scripts/checks.mjs, a package.json whose build writes `warm`, and benchmarks/budgets.json
// with the frozen preflight entry (margin 0.5) and no tasks. perf is run the way preflight runs it, with
// the checkout's own observation as its JSON argument, under plant-cpu.cjs (node -r), which sets the CPU
// line of the merge base's GNU time report (see that file).
//
// perf takes the throttle's timed class, so the fixtures share a table in an isolated HOME and the
// suite holds one timed grant in it for every run, as tests/perf.test.mjs does.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';

const scripts = new URL('../../../scripts/', import.meta.url);
const preload = fileURLToPath(new URL('plant-cpu.cjs', import.meta.url));
const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1421-home-')));
const { acquire, release } = await import(new URL('throttle.mjs', scripts));
const inHome = (act) => {
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    return act();
  } finally {
    process.env.HOME = previous;
  }
};
const grant = inHome(() => acquire('timed', { wait: 60 }));
assert.ok(grant, 'no timed grant came within 60 min');
after(() => {
  inHome(() => release(grant));
  rmSync(home, { recursive: true, force: true });
});

// Top-level code that spends `ms` of this process's own CPU.
export const spin = (ms) => `{ const start = process.cpuUsage(); for (let used; (used = process.cpuUsage(start)).user + used.system < ${ms * 1000};); }`;

export function repository(t, checks) {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1421-')));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const cwd = join(box, 'repo');
  const cache = join(box, 'cache');
  for (const directory of [cwd, cache]) mkdirSync(directory);
  mkdirSync(join(cwd, 'benchmarks'));
  cpSync(fileURLToPath(scripts), join(cwd, 'scripts'), { recursive: true });
  const files = {
    'scripts/checks.mjs': checks,
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: `node -e "require('node:fs').writeFileSync('warm', '')"` } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    'benchmarks/budgets.json': JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture base.' }, tasks: [] }),
    '.gitignore': 'warm\nnode_modules/\n',
  };
  for (const [path, content] of Object.entries(files)) writeFileSync(join(cwd, path), content);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const mark = join(box, 'planted.json');
  // plant: 'zero' (the base report reads cpu_s=0.00 0.00) or 'drop' (the base report has no CPU line).
  const perf = (observation, plant) => {
    const env = { ...process.env, HOME: home, XDG_CACHE_HOME: cache, DEEP_THROTTLE: grant.token, PLANT_CPU: plant, PLANT_MARK: mark };
    delete env.DEEP_PERF_LOCK;
    delete env.NODE_OPTIONS;
    const result = spawnSync(process.execPath, ['-r', preload, 'scripts/perf.mjs', JSON.stringify(observation)], { cwd, encoding: 'utf8', env });
    // The plant must have landed on the merge base's report, or the test proves nothing.
    assert.ok(existsSync(mark), `no /usr/bin/time report of the merge base was planted\n${result.stdout}${result.stderr}`);
    return { ...result, planted: JSON.parse(readFileSync(mark, 'utf8')) };
  };
  return { cwd, perf };
}
