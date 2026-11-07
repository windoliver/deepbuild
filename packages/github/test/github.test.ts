// What the acceptance suite in tests/acceptance/46 doesn't reach: which calls name a ref, a verdict that waits for its
// push across a restart, and a claim on a stranger's commit, which never makes that commit a session's.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, QUIET_MS, sleep, STRANGER, World, YOU } from '../../../tests/acceptance/46/helpers.ts';
import { FixtureForge } from '../../../tests/acceptance/46/forge.ts';
import { openGitHub } from '../src/index.ts';
import { namesRef } from '../src/pushes.ts';

describe('namesRef', () => {
  it.each([
    ['git push -q origin HEAD:refs/heads/own', 'refs/heads/own', true],
    ['git push origin HEAD:own', 'refs/heads/own', true],
    ['git push origin feature', 'refs/heads/feature', true],
    ['git push --force-with-lease origin +feature', 'refs/heads/feature', true],
    ['git push origin --delete old', 'refs/heads/old', true],
    ['git -C /tmp/w push origin v1', 'refs/tags/v1', true],
    ['git push', 'refs/heads/anything', true],
    ['git push origin HEAD', 'refs/heads/anything', true],
    ['git push --all origin', 'refs/heads/anything', true],
    ['gh pr merge 7 --squash', 'refs/heads/main', true],
    ['npm test', 'refs/heads/feature', false],
    ['git push origin HEAD:refs/heads/own', 'refs/heads/feature', false],
    ['echo done; git fetch origin feature', 'refs/heads/feature', false],
  ])('%s, for %s: %s', (command, ref, named) => {
    expect(namesRef(command, ref)).toBe(named);
  });
});

describe('a verdict waiting on a pushed commit', () => {
  let dir = '';
  let forge: FixtureForge;
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=you', '-c', 'user.email=you@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, FORGE_ACTOR: YOU } }).trim();
  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh46-held-')));
    forge = await FixtureForge.start(dir);
  });
  afterAll(async () => {
    await forge.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('survives a restart, and posts on the pushed commit with its tree', async () => {
    const bare = forge.repo('acme/shop');
    const work = join(dir, 'work');
    git(dir, 'clone', '-q', bare, work);
    git(work, 'checkout', '-q', '-b', 'main');
    writeFileSync(join(work, 'a.md'), 'a\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'first');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', '-b', 'topic');
    writeFileSync(join(work, 'a.md'), 'b\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'second');
    const made = git(work, 'rev-parse', 'HEAD');

    let last = 0;
    const session = { id: 's', agent: 'claude-code', cwd: work };
    const raw = async (query: string, params: (string | number | null)[] = []): Promise<unknown[]> => {
      if (query.includes('MAX(log_pos)')) return [{ at: last }];
      if (query.includes(`kind = 'verdict.made'`)) return params[0] === 0 ? [{ log_pos: 1, data: JSON.stringify({ commit: made, outcome: 'PASS', claim: 'claim:c' }) }] : [];
      if (query.includes('FROM claims')) return [{ cwd: work }];
      if (query.includes('FROM commits')) return [{ sha: made }];
      return [];
    };
    const open = () => openGitHub({
      api: forge.url, state: join(dir, 'github.json'), snapshots: join(dir, 'none'), raw, reads: async () => 'token', posts: () => 'token',
      settings: () => ({ delivery: { 'acme/shop': 'on' }, yours: [] }), sessions: () => [session], unguarded: async () => undefined, hear: () => undefined,
    });
    const first = open();
    await sleep(300);
    last = 1;
    first.verdicts();
    await sleep(500);
    expect(forge.statuses, 'nothing is pushed yet').toEqual([]);

    const after = open();
    git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/topic');
    await after.pass();
    await sleep(500);
    expect(forge.statuses.map((s) => [s.sha, s.state])).toEqual([[made, 'success']]);
  }, 120_000);
});

describe('a claim on a stranger\'s commit', () => {
  afterEach(cleanup, 60_000);
  it('leaves it a stranger\'s: a session that claims it gets no green', async () => {
    const w = await World.start();
    const out = w.outsider(STRANGER, YOU);
    const theirs = out.commit('feature', { 'docs/theirs.md': 'a line\n' });
    out.push('feature');
    const s = await w.session({ branch: 'feature' });
    await s.verdict(await s.claim(theirs), 'PASS');
    const status = await w.status(theirs);
    expect(status.state).toBe('pending');
    expect(status.description).toContain('untrusted head');
    await sleep(QUIET_MS);
    expect(w.forge.statusesOf(theirs).map((x) => x.state)).not.toContain('success');
  }, 300_000);
});
