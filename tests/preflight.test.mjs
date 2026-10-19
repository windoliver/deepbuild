import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checks } from '../scripts/lanes.mjs';

const runner = new URL('../scripts/lanes.mjs', import.meta.url).href;
const scripts = new URL('../scripts/', import.meta.url);

// A copy of the real preflight entry and harness, with stub check and perf workloads.
function entry(t, { checks, perf = '', limit = 300_000 }) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-preflight-entry-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const directory of ['scripts', 'benchmarks']) mkdirSync(join(cwd, directory));
  for (const file of readdirSync(scripts)) copyFileSync(new URL(file, scripts), join(cwd, 'scripts', file));
  writeFileSync(join(cwd, 'scripts/checks.mjs'), checks);
  writeFileSync(join(cwd, 'scripts/perf.mjs'), perf);
  writeFileSync(join(cwd, 'benchmarks/budgets.json'), JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: limit }, initialReason: 'Fixture.' }, tasks: [] }));
  writeFileSync(join(cwd, 'package.json'), '{ "private": true }');
  return cwd;
}
const preflight = (cwd) => spawnSync(process.execPath, [join(cwd, 'scripts/preflight.mjs')], { encoding: 'utf8' });

function fixture(t, steps) {
  const cwd = mkdtempSync(join(tmpdir(), 'deep-preflight-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const lanes = steps.map(({ name, error, missing, prelude = 'check started', laterOutput }) => ({
    name,
    fix: `Repair ${name}.`,
    commands: [missing ? [join(cwd, 'missing-executable')] : [process.execPath, '-e', `
      require('node:fs').appendFileSync('ran', ${JSON.stringify(`${name}\n`)});
      console.log(${JSON.stringify(prelude)});
      ${error ? `console.error(${JSON.stringify(error)}); process.exitCode = 1;` : ''}
      ${laterOutput ? `console.log(${JSON.stringify(laterOutput)});` : ''}
    `]],
  }));
  writeFileSync(join(cwd, 'run.mjs'), `
    import { runLanes } from ${JSON.stringify(runner)};
    process.exitCode = await runLanes(${JSON.stringify(lanes)}, { cwd: process.cwd() });
  `);
  const result = spawnSync(process.execPath, ['run.mjs'], { cwd, encoding: 'utf8' });
  return { ...result, ran: () => readFileSync(join(cwd, 'ran'), 'utf8') };
}

test('every lane runs after failures, with each first error and named fix', (t) => {
  const result = fixture(t, [
    { name: 'typecheck', error: 'Error: missing type\nError: later detail' },
    { name: 'lint' },
    { name: 'unit', error: 'AssertionError: expected true, got false' },
    { name: 'parity quick' },
    { name: 'perf' },
  ]);
  assert.notEqual(result.status, 0, result.stderr);
  assert.equal(result.ran(), 'typecheck\nlint\nunit\nparity quick\nperf\n');
  assert.match(result.stdout, /FAIL typecheck: Error: missing type\n\s+Fix: Repair typecheck\./);
  assert.match(result.stdout, /FAIL unit: AssertionError: expected true, got false\n\s+Fix: Repair unit\./);
  assert.match(result.stdout, /PASS perf/);
});

test('successful checks produce evidence and a zero exit', (t) => {
  const result = fixture(t, [{ name: 'unit' }]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.ran(), 'unit\n');
  assert.match(result.stdout, /PASS unit/);
  assert.doesNotMatch(result.stdout, /FAIL|BLOCKED/);
});

test('an unavailable check is blocked and does not suppress the later lane', (t) => {
  const result = fixture(t, [{ name: 'typecheck', missing: true }, { name: 'perf' }]);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /BLOCKED typecheck: .*ENOENT\n\s+Fix: Repair typecheck\./);
  assert.equal(result.ran(), 'perf\n');
  assert.match(result.stdout, /PASS perf/);
});

test('failure summary names a diagnostic instead of an error-related test title', (t) => {
  const result = fixture(t, [{ name: 'unit', prelude: 'testing error handling', error: 'Error: actual failure' }]);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAIL unit: Error: actual failure\n\s+Fix: Repair unit\./);
});

test('first failure preserves ordering across stderr and stdout', (t) => {
  const result = fixture(t, [{ name: 'unit', error: 'Error: original failure', laterOutput: 'Error: later cleanup failure' }]);
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAIL unit: Error: original failure\n\s+Fix: Repair unit\./);
});

test('preflight runs every lane when started through a symlinked path', (t) => {
  const cwd = entry(t, { checks: 'console.log("checks ran")', perf: 'console.log("perf ran")' });
  const link = `${cwd}-link`;
  symlinkSync(cwd, link);
  t.after(() => rmSync(link, { force: true }));
  const result = preflight(link);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /checks ran[\s\S]*perf ran/);
});

test('lane output streams while the measured workload is still running', async (t) => {
  const cwd = entry(t, { checks: `
    import { existsSync } from 'node:fs';
    console.log('lane started');
    const until = Date.now() + 10_000;
    while (!existsSync('release') && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
    console.log(existsSync('release') ? 'released by streamed output' : 'never released');
  ` });
  const child = spawn(process.execPath, [join(cwd, 'scripts/preflight.mjs')]);
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('lane started')) writeFileSync(join(cwd, 'release'), '');
  });
  await once(child, 'close');
  assert.match(stdout, /released by streamed output/);
});

test('failed check lanes block perf instead of measuring a broken workload', (t) => {
  const cwd = entry(t, { checks: 'process.exitCode = 1', perf: 'import { writeFileSync } from "node:fs"; writeFileSync("perf-ran", "");' });
  const result = preflight(cwd);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BLOCKED perf: .+\n\s+Fix: .+/);
  assert.equal(existsSync(join(cwd, 'perf-ran')), false);
});

test('the check budget comes from budgets.json and excludes the perf comparison', (t) => {
  const sleep = 'await new Promise((resolve) => setTimeout(resolve, 2500));';
  const slowChecks = preflight(entry(t, { checks: sleep, limit: 2000 }));
  assert.equal(slowChecks.status, 1, slowChecks.stdout);
  assert.match(slowChecks.stdout, /FAIL preflight budget/);
  const slowPerf = preflight(entry(t, { checks: '', perf: sleep, limit: 2000 }));
  assert.equal(slowPerf.status, 0, slowPerf.stdout);
});

test('the unit lane runs every tooling test file', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'deep-preflight-tooling-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'tests/acceptance/1'), { recursive: true });
  // Acceptance tests sit in tests/acceptance/<issue>/.
  for (const name of ['one', 'two', 'acceptance/1/three']) writeFileSync(join(cwd, 'tests', `${name}.test.mjs`), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(name.split('/').pop())}, '');`);
  const [command, ...args] = checks.find(({ name }) => name === 'unit').commands.find((parts) => parts.includes('--test'));
  // A nested test runner that inherits this runner's context runs no files.
  spawnSync(command, args, { cwd, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.deepEqual(['one', 'two', 'three'].filter((name) => existsSync(join(cwd, name))), ['one', 'two', 'three']);
});

test('the unit lane runs only test files inside the declared test paths, which perf sets apart', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'deep-preflight-test-paths-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'scripts'));
  for (const file of ['scripts/lanes.mjs', 'vitest.config.ts']) copyFileSync(new URL(`../${file}`, import.meta.url), join(cwd, file));
  symlinkSync(new URL('../node_modules', import.meta.url).pathname, join(cwd, 'node_modules'));
  writeFileSync(join(cwd, 'package.json'), '{ "type": "module" }');
  const write = (file, body) => { mkdirSync(join(cwd, file, '..'), { recursive: true }); writeFileSync(join(cwd, file), body); };
  // A test file outside the declared paths would run in the check workload yet never be set apart by perf.
  for (const name of ['tests/inside', 'scripts/outside']) write(`${name}.test.mjs`, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(name.split('/')[1])}, '');`);
  for (const name of ['packages/a/test/inside', 'scripts/outside']) write(`${name}.test.ts`, "import { it } from 'vitest'; it('runs', () => {});");
  const [command, ...args] = checks.find(({ name }) => name === 'unit').commands.find((parts) => parts.includes('--test'));
  spawnSync(command, args, { cwd, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.deepEqual(['inside', 'outside'].filter((name) => existsSync(join(cwd, name))), ['inside']);
  const listed = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'list', '--filesOnly'], { cwd, encoding: 'utf8' });
  assert.deepEqual(listed.stdout.trim().split('\n'), ['packages/a/test/inside.test.ts'], listed.stderr);
});

test('the lint lane fails Rust code that clippy warns about', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'deep-preflight-clippy-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.0.0"\nedition = "2021"\n');
  writeFileSync(join(cwd, 'Cargo.lock'), 'version = 4\n\n[[package]]\nname = "fixture"\nversion = "0.0.0"\n');
  writeFileSync(join(cwd, 'src/main.rs'), 'fn unused() {}\n\nfn main() {}\n');
  const clippy = checks.find(({ name }) => name === 'lint').commands.find((parts) => parts.includes('clippy'));
  assert.ok(clippy, 'the lint lane runs clippy');
  const [command, ...args] = clippy;
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /function `unused` is never used/);
});
