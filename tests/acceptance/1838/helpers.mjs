// Shared by the #1838 acceptance tests. Nothing here imports the code under test: every surface is reached by running
// it as a process (README: Surfaces). Each test gets a temporary folder with its own HOME, removed when it ends, and
// every process runs to its end under a timeout; nothing is killed by name or port.
//
// Every tag of a planted issue is built at runtime from its criterion's text, so no file here carries a tag a real
// issue's trace lane could read as its own.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** A run of a lane or a suite takes seconds on an idle machine and minutes on a loaded one; a hang still ends. */
export const LONG = { timeout: 900_000 };

// Set by node --test for its children, or by a session around it; a run under test must not inherit them.
const ENV_OUT = ['NODE_TEST_CONTEXT', 'DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR',
  'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT'];

/** A criterion's ID: the first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed. */
export const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

/** A temporary folder, removed after the test, with its own HOME and cache folder in the environment it returns. */
export function sandbox(t, prefix = 'deep-1838-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of ENV_OUT) delete env[name];
  return { dir, home, env };
}

/** Writes each file under `cwd`; a null content removes it. */
export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) rmSync(join(cwd, path), { force: true });
    else {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }
  }
}

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Runs `argv` to its end; its status and output. */
export function run(argv, { cwd, env, timeout = 600_000 }) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// A run's output, each line behind `| `, so no line of a dump in an assertion's message reads as a stack frame.
const tail = (text, size = 6_000) => (text.length > size ? `…${text.slice(-size)}` : text).replace(/^/gm, '| ');
export const show = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? ` (${result.error})` : ''}\nstdout:\n${tail(result.stdout)}\nstderr:\n${tail(result.stderr, 3_000)}`;

/**
 * A git repository at box.dir/<name>: `base` committed on main, with origin/main at that commit, then branch `change`
 * with `change` committed on it under `message`. A null content in `change` deletes the file.
 */
export function repository(box, { name = 'repo', base, change, message }) {
  const cwd = join(box.dir, name);
  mkdirSync(cwd, { recursive: true });
  write(cwd, base);
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '-b', 'change');
  write(cwd, change);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', message);
  return cwd;
}

// --- affected.mjs (criterion 2) ---

// cargo is stubbed first on PATH: `metadata` reports no crates, so the scratch tree has no Rust workspace.
const CARGO = `#!/bin/sh
if [ "$1" = metadata ]; then echo '{"packages":[],"workspace_members":[],"version":1}'; exit 0; fi
exit 0
`;

/** The lint lane's own scripts, as the tree's lanes.mjs lists them, read by a child process. */
function lintScripts(cwd) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(cwd, 'scripts/lanes.mjs')).href)});
    console.log(JSON.stringify(lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `the tree's scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

/**
 * The scratch tree affected.mjs runs in: a copy of this checkout's scripts/ with the lint lane's own scripts stubbed
 * (they read folders this tree doesn't have), an empty known-failures baseline, a folder of links to this checkout's
 * node_modules hidden from git, and the given repository's files. Returns the repository and an environment with the
 * cargo stub first on PATH.
 */
export function affectedTree(box, { base, change, message }) {
  const cwd = join(box.dir, 'tree');
  mkdirSync(cwd);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  const files = { 'scripts/known-failures.json': `${JSON.stringify({ failures: {}, lint: {}, timing: [] }, null, 2)}\n`, '.gitignore': 'node_modules\n' };
  for (const script of lintScripts(cwd)) files[script] = '// a lint stub for #1838\n';
  // A folder of links, so a tool's cache lands here, never in this checkout's node_modules.
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  repository(box, { name: 'tree', base: { ...files, ...base }, change, message });
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), CARGO);
  chmodSync(join(bin, 'cargo'), 0o755);
  return { cwd, env: { ...box.env, PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

/** affected.mjs's plan lines: `<block> <runner>: <files>`, as it prints them before it runs anything. */
export const planLines = (stdout) => stdout.split('\n').filter((line) => /^(?:parallel|alone|timed|slow) (?:node|vitest): /.test(line));
/** The last line of the output that isn't blank. */
export const lastLine = (stdout) => stdout.split('\n').filter((line) => line.trim()).at(-1) ?? '';

// --- the before lane (criterion 3) ---

/** An issue body as GitHub holds it: prose, then `### Acceptance criteria` with one `- [ ] ` line each. */
export const issueBody = (criteria) => `Planted for the #1838 acceptance tests.\n\n### Acceptance criteria\n${criteria.map((text) => `- [ ] ${text}`).join('\n')}\n\n### Proof\nOutput pasted.\n`;

/** `node scripts/proof.mjs ...lanes`, this checkout's, with its cwd at `cwd`, reading planted issues from `issues`. */
export function proof(box, cwd, issues, lanes) {
  const folder = join(box.dir, 'issues');
  write(folder, Object.fromEntries(Object.entries(issues).map(([number, criteria]) => [`${number}.md`, issueBody(criteria)])));
  return run([process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), ...lanes], { cwd, env: { ...box.env, DEEP_PROOF_ISSUES: folder } });
}

/** How a lane names a test: its file's repo path, ` › `, and its full name. */
export const named = (path, name) => `${path} › ${name}`;
/** The lines `<STATE> <lane>: <key>: ...` that name exactly this test, not a subtest under it. */
export const linesFor = (result, lane, key) => result.stdout.split('\n').filter((line) => /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) /.test(line) && line.includes(` ${lane}: ${key}: `));
