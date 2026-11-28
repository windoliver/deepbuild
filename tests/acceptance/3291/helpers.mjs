import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, criterionId, git, json, repository, run, sandbox, show } from '../1832/helpers.mjs';

export { CHECKOUT, json, sandbox, show };

export const LIST = 'scripts/whole-file-twins.json';
export const TWINS_LINT = 'scripts/twins-lint.mjs';
export const SLOW = { timeout: 900_000 };

const PRINT_LINT_CHECK = `const { checks } = await import(${JSON.stringify(join(CHECKOUT, 'scripts/lanes.mjs'))});
process.stdout.write(JSON.stringify({ node: process.execPath, commands: checks.find((check) => check.name === 'lint')?.commands ?? null }));`;

export function lintCheckCommands(box) {
  const result = run([process.execPath, '--input-type=module', '-e', PRINT_LINT_CHECK], { cwd: CHECKOUT, env: box.env, timeout: 300_000 });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read for its checks\n${show(result)}`);
  const { node, commands } = JSON.parse(result.stdout);
  assert.ok(Array.isArray(commands), `scripts/lanes.mjs exports no lint check\n${show(result)}`);
  return commands.map((argv) => argv.map((part, at) => (at === 0 && part === node ? process.execPath : part)));
}

export function twinsCommandsOfTheLintLane(box) {
  const commands = lintCheckCommands(box).filter((argv) => argv.includes(TWINS_LINT));
  assert.ok(commands.length, `the lint check of scripts/lanes.mjs runs no ${TWINS_LINT} command, so the lint lane never judges a twin`);
  return commands;
}

export function runTwinsCommands(box, cwd) {
  const runs = twinsCommandsOfTheLintLane(box).map((argv) => ({ argv, ...run(argv, { cwd, env: box.env, timeout: 600_000 }) }));
  for (const each of runs) assert.ok(each.signal === null && typeof each.status === 'number', `${each.argv.join(' ')} did not run to its end\n${show(each)}`);
  return {
    runs,
    status: runs.find((each) => each.status !== 0)?.status ?? 0,
    stdout: runs.map((each) => each.stdout).join('\n'),
    stderr: runs.map((each) => each.stderr).join('\n'),
  };
}

export const failLines = (result) => result.stdout.split('\n').filter((line) => line.startsWith('FAIL twins: '));

export function assertFailsNaming(result, folder, file) {
  assert.equal(result.status, 1, `the lint lane's twins command did not fail with exit 1\n${show(result)}`);
  const naming = failLines(result).filter((line) => line.includes(folder) && (file === undefined || line.includes(file)));
  assert.ok(naming.length, `no FAIL twins line names ${folder}${file === undefined ? '' : ` and ${file}`}\n${show(result)}`);
  assert.doesNotMatch(result.stdout, /^PASS twins\b/m, show(result));
}

export function assertPasses(result) {
  assert.deepEqual(result.runs.filter((each) => each.status !== 0).map((each) => each.argv.join(' ')), [], `a twins command of the lint lane did not exit 0\n${show(result)}`);
  assert.doesNotMatch(result.stdout, /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE) /m, show(result));
  assert.match(result.stdout, /^PASS twins\b/m, `no PASS twins line\n${show(result)}`);
}

export function assertNotNamed(result, folder) {
  assert.deepEqual(failLines(result).filter((line) => line.includes(folder)), [], `a FAIL twins line names ${folder}, a whole-file twin the merge base lists\n${show(result)}`);
}

export const LINES = json({ 'src/a.mjs': [{ find: ['export const a = 1;'], wrong: ['export const a = 2;'] }] });

export const folderOf = (suite, twin) => `tests/acceptance/${suite}/twins/${twin}`;

export function plantedSuite(suite, twins) {
  const names = Object.keys(twins);
  return {
    [`tests/acceptance/${suite}/twins.json`]: json({ [criterionId(suite, `Planted criterion of the scratch suite ${suite}`)]: names }),
    [`tests/acceptance/${suite}/plain.test.mjs`]: "import test from 'node:test';\n\ntest('nothing planted', () => {});\n",
    ...Object.fromEntries(Object.entries(twins).flatMap(([name, files]) => Object.entries(files).map(([path, content]) => [`${folderOf(suite, name)}/${path}`, content]))),
  };
}

export const WHOLE = { 'src/a.mjs': 'export const a = 3;\n' };
export const AS_LINES = { 'lines.json': LINES };

function scriptsOfThisCheckout() {
  const paths = git(CHECKOUT, 'ls-files', '-z', '--', 'scripts').split('\0').filter((path) => path && existsSync(join(CHECKOUT, path)) && statSync(join(CHECKOUT, path)).isFile());
  return {
    files: Object.fromEntries(paths.map((path) => [path, readFileSync(join(CHECKOUT, path))])),
    executable: paths.filter((path) => statSync(join(CHECKOUT, path)).mode & 0o111),
  };
}

export function scratchCheckout(box, { base, change }) {
  const scripts = scriptsOfThisCheckout();
  const cwd = repository(box, {
    base: { ...scripts.files, '.gitignore': 'node_modules\n', 'src/a.mjs': 'export const a = 1;\n', ...base },
    change,
    message: 'Part of #9291: a scratch change to the planted suites',
    executable: scripts.executable,
  });
  if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(cwd, 'node_modules'));
  return cwd;
}

export function removed(cwd, paths) {
  for (const path of paths) git(cwd, 'rm', '-q', '-r', '--', path);
  git(cwd, 'commit', '-qm', 'Part of #9291: files taken out');
}
