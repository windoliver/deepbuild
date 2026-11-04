// What #1143's acceptance tests share: the criterion IDs, the three commands the criteria name, run as they are and
// judged by their output, and a throwaway copy of the checkout for the planted wrong programs. Nothing here writes to
// the checkout's own files; the copy lives under the system's temporary folder and is removed by the test that made it.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The commit this suite was written against: origin/main when #1143 was drafted, with no implementation of it. */
export const BASE = '69803b946abf4881f818485c5898865949a2a871';

/** `#1143.` and the first 8 hex of SHA-256 of each criterion's text (scripts/proof-change.mjs, criterionId). */
export const AC = { 1: '#1143.daea5590', 2: '#1143.f4bcaafd', 3: '#1143.fb243546' } as const;

/** A verdict that is not a FAIL of the program: what was needed to judge it is missing or didn't run. */
export const blocked = (why: string): Error => new Error(`BLOCKED: ${why}`);
export const inconclusive = (why: string): Error => new Error(`INCONCLUSIVE: ${why}`);

// Child processes get the environment without this runner's own Vitest variables, so a nested Vitest is a fresh run.
const childEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITEST') && name !== 'NODE_OPTIONS'));

export function run(command: string, args: string[], cwd: string, timeout: number): SpawnSyncReturns<string> {
  return spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, timeout, env: childEnv() });
}

/** The tail of a process's output, for a failure message. */
export const tail = (text: string, lines = 30): string => text.split('\n').slice(-lines).join('\n');

// ---- AC1: node scripts/repo-rules.mjs.

export interface RepoRules { status: number | null; lines: string[]; output: string }

export function repoRules(root: string): RepoRules {
  const result = run(process.execPath, ['scripts/repo-rules.mjs'], root, 300_000);
  if (result.error) throw blocked(`node scripts/repo-rules.mjs could not run in ${root}: ${result.error.message}`);
  const output = `${result.stdout}${result.stderr}`;
  return { status: result.status, lines: output.split('\n'), output };
}

// ---- AC2: vitest run packages/contracts/test/events.test.ts, read through Vitest's JSON report.

export interface Assertion { fullName: string; status: string; failureMessages: string[] }
export interface EventsRun { status: number | null; assertions: Assertion[]; output: string }

export function eventsTest(root: string): EventsRun {
  const report = join(mkdtempSync(join(tmpdir(), 'da1143-report-')), 'report.json');
  try {
    const vitest = join(root, 'node_modules/vitest/vitest.mjs');
    if (!existsSync(vitest)) throw blocked(`no Vitest at ${vitest}; run npm ci`);
    const result = run(process.execPath, [vitest, 'run', 'packages/contracts/test/events.test.ts', '--reporter=default', '--reporter=json', `--outputFile=${report}`], root, 300_000);
    if (result.error) throw blocked(`vitest could not run in ${root}: ${result.error.message}`);
    const output = `${result.stdout}${result.stderr}`;
    if (!existsSync(report)) throw blocked(`vitest wrote no JSON report (exit ${result.status}):\n${tail(output)}`);
    const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults: { assertionResults: Assertion[] }[] };
    return { status: result.status, assertions: json.testResults.flatMap((file) => file.assertionResults), output };
  } finally {
    rmSync(dirname(report), { recursive: true, force: true });
  }
}

// ---- AC3: cargo clippy --workspace --all-targets --locked -- -D warnings.

interface Target { name: string; kind: string[] }
interface Span { file_name: string; line_start: number; is_primary: boolean }
type CargoLine =
  | { reason: 'compiler-message'; manifest_path: string; target: Target; message: { level: string; code: { code: string } | null; message: string; spans: Span[] } }
  | { reason: 'compiler-artifact'; manifest_path: string; target: Target; profile: { test: boolean } }
  | { reason: string; manifest_path?: string; target?: Target };

export interface ClippyJudgement {
  /** Each result_large_err clippy reported in crates/deep-canvas, as `file:line: message`. */
  largeErr: string[];
  /** The deep-canvas targets clippy didn't get to lint, each with why. Empty when it linted every one. */
  unchecked: string[];
}

/**
 * Judges clippy's JSON messages for crates/deep-canvas. A target counts as linted when clippy finished it (a
 * compiler-artifact; for the library, in both its check and its test build), or when every error it reported is a
 * clippy lint, so the lint pass ran over it. A target with no artifact and no messages, or with a compile error, wasn't
 * linted: clippy never got to it, or stopped before its lints.
 */
export function judgeClippy(stdout: string, manifest: string, targets: Target[]): ClippyJudgement {
  const lines = stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as CargoLine);
  const ours = lines.filter((line) => line.manifest_path !== undefined && realpathOrSelf(line.manifest_path) === manifest);
  const largeErr: string[] = [];
  for (const line of lines) {
    if (line.reason !== 'compiler-message' || !('message' in line)) continue;
    if (line.message.code?.code !== 'clippy::result_large_err') continue;
    const span = line.message.spans.find((s) => s.is_primary) ?? line.message.spans[0];
    const inCrate = realpathOrSelf(line.manifest_path) === manifest || /^crates\/deep-canvas\//.test(span?.file_name ?? '');
    if (inCrate) largeErr.push(`${span?.file_name ?? '(no span)'}:${span?.line_start ?? '?'}: ${line.message.message}`);
  }
  const unchecked: string[] = [];
  for (const target of targets) {
    const own = ours.filter((line) => line.target?.name === target.name && line.target.kind.join() === target.kind.join());
    const artifacts = own.filter((line): line is Extract<CargoLine, { reason: 'compiler-artifact' }> => line.reason === 'compiler-artifact');
    const finished = target.kind.includes('lib') ? artifacts.some((a) => a.profile.test) && artifacts.some((a) => !a.profile.test) : artifacts.length > 0;
    if (finished) continue;
    const errors = own.flatMap((line) => (line.reason === 'compiler-message' && 'message' in line && line.message.level === 'error' ? [line.message] : []))
      .filter((m) => m.code !== null || !/^aborting due to/.test(m.message));
    const lintsOnly = errors.length > 0 && errors.every((m) => m.code?.code.startsWith('clippy::'));
    if (lintsOnly) continue;
    const why = errors.length ? `it stopped on ${errors.find((m) => !m.code?.code.startsWith('clippy::'))?.message ?? 'an error'}` : 'clippy never reached it';
    unchecked.push(`${target.kind.join(',')} ${target.name}: ${why}`);
  }
  return { largeErr, unchecked };
}

const realpathOrSelf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** deep-canvas's manifest and every target `--all-targets` lints, from cargo metadata. */
export function deepCanvasTargets(root: string): { manifest: string; targets: Target[] } {
  const result = run('cargo', ['metadata', '--no-deps', '--format-version', '1', '--locked', '--offline'], root, 300_000);
  if (result.error || result.status !== 0) throw blocked(`cargo metadata could not run: ${result.error?.message ?? tail(result.stderr, 5)}`);
  const pkg = (JSON.parse(result.stdout) as { packages: { name: string; manifest_path: string; targets: Target[] }[] }).packages.find((p) => p.name === 'deep-canvas');
  if (!pkg) throw blocked('the workspace has no deep-canvas package');
  return { manifest: realpathOrSelf(pkg.manifest_path), targets: pkg.targets.map(({ name, kind }) => ({ name, kind })) };
}

// ---- The planted wrong programs: a copy of the checkout as git lists it, tracked and new files, uncommitted edits included.

/**
 * A copy of every file `git ls-files --cached --others --exclude-standard` lists, as the working tree has it, in a new
 * git repo under the temporary folder, with node_modules copied whole (never linked). The caller removes it.
 */
export function copyCheckout(): string {
  const listed = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], repoRoot, 120_000);
  if (listed.error || listed.status !== 0) throw blocked(`git ls-files failed: ${listed.error?.message ?? listed.stderr}`);
  const copy = mkdtempSync(join(tmpdir(), 'da1143-copy-'));
  for (const path of new Set(listed.stdout.split('\0').filter(Boolean))) {
    const from = join(repoRoot, path);
    let stat;
    try {
      stat = lstatSync(from);
    } catch {
      continue; // a tracked file deleted from the working tree
    }
    if (stat.isDirectory()) continue;
    mkdirSync(dirname(join(copy, path)), { recursive: true });
    cpSync(from, join(copy, path), { verbatimSymlinks: true, preserveTimestamps: true });
  }
  // What git ignores but a run needs: the installed modules, and each workspace's build (npm run build --workspaces),
  // which the workspaces' package entries point at.
  const built = readdirSync(join(repoRoot, 'packages')).map((name) => `packages/${name}/dist`).filter((path) => existsSync(join(repoRoot, path)));
  for (const path of ['node_modules', ...built]) {
    const cp = run('cp', ['-a', join(repoRoot, path), join(copy, path)], repoRoot, 600_000);
    if (cp.error || cp.status !== 0) throw blocked(`copying ${path} failed: ${cp.error?.message ?? cp.stderr}`);
  }
  const init = run('git', ['init', '-q'], copy, 60_000);
  if (init.error || init.status !== 0) throw blocked(`git init failed in the copy: ${init.error?.message ?? init.stderr}`);
  return copy;
}
