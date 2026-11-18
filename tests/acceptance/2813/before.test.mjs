// #2813: in the before lane, a node test file whose `node --test` run ends with no report is the only file
// BLOCKED for it; a neighbouring file that passes on the change and fails on the base is still proven.
// Reached by running this checkout's `node scripts/proof.mjs before` in a scratch repository (README).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const ISSUE = 9813; // a planted issue; its tags are worked out here, so no file carries them
const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const LOST = criterionId(ISSUE, 'A file whose run writes no report');
const VALUE = criterionId(ISSUE, 'The value is two');
const LOST_FILE = `tests/acceptance/${ISSUE}/lost.test.mjs`;
const VALUE_FILE = `tests/acceptance/${ISSUE}/value.test.mjs`;

// A file whose `node --test` run ends with no report: it finds the --test-reporter-destination of the runner
// above it (its own command line or an ancestor's), waits for that file to appear, and removes it. The runner
// keeps writing to the removed file, so the run ends with no report wherever this file falls among its
// neighbours, in one run or in parallel. On both the base and the change.
const LOST_TEST = `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';

function destination() {
  for (let pid = process.pid, hops = 0; pid > 1 && hops < 10; hops++) {
    const line = execFileSync('/bin/ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const [, ppid, command] = line.match(/^(\\d+)\\s+(.*)$/s) ?? [];
    const found = command?.match(/--test-reporter-destination[= ](\\S+)/);
    if (found) return found[1];
    pid = Number(ppid);
  }
  return null;
}

test('${LOST} a file whose run writes no report', async () => {
  const report = destination();
  assert.ok(report, 'no runner above this file names a --test-reporter-destination');
  const end = Date.now() + 10_000;
  while (!existsSync(report) && Date.now() < end) await new Promise((done) => setTimeout(done, 20));
  assert.ok(existsSync(report), 'the runner never opened its report ' + report);
  rmSync(report);
});
`;

const VALUE_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import { value } from '../../../src/value.mjs';

test('${VALUE} the value is two', () => {
  assert.equal(value(), 2);
});
`;

function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

function scene(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2813-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const children = [];
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  const cwd = join(dir, 'scene');
  mkdirSync(cwd);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  write(cwd, { 'src/value.mjs': 'export const value = () => 1;\n' });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  write(cwd, { 'src/value.mjs': 'export const value = () => 2;\n', [LOST_FILE]: LOST_TEST, [VALUE_FILE]: VALUE_TEST });
  git('add', '-A');
  git('commit', '-qm', `Make the value two\n\nPart of #${ISSUE}`);
  const issues = join(dir, 'issues');
  write(issues, { [`${ISSUE}.md`]: `Planted for #2813.\n\n### Acceptance criteria\n- [ ] A file whose run writes no report\n- [ ] The value is two\n\n### Proof\nNone.\n` });
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: join(dir, 'no-approvers') };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_BIN_DIR']) delete env[name];
  return { cwd, env, children };
}

function run({ cwd, env, children }, argv) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
}

test('#2813.9c532f47 in the before lane, a node test file whose run ends with no report is the only file BLOCKED as unable to run on the change; its neighbour that passes on the change and fails on the base is proven', async (t) => {
  const box = scene(t);
  const proof = await run(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'before']);
  const all = `exit ${proof.status}${proof.signal ? ` (${proof.signal})` : ''}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`;
  const lines = proof.stdout.split('\n');
  const cannot = lines.filter((line) => /^BLOCKED before: .*cannot run on the change/.test(line));
  assert.ok(cannot.some((line) => line.includes(LOST_FILE)), `the file whose run wrote no report does not read BLOCKED … cannot run on the change\n${all}`);
  assert.deepEqual(cannot.filter((line) => !line.includes(LOST_FILE)), [], `a file other than the one whose run wrote no report reads BLOCKED … cannot run on the change\n${all}`);
  assert.deepEqual(lines.filter((line) => /^BLOCKED /.test(line) && (line.includes(VALUE_FILE) || line.includes(VALUE))), [], `the passing file's tagged test reads BLOCKED\n${all}`);
  assert.ok(lines.some((line) => line.startsWith('PASS before: ') && line.includes(VALUE_FILE) && line.includes(VALUE)), `the passing file's tagged test ${VALUE} is not proven by the before lane\n${all}`);
});
