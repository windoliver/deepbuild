// #1017 AC4, Stale sources never read as fresh: a worktree checked out before the store's entry was built, whose
// branch changes one crate's source (`cart`) and holds a crate that reads CARGO_MANIFEST_DIR (`paths`, as `env!` in a
// test, its library and its `where` binary), receives the clone at its next session start. Its first `cargo build`
// recompiles both crates, or the product isn't placed and its session start says why. A planted store that places it
// anyway leaves both Fresh, runs a binary with the store's checkout path baked in, and fails, naming the crate.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC4, cargoNpmFiles, compiled, contextOf, makeRepo, mustFail, sleep, TARGET, waitBuilt, World, worktree } from './helpers.ts';

async function scenario(plant?: string): Promise<void> {
  const w = new World({ plant });
  try {
    await w.startHub();
    const repo = makeRepo(w, 'shop', cargoNpmFiles(w));
    // Checked out, and its branch's change made, before the store's entry exists.
    const old = worktree(w, repo, 'wt-old');
    const lib = join(old, 'cart', 'src', 'lib.rs');
    writeFileSync(lib, `${readFileSync(lib, 'utf8')}pub fn count(items: &[u32]) -> usize { items.len() }\n`);
    w.git(old, 'commit', '-q', '-am', 'cart: count');
    await sleep(2000);

    w.trust(repo, old);
    const s0 = w.session(repo);
    await s0.start();
    await s0.prompt('Build it.');
    await waitBuilt(w, [TARGET]);

    const s = w.session(old);
    const started = await s.start();
    const said = contextOf(started);
    const placed = existsSync(join(old, 'target'));
    console.log(`AC4 the worktree checked out before the entry: target ${placed ? 'placed' : 'not placed'} at its next session start, which said ${JSON.stringify(said.slice(0, 800))}`);
    if (!placed) {
      expect(said, 'the product isn\'t placed, so the session start must say why, naming target').toMatch(/\btarget\b/);
      return;
    }
    await s.prompt('Build it.');
    const build = w.run('cargo', ['build', '--workspace', '--locked'], old);
    console.log(`AC4 its first cargo build (exit ${build.code}):\n${build.out.slice(-3000)}`);
    expect(build.code, `its first cargo build must succeed: ${build.out.slice(-1500)}`).toBe(0);
    const fresh = ['cart', 'paths'].filter((c) => !compiled(build.out).includes(c));
    expect(fresh, `its first cargo build must recompile both cart (whose source its branch changed) and paths (which bakes CARGO_MANIFEST_DIR in); it left ${fresh.map((c) => `\`${c}\``).join(' and ')} Fresh`).toEqual([]);
    const where = w.run(join(old, 'target', 'debug', 'where'), [], old);
    expect(where.out.trim(), `crate \`paths\`'s binary must name this worktree's own crate folder, not the store's checkout`).toBe(join(old, 'paths'));
  } finally {
    await w.close();
  }
}

describe(`${AC4} stale sources never read as fresh`, () => {
  it(`${AC4} a worktree checked out before the entry was built either recompiles cart and paths after the clone, or gets no target and its session start says why`, async () => {
    await scenario();
  }, 3_600_000);

  it(`${AC4} a planted store that places the clone anyway leaves both crates Fresh and fails, naming the crate`, async () => {
    await mustFail('AC4 places-stale', () => scenario('places-stale'), ['`paths`']);
  }, 3_600_000);
});
