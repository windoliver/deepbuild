// Test-side fixtures only: a scratch git repository, and this checkout's `node scripts/proof.mjs guard` run in it
// with a clean environment. No implementation module is imported, and nothing from another suite.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const LIST = '.deepbuild/approvers';
export const FIRST = 'tests/first.test.mjs';
export const SECOND = 'tests/second.test.mjs';
export const BOUNDS = 'tests/fixtures/bounds.jsonl';
// The scratch repository's own criterion tags, computed as it runs so no line of this suite reads as a real one.
const tag = (words) => `#93166.${createHash('sha256').update(words).digest('hex').slice(0, 8)}`;
const source = (words) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${tag(words)} ${words}', () => { assert.equal(2 + 2, 4); });\n`;
const SOURCES = { [FIRST]: source('the first receipt is checked'), [SECOND]: source('the second receipt is checked') };
const bound = (tolerance) => `{"case":"sum","criterion":"${tag('the sum is within its bound')}","tolerance":${tolerance},"input":[0.1,0.2],"expected":0.3}\n`;
const BOUNDS_TEST = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nconst rows = readFileSync(new URL('fixtures/bounds.jsonl', import.meta.url), 'utf8').trim().split('\\n').map((row) => JSON.parse(row));\ntest('${tag('the sum is within its bound')} the sum is within its bound', () => { for (const { input, expected, tolerance } of rows) assert.ok(Math.abs(input[0] + input[1] - expected) <= tolerance); });\n`;

export function put(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
export function world(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'd3166-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  return { dir, home };
}
// An allowlist, so no real credential, SSH agent, git config or DEEP_* variable reaches a fixture or the guard.
export function env(home) {
  return { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: home,
    TMPDIR: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', NO_COLOR: '1' };
}
export function run(w, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: w.repo ?? w.dir, env: env(w.home), encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024, ...options });
  assert.ok(!result.error, `BLOCKED: cannot run ${command}: ${result.error?.code ?? ''}`);
  assert.equal(result.signal, null, `BLOCKED: ${command} ended by ${result.signal}`);
  return { ...result, out: (result.stdout ?? '') + (result.stderr ?? '') };
}
export function git(w, ...args) {
  const r = run(w, 'git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args]);
  assert.equal(r.status, 0, `BLOCKED: fixture git ${args[0]} failed: ${r.out}`);
  return r.stdout.trim();
}
/** A repository whose main holds the approvers list, two tagged tests and a tagged fixture of bounds; the change is on session/3166. */
export function repository(t, list) {
  const w = world(t);
  w.repo = join(w.dir, 'repo');
  mkdirSync(w.repo);
  git(w, 'init', '-q', '-b', 'main');
  put(join(w.repo, LIST), list);
  for (const [path, text] of Object.entries(SOURCES)) put(join(w.repo, path), text);
  put(join(w.repo, BOUNDS), bound('1e-6'));
  put(join(w.repo, 'tests/bounds.test.mjs'), BOUNDS_TEST);
  put(join(w.repo, 'scripts/proof-guard.mjs'), '// The proof lanes are on main.\n');
  commit(w, 'base');
  git(w, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(w, 'checkout', '-q', '-b', 'session/3166');
  return w;
}
/** Commits everything in the worktree; returns the commit's full ID. No message names an issue, so none is fetched. */
export function commit(w, message) {
  git(w, 'add', '-A');
  git(w, 'commit', '-q', '-m', message);
  return git(w, 'rev-parse', 'HEAD');
}
/** Edits a tagged test: skips it. */
export function skip(w, path) { put(join(w.repo, path), SOURCES[path].replace('test(', 'test.skip(')); }
/** Raises the fixture's tolerance in place, from 1e-6 to 1e-4. */
export function loosen(w) { put(join(w.repo, BOUNDS), bound('1e-4')); }
export function note(w, name = 'note.txt') { put(join(w.repo, name), `Unguarded work in ${name}.\n`); }

export function guard(t, w, label) {
  const r = run(w, process.execPath, [join(ROOT, 'scripts/proof.mjs'), 'guard']);
  t.diagnostic(`${label}: exit ${r.status}\n${r.out}`);
  return r;
}
const lines = (r, state) => r.stdout.split('\n').filter((line) => line.startsWith(`${state} guard:`));
/** The guard passed, saying so, and a PASS line names each approved edit. */
export function passes(r, label, ...names) {
  assert.equal(r.status, 0, `${label}: the guard must pass\n${r.out}`);
  assert.ok(lines(r, 'PASS').length, `${label}: a pass must be said, not silent\n${r.out}`);
  assert.doesNotMatch(r.stdout, /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE) guard:/m, `${label}\n${r.out}`);
  for (const name of names) assert.ok(lines(r, 'PASS').some((line) => line.includes(name)), `${label}: a PASS guard line must name the approved edit of ${name}\n${r.out}`);
}
/** The guard failed by its own FAIL lines, one naming each edit, and no PASS line lets any of them through. */
export function fails(r, label, ...names) {
  assert.equal(r.status, 1, `${label}: the guard must fail\n${r.out}`);
  assert.ok(lines(r, 'FAIL').length, `${label}: expected FAIL guard lines, not a crash or BLOCKED\n${r.out}`);
  for (const name of names) {
    assert.ok(lines(r, 'FAIL').some((line) => line.includes(name)), `${label}: a FAIL guard line must name ${name}\n${r.out}`);
    assert.ok(!lines(r, 'PASS').some((line) => line.includes(name)), `${label}: no PASS guard line may let ${name} through\n${r.out}`);
  }
}
/** Some FAIL guard line holds the words. */
export function says(r, label, words) {
  assert.ok(lines(r, 'FAIL').some((line) => line.includes(words)), `${label}: a FAIL guard line must say "${words}"\n${r.out}`);
}
