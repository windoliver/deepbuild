// #31 AC3 #31.95ac64f6 and AC5 #31.21807e6b: a run on the base and on the claim touches nothing of yours: no stash entry, no other worktree, and
// your worktree list, refs and objects stay as they were, during the run and after it; nothing is fetched.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changed, commit, digestOf, git, openWorld, presenceKind, REAL_FIX, repoHolds, repoState, sampleBranch, spec, tempDir, write, type RepoState, type World } from './helpers.ts';

async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try { await body(w); } finally { await w.close(); }
}
const check = (runner: string) => ({ check: 'presence', spec: spec('presence', runner), deadline: 60_000, on_base: 'fails' as const, own: [] });

describe('AC3 #31.95ac64f6 no stash entries and no changes to other worktrees after a run', () => {
  it('AC3 with uncommitted edits here and in another worktree, a run makes no stash entry and leaves the other worktree byte for byte, and these edits too', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX, { dependencies: false });
      const other = join(tempDir(), 'other');
      git(repo, ['worktree', 'add', '-q', '-b', 'other', other, 'main']);
      write(other, { 'src/cart.ts': '// their work in progress\n', 'src/theirs.ts': 'export const theirs = 1;\n' });
      write(repo, { 'src/cart.ts': `${REAL_FIX['src/cart.ts']}// my work in progress\n`, 'src/mine.ts': 'export const mine = 1;\n' });
      const otherFiles = digestOf(other);
      const before = { here: repoState(repo), other: repoState(other) };
      expect(before.here.stash, 'no stash entry to begin with').toBe('');
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      const r = await service.runClaim({ claim: 'claim:ac3', worktree: repo, onto: 'main', checks: [check('src/mine.ts')] });
      expect(kind.calls.length, 'the check ran on the claim and on the base').toBe(2);
      expect(r.checks[0]!.base?.outcome, 'with src/mine.ts absent from the base').toBe('failed');
      expect(git(repo, ['stash', 'list']), 'no stash entries').toBe('');
      expect(changed(before.other, repoState(other)), 'the other worktree\'s state').toEqual([]);
      expect(digestOf(other) === otherFiles, 'the other worktree\'s files, byte for byte').toBe(true);
      expect(changed(before.here, repoState(repo)), 'this worktree\'s state').toEqual([]);
    });
  }, 120_000);

  it('AC3 a stash entry you already had stays where it was', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX, { dependencies: false });
      write(repo, { 'src/cart.ts': '// stashed\n' });
      git(repo, ['stash', 'push', '-q', '-m', 'yours']);
      write(repo, { 'src/mine.ts': 'export const mine = 1;\n' });
      const stash = git(repo, ['stash', 'list']);
      const top = git(repo, ['rev-parse', 'refs/stash']);
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      await service.runClaim({ claim: 'claim:ac3b', worktree: repo, onto: 'main', checks: [check('src/mine.ts')] });
      expect(kind.calls.length).toBe(2);
      expect(git(repo, ['stash', 'list'])).toBe(stash);
      expect(git(repo, ['rev-parse', 'refs/stash'])).toBe(top);
    });
  }, 120_000);
});

describe('AC5 #31.21807e6b after a base-commit run, your repo\'s worktree list, refs and objects are unchanged', () => {
  it('AC5 during the run and after it the worktree list, the refs and the object files are as they were', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX, { dependencies: false });
      const before = repoState(repo);
      const during: RepoState[] = [];
      const kind = presenceKind('presence', () => { during.push(repoState(repo)); });
      const service = await w.service({ kinds: [kind] });
      const r = await service.runClaim({ claim: 'claim:ac5', worktree: repo, onto: 'main', checks: [check('src/cart.ts')] });
      expect(r.checks[0]!.base, 'a base-commit run happened').not.toBeNull();
      expect(during.length, 'read inside both runs').toBe(2);
      for (const reading of during) expect(changed(before, reading), 'while a run goes on').toEqual([]);
      expect(changed(before, repoState(repo)), 'after the run').toEqual([]);
    });
  }, 120_000);

  it('AC5 nothing is fetched behind your back: a commit only your remote has stays there', async () => {
    await withWorld(async (w) => {
      const { repo } = sampleBranch('fix', REAL_FIX, { dependencies: false });
      const upstream = join(tempDir(), 'upstream.git');
      git(tempDir(), ['clone', '-q', '--bare', repo, upstream]);
      const elsewhere = join(tempDir(), 'elsewhere');
      git(tempDir(), ['clone', '-q', upstream, elsewhere]);
      git(elsewhere, ['checkout', '-q', '-B', 'main', 'origin/main']);
      const remoteOnly = commit(elsewhere, { 'REMOTE_ONLY.txt': 'only upstream\n' }, 'upstream moves on');
      git(elsewhere, ['push', '-q', upstream, 'HEAD:refs/heads/main']);
      git(repo, ['remote', 'add', 'origin', upstream]);
      const before = repoState(repo);
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      await service.runClaim({ claim: 'claim:ac5b', worktree: repo, onto: 'main', checks: [check('src/cart.ts')] });
      expect(kind.calls.length).toBe(2);
      expect(changed(before, repoState(repo))).toEqual([]);
      expect(repoHolds(repo, remoteOnly), 'the remote\'s commit never reached your repo').toBe(false);
      expect(kind.calls.flatMap((c) => c.files), 'nor any checkout').not.toContain('REMOTE_ONLY.txt');
    });
  }, 120_000);
});
