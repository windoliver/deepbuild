// Helpers for #1872's acceptance tests: a sandboxed HOME, scratch git repositories the real `node scripts/proof.mjs
// guard` runs in, signed and unsigned approval tags made with throwaway keys, and a scratch tree the real
// `scripts/affected.mjs` runs in. Nothing here imports the code under test: every surface is reached by running it
// (README: The surface). Written for this suite after tests/acceptance/1115/helpers.mjs, never imported from it.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APPROVERS, people, tag } from '../../fixtures/approver.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const KNOWN = 'scripts/known-failures.json';
export const MAIN_WATCH = 'scripts/main-watch.mjs';
export const KNOWN_CHECK = 'scripts/known-failures-check.mjs';
/** A guard or affected.mjs run takes seconds on an idle machine and longer on a loaded one; a hang still ends. */
export const LONG = { timeout: 300_000 };
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT'];

/** The planted issue every scratch change names; its file stands in for an open issue. */
export const ISSUE = 9872;

/** A test's id, as known-failures.json and affected.mjs write it: the repo path, then each name, joined by ` › `. */
export const idOf = (file, ...names) => [file, ...names].join(' › ');

/** YYYY-MM-DD, `days` from today (UTC, as known-failures-check.mjs reads the date). */
export const day = (days = 0) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
/** A `failures` note as #1333's lint asks for: it ends `(#<issue>, added <YYYY-MM-DD>)`. */
export const note = (text, added = day()) => `${text} (#${ISSUE}, added ${added})`;

/** known-failures.json with the given keys, laid out as JSON.stringify with two spaces lays it out. */
export const known = (fields) => `${JSON.stringify({ failures: {}, lint: {}, timing: [], ...fields }, null, 2)}\n`;

/** A sandbox removed after the test, with its own HOME; every process it started is stopped by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1872-')));
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
export function run(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
}

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(cwd, path), { force: true });
      continue;
    }
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

const gitIn = (cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * A scratch repository for the guard: `base` committed on main with a stand-in scripts/proof-guard.mjs (so the proof
 * lanes are on main) and the maintainer's key on the approvers list, origin/main at that commit, on branch `change`.
 * commit() writes files (null deletes one) and commits them naming the planted issue; approve() tags a commit under
 * deep/approved/ with one `Approves:` line per item, signed by the maintainer, or unsigned when signer is null;
 * guard() runs this checkout's real `node scripts/proof.mjs guard` there.
 */
export function guardRepo(box, base) {
  const cwd = join(box.dir, 'repo');
  mkdirSync(cwd);
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  const keys = people();
  write(cwd, { 'scripts/proof-guard.mjs': '// the guard\n', [APPROVERS]: keys.list, ...base });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  const issues = join(box.dir, 'issues');
  write(issues, { [`${ISSUE}.md`]: 'Planted for #1872.\n\n### Acceptance criteria\n- [ ] Nothing real\n' });
  let tags = 0;
  return {
    cwd,
    commit(files, subject = 'Change the file') {
      write(cwd, files);
      git('add', '-A');
      git('commit', '-qm', `${subject}\n\nPart of #${ISSUE}`);
      return git('rev-parse', 'HEAD').trim();
    },
    approve(commit, items, signer = 'maintainer') {
      tag(cwd, `deep/approved/${++tags}`, commit, items, signer && keys[signer]);
    },
    guard: () => run(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env: { DEEP_PROOF_ISSUES: issues } }),
  };
}

/** The guard's FAIL lines (`FAIL guard: ...`). */
export const failLines = (result) => result.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:'));
/** The guard's PASS lines (`PASS guard: ...`). */
export const passLines = (result) => result.stdout.split('\n').filter((line) => line.startsWith('PASS guard:'));

const tail = (text, size = 2_500) => (text.length > size ? `…${text.slice(-size)}` : text);
export const dump = (...results) => results.map((r) => `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}\nstdout:\n${tail(r.stdout)}\nstderr:\n${tail(r.stderr, 800)}`).join('\n');

/**
 * A key of known-failures.json, named as a word on a line once the file's own path is taken out: the path holds
 * `failures`, so it can't be what names the key.
 */
export const namesKey = (key) => Object.assign((line) => RegExp(`\\b${key}\\b`).test(line.replaceAll(KNOWN, '')), { toString: () => `the key "${key}"` });

/** The guard refused the commit, on a FAIL line holding every one of `names` (a string, or a test of the line). */
export function expectRefused(result, what, names) {
  const all = dump(result);
  assert.ok(failLines(result).length, `${what} passed the guard\n${all}`);
  assert.notEqual(result.status, 0, `${what}: the guard printed FAIL but exited 0\n${all}`);
  const naming = failLines(result).filter((line) => names.every((name) => (typeof name === 'function' ? name(line) : line.includes(name))));
  assert.ok(naming.length, `${what} failed the guard, but no FAIL line names ${names.map(String).join(' and ')}\n${all}`);
}

/** The guard passed: no FAIL line, exit 0, a PASS line, and, when `names` is given, a PASS line holding each. */
export function expectPassed(result, what, names = []) {
  const all = dump(result);
  assert.deepEqual(failLines(result), [], `${what} failed the guard\n${all}`);
  assert.equal(result.status, 0, all);
  assert.ok(passLines(result).length, `the guard printed no PASS for ${what}\n${all}`);
  if (names.length) assert.ok(passLines(result).some((line) => names.every((name) => line.includes(name))), `the guard passed ${what} without judging it: no PASS line names ${names.join(' and ')}\n${all}`);
}

// ---- The scratch tree affected.mjs runs in ----

/** The lists of a tree's lanes.mjs, read by a child process. */
function lintScripts(root) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/lanes.mjs')).href)});
    const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''));
    console.log(JSON.stringify({ alone: lanes.alone ?? null, lint }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

const vitestFile = (body) => `import { describe, expect, it, test } from 'vitest';\n${body}\n`;
/** A node --test fixture file holding `body`. */
export const nodeFile = (body) => `import assert from 'node:assert/strict';\nimport test, { describe, it } from 'node:test';\n${body}\n`;

// cargo is stubbed: `metadata` reports no crates; everything else succeeds with no output.
const CARGO = `#!/bin/sh
if [ "$1" = metadata ]; then echo '{"packages":[],"workspace_members":[],"version":1}'; exit 0; fi
exit 0
`;
// The repo's config with its include written out: importing it from lanes.mjs needs the workspace packages built.
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'packages/**/test/**/*.test.ts', 'packages/**/*.test.ts'] } });
`;

/**
 * A scratch tree at box.dir/tree: a copy of this checkout's scripts/ with the lint lane's scripts stubbed, a vitest
 * config, a folder of links to node_modules, `knownText` as scripts/known-failures.json, one passing test per runner
 * of the unit lane, and `files`, committed in a fresh repository; a bin folder with a cargo stub leads PATH.
 */
export function tree(box, files, knownText) {
  const cwd = join(box.dir, 'tree');
  mkdirSync(cwd);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  const { alone, lint } = lintScripts(cwd);
  for (const script of lint) writeFileSync(join(cwd, script), '// a lint stub for #1872\n');
  const folder = alone?.find((entry) => entry.endsWith('/'));
  assert.ok(folder, 'scripts/lanes.mjs exports no alone folder');
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  write(cwd, {
    '.gitignore': 'node_modules\n',
    'vitest.config.mjs': VITEST_CONFIG,
    'tests/fixture-1872/pass.test.ts': vitestFile("test('a parallel vitest test passes', () => { expect(1).toBe(1); });"),
    [`${folder}fixture-1872-pass.test.ts`]: vitestFile("test('an alone vitest test passes', () => { expect(1).toBe(1); });"),
    'tests/fixture-1872-pass.test.mjs': nodeFile("test('a node test passes', () => { assert.equal(1, 1); });"),
    [KNOWN]: knownText,
    ...files,
  });
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), CARGO);
  chmodSync(join(bin, 'cargo'), 0o755);
  return { cwd, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

/** `node scripts/affected.mjs ...args` in the tree. */
export const affected = (box, { cwd, env }, args) => run(box, [process.execPath, 'scripts/affected.mjs', ...args], { cwd, env });
/** The failure ids of an affected.mjs run: each `NEW FAIL`, `KNOWN` and `FAIL` line's id (`<file> › <test>`), sorted. */
export const failIds = (stdout) => stdout.split('\n').map((line) => line.match(/^(?:NEW FAIL|KNOWN|FAIL) (.+? › [^:]+)/)?.[1]).filter(Boolean).sort();
export const readKnown = ({ cwd }) => readFileSync(join(cwd, KNOWN));
