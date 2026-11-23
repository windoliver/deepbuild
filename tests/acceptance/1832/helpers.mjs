// Shared by the #1832 acceptance tests. Nothing here imports the code under test: the before lane and the lint are
// reached only by running them as processes (README: Surfaces). Each test gets a temporary folder with its own HOME,
// removed when it ends, and every process runs to its end under a timeout; nothing is killed by name or port.
//
// Every tag of a planted issue is built at runtime from its criterion's text, so no file here carries a tag a real
// issue's trace lane could read as its own.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** A lane run takes seconds on an idle machine and minutes on a loaded one; a hang still ends. */
export const LONG = { timeout: 1_500_000 };

// Set by node --test for its children, by npm, or by a session around the run; a run under test must not inherit them.
const ENV_OUT = ['NODE_TEST_CONTEXT', 'NODE_V8_COVERAGE', '__STRYKER_ACTIVE_MUTANT__', 'DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES',
  'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_HUB_PLANT'];

/** A criterion's ID: the first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed. */
export const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

/** A temporary folder, removed after the test, with its own HOME; npm in it works offline and reads no outer setting. */
export function sandbox(t, prefix = 'deep-1832-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), PATH: [dirname(process.execPath), process.env.PATH].join(delimiter), npm_config_offline: 'true', npm_config_update_notifier: 'false' };
  for (const name of ENV_OUT) delete env[name];
  for (const name of Object.keys(env)) if (/^npm_(?!config_offline$|config_update_notifier$)/i.test(name)) delete env[name];
  return { dir, home, env };
}

/** Writes each file under `cwd`. */
export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Runs `argv` to its end; its status and output. */
export function run(argv, { cwd, env, timeout = 1_200_000 }) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// A run's output, each line behind `| `, so no line of a dump in an assertion's message reads as a stack frame.
const tail = (text, size = 8_000) => (text.length > size ? `…${text.slice(-size)}` : text).replace(/^/gm, '| ');
export const show = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? ` (${result.error})` : ''}\nstdout:\n${tail(result.stdout)}\nstderr:\n${tail(result.stderr, 3_000)}`;

/** The files under `folder`, as paths relative to it. */
export function filesUnder(folder, at = '') {
  return readdirSync(join(folder, at), { withFileTypes: true }).flatMap((entry) => {
    const path = at ? `${at}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(folder, path) : [path];
  }).sort();
}

/**
 * A git repository at box.dir/<name>: `base` committed on main, with origin/main at that commit, then branch `change`
 * with `change` committed on it under `message`. Paths in `executable` get their run bit before the first commit.
 */
export function repository(box, { name = 'repo', base, change, message, executable = [] }) {
  const cwd = join(box.dir, name);
  mkdirSync(cwd, { recursive: true });
  write(cwd, base);
  for (const path of executable) chmodSync(join(cwd, path), 0o755);
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (change) {
    git(cwd, 'checkout', '-q', '-b', 'change');
    write(cwd, change);
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-qm', message);
  }
  return cwd;
}

/** An issue body as GitHub holds it: prose, then `### Acceptance criteria` with one `- [ ] ` line each. */
const issueBody = (criteria) => `Planted for the #1832 acceptance tests.\n\n### Acceptance criteria\n${criteria.map((text) => `- [ ] ${text}`).join('\n')}\n\n### Proof\nOutput pasted.\n`;

/** `node scripts/proof.mjs before`, this checkout's, with its cwd at `cwd`, reading the planted issue from a folder. */
export function beforeLane(box, cwd, issue, criteria) {
  const folder = join(box.dir, 'issues');
  write(folder, { [`${issue}.md`]: issueBody(criteria) });
  return run([process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'before'], { cwd, env: { ...box.env, DEEP_PROOF_ISSUES: folder } });
}

/** How a lane names a test: its file's repo path, ` › `, and its full name. */
export const named = (path, name) => `${path} › ${name}`;
const STATE = /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) /;
/** The before lane's lines `<STATE> before: <key>: ...` that name exactly this test. */
export const linesFor = (result, key) => result.stdout.split('\n').filter((line) => STATE.test(line) && line.includes(` before: ${key}: `));
/** The before lane's BLOCKED lines that name both the twin and the file. */
export const blockedFor = (result, twin, file) => result.stdout.split('\n').filter((line) => line.startsWith('BLOCKED before: ') && line.includes(twin) && line.includes(file));

/** The lane ran to its end and judged: it printed its closing reading, and no line of it is a crash. */
export function ranToEnd(result) {
  assert.match(result.stdout, /^proof: wall time /m, `the before lane did not run to its end\n${show(result)}`);
}

/** Asserts the test is proven on the twin named: every lane line naming it is PASS, one of them on that twin at its assertion. */
export function provenOn(result, key, twin) {
  const lines = linesFor(result, key);
  assert.ok(lines.length, `the before lane names no ${key}\n${show(result)}`);
  for (const line of lines) assert.match(line, /^PASS before: /, `${key} is not proven\n${show(result)}`);
  assert.ok(lines.some((line) => line.endsWith(`: failed on ${twin} at its assertion`)), `${key} did not fail on ${twin} at its assertion\n${show(result)}`);
}

/** Asserts the lane names the test and gives it no PASS line. */
export function notProven(result, key) {
  const lines = linesFor(result, key);
  assert.deepEqual(lines.filter((line) => line.startsWith('PASS ')), [], `${key} reads proven though its twin was never applied\n${show(result)}`);
}

/** `node scripts/twins-lint.mjs ...args`, this checkout's. */
export const lint = (box, args = []) => run([process.execPath, join(CHECKOUT, 'scripts/twins-lint.mjs'), ...args], { cwd: CHECKOUT, env: box.env, timeout: 300_000 });
/** The twin folders the lint's `FAIL twins: <folder>: ...` lines list, in the order printed. */
export const listed = (result) => result.stdout.split('\n').map((line) => line.match(/^FAIL twins: (tests\/acceptance\/[^/\s]+\/twins\/[^/\s:]+): /)?.[1]).filter(Boolean);

/** The twins a suite's twins.json names in this checkout, each once: `{ name, folder (repo path), files }`. */
export function twinsOf(suite) {
  const file = join(CHECKOUT, 'tests/acceptance', suite, 'twins.json');
  assert.ok(existsSync(file), `tests/acceptance/${suite}/twins.json is missing`);
  const names = [...new Set(Object.values(JSON.parse(readFileSync(file, 'utf8'))).flat())].sort();
  assert.ok(names.length, `tests/acceptance/${suite}/twins.json names no twin`);
  return names.map((name) => {
    const folder = `tests/acceptance/${suite}/twins/${name}`;
    const files = existsSync(join(CHECKOUT, folder)) ? filesUnder(join(CHECKOUT, folder)) : [];
    assert.ok(files.length, `${folder}, named in the suite's twins.json, holds no file`);
    return { suite, name, folder, files };
  });
}
