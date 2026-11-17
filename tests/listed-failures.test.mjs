// #2444 regression coverage beyond the blind node-runner fixture: Vitest, Cargo and evidence states.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checks, readRun, testsOf } from '../scripts/lanes.mjs';

const checkout = fileURLToPath(new URL('../', import.meta.url));
const runner = new URL('../scripts/lanes.mjs', import.meta.url).href;
const reason = 'fixture failure on main (#2444, added 2026-11-15)';
function fixture(t, files, failures) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-listed-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ 'scripts/known-failures.json': JSON.stringify({ failures, skips: [] }), ...files })) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  }
  symlinkSync(join(checkout, 'node_modules'), join(cwd, 'node_modules'));
  return cwd;
}
function unit(cwd, command) {
  const code = `import { runLanes } from ${JSON.stringify(runner)};
    process.exitCode = runLanes([{name: 'unit', commands: [${JSON.stringify(command)}], fix: 'fixture'}], {cwd: process.cwd()});`;
  const { NODE_TEST_CONTEXT, DEEP_THROTTLE, DEEP_PROOF_VITEST_REPORT, DEEP_PREFLIGHT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8', timeout: 120_000,
    env: { ...env, HOME: join(cwd, 'home'), RUSTUP_HOME: env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: env.CARGO_HOME ?? join(homedir(), '.cargo') } });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

test('Vitest lists only the exact failing test ID, not its passing or newly failing sibling', (t) => {
  const id = 'tests/example.test.ts › listed';
  const cwd = fixture(t, { 'tests/example.test.ts': `import { test, expect } from 'vitest';
    test('listed', () => expect(1).toBe(2));
    test('passes', () => expect(1).toBe(1));
    test('new failure', () => expect(2).toBe(3));` }, { [id]: reason, 'tests/example.test.ts › passes': reason });
  const command = [process.execPath, 'node_modules/vitest/vitest.mjs', 'run'];
  const onlyListed = unit(cwd, [...command, '-t', '^listed$|^passes$']);
  const mixed = unit(cwd, command);
  assert.equal(onlyListed.status, 0, onlyListed.output);
  assert.match(onlyListed.output, /^LISTED tests\/example\.test\.ts › listed.*#2444/m);
  assert.doesNotMatch(onlyListed.output, /^LISTED .* › passes/m);
  assert.equal(mixed.status, 1, mixed.output);
  assert.match(mixed.output, /^LISTED tests\/example\.test\.ts › listed.*#2444/m);
  assert.match(mixed.output, /^FAIL unit:/m);
  assert.doesNotMatch(mixed.output, /^LISTED .* › new failure/m);
});

const cargoCommand = checks.find(({ name }) => name === 'unit').commands.find(([command]) => command === 'cargo');
const cargoFiles = {
  'Cargo.toml': '[package]\nname = "lane-fixture"\nversion = "0.0.0"\nedition = "2021"\n',
  'Cargo.lock': 'version = 4\n\n[[package]]\nname = "lane-fixture"\nversion = "0.0.0"\n',
  'src/lib.rs': '#[test]\nfn listed_on_main() { assert_eq!(1, 2, "listed failure ran"); }\n',
};
const cargoId = 'cargo -p lane-fixture --lib › listed_on_main';
test('Cargo results use the same rerunnable IDs as the known-failure list', (t) => {
  const cwd = fixture(t, cargoFiles, { [cargoId]: reason });
  const result = unit(cwd, cargoCommand);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /^LISTED cargo -p lane-fixture --lib › listed_on_main.*#2444/m);
  assert.match(result.output, /^PASS unit\b/m);
});

test('the real unit Cargo command runs a later unlisted target after a listed failure, and still fails', (t) => {
  const cwd = fixture(t, { ...cargoFiles, 'tests/later.rs': '#[test]\nfn new_regression() { panic!("later unlisted target ran"); }\n' }, { [cargoId]: reason });
  const result = unit(cwd, cargoCommand);
  assert.match(result.output, /later unlisted target ran/);
  assert.match(result.output, /^LISTED cargo -p lane-fixture --lib › listed_on_main.*#2444/m);
  assert.doesNotMatch(result.output, /^LISTED .*new_regression/m);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /^FAIL unit:/m);
});

test('listed evidence is never PASS; an unrun state or a crashed runner is never excused by that ID', (t) => {
  const id = 'tests/example.test.mjs › known';
  const cwd = fixture(t, {}, { [id]: reason });
  const failed = { failures: [{ id, state: 'FAIL', message: 'original failure' }] };
  const listed = readRun(failed, 1, cwd, []);
  assert.equal(listed.explained, true);
  assert.equal(listed.found, undefined);
  assert.equal(listed.tests.find((row) => row.id === id).state, 'LISTED');
  assert.match(listed.tests.find((row) => row.id === id).note, /#2444/);
  for (const status of [null, 137]) assert.equal(readRun(failed, status, cwd, []).explained, false);
  for (const state of ['BLOCKED', 'INVALID', 'INCONCLUSIVE']) {
    const run = readRun({ failures: [{ id, state, message: 'not proven' }] }, 1, cwd, []);
    assert.equal(run.found.state, state);
    assert.equal(run.tests[0].state, state);
    assert.deepEqual(run.covered, []);
  }
  const fresh = readRun({ failures: [{ id: `${id} sibling`, state: 'FAIL', message: 'new failure' }] }, 1, cwd, []);
  assert.equal(fresh.explained, false);
  assert.equal(fresh.tests[0].state, 'FAIL');
  assert.equal(JSON.parse(readFileSync(join(cwd, 'scripts/known-failures.json'), 'utf8')).failures[id], reason);
});

test('an unrun row sharing a listed failure ID keeps its own state in the evidence', (t) => {
  const id = 'tests/example.test.mjs › same name';
  const cwd = fixture(t, {}, { [id]: reason });
  const run = readRun({ failures: [{ id, state: 'FAIL', message: 'failed' }, { id, state: 'BLOCKED', message: 'unavailable' }],
    skips: [{ id, note: 'not run' }] }, 1, cwd, []);
  assert.deepEqual(run.tests.map(({ state }) => state), ['LISTED', 'BLOCKED', 'INCONCLUSIVE']);
  assert.equal(run.found.state, 'BLOCKED');
});

test('an unfinished Vitest report cannot turn a listed failure and missing results into PASS', (t) => {
  const id = 'tests/example.test.ts › listed';
  const cwd = fixture(t, {}, { [id]: reason });
  const report = join(cwd, 'report');
  writeFileSync(report, `${JSON.stringify({ type: 'fail', file: join(cwd, 'tests/example.test.ts'), name: 'listed', error: { message: 'failed' } })}\n`);
  const results = testsOf([process.execPath, 'node_modules/vitest/vitest.mjs', 'run'], cwd, { report, output: '', status: 1 });
  assert.equal(readRun(results, 1, cwd, []).found?.state, 'INCONCLUSIVE');
});
