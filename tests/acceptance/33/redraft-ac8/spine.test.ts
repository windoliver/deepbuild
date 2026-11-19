// #33 AC8, blind redraft, offline part (README). `node scripts/spine.mjs list` names each of the 25 spine tasks and the
// commit it is judged at: the merge commit GitHub records for its PR (owner: "Keep GitHub's hash"). Each row must be
// well formed, name a distinct task and a real commit object that main merged: in main's history, or, for a PR merged
// before the history rewrite of 2026-11-09, GitHub's pre-rewrite commit whose rewritten copy (same tree, author, author
// date and subject) main holds. Planted twins (the list's output with one row altered) must each be rejected.
// The live re-judge and reopening stay in ../spine.live.test.ts, which this file does not touch.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AC8, REPO } from '../helpers.ts';
import { gitIn, mainHistory, problems, type Git } from './rows.ts';

const git = gitIn(REPO);
let output = '';
let rows: string[] = [];
let main: ReturnType<typeof mainHistory>;
let objects = '';
let twinGit: Git;

/** A commit written only to a temporary object directory (the repo's objects as its alternate), never into the repo. */
function plantCommit(tree: string, message: string, env: Record<string, string>): string {
  return execFileSync('git', ['commit-tree', tree, '-p', 'HEAD', '-F', '-'], {
    cwd: REPO, input: message, encoding: 'utf8', env: { ...process.env, ...twinEnv(), ...env },
  }).trim();
}
const twinEnv = () => ({ GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), 'objects') });
const withRow = (i: number, row: string | null) => rows.flatMap((r, j) => (j !== i ? [r] : row === null ? [] : [row])).join('\n');
const commitOf = (i: number) => rows[i]!.split(' ')[1]!;
const issueOf = (i: number) => rows[i]!.split(' ')[0]!;

beforeAll(() => {
  output = execFileSync(process.execPath, ['scripts/spine.mjs', 'list'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
  rows = output.split('\n').filter(Boolean);
  main = mainHistory(git);
  objects = mkdtempSync(join(tmpdir(), 'dh33r8-'));
  twinGit = gitIn(REPO, twinEnv());
});
afterAll(() => { if (objects) rmSync(objects, { recursive: true, force: true }); });

describe(`${AC8} spine list: each of the 25 spine tasks at its merged commit (offline)`, () => {
  it(`${AC8} every row of \`node scripts/spine.mjs list\` names a distinct spine task at a commit main merged`, () => {
    expect(problems(output, git, main), `${AC8}: spine list rows`).toEqual([]);
  });

  describe(`${AC8} planted twins of the list are rejected`, () => {
    const twin = (name: string, make: () => string, said: RegExp) =>
      it(`${AC8} twin ${name} is rejected`, () => {
        const found = problems(make(), twinGit, main);
        expect(found.some((p) => said.test(p)), `${AC8}: twin ${name} gave ${JSON.stringify(found)}`).toBe(true);
      });
    twin('missing-task', () => withRow(rows.length - 1, null), /24 rows, not the 25/);
    twin('extra-task', () => `${output.trim()}\n#999 ${commitOf(0)}`, /26 rows, not the 25/);
    twin('repeated-task', () => withRow(1, `${issueOf(0)} ${commitOf(1)}`), /listed twice/);
    twin('repeated-commit', () => withRow(1, `${issueOf(1)} ${commitOf(0)}`), /is also line 1's/);
    twin('malformed-line', () => withRow(2, `${issueOf(2)} ${commitOf(2).slice(0, 12)}`), /is not "#<issue> <40-hex merged commit>"/);
    twin('made-up-hash', () => withRow(3, `${issueOf(3)} ${'0123456789abcdef'.repeat(3).slice(0, 40)}`), /no object in this repository/);
    twin('tree-not-commit', () => withRow(4, `${issueOf(4)} ${git(['rev-parse', 'HEAD^{tree}']).trim()}`), /a tree, not a commit/);
    twin('unmerged-commit', () => withRow(5, `${issueOf(5)} ${plantCommit(git(['rev-parse', 'HEAD^{tree}']).trim(), 'spine twin: a commit main never merged\n', {
      GIT_AUTHOR_NAME: 'Twin', GIT_AUTHOR_EMAIL: 'twin@example.invalid', GIT_AUTHOR_DATE: '2026-10-20T12:00:00Z', GIT_COMMITTER_NAME: 'Twin', GIT_COMMITTER_EMAIL: 'twin@example.invalid', GIT_COMMITTER_DATE: '2026-10-20T12:00:00Z',
    })}`), /main holds no commit with its tree, author, date and subject/);
    twin('copy-made-after-rewrite', () => withRow(6, `${issueOf(6)} ${copyOf(commitOf(6), '2026-11-15T12:00:00Z')}`), /after the rewrite of 2026-11-09/);
  });

  it(`${AC8} control: a pre-rewrite copy of a merged commit (same tree, author, date, subject; not in main) is accepted`, () => {
    const copy = copyOf(commitOf(6), '2026-11-08T12:00:00Z');
    expect(main.hashes.has(copy), `${AC8}: the control's copy must not be in main`).toBe(false);
    expect(problems(withRow(6, `${issueOf(6)} ${copy}`), twinGit, main), `${AC8}: pre-rewrite copy`).toEqual([]);
  });
});

/** A copy of `commit` as a rewrite makes one (same tree, author, author date and message), committed at `committed`. */
function copyOf(commit: string, committed: string): string {
  const [tree = '', an = '', ae = '', ad = ''] = git(['log', '-1', '--format=%T%x00%an%x00%ae%x00%aI', commit]).trim().split('\0');
  const message = git(['log', '-1', '--format=%B', commit]);
  return plantCommit(tree, message, {
    GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad, GIT_COMMITTER_NAME: 'Twin', GIT_COMMITTER_EMAIL: 'twin@example.invalid', GIT_COMMITTER_DATE: committed,
  });
}
