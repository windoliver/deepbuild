// Helpers for #2487's acceptance tests: a sandboxed HOME, scratch git repositories the real `node scripts/proof.mjs
// guard` runs in, two planted issues (the one the change names, and another whose tagged tests main holds), and signed
// and unsigned approval tags made with throwaway keys. Nothing here imports the code under test: the guard is reached
// only by running it (README: The guard). Written for this suite after tests/acceptance/1872/helpers.mjs, never
// imported from it.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVERS, people, tag } from '../../fixtures/approver.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** A guard run takes seconds on an idle machine and far longer on a loaded one; a hang still ends. */
export const LONG = { timeout: 300_000 };
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_GATES'];

/** The planted issue every scratch change names, and another issue, whose tagged tests main already holds. */
export const OWN = 9044;
export const OTHER = 9350;
const CRITERION = { [OWN]: 'The planted change does what its own issue asks', [OTHER]: 'Another issue\'s planted behavior holds' };
/** A criterion's tag as the proof lanes compute it: the issue, then eight hex digits of its text's SHA-256. */
const idOf = (issue) => `#${issue}.${createHash('sha256').update(CRITERION[issue].trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
export const OWN_TAG = idOf(OWN);
export const OTHER_TAG = idOf(OTHER);

/** A sandbox removed after the test, with its own HOME; every process it started is stopped by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2487-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of ENV_OUT) delete env[name];
  const box = { dir, home, env, children: [] };
  t.after(() => {
    for (const child of box.children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Runs `argv` in its own process group; resolves with its status and output. */
function run(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
}

function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(cwd, path), { force: true });
      continue;
    }
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

const gitIn = (cwd, env) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, stdio: 'pipe', encoding: 'utf8' });

// ---- What main holds in every scene ----

/** The other issue's suite, as #350's was: one vitest file of four tests, each carrying its tag, and three fixtures. */
export const STAGED = `tests/acceptance/${OTHER}/staged.test.ts`;
export const STAGED_FIXTURES = ['listed', 'renamed', 'empty'].map((name) => `tests/acceptance/${OTHER}/fixtures/${name}.json`);
export const STAGED_TESTS = ['lists a staged file', 'lists a staged rename under its new name', 'lists nothing when nothing is staged', 'lists each staged file once'].map((name) => `${OTHER_TAG} ${name}`);
const stagedText = `import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const staged = (name) => JSON.parse(readFileSync(new URL(\`./fixtures/\${name}.json\`, import.meta.url), 'utf8')).staged;

test('${STAGED_TESTS[0]}', () => {
  expect(staged('listed')).toEqual(['a.txt']);
});

test('${STAGED_TESTS[1]}', () => {
  expect(staged('renamed')).toEqual(['b.txt']);
});

test('${STAGED_TESTS[2]}', () => {
  expect(staged('empty')).toEqual([]);
});

test('${STAGED_TESTS[3]}', () => {
  expect(new Set(staged('listed')).size).toBe(staged('listed').length);
});
`;

/** A second file of the other issue's: two node tests, each carrying its tag, and no fixture. */
export const KEPT = `tests/acceptance/${OTHER}/kept.test.mjs`;
export const KEPT_TESTS = ['keeps the order it was given', 'keeps an empty list empty'].map((name) => `${OTHER_TAG} ${name}`);
const keptLines = ['import assert from \'node:assert/strict\';', 'import test from \'node:test\';', 'import { kept } from \'../../../src/kept.mjs\';', '',
  `test('${KEPT_TESTS[0]}', () => {`, '  assert.deepEqual(kept([3, 1, 2]), [3, 1, 2]);', '});', '',
  `test('${KEPT_TESTS[1]}', () => {`, '  assert.deepEqual(kept([]), []);', '});', ''];
export const keptText = keptLines.join('\n');
/** kept.test.mjs with its first test's assertion weakened: the test stays, its name and tag too, and proves nothing. */
export const keptWeakened = keptLines.map((line) => (line === '  assert.deepEqual(kept([3, 1, 2]), [3, 1, 2]);' ? '  assert.ok(kept([3, 1, 2]));' : line)).join('\n');
/** kept.test.mjs with its second test deleted; the first is left as it was. */
export const keptOneDeleted = `${keptLines.slice(0, 7).join('\n')}\n`;

/** The change's own issue's test file on main: two tests, neither carrying a tag. */
export const MINE = `tests/acceptance/${OWN}/mine.test.mjs`;
const mineHead = ['import assert from \'node:assert/strict\';', 'import test from \'node:test\';', 'import { planted } from \'../../../src/planted.mjs\';', ''];
const mineFirst = (expected) => ['test(\'the planted function answers\', () => {', `  assert.equal(planted(), ${expected});`, '});', ''];
const mineSecond = ['test(\'the planted function takes no argument\', () => {', '  assert.equal(planted.length, 0);', '});', ''];
export const mineText = [...mineHead, ...mineFirst(1), ...mineSecond].join('\n');
/** mine.test.mjs with its first, untagged, test's expected value changed. */
export const mineEdited = [...mineHead, ...mineFirst(2), ...mineSecond].join('\n');
/** mine.test.mjs with its second, untagged, test deleted. */
export const mineOneDeleted = [...mineHead, ...mineFirst(1)].join('\n');
/** mine.test.mjs with a third test added after the two, carrying the change's own issue's tag. */
export const mineWithTagged = [...mineHead, ...mineFirst(1), ...mineSecond, `test('${OWN_TAG} the planted function answers twice alike', () => {`, '  assert.equal(planted(), planted());', '});', ''].join('\n');

/** A new test file of the change's own issue; `tagged` gives each of its two tests the issue's tag. */
export const ADDED = `tests/acceptance/${OWN}/added.test.mjs`;
export const addedText = (tagged, expected = 1) => [...mineHead,
  `test('${tagged ? `${OWN_TAG} ` : ''}an added test reads the answer', () => {`, `  assert.equal(planted(), ${expected});`, '});', '',
  `test('${tagged ? `${OWN_TAG} ` : ''}an added test reads a number', () => {`, '  assert.equal(typeof planted(), \'number\');', '});', ''].join('\n');

/** The code the planted tests read; a change's commits that are not about tests edit it. */
export const SOURCE = 'src/planted.mjs';
export const source = (answer) => `export const planted = () => ${answer};\n`;

const MAIN = {
  [STAGED]: stagedText,
  [STAGED_FIXTURES[0]]: '{ "staged": ["a.txt"] }\n',
  [STAGED_FIXTURES[1]]: '{ "staged": ["b.txt"] }\n',
  [STAGED_FIXTURES[2]]: '{ "staged": [] }\n',
  [KEPT]: keptText,
  'src/kept.mjs': 'export const kept = (list) => [...list];\n',
  [MINE]: mineText,
  [SOURCE]: source(1),
};

/**
 * A scratch repository for the guard. Main holds a stand-in scripts/proof-guard.mjs (so the proof lanes are on main),
 * the maintainer's key on the approvers list, the other issue's two test files and three fixtures, and the change's own
 * issue's untagged test file; origin/main is at that commit, and the scene is on branch `change`. Both planted issues
 * are files in a folder DEEP_PROOF_ISSUES names, each with the one criterion its tag is the ID of.
 * commit() writes files (null deletes one) and commits them, its message naming the change's own issue (`Part of
 * #9044` unless `word` says otherwise); approve() tags a commit under deep/approved/ with one `Approves:` line per
 * item, signed by the maintainer, or unsigned when signer is null; guard() runs this checkout's real
 * `node scripts/proof.mjs guard` there.
 */
export function guardRepo(box) {
  const cwd = join(box.dir, 'repo');
  mkdirSync(cwd);
  const git = gitIn(cwd, box.env);
  git('init', '-q', '-b', 'main');
  const keys = people();
  write(cwd, { 'scripts/proof-guard.mjs': '// the guard\n', [APPROVERS]: keys.list, ...MAIN });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  const issues = join(box.dir, 'issues');
  write(issues, Object.fromEntries([OWN, OTHER].map((issue) => [`${issue}.md`, `Planted for #2487.\n\n### Acceptance criteria\n- [ ] ${CRITERION[issue]}\n`])));
  let tags = 0;
  return {
    cwd,
    commit(files, subject = 'Change the files', word = 'Part of') {
      write(cwd, files);
      git('add', '-A');
      git('commit', '-qm', `${subject}\n\n${word} #${OWN}`);
      return git('rev-parse', 'HEAD').trim();
    },
    approve(commit, items, signer = 'maintainer') {
      tag(cwd, `deep/approved/${++tags}`, commit, items, signer && keys[signer]);
    },
    guard: () => run(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env: { DEEP_PROOF_ISSUES: issues } }),
  };
}

/** The guard's FAIL lines (`FAIL guard: ...`). */
const failLines = (result) => result.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:'));
/** The guard's PASS lines (`PASS guard: ...`). */
const passLines = (result) => result.stdout.split('\n').filter((line) => line.startsWith('PASS guard:'));

const tail = (text, size = 2_500) => (text.length > size ? `…${text.slice(-size)}` : text);
const dump = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${tail(result.stdout)}\nstderr:\n${tail(result.stderr, 800)}`;

/** The guard refused the change: a FAIL line, a non-zero exit, and a FAIL line holding `name`. */
export function expectRefused(result, what, name) {
  const all = dump(result);
  assert.ok(failLines(result).length, `${what} passed the guard\n${all}`);
  assert.notEqual(result.status, 0, `${what}: the guard printed FAIL but exited 0\n${all}`);
  assert.ok(failLines(result).some((line) => line.includes(name)), `${what} failed the guard, but no FAIL line names ${name}\n${all}`);
}

/** The guard passed: no FAIL line, exit 0, a PASS line, and, when `name` is given, a PASS line holding it. */
export function expectPassed(result, what, name) {
  const all = dump(result);
  assert.deepEqual(failLines(result), [], `${what} failed the guard\n${all}`);
  assert.equal(result.status, 0, `${what}: the guard printed no FAIL but exited ${result.status}\n${all}`);
  assert.ok(passLines(result).length, `the guard printed no PASS for ${what}\n${all}`);
  if (name) assert.ok(passLines(result).some((line) => line.includes(name)), `the guard passed ${what} without judging it: no PASS line names ${name}\n${all}`);
}
