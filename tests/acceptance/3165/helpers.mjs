// Shared by the #3165 acceptance tests: a scratch repository whose merge of main into the change really conflicts in
// one check file, resolved as a test says. The guard is reached only by running `node scripts/proof.mjs guard` from
// this checkout with its cwd at that repository (README: Surfaces). Scratch repositories, approvals and the line
// assertions are #569's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { approve, git, proof, repo, write } from '../569/helpers.mjs';

export { assertFails, assertPasses, line, linesOf, show } from '../569/helpers.mjs';

// The planted issue each scratch commit names, so no run asks GitHub for one.
const ISSUE = 9001;

export const LANES = 'scripts/lanes.mjs';
export const GUARD = 'scripts/proof-guard.mjs';
export const CONFIG = 'vitest.config.ts';

/** A small scripts/lanes.mjs: a list of test paths, one a line, between lines both parents hold. */
export const lanes = (paths) => `// The repo's declared test paths, and the suites the unit lane runs one at a time.
export const testPaths = ['tests/**'];
export const alone = [
${paths.map((path) => `  '${path}',`).join('\n')}
];
export const timed = ['tests/acceptance/201/budgets.test.ts'];
`;
/** A stand-in for scripts/proof-guard.mjs, which the merge base must hold for check files to be guarded. */
export const guardCode = (files) => `// The test guard: the files whose edits need an approved proposal.
export const guarded = [
${files.map((file) => `  '${file}',`).join('\n')}
];
export const lane = 'guard';
`;
/** A test runner's config. */
export const config = (globs) => `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
${globs.map((glob) => `      '${glob}',`).join('\n')}
    ],
  },
});
`;

// What each file holds at the first merge base, the line main adds and the line the change adds, both after the last.
export const P = { one: 'tests/acceptance/101/', two: 'tests/acceptance/102/', main: 'tests/acceptance/103/', change: 'tests/acceptance/104/', third: 'tests/acceptance/105/' };
export const G = { one: 'AGENTS.md', two: 'docs/technical-design.md', main: 'scripts/known-failures.json', change: '.deepbuild/approvers' };
export const V = { one: 'tests/unit/**/*.test.ts', two: 'packages/**/*.test.ts', main: 'tests/acceptance/103/**/*.test.ts', change: 'tests/acceptance/104/**/*.test.ts' };

const FIRST = { [LANES]: lanes([P.one, P.two]), [GUARD]: guardCode([G.one, G.two]), [CONFIG]: config([V.one, V.two]) };

/**
 * A scratch repository where main and the change each add a different line at the same place in `path`, and the
 * change merges main, which conflicts there. `onMain` and `onChange` are the file as each side leaves it, and
 * `resolved` is what the merge commit holds. The change's own edit of the check file is approved as its own proposal,
 * as every edit of a check file is today, so the merge's resolution is the only thing left to judge. The merge commit
 * carries an approval only when `approval` lists its items. The merge base then holds scripts/proof-guard.mjs and
 * .deepbuild/approvers, so the guard's rules for check files are in force.
 */
export function merged(t, { path, onMain, onChange, resolved, approval = null }) {
  const scene = repo(t, { base: FIRST, issues: { [ISSUE]: ['A planted criterion no test here carries'] } });
  const { cwd } = scene;
  const commit = (files, message) => {
    write(cwd, files);
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', message);
    return git(cwd, 'rev-parse', 'HEAD').trim();
  };
  git(cwd, 'checkout', '-q', 'main');
  commit({ [path]: onMain }, 'Main adds its line');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', 'change');
  scene.own = commit({ [path]: onChange }, `The change adds its line\n\nPart of #${ISSUE}`);
  approve(scene, scene.own, [path]);
  assert.throws(() => git(cwd, 'merge', '-q', '--no-edit', 'main'), undefined, `merging main did not conflict in ${path}, so this scene shows nothing`);
  assert.deepEqual(git(cwd, 'diff', '--name-only', '--diff-filter=U').trim().split('\n'), [path], 'the merge did not conflict in that file alone');
  assert.match(readFileSync(join(cwd, path), 'utf8'), /^<{7} /m, `git left no conflict marker in ${path}`);
  scene.merge = commit({ [path]: resolved }, `Merge main\n\nPart of #${ISSUE}`);
  assert.equal(git(cwd, 'rev-list', '--parents', '-n', '1', scene.merge).trim().split(' ').length, 3, 'the resolution is not a merge commit of two parents');
  // The commits as a person reads them in a line: git's own short form.
  scene.short = (sha) => git(cwd, 'rev-parse', '--short', sha).trim();
  if (approval) approve(scene, scene.merge, approval);
  return scene;
}

/** The planted conflict in scripts/lanes.mjs, resolved to the list `paths`; `approval` as in `merged`. */
export const lanesMerge = (t, paths, approval = null) => merged(t, { path: LANES, onMain: lanes([P.one, P.two, P.main]), onChange: lanes([P.one, P.two, P.change]), resolved: lanes(paths), approval });

/** Runs the guard lane on the scene. */
export const guard = (scene) => proof(scene, ['guard']);
