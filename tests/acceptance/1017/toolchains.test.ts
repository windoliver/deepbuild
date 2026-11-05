// #1017 AC2, No toolchain is special: the same holds in a sample Python repo with `uv.lock` and `.venv`. A planted
// manifest that knows only Cargo and npm places nothing there and fails, naming `.venv`.
import { describe, expect, it } from 'vitest';
import { AC2, mustFail, pythonFiles, secondWorktree, VENV, type Toolchain } from './helpers.ts';

const uv: Toolchain = {
  name: 'uv',
  files: pythonFiles,
  products: [VENV],
  cold(w, wt) { w.must('uv', ['sync', '--frozen'], wt, 600_000); },
  firstBuild: (w, wt) => w.run('uv', ['sync', '--frozen'], wt, 600_000),
  after(w, wt, build) {
    expect(build.code, `the second worktree's first \`uv sync --frozen\` must succeed: ${build.out.slice(-1500)}`).toBe(0);
    const installs = build.out.split('\n').filter((l) => /^\s*[+-] \S+==/.test(l) || /\b(Installed|Uninstalled) \d+ packages?\b/.test(l));
    expect(installs, `the second worktree's first \`uv sync --frozen\` must install nothing, as a placed .venv leaves it nothing to do: ${installs.join(' | ')}`).toEqual([]);
    const test = w.run('uv', ['run', '--frozen', 'python', '-m', 'unittest', '-v'], wt, 600_000);
    console.log(`AC2 the tests in the second worktree, with no install: exit ${test.code}\n${test.out.slice(-1500)}`);
    expect(test.code, `the tests must pass in the second worktree with no install: ${test.out.slice(-1500)}`).toBe(0);
    expect(test.out, 'running the tests installs nothing').not.toMatch(/\bInstalled \d+ packages?\b/);
  },
};

describe(`${AC2} no toolchain is special: a uv repo's .venv is placed the same way`, () => {
  it(`${AC2} in a uv repo, the second worktree has \`.venv\` before its first prompt, adds under 5% of the first's disk, \`uv sync\` installs nothing and the tests pass`, async () => {
    await secondWorktree('AC2', uv);
  }, 3_600_000);

  it(`${AC2} a planted manifest that knows only Cargo and npm places nothing in the uv repo and fails, naming .venv`, async () => {
    await mustFail('AC2 products-cargo-npm-only', () => secondWorktree('AC2 (planted: products-cargo-npm-only)', uv, 'products-cargo-npm-only'), ['.venv']);
  }, 3_600_000);
});
