import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks } from '../../../scripts/lanes.mjs';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SCRIPT = 'scripts/comment-ratchet.mjs';
export const CEILINGS = 'scripts/comment-ceilings.json';
export const BLIND = 'tests/acceptance/';
export const lint = checks.find(({ name }) => name === 'lint');

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

const runsScript = (command, script) => [process.execPath, 'node'].includes(command[0]) && command[1] === script;

export function guardCommand() {
  const command = lint?.commands.find((candidate) => runsScript(candidate, SCRIPT));
  assert.ok(command, `the lint lane runs no ${SCRIPT}`);
  return command;
}

export function guard(cwd, ...extra) {
  const [program, ...args] = guardCommand();
  const result = spawnSync(program === 'node' ? process.execPath : program, [...args, ...extra], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  return { ...result, stdout, lines: stdout.split('\n') };
}

export const show = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr ?? ''}${result.error ? `\nerror: ${result.error.message}` : ''}`;

const failLines = (result) => result.lines.filter((line) => line.startsWith('FAIL '));

export function assertPasses(result, why = '') {
  assert.equal(result.status, 0, `expected a pass ${why}\n${show(result)}`);
  assert.ok(result.lines.some((line) => line.startsWith('PASS ')), `no PASS line ${why}\n${show(result)}`);
  assert.ok(!result.lines.some((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line)), `a line in another state ${why}\n${show(result)}`);
}

export function assertFailsNaming(result, path, why = '') {
  assert.ok(failLines(result).some((line) => line.includes(path)), `no FAIL line naming ${path} ${why}\n${show(result)}`);
  assert.equal(result.status, 1, `expected exit 1 ${why}\n${show(result)}`);
}

export function assertNotNamed(result, path, why = '') {
  assert.ok(!failLines(result).some((line) => line.includes(path)), `a FAIL line names ${path} ${why}\n${show(result)}`);
}

export const listedUnderBlind = (cwd) => Object.keys(JSON.parse(readFileSync(join(cwd, CEILINGS), 'utf8'))).filter((path) => path.startsWith(BLIND));

export function put(cwd, path, content) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

export function commitAll(cwd, message) {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

export const LISTED = 'packages/fixture/src/note.ts';
const listedText = ['// the one listed comment', 'export const NOTE = 1;', ''].join('\n');

export function repo(t, files) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-comments-3455-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, '.git', 'info'), { recursive: true });
  appendFileSync(join(cwd, '.git', 'info', 'exclude'), '\n/scripts/\n/node_modules\n');
  mkdirSync(join(cwd, 'scripts'));
  for (const name of readdirSync(join(root, 'scripts')))
    if (statSync(join(root, 'scripts', name)).isFile()) copyFileSync(join(root, 'scripts', name), join(cwd, 'scripts', name));
  symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
  put(cwd, LISTED, listedText);
  put(cwd, CEILINGS, `${JSON.stringify({ [LISTED]: 1 }, null, 2)}\n`);
  for (const [path, content] of Object.entries(files)) put(cwd, path, content);
  git(cwd, 'add', '-A');
  git(cwd, 'add', '-f', CEILINGS);
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}

const PLANT = {
  mjs: '// a planted comment',
  ts: '// a planted comment',
  rs: '    // a planted comment',
  wgsl: '  // a planted comment',
};

const lines = (parts) => `${parts.filter((part) => part !== null).join('\n')}\n`;

export const suiteFiles = (n) => ({
  test: `tests/acceptance/${n}/double.test.mjs`,
  helper: `tests/acceptance/${n}/helpers.ts`,
  rust: `tests/acceptance/${n}/fixture/src/lib.rs`,
  wgsl: `tests/acceptance/${n}/fixture/src/half.wgsl`,
});

export const testText = (plant = false) => lines([
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  "import { double } from './helpers.ts';",
  '',
  "test('double of two is four', () => {",
  plant ? PLANT.mjs : null,
  '  assert.equal(double(2), 4);',
  '});',
]);

export const helperText = (plant = false) => lines([
  'export function double(n: number): number {',
  plant ? PLANT.ts : null,
  '  return n * 2;',
  '}',
]);

export const rustText = (plant = false) => lines([
  'pub fn double(n: u32) -> u32 {',
  plant ? PLANT.rs : null,
  '    n * 2',
  '}',
]);

export const wgslText = (plant = false) => lines([
  'fn half(x: f32) -> f32 {',
  plant ? PLANT.wgsl : null,
  '  return x / 2.0;',
  '}',
]);

export const writers = { test: testText, helper: helperText, rust: rustText, wgsl: wgslText };

export const suite = (n, planted = null) => Object.fromEntries(Object.entries(suiteFiles(n)).map(([kind, path]) => [path, writers[kind](kind === planted)]));

export const commentedSuite = (n) => Object.fromEntries(Object.entries(suiteFiles(n)).map(([kind, path]) => [path, writers[kind](true)]));
