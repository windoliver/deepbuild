// Needs you's bench, for AC3 and AC4 (README): the real asks core (`openAsks`, @deepbuild/asks's public entry) on the
// real record, as #880's suite seeds it, with one session whose worktree is a real git repo. Asks are raised through
// the core's own `raise`, each an authority ask pinned to a commit of that worktree, as the hub raises them.
//
// The `git` count: a stand-in script named `git`, first on PATH while a load runs, appends one line to a log for each
// start and execs the real git with the same arguments, so every git process the core starts in the load is one line.
// The core starts git with node's execFile, which looks `git` up on the process's PATH when it starts it.
//
// Safety: every folder is under /tmp/dh2647-*, removed after its file; HOME for git is the test's own folder; no
// network, no model; the only processes started are git (and the stand-in's /bin/sh), each run to its end.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { askSources, openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openRecord, type Connection } from '../../../packages/record/src/index.ts';
import { withPlans } from '../plans.ts';
import { ulid } from '../24/helpers.ts';
import { withDeclared } from '../declared.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const made: string[] = [];
export function tempDir(): string {
  const dir = mkdtempSync('/tmp/dh2647-');
  made.push(dir);
  return dir;
}
export function removeTemp(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The session's worktree.
export const SESSION = 'S2647';
const PROJECT = 'shop';
export interface Tree { dir: string; home: string }
const gitEnv = (t: Tree): NodeJS.ProcessEnv => ({
  PATH: '/usr/bin:/bin', HOME: t.home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'You', GIT_AUTHOR_EMAIL: 'you@example.invalid',
  GIT_COMMITTER_NAME: 'You', GIT_COMMITTER_EMAIL: 'you@example.invalid', LC_ALL: 'C',
});
export const git = (t: Tree, ...args: string[]): string => execFileSync('git', ['-C', t.dir, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { env: gitEnv(t), encoding: 'utf8', maxBuffer: 1 << 26 });
export function makeTree(root: string): Tree {
  const t = { dir: join(root, 'shop'), home: join(root, 'home') };
  mkdirSync(t.dir, { recursive: true });
  mkdirSync(t.home, { recursive: true });
  git(t, 'init', '-q', '-b', 'main');
  return t;
}
/** A commit writing `files` in the worktree; its hash. */
export function commit(t: Tree, files: Record<string, string>, message: string): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(t.dir, path, '..'), { recursive: true });
    writeFileSync(join(t.dir, path), text);
  }
  git(t, 'add', '-A');
  git(t, 'commit', '-q', '-m', message);
  return git(t, 'rev-parse', 'HEAD').trim();
}
/**
 * What the merge base's card shows as `changed` for an ask pinned to `from` while the worktree's head is `to`, read
 * with git directly: null when the head is still `from`, else the commits, the files `git diff --name-only` names and
 * the whole `git diff` between them.
 */
export function changedOnBase(t: Tree, from: string): { from: string; to: string; files: string[]; diff: string } | null {
  // In this process's own environment, as the core runs git: the same user config shapes both diffs.
  const run = (...args: string[]): string => execFileSync('git', ['-C', t.dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const to = run('rev-parse', 'HEAD').trim();
  if (to === from) return null;
  return { from, to, files: run('diff', '--name-only', from, to).split('\n').filter(Boolean), diff: run('diff', from, to) };
}

// ---- The asks core on its record.
const who = { actor: 'you', scope: 'you' };
const core: Connection = { writer: 'core', ...who, session: SESSION, project: PROJECT };
const AUTHORITY = [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }];
export interface Bench { asks: Asks; close(): Promise<void> }
/** The asks core on a fresh record, with the session started in the worktree. */
export async function openBench(root: string, t: Tree): Promise<Bench> {
  const now = Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now });
  const asks = withDeclared(withPlans(await openAsks({ record, now: Date.now, deliver: () => undefined })));
  await record.append({ writer: 'hook', ...who, session: SESSION, project: PROJECT, agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: t.dir, branch: 'main', thread: SESSION } });
  return { asks, close: () => record.close() };
}
/** Raises an authority ask of the session, about `subject`, pinned to the commit `ref`; its handle. */
export async function raise(b: Bench, subject: string, ref: string): Promise<string> {
  const source = askSources().find((row) => row.kind === 'authority')!.source;
  const now = Date.now();
  return b.asks.raise(core, source, {
    kind: 'authority', question: `Push ${subject} to origin?`, options: structuredClone(AUTHORITY), recommended: null,
    deadline: now + 86_400_000, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key: sha256(`authority:${subject}`),
    pinned_to: { kind: 'commit', ref },
  });
}

// ---- The git stand-in.
const REAL_GIT = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'].find((p) => existsSync(p));
export interface Counter { bin: string; log: string; starts(): string[] }
/** A folder holding the `git` stand-in, and its log: one line per start, with its arguments. */
export function gitCounter(root: string): Counter {
  if (!REAL_GIT) throw Error('BLOCKED: no git binary at /usr/bin, /opt/homebrew/bin or /usr/local/bin for the stand-in to exec');
  const bin = join(root, 'bin');
  const log = join(root, 'git-starts.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${REAL_GIT}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  return { bin, log, starts: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
}
/** Runs `load` with the stand-in first on this process's PATH, the process the asks core runs in; the git starts it made. */
export async function counted<T>(c: Counter, load: () => Promise<T>): Promise<{ value: T; starts: string[] }> {
  const before = c.starts().length;
  const path = process.env.PATH;
  process.env.PATH = `${c.bin}:${path ?? '/usr/bin:/bin'}`;
  try {
    const value = await load();
    return { value, starts: c.starts().slice(before) };
  } finally {
    process.env.PATH = path;
  }
}
