// #1017 AC1, Placement: in a sample repo with a Cargo workspace of 3 crates over 120 dependencies, plus an npm
// workspace, a second worktree made from the default branch has `target` and `node_modules` in place before its
// session's first prompt; its first `cargo build` compiles only the 3 workspace crates, and `npm test` passes with no
// install; until its first edit, the disk it adds (the volume's free space before and after) is under 5% of the
// first worktree's. A planted store that hard-links or symlinks the folders fails, naming the file that a build in
// the second worktree changed in the store.
import { describe, expect, it } from 'vitest';
import { AC1, cargoNpmFiles, compiled, CRATES, mustFail, NODE_MODULES, secondWorktree, TARGET, type Toolchain } from './helpers.ts';

const cargoAndNpm: Toolchain = {
  name: 'Cargo and npm',
  files: cargoNpmFiles,
  products: [TARGET, NODE_MODULES],
  cold(w, wt) {
    w.must('cargo', ['build', '--workspace', '--locked'], wt);
    w.must('npm', ['ci'], wt, 600_000);
  },
  firstBuild: (w, wt) => w.run('cargo', ['build', '--workspace', '--locked'], wt),
  after(w, wt, build) {
    expect(build.code, `the second worktree's first \`cargo build\` must succeed: ${build.out.slice(-1500)}`).toBe(0);
    const built = compiled(build.out);
    const deps = built.filter((c) => !CRATES.includes(c));
    expect(deps, `the second worktree's first \`cargo build\` must compile only the 3 workspace crates; it compiled ${deps.length} dependencies too: ${deps.slice(0, 10).join(', ')}`).toEqual([]);
    expect(built, `the second worktree's first \`cargo build\` compiles the 3 workspace crates, whose sources are newer than the store's build`).toEqual(CRATES);
    const test = w.run('npm', ['test'], wt, 600_000);
    console.log(`AC1 \`npm test\` in the second worktree, with no install: exit ${test.code}\n${test.out.slice(-1500)}`);
    expect(test.code, `\`npm test\` must pass in the second worktree with no install: ${test.out.slice(-1500)}`).toBe(0);
  },
};

describe(`${AC1} a second worktree has target and node_modules in place, cloned copy-on-write`, () => {
  it(`${AC1} the second worktree has \`target\` and \`node_modules\` before its first prompt, adds under 5% of the first's disk, compiles only the 3 workspace crates, and \`npm test\` passes with no install`, async () => {
    await secondWorktree('AC1', cargoAndNpm);
  }, 3_600_000);

  it(`${AC1} a planted store that symlinks the folders fails, naming the file a build in the second worktree changed in the store`, async () => {
    await mustFail('AC1 product-symlinks', () => secondWorktree('AC1 (planted: product-symlinks)', cargoAndNpm, 'product-symlinks'), ['a build in the second worktree changed the store', /\/products\/\S+/]);
  }, 3_600_000);

  it(`${AC1} a planted store that hard-links the folders fails, naming the file a build in the second worktree changed in the store`, async () => {
    await mustFail('AC1 product-hard-links', () => secondWorktree('AC1 (planted: product-hard-links)', cargoAndNpm, 'product-hard-links'), ['a build in the second worktree changed the store', /\/products\/\S+/]);
  }, 3_600_000);
});
