// Acceptance tests for issue #583: "Perf lane: the whole check run is compared without the change's
// own new tests". Each test plants a throwaway git repository whose merge base (origin/main) and
// checkout run a fixture check workload that spins for a stated CPU time, then runs
// scripts/perf.mjs the way scripts/preflight.mjs does: the checkout's check workload is measured
// once with measureOnce, and that observation is passed to perf as its JSON argument.
//
// The fixture workload (scripts/checks.mjs) loads every .mjs and .ts file present under src/,
// packages/ and tests/, so a file perf leaves out of its second run is simply not on disk for that
// run. It also appends its label ("base" on the merge base, "checkout" on the change) to a runs log,
// so the tests can count how often the checkout's workload ran.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { measureOnce, validateBudgets } from '../../../scripts/benchmark.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

// Top-level code that spends `ms` of this process's CPU.
const spin = (ms) => `{ const start = process.cpuUsage(); for (let used; (used = process.cpuUsage(start)).user + used.system < ${ms * 1000};); }`;
const writes = (path, line) => `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(path)}, ${JSON.stringify(`${line}\n`)});`;

function workload(label, runs, { setup = false } = {}) {
  return `
import { appendFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
appendFileSync(${JSON.stringify(runs)}, ${JSON.stringify(`${label}\n`)});
${setup ? "await import('../tests/setup.mjs');" : ''}
const files = [];
const walk = (directory) => {
  let names;
  try { names = readdirSync(directory).sort(); } catch { return; }
  for (const name of names) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\\.(?:mjs|ts)$/.test(name)) files.push(path);
  }
};
for (const top of ['src', 'packages', 'tests']) walk(join(root, top));
for (const file of files) await import(pathToFileURL(file));
`;
}

// A fixture repository: the merge base holds the repo's whole scripts/ directory with the fixture
// workload in scripts/checks.mjs, plus `files`; the working tree then relabels the workload
// "checkout" (uncommitted until the test calls commit()).
function fixture(t, files) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-perf-583-')));
  const marks = realpathSync(mkdtempSync(join(tmpdir(), 'deep-perf-583-marks-')));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(marks, { recursive: true, force: true });
  });
  const runs = join(marks, 'runs');
  cpSync(join(repository, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  const write = (entries) => {
    for (const [path, content] of Object.entries(entries)) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }
  };
  write({
    'scripts/checks.mjs': workload('base', runs),
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: `node -e "require('node:fs').writeFileSync('warm', '')"` } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    'benchmarks/budgets.json': JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture base.' }, tasks: [] }),
    '.gitignore': 'warm\nnode_modules/\n',
    ...files,
  });
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write({ 'scripts/checks.mjs': workload('checkout', runs) });
  const commit = (message = 'change') => {
    git('add', '-A');
    git('commit', '-qm', message);
  };
  // What preflight.mjs does: measure the checkout's check workload once, then hand perf the observation.
  const preflight = () => {
    const measured = measureOnce([process.execPath, 'scripts/checks.mjs'], cwd);
    assert.equal(measured.status, 0, `fixture bug: the checkout's own check run failed:\n${measured.output}`);
    const observed = { elapsedMs: measured.elapsedMs, cpuMs: measured.cpuMs, peakBytes: measured.peakBytes, status: measured.status };
    const result = spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify(observed)], { cwd, encoding: 'utf8' });
    return { observed, status: result.status, output: result.stdout + result.stderr };
  };
  const count = (path, line) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((entry) => entry === line).length : 0);
  return { cwd, marks, runs, write, commit, preflight, count, git };
}

// The cpuMs value a `FAIL perf` line names, or null when no FAIL perf line names cpuMs.
const failedCpuMs = (output) => {
  const match = output.match(/^FAIL perf: .*?\bcpuMs\D*?(\d+)/m);
  return match ? Number(match[1]) : null;
};

// Criterion 1: A checkout that adds a test file spending 10 s of CPU, against a base whose check run
// spends 1 s, passes perf, and the output names the CPU the added test accounts for; a lane that
// compares the whole run with the base fails this, as main does today.
test('criterion 1: a 10 s added test against a 1 s base passes perf and the output names the CPU it accounts for', (t) => {
  const repo = fixture(t, {
    'src/product.mjs': `export function work() ${spin(1000)}`,
    'tests/existing.test.mjs': `import { work } from '../src/product.mjs'; work();`,
  });
  repo.write({ 'tests/heavy.test.mjs': spin(10_000) });
  repo.commit();
  const { observed, status, output } = repo.preflight();
  // Catches main's whole-run comparison: the full run's ~11 s cpuMs is more than 50% above the base's ~1 s.
  assert.equal(status, 0, `perf failed a change whose only extra CPU is its own added test:\n${output}`);
  assert.match(output, /^PASS perf\b/m, output);
  assert.doesNotMatch(output, /^(?:FAIL|BLOCKED) perf/m, output);
  // Catches a lane that passes without saying what the added test cost: some reported number, in ms or
  // in s, is the full run's CPU less the run without the added test, about 10 s. The full run's own
  // cpuMs (~11 s), its wall time (>= its CPU) and the base and second runs (~1 s) are all outside this range.
  const reported = output.split('\n').filter((line) => !/^PASS perf \(/.test(line)).join('\n');
  const numbers = [...reported.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g)].map(([value]) => Number(value));
  assert.ok(
    numbers.some((value) => (value >= 9300 && value <= 10_700) || (value >= 9.3 && value <= 10.7)),
    `the output does not name the ~10 s of CPU the added test accounts for (full run cpuMs ${observed.cpuMs}):\n${output}`,
  );
});

// Criterion 2: A checkout whose product code makes an existing test spend 2 s more CPU against a base
// run of 1 s fails perf on `cpuMs`, even when the same change also adds a test file; a lane that skips
// the comparison whenever any test file is added passes this change and fails the criterion.
test('criterion 2: a 2 s product slowdown against a 1 s base fails perf on cpuMs even when a test file is added', (t) => {
  const repo = fixture(t, {
    'src/product.mjs': `export function work() ${spin(1000)}`,
    'tests/existing.test.mjs': `import { work } from '../src/product.mjs'; work();`,
  });
  repo.write({
    'src/product.mjs': `export function work() ${spin(3000)}`,
    'tests/added.test.mjs': spin(1000),
  });
  repo.commit();
  const { observed, status, output } = repo.preflight();
  // Catches the always-exempting lane: it skips the comparison because a test file was added, and passes.
  assert.equal(status, 1, `perf passed a 2 s product slowdown because the change also added a test:\n${output}`);
  assert.doesNotMatch(output, /^PASS perf\b/m, output);
  const failed = failedCpuMs(output);
  assert.notEqual(failed, null, `perf did not fail on cpuMs:\n${output}`);
  // Catches main's whole-run comparison: main fails on the full run's cpuMs, which still charges the added
  // test's 1 s. The run compared with the base must be the one without the added test, about 1 s less.
  assert.ok(failed <= observed.cpuMs - 500, `perf failed on cpuMs ${failed}, the full run's ${observed.cpuMs}, not the run without the added test:\n${output}`);
});

// Criterion 3: A test file that is added but not committed, and one that is modified but not committed,
// are set apart the same way as a committed one; a lane that reads only `merge-base..HEAD` charges the
// change for them and fails the criterion.
test('criterion 3: an uncommitted added test and an uncommitted modified test are set apart like committed ones', (t) => {
  const repo = fixture(t, {
    'src/product.mjs': `export function work() ${spin(1000)}`,
    'tests/existing.test.mjs': `import { work } from '../src/product.mjs'; work();`,
    'tests/other.test.mjs': '',
  });
  repo.commit();
  // Each file alone takes the run from 1 s to 2 s, past the 0.5 margin, if it is charged to the change.
  repo.write({
    'tests/new.test.mjs': spin(1000), // added, untracked
    'tests/other.test.mjs': spin(1000), // modified, unstaged
  });
  assert.match(repo.git('status', '--porcelain'), /^\?\? tests\/new\.test\.mjs$/m);
  assert.match(repo.git('status', '--porcelain'), /^ M tests\/other\.test\.mjs$/m);
  const { status, output } = repo.preflight();
  // Catches a lane that reads only merge-base..HEAD (it sees no test file and compares the ~3 s full run),
  // and one that also misses either the untracked or the unstaged file (its second run is ~2 s).
  assert.equal(status, 0, `perf charged the change for its uncommitted test files:\n${output}`);
  assert.match(output, /^PASS perf\b/m, output);
  assert.doesNotMatch(output, /^(?:FAIL|BLOCKED) perf/m, output);
});

// Criterion 4: A heavy file outside the declared test paths, such as
// `packages/cli/src/slow-testing-helper.ts`, is not set apart; a lane that matches `test` anywhere in
// a file's name passes a slowdown there and fails the criterion.
test('criterion 4: a slowdown in packages/cli/src/slow-testing-helper.ts is not set apart and fails perf on cpuMs', (t) => {
  const repo = fixture(t, {
    'packages/cli/src/slow-testing-helper.ts': spin(1000),
    'tests/existing.test.mjs': '',
  });
  repo.write({
    'packages/cli/src/slow-testing-helper.ts': spin(3000),
    'tests/added.test.mjs': spin(1000),
  });
  repo.commit();
  const { observed, status, output } = repo.preflight();
  // Catches a lane matching `test` anywhere in a name: it leaves the helper out too, so its second run
  // spends ~0 s against the base's 1 s and passes.
  assert.equal(status, 1, `perf passed a 2 s slowdown in a helper outside the declared test paths:\n${output}`);
  assert.doesNotMatch(output, /^PASS perf\b/m, output);
  const failed = failedCpuMs(output);
  assert.notEqual(failed, null, `perf did not fail on cpuMs:\n${output}`);
  // Catches main's whole-run comparison: main fails on the full run, which still charges the added test's 1 s.
  assert.ok(failed <= observed.cpuMs - 500, `perf failed on cpuMs ${failed}, the full run's ${observed.cpuMs}, not the run without the added test:\n${output}`);
  assert.ok(failed >= 2500, `perf's second run left out the helper's 3 s (cpuMs ${failed}):\n${output}`);
});

// Criterion 5: The second run does not execute the added test files, shown by a marker those files
// write; a lane that runs everything twice records the marker and fails.
test('criterion 5: the second run does not execute the added test file, shown by the marker it writes', (t) => {
  const repo = fixture(t, {
    'src/product.mjs': `export function work() ${spin(1000)}`,
    'tests/existing.test.mjs': `import { work } from '../src/product.mjs'; work();`,
  });
  const marker = join(repo.marks, 'added-test-ran');
  repo.write({ 'tests/added.test.mjs': writes(marker, 'ran') });
  repo.commit();
  const { output } = repo.preflight();
  // Without a second run the marker proves nothing; main never runs one. preflight's run plus perf's second.
  assert.equal(repo.count(repo.runs, 'checkout'), 2, `perf did not run the checkout's workload a second time:\n${output}`);
  // Catches a lane that runs everything twice: its second run executes the added test and writes the marker again.
  assert.equal(repo.count(marker, 'ran'), 1, `the added test ran in perf's second run:\n${output}`);
});

// Criterion 6: A change with no added or modified test file runs the check workload once on the
// checkout; a lane that always runs it twice fails by counting the runs.
test('criterion 6: a change with no added or modified test file runs the check workload once on the checkout', (t) => {
  const repo = fixture(t, {
    'src/product.mjs': `export function work() ${spin(1000)}`,
    'tests/existing.test.mjs': `import { work } from '../src/product.mjs'; work();`,
  });
  repo.write({ 'README.md': 'A change outside the test paths.\n' });
  repo.commit();
  const first = repo.preflight();
  // Catches a lane that always runs it twice: preflight's run is the only one on the checkout.
  assert.equal(repo.count(repo.runs, 'checkout'), 1, `the checkout's workload ran more than once with no test file changed:\n${first.output}`);
  // Nothing changes: the one run is compared with the base, as today.
  assert.equal(first.status, 0, first.output);
  assert.match(first.output, /"task":"preflight"[^\n]*"status":"PASS"/, first.output);
  // The count sees a second run when there is one: once a test file is added, preflight's run plus
  // perf's second make two more. Main never runs a second time, so this control fails there.
  repo.write({ 'tests/added.test.mjs': '' });
  repo.commit('add a test');
  const second = repo.preflight();
  assert.equal(repo.count(repo.runs, 'checkout'), 3, `the run count did not see perf's second run once a test file was added:\n${second.output}`);
});

// Criterion 7: A second run that exits non-zero gives `BLOCKED perf` with a Fix line, and no `PASS`.
test('criterion 7: a second run that exits non-zero gives BLOCKED perf with a Fix line and no PASS', (t) => {
  const repo = fixture(t, {
    'src/product.mjs': `export function work() ${spin(1000)}`,
    'tests/existing.test.mjs': `import { work } from '../src/product.mjs'; work();`,
  });
  // The workload loads a setup file the change adds under tests/, so the run without it exits non-zero.
  repo.write({
    'scripts/checks.mjs': workload('checkout', repo.runs, { setup: true }),
    'tests/setup.mjs': '',
  });
  repo.commit();
  const { status, output } = repo.preflight();
  // Catches main, which runs no second run and passes this ~1 s checkout against its ~1 s base,
  // and a lane that ignores the second run's exit status.
  assert.equal(status, 1, `perf did not stop on a failed second run:\n${output}`);
  assert.match(output, /^BLOCKED perf: .+\n\s+Fix: .+/m, output);
  assert.doesNotMatch(output, /^PASS perf\b/m, output);
  assert.doesNotMatch(output, /"status":"PASS"/, output);
});

// Criterion 8: Editing `margin` in the frozen `preflight` entry, or deleting it, is still refused by
// `validateBudgets`; a lane that accepts the edit when test files were added fails.
test('criterion 8: editing or deleting the frozen preflight entry is still refused, also when test files were added', (t) => {
  // The frozen entry on main, through validateBudgets directly.
  const frozen = JSON.parse(readFileSync(join(repository, 'benchmarks/budgets.json'), 'utf8'));
  assert.ok(frozen.preflight, 'the base commit has a frozen preflight entry');
  assert.throws(() => validateBudgets({ ...frozen, preflight: { ...frozen.preflight, margin: 1 } }, frozen), /preflight/);
  const { preflight: _deleted, ...withoutPreflight } = frozen;
  assert.throws(() => validateBudgets(withoutPreflight, frozen), /preflight/);

  // Through perf, on a change that adds a test file.
  const budgets = { preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture base.' }, tasks: [] };
  const repo = fixture(t, {
    'src/product.mjs': `export function work() ${spin(1000)}`,
    'tests/existing.test.mjs': `import { work } from '../src/product.mjs'; work();`,
  });
  repo.write({ 'tests/added.test.mjs': spin(1000) });
  repo.commit();
  const { observed, status, output } = repo.preflight();
  // Control: with the entry untouched this change passes, so a refusal below comes from the edit, not
  // from the added test being charged. Main charges it (~2 s against ~1 s), so this fails there.
  assert.equal(status, 0, `perf failed the change before any budget edit:\n${output}`);
  const edits = [
    ['margin edited', { ...budgets, preflight: { ...budgets.preflight, margin: 5 } }],
    ['entry deleted', { tasks: [] }],
  ];
  for (const [edit, current] of edits) {
    repo.write({ 'benchmarks/budgets.json': JSON.stringify(current) });
    const result = spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify(observed)], { cwd: repo.cwd, encoding: 'utf8' });
    const text = result.stdout + result.stderr;
    // Catches a lane that accepts the edit when test files were added.
    assert.equal(result.status, 1, `perf accepted the frozen preflight entry ${edit}:\n${text}`);
    assert.match(text, /^BLOCKED perf: .*preflight.*\n\s+Fix: .+/m, text);
    assert.doesNotMatch(text, /^PASS perf\b/m, text);
  }
});
