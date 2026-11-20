// Shared by the #1604 acceptance tests. The wait guard is reached only through the lint lane's command for it, taken
// from `scripts/lanes.mjs`'s exported `checks` and run as a process with cwd at the checkout it checks (README:
// Surfaces). Scratch repositories live under the realpathed system temporary folder and are removed in t.after.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks, testPaths } from '../../../scripts/lanes.mjs';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SCRIPT = 'scripts/wait-ratchet.mjs';
export const CEILINGS = 'scripts/wait-ceilings.json';
export const lint = checks.find(({ name }) => name === 'lint');

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** A lint command that runs `script` with node, as the lane lists it. */
export const runsScript = (command, script) => [process.execPath, 'node'].includes(command[0]) && command[1] === script;

/** The lint lane's command for the wait guard; the test fails here when the lane has none. */
export function guardCommand() {
  const command = lint?.commands.find((candidate) => runsScript(candidate, SCRIPT));
  // The node path is left out of the message, so no local path lands in the evidence.
  assert.ok(command, `the lint lane runs no ${SCRIPT}; its node commands are ${JSON.stringify(lint?.commands.filter((c) => c[0] === process.execPath).map((c) => c.slice(1).join(' ')))}`);
  return command;
}

/** Runs the lane's wait-guard command with cwd at `cwd`. */
export function guard(cwd) {
  const [program, ...args] = guardCommand();
  // deadline: turns a hung guard into a failure of this test; nothing waits on it to pass
  const result = spawnSync(program === 'node' ? process.execPath : program, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  return { ...result, stdout, lines: stdout.split('\n') };
}

export const show = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr ?? ''}${result.error ? `\nerror: ${result.error.message}` : ''}`;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fails = (result) => result.lines.filter((line) => line.startsWith('FAIL '));

/** A pass: exit 0, a PASS line, and no line in another state (a silent exit 0 is not a pass). */
export function assertPasses(result, why = '') {
  assert.equal(result.status, 0, `${why}\n${show(result)}`);
  assert.ok(result.lines.some((line) => line.startsWith('PASS ')), `no PASS line ${why}\n${show(result)}`);
  assert.ok(!result.lines.some((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line)), `${why}\n${show(result)}`);
}

/** A FAIL: exit 1 and a FAIL line naming `path` at `line` (`path:line`, a column after it allowed). */
export function assertFailsAt(result, path, line, why = '') {
  assert.equal(result.status, 1, `${why}\n${show(result)}`);
  const at = new RegExp(`${escape(path)}:${line}(?!\\d)`);
  assert.ok(fails(result).some((text) => at.test(text)), `no FAIL line naming ${path}:${line} ${why}\n${show(result)}`);
}

/** A FAIL: exit 1 and a FAIL line holding `text` (a path or a suite's folder). */
export function assertFailsNaming(result, text, why = '') {
  assert.equal(result.status, 1, `${why}\n${show(result)}`);
  assert.ok(fails(result).some((line) => line.includes(text)), `no FAIL line naming ${text} ${why}\n${show(result)}`);
}

/** No FAIL line names `path`: a finding elsewhere doesn't spill onto a file that holds its ceiling. */
export function assertNotNamed(result, path) {
  assert.ok(!fails(result).some((line) => line.includes(path)), `a FAIL line names ${path}, which is at its ceiling\n${show(result)}`);
}

export const ceilings = (entries) => `${JSON.stringify(entries, null, 2)}\n`;

/** Whether `path` is one of the repo's declared test paths (`testPaths` in scripts/lanes.mjs). */
export function isTestPath(path) {
  return testPaths.some((glob) => {
    const pattern = glob.split(/(\*\*\/|\/\*\*$|\*\*|\*)/).map((part) =>
      part === '**/' ? '(?:.*/)?' : part === '/**' ? '/.+' : part === '**' ? '.*' : part === '*' ? '[^/]*' : escape(part)).join('');
    return new RegExp(`^${pattern}$`).test(path);
  });
}

/**
 * A scratch git repository holding a copy of every flat file in this checkout's scripts/, which .git/info/exclude hides
 * from git's listing, and `files`, committed with origin/main at that commit. The ceilings file is force-added, since
 * it sits in the hidden folder.
 */
export function repo(t, files) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-waits-1604-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, '.git', 'info'), { recursive: true });
  appendFileSync(join(cwd, '.git', 'info', 'exclude'), '\n/scripts/\n');
  mkdirSync(join(cwd, 'scripts'));
  for (const name of readdirSync(join(root, 'scripts')))
    if (statSync(join(root, 'scripts', name)).isFile()) copyFileSync(join(root, 'scripts', name), join(cwd, 'scripts', name));
  for (const [path, content] of Object.entries(files)) put(cwd, path, content);
  git(cwd, 'add', '-A');
  git(cwd, 'add', '-f', CEILINGS);
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}

/** Writes `content` at `path` in the scratch repository, as an uncommitted edit or an untracked file. */
export function put(cwd, path, content) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

/** Removes `path` from the scratch repository's work tree, so the next plant runs without it. */
export const drop = (cwd, path) => rmSync(join(cwd, path), { force: true });

/** A test file of the scratch repository's own that is listed with two fixed waits, at its ceiling of 2. */
export const LISTED = 'packages/fixture/test/listed.test.ts';
export const listed = (waits) => [
  "import { expect, it } from 'vitest';",
  "import { sleep } from './helpers';",
  '',
  "it('settles', async () => {",
  ...Array.from({ length: waits }, (_, i) => `  await sleep(${(i + 1) * 100});`),
  '  expect(true).toBe(true);',
  '});',
  '',
].join('\n');

/** The scratch repository every plant starts from: LISTED with two waits, at its ceiling of 2. */
export const base = (t) => repo(t, { [LISTED]: listed(2), [CEILINGS]: ceilings({ [LISTED]: 2 }) });
