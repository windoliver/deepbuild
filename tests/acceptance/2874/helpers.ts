// What #2874's tests share: temp folders and a clean environment, a command run under a given umask, git checkouts
// of one scratch repository of this checkout's contract data made under umask 022 or 002, and the contract step
// (`scripts/contract-diff.mjs`) run on one of them under the same umask (README, The surface under test).
//
// Safety: every folder is under /tmp/dh2874-* (real paths) and removed after the file. HOME is a temp folder for this
// process and every child, TMPDIR for every child; CLAUDE*, DEEP_*, AI_AGENT, NODE_OPTIONS, npm's and Vitest's
// variables and git's GIT_* are taken out of every child's environment, and git reads no system or user config. No
// network, no port. The only processes started are git and the step, each waited for; one past its bound is killed by
// its own PID.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const STEP = join(REPO, 'scripts/contract-diff.mjs');
export const FIXTURE = 'contracts/fixtures/R1';
export const MINUTES = 60_000;

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh2874-${tag}-`));
  made.push(dir);
  return dir;
}
for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
const HOME = tempDir('home');
const TMP = tempDir('tmp');
process.env.HOME = HOME;
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** This process's environment for a child, less what would point it at another run, repository or config. */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(?:CLAUDE|DEEP_|GIT_|VITEST|npm_)|^(?:AI_AGENT|NODE_OPTIONS|XDG_CONFIG_HOME)$/.test(key)) env[key] = value;
  }
  const who = { GIT_AUTHOR_NAME: 'dh2874', GIT_AUTHOR_EMAIL: 'dh2874@example.invalid', GIT_COMMITTER_NAME: 'dh2874', GIT_COMMITTER_EMAIL: 'dh2874@example.invalid' };
  return { ...env, HOME, TMPDIR: TMP, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...who };
}

/**
 * A leg this machine can't set up, such as git that fails or writes modes other than a checkout's: a plain Error, never
 * an assertion, so it is never a pass and never counts as a wrong program failing.
 */
export function inconclusive(why: string): never {
  throw new Error(`INCONCLUSIVE: ${why}; this is not a pass`);
}

/** Output a message quotes, less lines that read as stack frames, which would place the failure in the code under test. */
export const quoted = (text: string): string => text.split('\n').filter((line) => !/^\s*at\s/.test(line)).join('\n');

/** A machine's default umask: the reference Mac's, and the Spark's the issue names. */
export type Umask = '022' | '002';
// `sh -c` sets the umask, then becomes the command, so the command's PID is the child's.
const UNDER = 'umask "$1" && shift && exec "$@"';

/** git in `cwd` under `umask`; a failure is INCONCLUSIVE. */
export function git(cwd: string, umask: Umask, args: readonly string[]): string {
  const r = spawnSync('/bin/sh', ['-c', UNDER, 'sh', umask, 'git', ...args], { cwd, env: childEnv(), encoding: 'utf8', timeout: 2 * MINUTES, killSignal: 'SIGKILL', maxBuffer: 1 << 26 });
  if (r.status !== 0) inconclusive(`git ${args.join(' ')} under umask ${umask} failed (${r.error?.message ?? `exit ${r.status ?? r.signal}`}): ${(r.stderr ?? '').trim()}`);
  return r.stdout;
}

// The contract data #139's scratch tree copies: packages/contracts' published files, beside the contracts/ folder.
const DATA = ['extension-api.json', 'hub-slots.json', 'digests.json', 'schemas', 'slots', 'rpc-methods.json', 'canvas-registries.json'];
/**
 * A scratch repository of this checkout's contract data, committed once: packages/contracts' published files and
 * contracts/ with R1's fixture package, no release or break recorded (as #139's scratch tree), after `change`. git
 * records each file 100644, or 100755 when its owner may run it, whatever else its mode on disk says.
 */
export function source(tag: string, change?: (root: string) => void): string {
  const root = tempDir(`${tag}-src`);
  for (const name of DATA) {
    const from = join(REPO, 'packages/contracts', name);
    if (existsSync(from)) cpSync(from, join(root, 'packages/contracts', name), { recursive: true });
  }
  cpSync(join(REPO, 'contracts'), join(root, 'contracts'), { recursive: true });
  for (const sub of ['releases', 'breaks']) rmSync(join(root, 'contracts', sub), { recursive: true, force: true });
  if (!existsSync(join(root, FIXTURE, 'deepbuild.json'))) inconclusive(`this checkout has no ${FIXTURE}/deepbuild.json, the fixture package the criteria name`);
  change?.(root);
  git(root, '022', ['init', '--quiet']);
  git(root, '022', ['add', '-A']);
  git(root, '022', ['commit', '--quiet', '-m', 'The contract data of this checkout']);
  return root;
}

/** Each file under R1's fixture folder git tracks in a checkout: the mode git records and the mode it has on disk. */
export function fixtureFiles(root: string): { path: string; recorded: string; mode: number }[] {
  const lines = git(root, '022', ['ls-files', '-s', '--', FIXTURE]).split('\n').filter(Boolean);
  if (!lines.length) inconclusive(`git tracks nothing under ${FIXTURE} in ${root}`);
  return lines.map((line) => {
    const m = /^(\d{6}) [0-9a-f]+ \d+\t(.+)$/.exec(line);
    if (!m) inconclusive(`git ls-files -s printed ${JSON.stringify(line)}`);
    return { path: m[2]!, recorded: m[1]!, mode: statSync(join(root, m[2]!)).mode & 0o777 };
  });
}

/**
 * A clone of `from` made under `umask`, as git checks a repository out on a machine whose default umask that is: each
 * file 0666 less the umask, 0777 less it for one git records as executable (664 and 775 under 002). Its root, once each
 * of R1's fixture files is checked to be so on disk.
 */
export function checkout(from: string, umask: Umask, tag: string): string {
  const root = join(tempDir(tag), 'checkout');
  git(dirname(root), umask, ['clone', '--quiet', from, root]);
  for (const f of fixtureFiles(root)) {
    const want = (f.recorded === '100755' ? 0o777 : 0o666) & ~Number.parseInt(umask, 8);
    if (f.mode !== want) inconclusive(`git wrote ${f.path} (${f.recorded}) as ${f.mode.toString(8)} under umask ${umask}, not ${want.toString(8)}, so this isn't the checkout the criteria name`);
  }
  return root;
}

/** Commits what the step wrote in a checkout, as a release is committed where it was recorded. */
export function commitAll(root: string, umask: Umask, message: string): void {
  git(root, umask, ['add', '-A']);
  git(root, umask, ['commit', '--quiet', '-m', message]);
}

/**
 * Each file of a folder at the mode git records for it, 755 when its owner may run it and 644 otherwise, as a checkout
 * under umask 022 holds it.
 */
export function gitModes(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) gitModes(path);
    else if (stat.isFile()) chmodSync(path, stat.mode & 0o100 ? 0o755 : 0o644);
  }
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; out: string }
/**
 * `node scripts/contract-diff.mjs <args> --root <checkout>` under `umask`, stdout and stderr together, without holding
 * the test's event loop. One still running after `bound` is killed by its PID and reads INCONCLUSIVE.
 */
export async function step(umask: Umask, args: readonly string[], root: string, bound = 4 * MINUTES): Promise<Ran> {
  const what = `node scripts/contract-diff.mjs ${args.join(' ')} --root ${root} under umask ${umask}`;
  if (!existsSync(STEP)) inconclusive(`${STEP} does not exist`);
  const ended = await new Promise<Ran | Error>((resolve) => {
    const child = spawn('/bin/sh', ['-c', UNDER, 'sh', umask, process.execPath, STEP, ...args, '--root', root], { cwd: REPO, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    let overran = false;
    const timer = setTimeout(() => { overran = true; child.kill('SIGKILL'); }, bound);
    child.on('error', (error) => { clearTimeout(timer); resolve(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve(overran ? new Error(`still running after ${bound / MINUTES} minutes`) : { code, signal, out: Buffer.concat(chunks).toString('utf8') });
    });
  });
  if (ended instanceof Error) inconclusive(`${what}: ${ended.message}`);
  return ended;
}

/** The step's FAIL lines, `FAIL contracts: <entry>: <reason>`. */
export const failLines = (r: Ran): string[] => r.out.split('\n').filter((line) => line.startsWith('FAIL contracts:'));
export const shown = (r: Ran): string => `exit ${r.code ?? r.signal}, output:\n${quoted(r.out.trimEnd().split('\n').slice(-40).join('\n'))}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export const readJson = (path: string): Json => JSON.parse(readFileSync(path, 'utf8'));
/** A JSON file's value, or undefined when it doesn't exist, so an assertion compares it rather than throwing. */
export const readIf = (path: string): Json => (existsSync(path) ? readJson(path) : undefined);
/** The envelope digest a recorded release pins R1's fixture package at: `fixture.digest` in contracts/releases/R1.json. */
export const pinOf = (root: string): string | undefined => readIf(join(root, 'contracts/releases/R1.json'))?.fixture?.digest;

/** Asserts the record step installed, checked and loaded R1's fixture package: no FAIL line and exit 0. */
export function expectRecorded(r: Ran, what: string): void {
  expect(failLines(r), `${what}: record --release R1 installs and loads R1's fixture package, with no FAIL line\n${shown(r)}`).toEqual([]);
  expect(r.code, `${what}: record --release R1 exits 0\n${shown(r)}`).toBe(0);
}
