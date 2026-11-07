// What #1115's blind suite leaves out (its README, What the tests can't see): each test here names the wrong reading it
// stops. The lanes run for real, in a scratch repository with a sandboxed HOME.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cargoResults, exactTree, readRun, readSkips, reportResults, testsOf } from '../scripts/lanes.mjs';

const CHECKOUT = fileURLToPath(new URL('../', import.meta.url));
const VITEST = join(CHECKOUT, 'node_modules/vitest/vitest.mjs');
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** A scratch repository holding the files, committed, that resolves vitest; removed after the test. */
function repository(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deep-results-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'node_modules'));
  symlinkSync(join(CHECKOUT, 'node_modules/vitest'), join(root, 'node_modules/vitest'));
  for (const [path, text] of Object.entries({ '.gitignore': 'node_modules\nhome\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'files');
  return root;
}

/** The lane's printed output, from the real runLanes under a sandboxed HOME. */
function lane(root, commands) {
  const runner = pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href;
  const code = `import { runLanes } from ${JSON.stringify(runner)};
    process.exitCode = runLanes([{ name: 'gap', commands: ${JSON.stringify(commands)}, fix: 'none' }], { cwd: process.cwd() });`;
  const { DEEP_THROTTLE, DEEP_PROOF_VITEST_REPORT, NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', env: { ...env, HOME: join(root, 'home') } });
  return result.stdout + result.stderr;
}

test('a suite failing on its hook beside a test failing INCONCLUSIVE stays FAIL: the hook is no test that named its state', (t) => {
  const root = repository(t, { 'hook.test.ts': `import { beforeAll, describe, expect, test } from 'vitest';
test('unsure', () => { expect.fail('INCONCLUSIVE: not read here'); });
describe('around', () => {
  beforeAll(() => { throw new Error('the hook broke'); });
  test('never starts', () => {});
});` });
  assert.match(lane(root, [[process.execPath, VITEST, 'run']]), /^FAIL gap\b/m);
});

test('a platform note is never listed, whatever the list holds, and leaves the lane INCONCLUSIVE (platform)', (t) => {
  const note = 'INCONCLUSIVE: macOS only';
  const root = repository(t, {
    'scripts/known-failures.json': JSON.stringify({ skips: [{ id: 'gap.test.mjs › absent here', note, reason: 'a list that may not hold it', approval: 'none' }] }),
    'gap.test.mjs': `import { test } from 'node:test';\ntest('absent here', (t) => { t.skip(${JSON.stringify(note)}); });`,
  });
  const output = lane(root, [[process.execPath, '--test', 'gap.test.mjs']]);
  assert.match(output, /^INCONCLUSIVE gap \(platform\):/m);
  assert.doesNotMatch(output, /^LISTED /m);
});

test('a BLOCKED note naming a GPU is a block, not a platform skip: a list can hold it, and its lane reads BLOCKED unlabelled', (t) => {
  const note = 'BLOCKED: no record from an M1 (unblock: run deep-gpu on an M1 Mac)';
  const skip = { id: 'gap.test.mjs › by design', note };
  assert.deepEqual(readSkips([skip], [{ ...skip, note: 'BLOCKED: no record from an M1', reason: 'approved', approval: 'owner' }]).open, []);
  const root = repository(t, { 'gap.test.mjs': `import { test } from 'node:test';\ntest('by design', (t) => { t.skip(${JSON.stringify(note)}); });` });
  assert.match(lane(root, [[process.execPath, '--test', 'gap.test.mjs']]), /^BLOCKED gap:/m);
});

test('a lane that fails beside a platform skip reads FAIL, without the (platform) that belongs to an INCONCLUSIVE one', (t) => {
  const root = repository(t, { 'gap.test.mjs': `import { test } from 'node:test';
test('broken', () => { throw new Error('wrong'); });
test('absent here', (t) => { t.skip('INCONCLUSIVE: macOS only'); });` });
  assert.match(lane(root, [[process.execPath, '--test', 'gap.test.mjs']]), /^FAIL gap:/m);
});

test('outside git a lane writes no record: one with no tree could only be found by nothing', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deep-results-plain-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'gap.test.mjs'), `import { test } from 'node:test';\ntest('runs', () => {});`);
  const output = lane(root, [[process.execPath, '--test', 'gap.test.mjs']]);
  assert.match(output, /^PASS gap\b/m);
  assert.doesNotMatch(output, /no evidence record/);
  assert.equal(existsSync(join(root, 'home/.deepbuild/lanes')), false);
});

test('a repository nothing was added to yet still has a tree: git init writes no index, and its lane gets a record, not a block', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deep-results-new-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'gap.test.mjs'), `import { test } from 'node:test';\ntest('runs', () => {});`);
  git(root, 'init', '-q');
  const output = lane(root, [[process.execPath, '--test', 'gap.test.mjs']]);
  assert.match(output, /^PASS gap\b/m);
  assert.equal(readdirSync(join(root, 'home/.deepbuild/lanes')).length, 1);
});

test('a checkout git can\'t write a tree for gets no silent pass: its lane reads BLOCKED, naming the missing record', (t) => {
  const root = repository(t, { 'gap.test.mjs': `import { test } from 'node:test';\ntest('runs', () => {});` });
  writeFileSync(join(root, 'unreadable.txt'), 'x');
  chmodSync(join(root, 'unreadable.txt'), 0o000);
  const output = lane(root, [[process.execPath, '--test', 'gap.test.mjs']]);
  chmodSync(join(root, 'unreadable.txt'), 0o600);
  assert.match(output, /BLOCKED gap: no evidence record/);
});

test('a lane that already failed keeps its one verdict when no tree can be written: the missing record is a note, not a block', (t) => {
  const root = repository(t, { 'gap.test.mjs': `import { test } from 'node:test';\ntest('broken', () => { throw new Error('wrong'); });` });
  writeFileSync(join(root, 'unreadable.txt'), 'x');
  chmodSync(join(root, 'unreadable.txt'), 0o000);
  const output = lane(root, [[process.execPath, '--test', 'gap.test.mjs']]);
  chmodSync(join(root, 'unreadable.txt'), 0o600);
  assert.match(output, /^FAIL gap:/m);
  assert.doesNotMatch(output, /^BLOCKED gap:/m);
  assert.match(output, /^NOTE gap: no evidence record/m);
});

test('a test vitest\'s -t filter leaves out is no skip, and a skip it runs still is', (t) => {
  const root = repository(t, { 'gap.test.ts': `import { test } from 'vitest';
test('wanted', () => {});
test('left out', () => {});
test('wanted too, but unrun', (ctx) => { if (process.env.GAP_SKIP) ctx.skip('INCONCLUSIVE: unrun'); });` });
  const command = [process.execPath, VITEST, 'run', '-t', 'wanted'];
  assert.match(lane(root, [command]), /^PASS gap\b/m);
  assert.match(lane(root, [['env', 'GAP_SKIP=1', ...command]]), /^INCONCLUSIVE gap:/m);
});

test('cargo\'s ignored tests read as skips, with the reason cargo prints, and never as passes', () => {
  const output = '     Running unittests src/lib.rs (target/debug/deps/deep_x-0123456789abcdef)\n\ntest plain ... ignored\ntest reasoned ... ignored, needs a GPU\ntest runs ... ok\n';
  const { passed, skips } = cargoResults(output, 0, []);
  assert.deepEqual(passed, ['cargo deep_x src/lib.rs › runs']);
  assert.deepEqual(skips, [{ id: 'cargo deep_x src/lib.rs › plain', note: '' }, { id: 'cargo deep_x src/lib.rs › reasoned', note: 'needs a GPU' }]);
});

test('the tree hash is what is on disk: HEAD\'s tree when clean, another for an edit or an untracked file, the index left as it was', (t) => {
  const root = repository(t, { 'a.txt': 'one\n' });
  const clean = exactTree(root);
  assert.equal(clean, git(root, 'rev-parse', 'HEAD^{tree}'));
  writeFileSync(join(root, 'a.txt'), 'two\n');
  const edited = exactTree(root);
  assert.notEqual(edited, clean);
  writeFileSync(join(root, 'b.txt'), 'new\n');
  assert.notEqual(exactTree(root), edited);
  assert.equal(git(root, 'diff', '--cached', '--name-only'), '');
  assert.equal(exactTree(mkdtempSync(join(tmpdir(), 'deep-results-plain-'))), null);
});

test('a same-size edit in the second the index was written still changes the tree: the copied index keeps its age', async (t) => {
  await new Promise((done) => setTimeout(done, 1000 - Date.now() % 1000));
  const root = repository(t, { 'a.txt': 'one\n' });
  writeFileSync(join(root, 'a.txt'), 'two\n');
  await new Promise((done) => setTimeout(done, 1200));
  assert.notEqual(exactTree(root), git(root, 'rev-parse', 'HEAD^{tree}'));
});

test('a reading-only note with its reason inside the bracket stays under the reading-only rule: full note, no criterion, no timed file', () => {
  const note = 'INCONCLUSIVE (reading only: not on mains power)';
  const skip = { id: 'plain.test.ts › reads', note }, entry = { ...skip, reason: 'approved', approval: 'owner' };
  assert.deepEqual(readSkips([skip], [entry]).open, []);
  assert.equal(readSkips([skip], [{ ...entry, note: 'INCONCLUSIVE (reading only' }]).open.length, 1);
  const tagged = { id: 'plain.test.ts › #1.0123abcd reads', note };
  assert.equal(readSkips([tagged], [{ ...tagged, reason: 'approved', approval: 'owner' }]).open.length, 1);
});

test('the throttle\'s marker counts only as a report\'s one row: beside others, a test\'s own throttle left it', () => {
  const marker = JSON.stringify({ type: 'no-grant', message: 'no test grant came within 30 min' });
  assert.equal(reportResults('/repo', marker).noGrant, 'no test grant came within 30 min');
  const beside = [marker, JSON.stringify({ type: 'pass', file: '/repo/a.test.ts', name: 'ran' })].join('\n');
  assert.equal(reportResults('/repo', beside).noGrant, undefined);
});

test('a runner killed outright isn\'t explained by a test that named its own state', () => {
  const results = { failures: [{ id: 'a › b', state: 'INCONCLUSIVE', message: 'INCONCLUSIVE: x' }], passed: [], skips: [] };
  assert.equal(readRun(results, 1, '/nowhere', []).explained, true);
  assert.equal(readRun(results, 137, '/nowhere', []).explained, false);
  assert.equal(readRun(null, null, '/nowhere', []).explained, false);
});

test('a report cut off mid-line reads as no report, so the lane falls back on the exit status', (t) => {
  const root = repository(t, { report: '{"type":"pass","file":"/a' });
  assert.equal(testsOf(['node', '--test'], root, { report: join(root, 'report'), output: '', status: 1 }), null);
});

test('a todo is unrun, so it is a skip in both runners\' rows', () => {
  const { skips, passed } = reportResults('/repo', [
    JSON.stringify({ type: 'skip', file: '/repo/a.test.ts', name: 'vitest todo' }),
    JSON.stringify({ type: 'pass', file: '/repo/b.test.mjs', name: 'node todo', nesting: 0, todo: true, note: 'later' }),
  ].join('\n'));
  assert.deepEqual(passed, []);
  assert.deepEqual(skips, [{ id: 'a.test.ts › vitest todo', note: '' }, { id: 'b.test.mjs › node todo', note: 'later' }]);
  assert.deepEqual(readSkips(skips).open.map(({ state }) => state), ['INCONCLUSIVE', 'INCONCLUSIVE']);
});
