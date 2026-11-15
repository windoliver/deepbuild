// #1816 AC1 and AC2: the spine judges a task in a checkout where `git merge-base HEAD origin/main` and
// `git show <base>:<path>` answer as they would in the repo at that commit, and that checkout is never a worktree of
// the user's repo; so a test that reads the merge base passes under `spine.mjs`.
//
// The fixture (README, The fixture): main at B with benchmarks/budgets.json {"ms":100}; main then moves on to M
// ({"ms":80}), pushed, so the user's repo's origin/main is M; the task commit T, branched from B, changes the budgets to
// {"ms":90} and lands tests/acceptance/44/merge-base.test.mjs, a node:test file like #348 AC8's: it runs
// `git merge-base HEAD origin/main` and `git show <base>:benchmarks/budgets.json` with the checkout as cwd and expects
// B and {"ms":100}. The spine's table names T as #44's merged commit; #44's one criterion is that test's (AC1).
// In the repo at T those answer B and {"ms":100}; that test also records what it saw in an evidence file, with
// the user's repo's `git worktree list` while it runs.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AC1, AC2, cleanup, commit, git, idOf, judge, makeFixture, must, pointSpine, shown, worktrees, type Fixture, type Judging } from './helpers.ts';

const CRITERION = 'the perf lane reads the merge base\'s budgets';
let fx: Fixture;
let B = '', T = '', evidence = '', before = '', after = '';
let j: Judging;

beforeAll(() => {
  const made = makeFixture({
    'package.json': '{"name":"fx","private":true,"workspaces":["packages/*"]}\n',
    'packages/w/package.json': '{"name":"w","version":"1.0.0"}\n',
    'benchmarks/budgets.json': '{"ms":100}\n',
  }, { 44: `## Scope\n\nA fixture task.\n\n### Acceptance criteria\n\n- [ ] ${CRITERION}\n` });
  fx = made.fx;
  B = made.baseCommit;
  evidence = join(fx.tmp, 'evidence.json');
  git(fx.root, fx.tmp, 'switch', '-q', '-c', 'task');
  T = commit(fx, {
    'benchmarks/budgets.json': '{"ms":90}\n',
    'tests/acceptance/44/merge-base.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const git = (...a) => { const r = spawnSync('git', a, { encoding: 'utf8' }); return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }; };
test('AC1 the merge base and its budgets read as in the repo at this commit', () => {
  const head = git('rev-parse', 'HEAD');
  const base = git('merge-base', 'HEAD', 'origin/main');
  const shown = git('show', base.out + ':benchmarks/budgets.json');
  const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  const sourceWorktrees = git('-C', ${JSON.stringify(fx.root)}, 'worktree', 'list', '--porcelain');
  writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({ cwd: process.cwd(), head, base, shown, common, sourceWorktrees }));
  assert.equal(base.out, ${JSON.stringify(B)}, 'git merge-base HEAD origin/main: ' + base.err);
  assert.equal(shown.out, '{"ms":100}', 'git show <base>:benchmarks/budgets.json: ' + shown.err);
});
`,
  }, 'the task: Closes #44');
  git(fx.root, fx.tmp, 'push', '-q', 'origin', 'task');
  git(fx.root, fx.tmp, 'switch', '-q', 'main');
  commit(fx, { 'benchmarks/budgets.json': '{"ms":80}\n' }, 'main moves on');
  git(fx.root, fx.tmp, 'push', '-q', 'origin', 'main');
  pointSpine(fx, 44, T);
  before = worktrees(fx);
  j = judge(fx, 44);
  after = worktrees(fx);
}, 900_000);
afterAll(cleanup);

interface Evidence { cwd: string; head: { out: string }; base: { code: number; out: string; err: string }; shown: { code: number; out: string; err: string }; common: { out: string }; sourceWorktrees: { out: string } }
function seen(): Evidence {
  must(existsSync(evidence), `the merge-base-reading test never ran in the spine's checkout (no evidence file): ${shown(j)}`);
  return JSON.parse(readFileSync(evidence, 'utf8')) as Evidence;
}

describe(`${AC1} the spine judges each task in a checkout where git merge-base HEAD origin/main and git show <base>:<path> answer as they would in the repo at that commit, still never a worktree of the user's`, () => {
  it(`${AC1} in the spine's checkout of T, HEAD is T, git merge-base HEAD origin/main answers B as the repo does, and git show B:benchmarks/budgets.json answers B's file`, () => {
    const inRepo = git(fx.root, fx.tmp, 'merge-base', T, 'origin/main');
    must(inRepo === B, `BLOCKED: the fixture is wrong: in the user's repo the merge base of T and origin/main is ${inRepo}, not B ${B}`);
    const e = seen();
    must(e.head.out === T, `${AC1} HEAD in the checkout is the judged commit T ${T}: ${JSON.stringify(e.head)}`);
    must(e.base.code === 0 && e.base.out === B, `${AC1} \`git merge-base HEAD origin/main\` in the checkout answers B ${B}, as in the repo at T: exit ${e.base.code}, ${JSON.stringify(e.base.out)} ${JSON.stringify(e.base.err)}`);
    must(e.shown.code === 0 && e.shown.out === '{"ms":100}', `${AC1} \`git show B:benchmarks/budgets.json\` in the checkout answers B's {"ms":100}: exit ${e.shown.code}, ${JSON.stringify(e.shown.out)} ${JSON.stringify(e.shown.err)}`);
  });

  it(`${AC1} the checkout is not a worktree of the user's repo: no worktree is added while it judges or after, and the checkout's git is not the user's`, () => {
    const e = seen();
    must(before.split('\n').filter((l) => l.startsWith('worktree ')).length === 1, `BLOCKED: the fixture's user repo should start with only its own worktree: ${before}`);
    must(e.sourceWorktrees.out === before, `${AC1} while the task's test runs, the user's repo lists the same worktrees as before judging: before ${JSON.stringify(before)}, during ${JSON.stringify(e.sourceWorktrees.out)}`);
    must(after === before, `${AC1} after judging, the user's repo lists the same worktrees as before: before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
    const userGit = realpathSync(join(fx.root, '.git'));
    const common = e.common.out && existsSync(e.common.out) ? realpathSync(e.common.out) : e.common.out;
    must(common !== userGit, `${AC1} the checkout's git directory is its own, not the user's ${userGit}: ${common}`);
    // The checkout is gone by now; fx.root is a real path (tempDir) and the checkout's cwd is as the test saw it.
    must(!e.cwd.startsWith(`${fx.root}/`) && e.cwd !== fx.root, `${AC1} the checkout is outside the user's repo: ${e.cwd}`);
  });
});

describe(`${AC2} a test shows a merge-base-reading test passing under spine.mjs`, () => {
  it(`${AC2} node scripts/spine.mjs judge --issue 44 reads the merge-base-reading criterion PASS, and #44 PASS at T`, () => {
    const id = idOf(44, CRITERION);
    const line = j.lines.find((l) => l.issue === 44);
    must(line !== undefined, `${AC2} the spine prints a judgment of #44: ${shown(j)}`);
    must(line.commit === T, `${AC2} #44 is judged at the fixture's commit T ${T}: ${line.commit}`);
    const c = line.criteria.find((x) => x.id === id);
    must(c !== undefined, `${AC2} #44's criterion ${id} is judged: ${JSON.stringify(line)}`);
    must(c.outcome === 'PASS', `${AC2} the merge-base-reading test's criterion ${id} reads PASS under spine.mjs: ${JSON.stringify(line)}; ${shown(j)}`);
    must(line.verdict === 'PASS' && line.reopen === null && j.status === 0, `${AC2} #44 reads PASS and nothing reopens: ${JSON.stringify(line)}; ${shown(j)}`);
    must(!existsSync(join(fx.issues, 'reopened.log')), `${AC2} no issue is reopened: ${existsSync(join(fx.issues, 'reopened.log')) ? readFileSync(join(fx.issues, 'reopened.log'), 'utf8') : ''}`);
  });
});
