// The base-commit service's checkouts from where a session really sits (#31): a subfolder of the repo, and a dependency
// folder git partly tracks. Real git, no hub; the host and leases only serve stand-ins, which these declare none of.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCheckouts, type CheckoutsOptions } from '@deepbuild/gate';
import { afterEach, describe, expect, it } from 'vitest';

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function world(kinds: CheckoutsOptions['kinds'] = []): { repo: string; service: ReturnType<typeof openCheckouts>; git(...args: string[]): void } {
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
  const service = openCheckouts({ store: join(dir, 'store'), root: join(dir, 'checkouts'), kinds, host: {} as CheckoutsOptions['host'], leases: {} as CheckoutsOptions['leases'], now: Date.now });
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

  it('a linked install deeper in the repo is cloned too', async () => {
    const { repo, service, git } = world();
    git('commit', '-qm', 'base');
    const s = await service;
    symlinkSync(join(repo, 'node_modules'), join(repo, 'pkg/node_modules'));
    const { commit } = await s.snapshot(repo);
    const c = await s.checkout({ worktree: repo, commit, dependencies: ['node_modules'], runs: ['r'] });
    expect(lstatSync(join(c.dir, 'pkg/node_modules')).isDirectory(), 'a real folder, no link').toBe(true);
    expect(existsSync(join(c.dir, 'pkg/node_modules/dep.js'))).toBe(true);
    await s.close();
  }, 60_000);

  // A package a tree tracks in the ignored folder, now a link in the worktree: the clone keeps that link.
  const linkedPackage = (repo: string, git: (...args: string[]) => void): { real: string; big: Buffer } => {
    const big = Buffer.alloc(2 << 20, 'b');
    mkdirSync(join(repo, 'node_modules/foo'));
    writeFileSync(join(repo, 'node_modules/foo/patched.js'), 'broken\n');
    writeFileSync(join(repo, 'node_modules/foo/big.bin'), big);
    git('add', '-f', 'node_modules/foo');
    git('commit', '-qm', 'base');
    const real = join(repo, '..', 'shared-foo');
    mkdirSync(real);
    writeFileSync(join(real, 'patched.js'), 'real\n');
    writeFileSync(join(real, 'big.bin'), big);
    rmSync(join(repo, 'node_modules/foo'), { recursive: true });
    symlinkSync(real, join(repo, 'node_modules/foo'));
    return { real, big };
  };

  it('making a checkout never changes what a link in a dependency folder points at, and the tree\'s bytes are written in its place', async () => {
    const { repo, service, git } = world();
    const { real, big } = linkedPackage(repo, git);
    const s = await service;
    const { commit } = await s.snapshot(repo);
    const base = await s.baseCheckout({ worktree: repo, onto: 'HEAD', claim: commit, own: [], dependencies: ['node_modules'], runs: ['r'] });
    expect(readFileSync(join(real, 'patched.js'), 'utf8'), 'the small file outside').toBe('real\n');
    expect(readFileSync(join(real, 'big.bin')).equals(big), 'the big file outside').toBe(true);
    expect(lstatSync(join(base.dir, 'node_modules/foo')).isSymbolicLink(), 'no link left in the tree\'s folder').toBe(false);
    expect(readFileSync(join(base.dir, 'node_modules/foo/patched.js'), 'utf8')).toBe('broken\n');
    expect(readFileSync(join(base.dir, 'node_modules/foo/big.bin')).equals(big)).toBe(true);
    await s.close();
  }, 60_000);

  it('a linked install with a stale tracked file under it is still cloned', async () => {
    const { repo, service, git } = world();
    mkdirSync(join(repo, 'pkg/node_modules'));
    writeFileSync(join(repo, 'pkg/node_modules/patched.js'), 'broken\n');
    git('add', '-f', 'pkg/node_modules/patched.js');
    git('commit', '-qm', 'base');
    const s = await service;
    rmSync(join(repo, 'pkg/node_modules'), { recursive: true });
    symlinkSync(join(repo, 'node_modules'), join(repo, 'pkg/node_modules'));
    const { commit } = await s.snapshot(repo);
    const base = await s.baseCheckout({ worktree: repo, onto: 'HEAD', claim: commit, own: [], dependencies: ['node_modules'], runs: ['r'] });
    expect(existsSync(join(base.dir, 'pkg/node_modules/dep.js')), 'the install is there').toBe(true);
    expect(readFileSync(join(base.dir, 'pkg/node_modules/patched.js'), 'utf8')).toBe('broken\n');
    await s.close();
  }, 60_000);

  it('a read-only folder, cloned or made by a run, stops neither the checkout nor its removal nor the next open', async () => {
    const { repo, service, git } = world();
    mkdirSync(join(repo, 'node_modules/ro'));
    writeFileSync(join(repo, 'node_modules/ro/patched.js'), 'broken\n');
    git('add', '-f', 'node_modules/ro/patched.js');
    git('commit', '-qm', 'base');
    chmodSync(join(repo, 'node_modules/ro'), 0o555);
    try {
      const s = await service;
      const { commit } = await s.snapshot(repo);
      const c = await s.checkout({ worktree: repo, commit, dependencies: ['node_modules'], runs: ['r'] });
      mkdirSync(join(c.dir, 'cache'));
      writeFileSync(join(c.dir, 'cache/x'), 'x');
      chmodSync(join(c.dir, 'cache'), 0o555);
      await s.ended(c, 'r');
      expect(existsSync(c.dir), 'removed').toBe(false);
      const crashed = join(repo, '..', 'checkouts', 'c-left');
      mkdirSync(join(crashed, 'cache'), { recursive: true });
      chmodSync(join(crashed, 'cache'), 0o555);
      await s.close();
      const again = await openCheckouts({ store: join(repo, '..', 'store'), root: join(repo, '..', 'checkouts'), kinds: [], host: {} as CheckoutsOptions['host'], leases: {} as CheckoutsOptions['leases'], now: Date.now });
      expect(existsSync(crashed), 'what a crash left is removed').toBe(false);
      await again.close();
    } finally { chmodSync(join(repo, 'node_modules/ro'), 0o755); }
  }, 60_000);

  it('an edit of the same size in the second of the last `git add` is in the snapshot', async () => {
    const { repo, service, git } = world();
    const s = await service;
    // At the start of a second, so the write, the add and the edit share it, and the snapshot comes in a later one.
    while (Date.now() % 1000 > 50) await new Promise((resolve) => setTimeout(resolve, 5));
    writeFileSync(join(repo, 'edit.txt'), 'a\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    writeFileSync(join(repo, 'edit.txt'), 'b\n');
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const { commit } = await s.snapshot(repo);
    const c = await s.checkout({ worktree: repo, commit, runs: ['r'] });
    expect(readFileSync(join(c.dir, 'edit.txt'), 'utf8')).toBe('b\n');
    await s.close();
  }, 60_000);

  describe('what a later claim carries', () => {
    const kindOf = (outcomes: string[]): { kind: { kind: string; run(): Promise<unknown> }; calls(): number } => {
      let i = 0;
      return {
        calls: () => i,
        kind: {
          kind: 'scripted',
          run: async () => {
            const outcome = outcomes[Math.min(i++, outcomes.length - 1)]!;
            return { outcome, testsRun: 1, failures: outcome === 'passed' ? [] : [{ test: 't', file: 'a.ts', line: 1, stack: null, assertion: true, message: 'm' }], evidence: [], read: [], mask: null };
          },
        },
      };
    };
    const twoClaims = async (inputs: string[], outcomes: string[], setUp: (repo: string) => void, change: (repo: string) => void): Promise<{ carried: boolean; calls: number }> => {
      const { repo, git } = world();
      setUp(repo);
      git('add', '-A');
      git('commit', '-qm', 'base');
      const { kind, calls } = kindOf(outcomes);
      const s = await openCheckouts({ store: join(repo, '..', 'store2'), root: join(repo, '..', 'checkouts2'), kinds: [kind] as unknown as CheckoutsOptions['kinds'], host: {} as CheckoutsOptions['host'], leases: {} as CheckoutsOptions['leases'], now: Date.now });
      const checks = [{ check: 'c', spec: { kind: 'scripted', inputs }, own: [] }] as unknown as Parameters<typeof s.runClaim>[0]['checks'];
      const first = await s.runClaim({ claim: 'claim:1', worktree: repo, onto: 'HEAD', checks });
      change(repo);
      const before = calls();
      const second = await s.runClaim({ claim: 'claim:2', worktree: repo, onto: 'HEAD', checks, earlier: [first] });
      await s.close();
      return { carried: second.checks[0]!.carried, calls: calls() - before };
    };

    it('an input that is only renamed runs again', async () => {
      const r = await twoClaims(['src/cart.ts'], ['passed'], (repo) => { mkdirSync(join(repo, 'src')); writeFileSync(join(repo, 'src/cart.ts'), 'cart\n'); }, (repo) => { renameSync(join(repo, 'src/cart.ts'), join(repo, 'src/basket.ts')); });
      expect(r.carried).toBe(false);
    }, 60_000);

    it('an input whose name git would quote runs again when it changes', async () => {
      const r = await twoClaims(['src/café.ts'], ['passed'], (repo) => { mkdirSync(join(repo, 'src')); writeFileSync(join(repo, 'src/café.ts'), 'a\n'); }, (repo) => { writeFileSync(join(repo, 'src/café.ts'), 'b\n'); });
      expect(r.carried).toBe(false);
    }, 60_000);

    it('a clean pass with nothing it names changed still is', async () => {
      const r = await twoClaims(['src/a.ts'], ['passed'], () => undefined, (repo) => { writeFileSync(join(repo, 'other.txt'), 'x\n'); });
      expect(r.carried).toBe(true);
      expect(r.calls).toBe(0);
    }, 60_000);
  });

  it('a module stand-in is never written through a link in the base tree', async () => {
    const { repo, service, git } = world();
    const other = join(repo, '..', 'other');
    mkdirSync(other);
    symlinkSync(other, join(repo, 'vendor'));
    git('add', '-A');
    git('commit', '-qm', 'base');
    const s = await service;
    const { commit } = await s.snapshot(repo);
    await s.baseCheckout({ worktree: repo, onto: 'HEAD', claim: commit, own: [], surfaces: [{ kind: 'module', check: 'c', path: 'vendor/new.ts', exports: ['a'] }], runs: ['r'] });
    expect(existsSync(join(other, 'new.ts')), 'nothing written outside').toBe(false);
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

  it('a run that counts as nothing isn\'t started again and again', async () => {
    let calls = 0;
    const kind: CheckoutsOptions['kinds'][number] = {
      slot: 'check.kind@1', revision: 1, kind: 'seen',
      // A wrong program stops here rather than never.
      run: () => ({ outcome: ++calls > 5 ? 'passed' : 'uncounted', testsRun: 0, failures: [], evidence: [], read: [], mask: 'a child it can\'t see into' }),
    };
    const { repo, service, git } = world([kind]);
    git('commit', '-qm', 'base');
    const s = await service;
    const check = { check: 'c', spec: { kind: 'seen', runner: 'x', inputs: [], depth: 'unit' as const, oracle: 'code' as const, contract: null }, deadline: 1_000, on_base: 'passes' as const, own: [] };
    const r = await s.runClaim({ claim: 'claim:c', worktree: repo, onto: 'HEAD', checks: [check] });
    expect(r.checks[0]!.head.outcome).toBe('uncounted');
    expect(r.verdict).not.toBe('PASS');
    await s.close();
  }, 60_000);
});
