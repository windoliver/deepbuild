// #246 acceptance: the lint lane and lane states, through `scripts/lanes.mjs`'s exported
// `checks` and `runLanes`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checks } from '../../../scripts/lanes.mjs';
import { BASE, CRATE, lanesUrl, lintLane, repo, root, scratch, show } from './helpers.mjs';

const lint = checks.find(({ name }) => name === 'lint');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const summary = (state, rest) => new RegExp(`^${state} lint: ${escape(rest)}\\n  Fix: ${escape(lint.fix)}$`, 'm');

test('the lint lane runs scripts/repo-rules.mjs second, after cargo fmt --check, holds no inline check, and its fix points to the Fix lines', () => {
  assert.ok(lint, 'no lint lane');
  const [fmt, rulesCommand] = lint.commands;
  assert.ok(fmt[0] === 'cargo' && fmt.includes('fmt') && fmt.includes('--check'), JSON.stringify(fmt));
  assert.equal(rulesCommand?.length, 2, JSON.stringify(rulesCommand));
  assert.ok([process.execPath, 'node'].includes(rulesCommand[0]), JSON.stringify(rulesCommand));
  assert.equal(rulesCommand[1], 'scripts/repo-rules.mjs');
  for (const command of lint.commands) assert.ok(!command.some((part) => ['-e', '--eval', '-p', '--print'].includes(part)), `inline check: ${JSON.stringify(command)}`);
  assert.match(lint.fix, /Fix line/);
});

test('a clean scratch checkout passes the lint lane, with each rule saying what it read', (t) => {
  const cwd = repo(t, { tracked: CRATE });
  const result = lintLane(cwd);
  assert.equal(result.status, 0, show(result));
  assert.match(result.stdout, /^PASS workflows: \.github\/workflows\/ has no entries$/m, show(result));
  assert.match(result.stdout, /^PASS secrets: \d+ files? scanned/m, show(result));
  assert.match(result.stdout, /^PASS deps: /m, show(result));
  assert.match(result.stdout, /^PASS lint \(\d+(?:\.\d+)? s\)$/m, show(result));
});

test('a workflow file makes the lint summary FAIL lint: workflows: .github/workflows/ci.yml', (t) => {
  const cwd = repo(t, { tracked: CRATE, files: { '.github/workflows/ci.yml': 'on: push\n' } });
  const result = lintLane(cwd);
  assert.equal(result.status, 1, show(result));
  assert.match(result.stdout, summary('FAIL', 'workflows: .github/workflows/ci.yml'), show(result));
});

test('a lane takes its state from a diagnostic line that starts with FAIL, INVALID or BLOCKED, and drops the word', (t) => {
  const cwd = scratch(t, 'deep-lanes-246-');
  const lane = (name, line) => ({ name, fix: `Repair ${name}.`, commands: [[process.execPath, '-e', `console.log('check started'); console.log(${JSON.stringify(line)}); process.exitCode = 1;`]] });
  const lanes = [
    lane('blocked-lane', 'BLOCKED rule: cargo could not run'),
    lane('invalid-lane', 'INVALID rule: nothing was read'),
    lane('fail-lane', 'FAIL rule: a violation'),
    lane('plain-lane', 'Error: plain failure'),
  ];
  const code = `import { runLanes } from ${JSON.stringify(lanesUrl)}; process.exitCode = runLanes(${JSON.stringify(lanes)}, { cwd: process.cwd() });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1, show(result));
  for (const expected of [
    'BLOCKED blocked-lane: rule: cargo could not run\n  Fix: Repair blocked-lane.',
    'INVALID invalid-lane: rule: nothing was read\n  Fix: Repair invalid-lane.',
    'FAIL fail-lane: rule: a violation\n  Fix: Repair fail-lane.',
    'FAIL plain-lane: Error: plain failure\n  Fix: Repair plain-lane.',
  ]) assert.ok(result.stdout.includes(expected), `missing ${JSON.stringify(expected)}\n${show(result)}`);
});

function locked(t, files = {}) {
  const cwd = repo(t, { tracked: { ...CRATE, 'notes/locked.md': 'hello\n' }, files });
  chmodSync(join(cwd, 'notes/locked.md'), 0o000);
  t.after(() => { try { chmodSync(join(cwd, 'notes/locked.md'), 0o600); } catch {} });
  return cwd;
}

test("an unreadable file alone makes the lint summary BLOCKED, and the base's lane tests pass unedited", (t) => {
  const result = lintLane(locked(t));
  assert.equal(result.status, 1, show(result));
  assert.match(result.stdout, summary('BLOCKED', 'secrets: notes/locked.md cannot be read (EACCES)'), show(result));

  // tests/preflight.test.mjs exactly as #12 left it, run against this checkout's scripts.
  const cwd = scratch(t, 'deep-lanes-246-base-tests-');
  for (const directory of ['scripts', 'tests']) mkdirSync(join(cwd, directory));
  for (const file of readdirSync(join(root, 'scripts')))
    if (statSync(join(root, 'scripts', file)).isFile()) copyFileSync(join(root, 'scripts', file), join(cwd, 'scripts', file));
  writeFileSync(join(cwd, 'tests/preflight.test.mjs'), execFileSync('git', ['show', `${BASE}:tests/preflight.test.mjs`], { cwd: root, encoding: 'utf8' }));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.CARGO_TARGET_DIR;
  const base = spawnSync(process.execPath, ['--test', 'tests/preflight.test.mjs'], { cwd, env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(base.status, 0, show(base));
});

test('an unreadable file beside a FAIL makes the lint summary FAIL, with the FAIL printed first', (t) => {
  const result = lintLane(locked(t, { '.github/workflows/ci.yml': 'on: push\n' }));
  assert.equal(result.status, 1, show(result));
  assert.match(result.stdout, summary('FAIL', 'workflows: .github/workflows/ci.yml'), show(result));
  assert.doesNotMatch(result.stdout, /^BLOCKED lint:/m, show(result));
  const lines = result.stdout.split('\n');
  const failed = lines.indexOf('FAIL workflows: .github/workflows/ci.yml');
  const blocked = lines.indexOf('BLOCKED secrets: notes/locked.md cannot be read (EACCES)');
  assert.ok(failed !== -1 && blocked !== -1 && failed < blocked, show(result));
});
