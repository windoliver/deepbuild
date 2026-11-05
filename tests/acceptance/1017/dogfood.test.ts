// #1017 AC7, Dogfood: ten worktrees of DeepBuild's own repo, made one after another from the default branch, take
// under 10% of the disk that ten cold builds take. The first build in each compiles only DeepBuild's own crates and
// packages. The heavy one (README): one cold build of this repo, the hub's own build of the entries, then ten
// worktrees each with its first build, all on a sparse test volume, so it needs well over 100 GB free on the host.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC7, compiled, doneYaml, gb, GB, hostFree, NODE_MODULES, REPO, TARGET, waitBuilt, World, worktree } from './helpers.ts';

const WORKTREES = 10;
const HOST_FREE = 150 * GB;

describe(`${AC7} dogfood: ten worktrees of DeepBuild's own repo`, () => {
  it(`${AC7} ten worktrees made one after another from the default branch take under 10% of ten cold builds' disk, and each first build compiles only DeepBuild's own crates and packages`, async (ctx) => {
    if (hostFree() < HOST_FREE) ctx.skip(`INCONCLUSIVE (not run): the host disk has ${gb(hostFree())} free, under the ${gb(HOST_FREE)} this run writes at most`);
    const w = new World({ gb: 500, env: { npm_config_cache: join(process.env.HOME ?? '', '.npm'), npm_config_prefer_offline: 'true' } });
    try {
      await w.startHub();
      // The default branch: this checkout's HEAD, with the issue's two products declared, pushed to an origin of its own.
      const origin = join(w.dir, 'deepbuild.git');
      w.git(w.dir, 'clone', '-q', '--bare', '--shared', REPO, origin);
      const repo = join(w.dir, 'deepbuild');
      const f0 = w.vol.free();
      w.git(w.dir, 'clone', '-q', origin, repo);
      const branch = w.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
      w.git(repo, 'checkout', '-q', '-B', 'main');
      const yaml = join(repo, '.deepbuild', 'done.yaml');
      w.git(repo, 'rm', '-q', '--cached', '--ignore-unmatch', '.deepbuild/done.yaml');
      mkdirSync(join(repo, '.deepbuild'), { recursive: true });
      writeFileSync(yaml, doneYaml([TARGET, NODE_MODULES]));
      w.git(repo, 'add', '-f', '.deepbuild/done.yaml');
      w.git(repo, 'commit', '-q', '-m', 'Products');
      w.git(repo, 'push', '-q', 'origin', 'main');
      w.git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
      w.git(repo, 'fetch', '-q', 'origin');
      w.git(repo, 'branch', '-q', '-u', 'origin/main');
      w.git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
      console.log(`AC7 the default branch: ${branch} at ${w.git(repo, 'rev-parse', 'HEAD')} plus the products' done.yaml`);

      // One cold build, as today, before the hub knows the repo: ten of them is what the ten worktrees are held to.
      w.must('npm', ['ci'], repo, 1_800_000);
      w.must('cargo', ['build', '--workspace', '--locked'], repo, 4 * 3_600_000);
      const cold = f0 - w.vol.free();
      console.log(`AC7 one cold build (checkout, npm ci, cargo build --workspace): ${gb(cold)}; ten: ${gb(10 * cold)}`);

      w.trust(repo);
      const s0 = w.session(repo);
      await s0.start();
      await s0.prompt('Build it.');
      await waitBuilt(w, [TARGET, NODE_MODULES], { ms: 4 * 3_600_000 });

      const own = (JSON.parse(w.must('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], repo).out.split('\n').find((l) => l.startsWith('{'))!) as { packages: { name: string }[] }).packages.map((p) => p.name);
      const f2 = w.vol.free();
      for (let i = 1; i <= WORKTREES; i++) {
        const at = join(w.dir, `dog-${i}`);
        w.trust(at);
        worktree(w, repo, `dog-${i}`);
        await w.session(at).start();
        const cargo = w.run('cargo', ['build', '--workspace', '--locked'], at, 4 * 3_600_000);
        const npm = w.run('npm', ['run', 'build', '--workspaces'], at, 3_600_000);
        const theirs = compiled(cargo.out).filter((c) => !own.includes(c));
        console.log(`AC7 dog-${i}: cargo build exit ${cargo.code}, ${(cargo.ms / 1000).toFixed(0)} s, compiled ${compiled(cargo.out).length} crates (${theirs.length} not DeepBuild's); npm run build exit ${npm.code}; free ${gb(w.vol.free())}`);
        expect(cargo.code, `dog-${i}: its first cargo build must succeed: ${cargo.out.slice(-1500)}`).toBe(0);
        expect(theirs, `dog-${i}: its first build must compile only DeepBuild's own crates; it compiled ${theirs.slice(0, 10).join(', ')}`).toEqual([]);
        expect(npm.code, `dog-${i}: its first build of DeepBuild's own packages must succeed with no install: ${npm.out.slice(-1500)}`).toBe(0);
        expect(npm.out, `dog-${i}: building the packages installs nothing`).not.toMatch(/\badded \d+ packages?\b/);
      }
      const ten = f2 - w.vol.free();
      console.log(`AC7 the dogfood run's disk use: ten worktrees took ${gb(ten)}, ${((100 * ten) / (10 * cold)).toFixed(2)}% of ten cold builds' ${gb(10 * cold)}`);
      expect(ten, `ten worktrees of DeepBuild's own repo must take under 10% of the disk ten cold builds take (${gb(10 * cold)}); they took ${gb(ten)}`).toBeLessThan(0.1 * 10 * cold);
    } finally {
      await w.close();
    }
  }, 12 * 3_600_000);
});
