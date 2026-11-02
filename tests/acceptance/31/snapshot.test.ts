// #31 AC9 #31.6485de3c, AC10 #31.4e4739a3 and AC13 #31.2f87995e: the claim's own checkout. A snapshot commit from a copy of the session's index, in DeepBuild's
// store; ignored dependency folders cloned; and the same tree on the same HEAD the same commit. Real git, real folders.
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CheckResult, CheckRunnerFill } from '../../../packages/conformance/src/index.ts';
import type { Checkouts, Snapshot } from '../../../packages/gate/src/index.ts';
import { changed, digestOf, git, inStore, makeRepo, mustFail, openWorld, presenceKind, repoHolds, repoState, SEEDED, sleep, spec, storeHolds, storeObjects, write, type RepoState, type World } from './helpers.ts';

async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try { await body(w); } finally { await w.close(); }
}
const EDIT = '// edited, uncommitted\nexport const edited = true;\n';
const NEW = 'export const added = true;\n';
const IGNORED = { 'dist/out.js': 'built\n', 'node_modules/dep/index.js': 'dep\n' };

/** The sample repo at main with `src/cart.ts` edited, `src/new.ts` untracked, both uncommitted, and ignored files beside them. */
function edited(): string {
  const repo = makeRepo(SEEDED);
  write(repo, { 'src/cart.ts': EDIT, 'src/new.ts': NEW, ...IGNORED });
  return repo;
}
const CHECK = { check: 'presence', spec: spec('presence', 'src/new.ts'), deadline: 60_000, on_base: 'passes' as const, own: [] };
interface Observed { snapshot: string; before: RepoState; after: RepoState; checkout: string; ranFiles: string[] }
async function claimOn(service: Checkouts, repo: string, kind: ReturnType<typeof presenceKind>): Promise<Observed> {
  const before = repoState(repo);
  const r = await service.runClaim({ claim: 'claim:ac9', worktree: repo, onto: 'main', checks: [CHECK] });
  const call = kind.calls.at(-1)!;
  return { snapshot: r.snapshot, before, after: repoState(repo), checkout: call.checkout, ranFiles: call.files };
}

describe('AC9 #31.6485de3c a claim on uncommitted edits runs in a checkout of a snapshot commit', () => {
  it('AC9 the snapshot\'s parent is HEAD and its tree holds both files and nothing .gitignore names, and the check ran in a checkout of it', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      const o = await claimOn(service, repo, kind);
      expect(o.snapshot, 'a commit of its own, not HEAD').not.toBe(o.before.head);
      expect(inStore(w.store, repo, ['rev-parse', `${o.snapshot}^`]), 'its parent').toBe(o.before.head);
      const tree = inStore(w.store, repo, ['ls-tree', '-r', '--name-only', o.snapshot]).split('\n');
      expect(tree).toEqual(expect.arrayContaining(['src/cart.ts', 'src/new.ts', '.gitignore', 'package.json']));
      expect(tree.filter((f) => f.startsWith('dist/') || f.startsWith('node_modules/')), 'nothing .gitignore names').toEqual([]);
      expect(inStore(w.store, repo, ['show', `${o.snapshot}:src/cart.ts`])).toBe(EDIT.trim());
      expect(inStore(w.store, repo, ['show', `${o.snapshot}:src/new.ts`])).toBe(NEW.trim());
      expect(o.checkout, 'never in the live worktree').not.toBe(repo);
      expect(o.ranFiles).toEqual(expect.arrayContaining(['src/cart.ts', 'src/new.ts']));
      expect(o.ranFiles.filter((f) => f.startsWith('dist/')), 'and the ignored files aren\'t in its checkout unless declared').toEqual([]);
    });
  }, 120_000);

  it('AC9 after the run the session\'s index file is byte for byte the same, and status, refs and the repo\'s own objects are unchanged', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      const o = await claimOn(service, repo, kind);
      expect(storeHolds(w.store, o.snapshot), 'the snapshot is in DeepBuild\'s store').toBe(true);
      expect(repoHolds(repo, o.snapshot), 'and not in the repo\'s objects').toBe(false);
      expect(changed(o.before, o.after)).toEqual([]);
    });
  }, 120_000);

  it('AC9 (wrong program) a service that writes the snapshot through the session\'s index fails, naming the index', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind], plant: 'snapshot-through-index' });
      const o = await claimOn(service, repo, kind);
      const changes = changed(o.before, o.after);
      await mustFail('snapshot-through-index', () => expect(changes, 'changed').toEqual([]), ['index']);
    });
  }, 120_000);

  it('AC9 (wrong program) a service that writes the snapshot into the repo\'s objects fails, naming the objects', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind], plant: 'snapshot-into-repo' });
      const o = await claimOn(service, repo, kind);
      const changes = changed(o.before, o.after);
      await mustFail('snapshot-into-repo', () => expect(changes, 'changed').toEqual([]), ['objects']);
    });
  }, 120_000);

  const marked = (): string => {
    const repo = edited();
    git(repo, ['update-index', '--skip-worktree', 'src/cart.ts']);
    return repo;
  };
  it('AC9 with src/cart.ts also marked skip-worktree in the session\'s index, the snapshot still holds its edit and the mark stays yours', async () => {
    await withWorld(async (w) => {
      const repo = marked();
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      const o = await claimOn(service, repo, kind);
      expect(inStore(w.store, repo, ['show', `${o.snapshot}:src/cart.ts`]), 'src/cart.ts').toBe(EDIT.trim());
      expect(changed(o.before, o.after), 'the index, mark included').toEqual([]);
      expect(git(repo, ['ls-files', '-v', 'src/cart.ts']).startsWith('S '), 'the mark').toBe(true);
    });
  }, 120_000);

  it('AC9 (wrong program) a service that copies the index without clearing the mark leaves the edit out and fails, naming the file', async () => {
    await withWorld(async (w) => {
      const repo = marked();
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind], plant: 'keeps-skip-worktree' });
      const o = await claimOn(service, repo, kind);
      const held = inStore(w.store, repo, ['show', `${o.snapshot}:src/cart.ts`]);
      await mustFail('keeps-skip-worktree', () => expect(held, 'src/cart.ts').toBe(EDIT.trim()), ['src/cart.ts']);
    });
  }, 120_000);
});

/** A test kind that writes `node_modules/.cache/x` in its checkout, and fails unless the clone's own files are there. */
function writesCache(): CheckRunnerFill & { checkouts: string[] } {
  const checkouts: string[] = [];
  return {
    slot: 'check.kind@1', revision: 1, kind: 'writes-cache', checkouts,
    run: (_s, ctx) => {
      checkouts.push(ctx.checkout);
      const held = existsSync(join(ctx.checkout, 'node_modules/dep/index.js'));
      mkdirSync(join(ctx.checkout, 'node_modules/.cache'), { recursive: true });
      writeFileSync(join(ctx.checkout, 'node_modules/.cache/x'), 'written by the check\n');
      const r: CheckResult = { outcome: held ? 'passed' : 'failed', testsRun: 1, failures: [], evidence: [], read: [], mask: null };
      return r;
    },
  };
}
const CACHE = { check: 'cache', spec: spec('writes-cache', 'x'), deadline: 60_000, on_base: 'passes' as const, own: [] };

describe('AC10 #31.4e4739a3 a check that writes under node_modules in the claim\'s checkout leaves the session\'s unchanged', () => {
  it('AC10 the folder is a clone: the check sees the install, its write stays in its checkout, and the session\'s node_modules is byte for byte the same', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      const session = digestOf(join(repo, 'node_modules'));
      const kind = writesCache();
      const service = await w.service({ kinds: [kind] });
      const r = await service.runClaim({ claim: 'claim:ac10', worktree: repo, onto: 'main', dependencies: ['node_modules'], checks: [CACHE] });
      expect(r.checks[0]!.head.outcome, 'the install was there').toBe('passed');
      expect(kind.checkouts[0], 'in a checkout, not the live worktree').not.toBe(repo);
      expect(existsSync(join(repo, 'node_modules/.cache/x')), 'node_modules/.cache/x reached the session').toBe(false);
      expect(digestOf(join(repo, 'node_modules')) === session, 'the session\'s node_modules').toBe(true);
    });
  }, 120_000);

  it('AC10 the checkout\'s folder is no link of any kind while the run goes on', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      let link: boolean | null = null;
      let sameFile: boolean | null = null;
      const kind = presenceKind('presence', (ctx) => {
        link = lstatSync(join(ctx.checkout, 'node_modules')).isSymbolicLink();
        const a = lstatSync(join(ctx.checkout, 'node_modules/dep/index.js'));
        const b = lstatSync(join(repo, 'node_modules/dep/index.js'));
        sameFile = a.ino === b.ino && a.dev === b.dev;
      });
      const service = await w.service({ kinds: [kind] });
      await service.runClaim({ claim: 'claim:ac10b', worktree: repo, onto: 'main', dependencies: ['node_modules'], checks: [CHECK] });
      expect(link, 'a symbolic link').toBe(false);
      expect(sameFile, 'a hard link to the session\'s file').toBe(false);
    });
  }, 120_000);

  it('AC10 (wrong program) a service that links the folder instead of cloning it fails, naming the file', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      const kind = writesCache();
      const service = await w.service({ kinds: [kind], plant: 'links-dependencies' });
      await service.runClaim({ claim: 'claim:ac10c', worktree: repo, onto: 'main', dependencies: ['node_modules'], checks: [CACHE] });
      const reached = existsSync(join(repo, 'node_modules/.cache/x'));
      await mustFail('links-dependencies', () => expect(reached, 'node_modules/.cache/x reached the session').toBe(false), ['node_modules/.cache/x']);
    });
  }, 120_000);
});

describe('AC13 #31.2f87995e two stops with the same edits on the same HEAD give the same snapshot commit', () => {
  const stops = async (service: Checkouts, store: string, repo: string): Promise<{ first: Snapshot; second: Snapshot; written: number }> => {
    const first = await service.snapshot(repo);
    const after = storeObjects(store);
    await sleep(1100); // A commit's date has one-second steps: a stamped time would differ.
    const second = await service.snapshot(repo);
    return { first, second, written: storeObjects(store) - after };
  };

  it('AC13 the second stop gives the same commit and writes no object to DeepBuild\'s store', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      let clock = 1_000_000;
      const service = await w.service({ now: () => (clock += 60_000) });
      const { first, second, written } = await stops(service, w.store, repo);
      expect(first.commit, 'the first stop wrote a snapshot').not.toBe(git(repo, ['rev-parse', 'HEAD']));
      expect(first.wrote, 'the first stop wrote it').toBe(true);
      expect(second.commit, 'the same tree on the same HEAD').toBe(first.commit);
      expect(second.wrote, 'the second wrote nothing').toBe(false);
      expect(written, 'objects written to the store by the second stop').toBe(0);
    });
  }, 120_000);

  it('AC13 a further edit makes another snapshot; a clean worktree\'s snapshot is HEAD and writes nothing', async () => {
    await withWorld(async (w) => {
      const repo = makeRepo(SEEDED);
      const service = await w.service();
      const clean = await service.snapshot(repo);
      expect(clean.commit, 'on a clean worktree the snapshot is HEAD').toBe(git(repo, ['rev-parse', 'HEAD']));
      expect(clean.wrote).toBe(false);
      write(repo, { 'src/cart.ts': EDIT });
      const one = await service.snapshot(repo);
      write(repo, { 'src/cart.ts': `${EDIT}// more\n` });
      const two = await service.snapshot(repo);
      expect(two.commit).not.toBe(one.commit);
      expect(two.wrote).toBe(true);
    });
  }, 120_000);

  it('AC13 (wrong program) a service that stamps the current time writes two commits and fails this test', async () => {
    await withWorld(async (w) => {
      const repo = edited();
      const service = await w.service({ plant: 'stamps-time' });
      const { first, second, written } = await stops(service, w.store, repo);
      expect(first.commit).not.toBe('');
      await mustFail('stamps-time, the commit', () => expect(second.commit, 'the same commit').toBe(first.commit));
      await mustFail('stamps-time, the store', () => expect(written, 'objects written').toBe(0));
    });
  }, 120_000);
});
