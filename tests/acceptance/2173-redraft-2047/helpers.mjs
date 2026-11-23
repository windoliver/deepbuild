// #2173's blind redraft (#2047): what both test files share. It runs scripts/repo-rules.mjs as the lint lane does, as
// `node scripts/repo-rules.mjs` from a checkout's root, reads its result lines, and makes the scratch copy AC2 plants
// its manifests in. Node built-ins only. Nothing here writes the checkout the suite sits in (README: The surface).
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CHECKER = 'scripts/repo-rules.mjs';
// The states the checker prints; FAIL, INVALID and BLOCKED fail its run (its own header).
const LINE = /^(PASS|FAIL|INVALID|BLOCKED|NOTE) ([\w-]+): (.*)$/;
export const FAILING = ['FAIL', 'INVALID', 'BLOCKED'];
// A command that can't start, overruns or is killed fails its test INCONCLUSIVE, never at an assertion.
const CHECKER_BOUND_MS = 15 * 60_000;
const TOOL_BOUND_MS = 5 * 60_000;
const COPY_PREFIX = 'blind-2173-';

// rustup's cargo on this Mac, which Homebrew's rustup keeps off the default PATH; put first when the folder exists.
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';

/**
 * The suite's environment for a child: no test runner's variables and none of git's, so git finds the folder's own,
 * and rustup's proxies first on PATH where they are.
 */
export function childEnv(extra = {}) {
  const env = { ...process.env, ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env.PATH ?? ''}` } : {}), ...extra };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  return env;
}

const inconclusive = (what, run, bound) => {
  if (run.error) return new Error(`INCONCLUSIVE: ${what} didn't run to its end (bounded at ${bound / 60_000} min): ${run.error.message}`);
  if (run.signal) return new Error(`INCONCLUSIVE: ${what} was killed by ${run.signal}`);
  return null;
};

/** The checker reads git's index and runs cargo metadata and cargo tree; without cargo it can't judge, so neither can a test. */
export function needCargo(env) {
  const run = spawnSync('cargo', ['--version'], { env, encoding: 'utf8', timeout: TOOL_BOUND_MS, killSignal: 'SIGKILL' });
  const stopped = inconclusive('cargo --version', run, TOOL_BOUND_MS);
  if (stopped || run.status !== 0) {
    throw new Error(`INCONCLUSIVE: cargo can't run here (looked on PATH and in ${RUSTUP_BIN}: ${stopped?.message ?? `cargo --version exited ${run.status}`}); ${CHECKER} runs cargo metadata and cargo tree`);
  }
}

/** `git <args>` in `cwd`; a failure is the environment's, so INCONCLUSIVE. */
export function git(cwd, args, env, input) {
  const run = spawnSync('git', args, { cwd, env: { ...env, GIT_OPTIONAL_LOCKS: '0' }, input, encoding: 'utf8', timeout: TOOL_BOUND_MS, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
  const stopped = inconclusive(`git ${args[0]}`, run, TOOL_BOUND_MS);
  if (stopped) throw stopped;
  if (run.status !== 0) throw new Error(`INCONCLUSIVE: git ${args[0]} exited ${run.status}: ${run.stderr.trim().split('\n')[0]}`);
  return run.stdout;
}

/**
 * `node scripts/repo-rules.mjs` from `root`, by the Node that runs this suite: its exit status, its output, and its
 * result lines. A tool the checker runs that can't start (a `spawn … ENOENT` in a failing line) is the environment's.
 */
export function runChecker(root, env) {
  const run = spawnSync(process.execPath, [CHECKER], { cwd: root, env, encoding: 'utf8', timeout: CHECKER_BOUND_MS, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
  const stopped = inconclusive(`node ${CHECKER}`, run, CHECKER_BOUND_MS);
  if (stopped) throw stopped;
  const results = run.stdout.split('\n').map((line) => LINE.exec(line)).filter(Boolean).map(([line, state, lane, message]) => ({ line, state, lane, message }));
  const failing = results.filter(({ state }) => FAILING.includes(state));
  const unstarted = failing.find(({ message }) => /\bspawn(?:Sync)? \S+ (?:ENOENT|EACCES)\b/.test(message));
  if (unstarted) throw new Error(`INCONCLUSIVE: a tool ${CHECKER} runs couldn't start: ${unstarted.line}`);
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, results, failing };
}

/**
 * What a message quotes of an output: the checkout's and the copy's paths as <checkout> and <copy>, and no line that
 * reads as a stack frame, since the proof lane places a failure by the first frame in its stack, message included.
 */
export function quoted(text, copy) {
  let out = String(text);
  for (const [path, name] of [[copy, '<copy>'], [CHECKOUT, '<checkout>']]) if (path) out = out.replaceAll(pathToFileURL(path).href, name).replaceAll(path, name);
  const lines = out.split('\n').filter((line) => !/^\s*at /.test(line)).join('\n').trim();
  // The last 3,000 characters, from a whole line.
  return (lines.length > 3000 ? lines.slice(-3000).replace(/^[^\n]*\n/, '') : lines) || '(nothing)';
}

/** At most `count` lines, then how many more. */
export const some = (lines, count = 20) => (lines.length > count ? [...lines.slice(0, count), `… and ${lines.length - count} more`] : lines).join('\n') || '(none)';

/**
 * A scratch copy of every file git lists in the checkout (tracked, and new ones it doesn't ignore), in a temporary
 * folder of its own, never with the checkout's .git. `plant(copy)` changes the copy; then the copy gets a git
 * repository of its own whose index lists every file, so the checker reads the copy as it reads the checkout.
 */
export function scratchCopy(env, plant) {
  const listed = [...new Set(git(CHECKOUT, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], env).split('\0').filter(Boolean))];
  const copy = realpathSync(mkdtempSync(join(tmpdir(), COPY_PREFIX)));
  const files = [];
  try {
    for (const path of listed) {
      const from = join(CHECKOUT, path), to = join(copy, path);
      let stat;
      try {
        stat = lstatSync(from);
      } catch (error) {
        if (error.code === 'ENOENT') continue; // a tracked file the working tree deleted
        throw error;
      }
      if (stat.isDirectory()) continue;
      mkdirSync(dirname(to), { recursive: true });
      if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
      else copyFileSync(from, to, constants.COPYFILE_FICLONE);
      files.push(path);
    }
    files.push(...plant(copy));
    git(copy, ['init', '-q', '--template=', copy], env);
    git(copy, ['update-index', '--add', '--info-only', '-z', '--stdin'], env, `${[...new Set(files)].join('\0')}\0`);
  } catch (error) {
    removeCopy(copy);
    throw error.message.startsWith('INCONCLUSIVE:') ? error : new Error(`INCONCLUSIVE: the scratch copy couldn't be made: ${error.message}`);
  }
  return copy;
}

/** Removes a copy scratchCopy made, and nothing else. */
export function removeCopy(copy) {
  const temporary = realpathSync(tmpdir());
  if (copy && copy.startsWith(`${temporary}${sep}${COPY_PREFIX}`)) rmSync(copy, { recursive: true, force: true });
}
