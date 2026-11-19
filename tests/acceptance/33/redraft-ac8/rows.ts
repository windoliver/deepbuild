// How #33 AC8's offline test decides `node scripts/spine.mjs list` (README, How a row is decided). Read-only git only.
import { execFileSync } from 'node:child_process';

/** The day of the repository's history rewrite: a commit GitHub recorded before it may be missing from main's history. */
export const REWRITE_DAY = '2026-11-09';
const SPINE_SIZE = 25;
const LINE = /^#([1-9][0-9]*) ([0-9a-f]{40})$/;
/** What a rewrite keeps of a commit: its tree, author, author date and subject (its hash and committer change). */
const KEY = '%T%x09%an%x09%ae%x09%aI%x09%s';

export type Git = (args: string[]) => string;
/** Read-only git in `cwd`; `env` adds variables (a twin's objects live in a temporary object directory). */
export function gitIn(cwd: string, env: NodeJS.ProcessEnv = {}): Git {
  return (args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}
const tryGit = (git: Git, args: string[]): string | undefined => { try { return git(args).trim(); } catch { return undefined; } };

/** Main's history: every commit reachable from HEAD, and from origin/main when this clone has it. */
export function mainHistory(git: Git): { hashes: Set<string>; keys: Set<string> } {
  const tips = ['HEAD', ...(tryGit(git, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main']) ? ['refs/remotes/origin/main'] : [])];
  const hashes = new Set<string>();
  const keys = new Set<string>();
  for (const line of git(['log', ...tips, `--format=%H%x09${KEY}`]).split('\n').filter(Boolean)) {
    const tab = line.indexOf('\t');
    hashes.add(line.slice(0, tab));
    keys.add(line.slice(tab + 1));
  }
  return { hashes, keys };
}

/** Every problem with the list's output; an empty array means each row is a spine task at a commit main merged. */
export function problems(output: string, git: Git, main = mainHistory(git)): string[] {
  const out: string[] = [];
  const lines = output.split('\n').filter((l) => l.trim() !== '');
  if (lines.length !== SPINE_SIZE) out.push(`${lines.length} rows, not the ${SPINE_SIZE} spine tasks`);
  const issues = new Map<string, number>();
  const commits = new Map<string, number>();
  for (const [i, line] of lines.entries()) {
    const m = LINE.exec(line);
    if (!m) { out.push(`line ${i + 1} is not "#<issue> <40-hex merged commit>": ${JSON.stringify(line)}`); continue; }
    const issue = m[1]!;
    const commit = m[2]!;
    if (issues.has(issue)) out.push(`#${issue} is listed twice (lines ${issues.get(issue)! + 1} and ${i + 1})`);
    if (commits.has(commit)) out.push(`#${issue}'s commit ${commit} is also line ${commits.get(commit)! + 1}'s`);
    issues.set(issue, i);
    commits.set(commit, i);
    const type = tryGit(git, ['cat-file', '-t', commit]);
    if (type !== 'commit') { out.push(`#${issue}: ${commit} is ${type ? `a ${type}` : 'no object in this repository'}, not a commit`); continue; }
    if (main.hashes.has(commit)) continue;
    // Not in main's history: only a commit GitHub recorded before the rewrite, whose rewritten copy main holds, is right.
    const [key = '', committed = ''] = git(['log', '-1', `--format=${KEY}%n%cI`, commit]).trim().split('\n');
    if (!main.keys.has(key)) { out.push(`#${issue}: ${commit} is not in main's history, and main holds no commit with its tree, author, date and subject`); continue; }
    if (committed.slice(0, 10) > REWRITE_DAY) out.push(`#${issue}: ${commit} is not in main's history and was committed ${committed}, after the rewrite of ${REWRITE_DAY}`);
  }
  return out;
}
