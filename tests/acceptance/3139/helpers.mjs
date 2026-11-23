// Shared by #3139's acceptance tests (README: Surfaces). The three lints are reached only through the lint lane's
// commands for them, taken from scripts/lanes.mjs's exported `checks` and run as processes with cwd at the checkout
// they check: this checkout, read-only, or a scratch git repository under the system's temporary folder, removed in
// t.after. Nothing here writes into this checkout, and no message prints a local path or a planted home path's value.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks } from '../../../scripts/lanes.mjs';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

/** Each criterion's ID: `#3139.` and the first 8 hex digits of the SHA-256 of its text from the issue, trimmed, with
 * white space collapsed (`criterionId` in scripts/proof-change.mjs). */
export const AC1 = '#3139.b841908f';
export const AC2 = '#3139.9aeafe77';
export const AC3 = '#3139.0cf32f1a';

export const WAITS = 'scripts/wait-ratchet.mjs';
export const SIZE = 'scripts/size-ratchet.mjs';
export const RULES = 'scripts/repo-rules.mjs';
export const WAIT_CEILINGS = 'scripts/wait-ceilings.json';
export const SIZE_CEILINGS = 'scripts/size-ceilings.json';
export const RULES_CONFIG = 'scripts/repo-rules.json';

const lint = checks.find(({ name }) => name === 'lint');

/** The lint lane's command that runs `script` with node; the test fails here when the lane runs none. */
export function command(script) {
  const found = lint?.commands.find((candidate) => [process.execPath, 'node'].includes(candidate[0]) && candidate[1] === script);
  assert.ok(found, `the lint lane runs no ${script}`);
  return found;
}

// The deps rule reads Cargo manifests with `cargo metadata`; without cargo on PATH it reads BLOCKED. A rustup that
// isn't on PATH is put first, as the brief for this job says (cargo found in one of these folders).
const cargoDir = ['/opt/homebrew/opt/rustup/bin', '/usr/local/opt/rustup/bin', join(homedir(), '.cargo', 'bin')].find((dir) => existsSync(join(dir, 'cargo')));
const withCargo = (env) => (cargoDir ? { ...env, PATH: `${cargoDir}${delimiter}${env.PATH ?? ''}` } : env);
/** The environment without git's repository variables, so a scratch repository's git never reaches another one. */
const scrubbed = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));

/**
 * Runs the lane's command for `script` with cwd at `cwd` (a scratch repository unless it is `root`). A run that is
 * stopped or can't start is INCONCLUSIVE, never a verdict.
 */
export function run(script, cwd) {
  const [program, ...args] = command(script);
  const env = withCargo(cwd === root ? { ...process.env } : scrubbed());
  // deadline: turns a hung lint into a failure of this test; nothing waits on it to pass
  const result = spawnSync(program === 'node' ? process.execPath : program, args, { cwd, env, encoding: 'utf8', timeout: 900_000, maxBuffer: 1 << 28 });
  if (result.error || result.signal) throw new Error(`INCONCLUSIVE: ${script} didn't finish (${result.error?.code ?? result.signal})`);
  const stdout = result.stdout ?? '';
  return { status: result.status, stdout, lines: stdout.split('\n') };
}

/** The lines of one check (`waits`, `size`, `deps`, `secrets`) in a state that fails a run. */
export const findings = (result, check) => result.lines.filter((line) => new RegExp(`^(?:FAIL|INVALID|BLOCKED) ${check}: `).test(line));
/** Those of them that hold `text`, such as a path. */
export const naming = (result, check, text) => findings(result, check).filter((line) => line.includes(text));
/** The path a waits or size line starts with, after `<STATE> <check>: `. */
export const pathOf = (line) => line.replace(/^\S+ \S+: /, '').split(/[: ]/)[0];
/** Whether `path` is a planted twin: a file under a `twins/` folder in `tests/acceptance/`. */
export const isTwin = (path) => path.startsWith('tests/acceptance/') && path.split('/').slice(2, -1).includes('twins');

/**
 * A run's output for a failure message: its first `max` lines, without Fix lines, and with `checks` given only those
 * checks' lines (a scratch repository's other repo rules name its temporary folder).
 */
export function show(result, { checks, max = 40 } = {}) {
  const lines = result.lines.filter((line) => line && !line.startsWith('  Fix:') && (!checks || checks.some((check) => new RegExp(`^\\S+ ${check}\\b`).test(line))));
  return `exit ${result.status}; ${lines.length} lines${checks ? ` of ${checks.join(' and ')}` : ''}${lines.length > max ? `, the first ${max}` : ''}:\n${lines.slice(0, max).join('\n')}`;
}

/** A deps check that couldn't read a manifest can't judge it: BLOCKED, never a pass. */
export function assertDepsRan(result) {
  const blocked = result.lines.filter((line) => /^BLOCKED deps: /.test(line));
  if (blocked.length) throw new Error(`BLOCKED: the deps rule couldn't run: ${blocked.join('; ')}`);
}

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, env: cwd === root ? process.env : scrubbed(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });

/** Writes `content` at `path` in the scratch repository. */
export function put(cwd, path, content) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

/** Removes `path` from the scratch repository's work tree. */
export const drop = (cwd, path) => rmSync(join(cwd, path), { force: true });

/**
 * A scratch git repository, as #1604's and #1432's suites make theirs: a copy of this checkout's scripts/, which
 * .git/info/exclude hides from git's listing, with `config` written over files in it, and `files`, committed with
 * origin/main at that commit, so the merge base is that commit and holds `files`. The config files are force-added.
 */
export function scratch(t, files, config) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3139-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, '.git', 'info'), { recursive: true });
  writeFileSync(join(cwd, '.git', 'info', 'exclude'), '/scripts/\n');
  cpSync(join(root, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  for (const [path, content] of Object.entries({ ...config, ...files })) put(cwd, path, content);
  git(cwd, 'add', '-A');
  for (const path of Object.keys(config)) git(cwd, 'add', '-f', path);
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}

/** Commits `files` on top of HEAD: the change that adds them. origin/main stays at the base, which doesn't hold them. */
export function commit(cwd, files) {
  for (const [path, content] of Object.entries(files)) put(cwd, path, content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'change');
}

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** This checkout's scripts/repo-rules.json with the scratch repository's own dependency rows and no allowed findings,
 * every other key kept, so rows for manifests the scratch repository lacks print nothing. */
export const rulesConfig = (deps = {}) => json({ ...JSON.parse(readFileSync(join(root, RULES_CONFIG), 'utf8')), deps, allowedFindings: [] });

/** `count` lines of JavaScript or TypeScript, each a line of code. */
export const lines = (count) => Array.from({ length: count }, (_, i) => `export const c${String(i + 1).padStart(4, '0')} = ${i + 1};\n`).join('');

/** A macOS home folder under a made-up user, built from parts so this file holds none itself. */
export const HOME = ['', 'Users', 'fixture-user', ''].join('/');

/** The folder a planted suite of the scratch repositories lives in. No real suite has this name. */
export const PLANT = 'tests/acceptance/3139-plant/';
/** The folder of a suite the change adds in a scratch repository. */
export const ADDED = 'tests/acceptance/3139-added/';
