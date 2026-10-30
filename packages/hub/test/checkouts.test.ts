// The base-commit service's checkouts from where a session really sits (#31): a subfolder of the repo, and a dependency
// folder git partly tracks. Real git, no hub; the host and leases only serve stand-ins, which these declare none of.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCheckouts, type CheckoutsOptions } from '@deepbuild/gate';
import { afterEach, describe, expect, it } from 'vitest';

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function world(): { repo: string; service: ReturnType<typeof openCheckouts>; git(...args: string[]): void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-checkouts-')));
  made.push(dir);
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'pkg/sub'), { recursive: true });
  const git = (...args: string[]): void => { execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, stdio: 'ignore' }); };
  git('init', '-q');
  writeFileSync(join(repo, 'root.txt'), 'root\n');
  writeFileSync(join(repo, 'pkg/sub/b.txt'), 'b\n');
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  mkdirSync(join(repo, 'node_modules'));
  writeFileSync(join(repo, 'node_modules/dep.js'), 'dep\n');
  git('add', '-A');
  const service = openCheckouts({ store: join(dir, 'store'), root: join(dir, 'checkouts'), kinds: [], host: {} as CheckoutsOptions['host'], leases: {} as CheckoutsOptions['leases'], now: Date.now });
  return { repo, service, git };
}

describe('checkouts from where a session sits', () => {
  it('a session in a subfolder gets the whole repo, its dependencies from the top', async () => {
    const { repo, service, git } = world();
    git('commit', '-qm', 'base');
    const s = await service;
    writeFileSync(join(repo, 'root.txt'), 'edited\n');
    const from = join(repo, 'pkg/sub');
    const { commit } = await s.snapshot(from);
    const c = await s.checkout({ worktree: from, commit, dependencies: ['node_modules'], runs: ['r'] });
    expect(readFileSync(join(c.dir, 'root.txt'), 'utf8')).toBe('edited\n');
    expect(existsSync(join(c.dir, 'pkg/sub/b.txt'))).toBe(true);
    expect(existsSync(join(c.dir, 'node_modules/dep.js'))).toBe(true);
    const base = await s.baseCheckout({ worktree: from, onto: 'HEAD', claim: commit, own: [], dependencies: ['node_modules'], runs: ['r'] });
    expect(readFileSync(join(base.dir, 'root.txt'), 'utf8')).toBe('root\n');
    await s.close();
  }, 60_000);

  it('a linked install that `node_modules/` doesn\'t ignore stays out of the snapshot, and the checkout gets a clone of it', async () => {
    const { repo, service, git } = world();
    git('commit', '-qm', 'base');
    const s = await service;
    const shared = join(repo, '..', 'shared');
    mkdirSync(shared);
    writeFileSync(join(shared, 'dep.js'), 'dep\\n');
    rmSync(join(repo, 'node_modules'), { recursive: true });
    symlinkSync(shared, join(repo, 'node_modules'));
    writeFileSync(join(repo, 'root.txt'), 'edited\\n');
    const { commit } = await s.snapshot(repo);
    const c = await s.checkout({ worktree: repo, commit, dependencies: ['node_modules'], runs: ['r'] });
    expect(lstatSync(join(c.dir, 'node_modules')).isDirectory(), 'a real folder, no link').toBe(true);
    writeFileSync(join(c.dir, 'node_modules/x'), 'written\\n');
    expect(existsSync(join(shared, 'x')), 'a write in the checkout stays there').toBe(false);
    expect(existsSync(join(c.dir, 'node_modules/dep.js'))).toBe(true);
    await s.close();
  }, 60_000);

  it('in a folder git partly tracks, the base sees the tree\'s bytes, the ignored rest, and nothing else of the worktree\'s', async () => {
    const { repo, service, git } = world();
    writeFileSync(join(repo, 'node_modules/patched.js'), 'broken\n');
    git('add', '-f', 'node_modules/patched.js');
    git('commit', '-qm', 'base');
    const s = await service;
    writeFileSync(join(repo, 'node_modules/patched.js'), 'fixed\n');
    // Force-added by the fix: tracked in the worktree's index, not in the base's tree.
    writeFileSync(join(repo, 'node_modules/added.js'), 'added\n');
    git('add', '-f', 'node_modules/added.js');
    const { commit } = await s.snapshot(repo);
    const base = await s.baseCheckout({ worktree: repo, onto: 'HEAD', claim: commit, own: [], dependencies: ['node_modules'], runs: ['r'] });
    expect(readFileSync(join(base.dir, 'node_modules/patched.js'), 'utf8')).toBe('broken\n');
    expect(existsSync(join(base.dir, 'node_modules/dep.js')), 'the ignored rest is cloned').toBe(true);
    expect(existsSync(join(base.dir, 'node_modules/added.js')), 'what only the fix has stays out').toBe(false);
    expect(existsSync(join(base.dir, 'node_modules/node_modules')), 'no nested clone').toBe(false);
    await s.close();
  }, 60_000);
});
