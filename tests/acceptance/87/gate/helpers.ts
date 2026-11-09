// Shared by the #87 gate-slice acceptance tests (README): the criteria's IDs, the review check package imported
// lazily (so each test fails on its own at the base), real git repositories in temporary folders, and the scratch
// repositories the preflight's replay lane runs in, with the maintainer's security-key approvals. Nothing here stands
// in for the code under test; the stand-in review check of the replay test lives in that test's scratch repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { APPROVERS, people, tag } from '../../../fixtures/approver.mjs';

export const REPO = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
export const PROOF = join(REPO, 'scripts/proof.mjs');

// ---- The criteria: `#87.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`.
export const AC3 = 'AC3 #87.f9b06470';
export const AC8 = 'AC8 #87.85a2cd4f';
export const AC10 = 'AC10 #87.52ef7a04';
export const AC21 = 'AC21 #87.7649e9da';

// ---- The review check, reached only through its public entry, imported when a test first needs it.
type Review = typeof import('../../../../packages/checks-review/src/index.ts');
export const review = (): Promise<Review> => import('../../../../packages/checks-review/src/index.ts');

export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}
/** The message a judgement throws on a wrong program, or null when the judgement holds. */
export async function failureOf(judge: () => unknown): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---- Temporary folders, removed when the file's tests end.
const made: string[] = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
export function tempDir(prefix = 'deep-87-gate-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
/** Writes each file under `root`; a null content removes it. */
export function write(root: string, files: Record<string, string | null>): void {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) rmSync(join(root, path), { force: true });
    else {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  }
}

// ---- git, with no user configuration, hooks or signing of this machine's.
const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main'];
export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } }).trim();
/** Writes the files and commits them; returns the commit. */
export function commit(cwd: string, files: Record<string, string | null>, message: string): string {
  write(cwd, files);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}
/** A new git repository on main in a temporary folder, its first commit holding `files`. */
export function gitRepo(files: Record<string, string>): { cwd: string; first: string } {
  const cwd = tempDir();
  git(cwd, 'init', '-q', '-b', 'main');
  return { cwd, first: commit(cwd, files, 'base') };
}

// ---- The scratch repositories of the replay lane (README, AC21), as #569's suite builds them.
export interface Scene { cwd: string; head: string; env: Record<string, string>; keys: ReturnType<typeof people>; approvals: number }
/**
 * `base` committed on main as the merge base, with origin/main pointing at it; then each change commit on branch
 * `change`. DEEP_PROOF_ISSUES names an empty folder (the change names no issue); the maintainer's security key is on
 * the merge base's .deepbuild/approvers (#1326).
 */
export function scene(base: Record<string, string>, commits: { files: Record<string, string | null>; message: string }[]): Scene {
  const cwd = tempDir();
  const keys = people();
  git(cwd, 'init', '-q', '-b', 'main');
  commit(cwd, { [APPROVERS]: keys.list, ...base }, 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '-b', 'change');
  let head = git(cwd, 'rev-parse', 'HEAD');
  for (const c of commits) head = commit(cwd, c.files, c.message);
  return { cwd, head, env: { DEEP_PROOF_ISSUES: tempDir('deep-87-gate-issues-') }, keys, approvals: 0 };
}
/** The maintainer's yes (or `signer`'s): a security key's signed annotated tag under deep/approved/ on `at`, one `Approves:` line per item. */
export function approve(s: Scene, at: string, items: string[], signer: 'maintainer' | 'stranger' = 'maintainer'): void {
  tag(s.cwd, `deep/approved/${++s.approvals}`, at, items, s.keys[signer]);
}
export interface Proof { status: number | null; stdout: string; stderr: string; lines: string[] }
/** `node scripts/proof.mjs ...args` from this checkout, its cwd the scene's repository. */
export function proof(s: Scene, args: string[]): Proof {
  const env: NodeJS.ProcessEnv = { ...process.env, ...s.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  const r = spawnSync(process.execPath, [PROOF, ...args], { cwd: s.cwd, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 << 20 });
  const stdout = r.stdout ?? '';
  return { status: r.status, stdout, stderr: r.stderr ?? '', lines: stdout.split('\n') };
}
export const showProof = (r: Proof): string => `exit ${r.status}\nstdout:\n${r.stdout.slice(0, 6000)}\nstderr:\n${r.stderr.slice(0, 2000)}`;
/** The lines of `lane` in one of `states`, `<STATE> <lane>: …`. */
export const linesOf = (r: Proof, states: string[], lane: string): string[] => r.lines.filter((l) => states.some((s) => l.startsWith(`${s} ${lane}:`)));
