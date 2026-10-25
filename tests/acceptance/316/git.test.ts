// #316 AC2, AC6: from inside a worktree session (the payload's cwd is a real git worktree), deep-hook denies a
// bare `git stash` and any git command aimed at another checkout (another worktree or the main checkout), however
// it's aimed, while a `git stash push -m <tag>` and git in the session's own worktree are allowed. The denial of
// a cross-checkout call names that checkout's real path, the exact command for you to run there. Hub stopped.
import { afterEach, beforeAll, describe, it } from 'vitest';
import {
  addWorktree, bash, buildDeepHook, carriesReasonNextStep, cleanup, decision, denialText, gitDirOf, hook,
  installDefaults, makeHome, makeRepo, newSession, shown, type Checkout, type Ran, type Rules,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

/** A world: a main checkout, the session's own worktree (w1) and another worktree (w2), defaults installed, no hub. */
interface World { home: string; rules: Rules; repo: Checkout; w1: string; w2: string; session: ReturnType<typeof newSession> }
function world(): World {
  const home = makeHome();
  const rules = installDefaults(home);
  const repo = makeRepo();
  const w1 = addWorktree(repo, 'w1');
  const w2 = addWorktree(repo, 'w2');
  const session = newSession(home, w1);
  return { home, rules, repo, w1, w2, session };
}
async function run(w: World, command: string, extra = {}): Promise<Ran> {
  return hook(w.home, w.session, 'PreToolUse', bash(w.session, command, extra), { binary: BIN, cwd: w.w1 });
}
function expectDenied(command: string, w: World, ran: Ran, namesPath?: string): void {
  if (decision(ran) !== 'deny') throw Error(`\`${command}\` must be denied from inside the worktree session: ${shown(ran)}`);
  if (!carriesReasonNextStep(ran, w.rules)) throw Error(`\`${command}\`: the denial carries no default entry's reason and next_step: ${shown(ran)}`);
  if (namesPath && !denialText(ran).includes(namesPath)) throw Error(`\`${command}\`: the denial does not name the other checkout ${namesPath}: ${shown(ran)}`);
}
function expectAllowed(command: string, ran: Ran): void {
  if (decision(ran) !== 'allow') throw Error(`\`${command}\` must be allowed in the session's own worktree: ${shown(ran)}`);
}

describe('AC2 #316.e0cba5a9 git stash and git -C <another worktree> status are blocked from a worktree session; git stash push -m <tag> and git in the own worktree are allowed', () => {
  it('AC2 bare stash and cross-worktree git are denied; stash push and own-worktree git are allowed', async () => {
    const w = world();
    expectDenied('git stash', w, await run(w, 'git stash'));
    const aimed = `git -C ${w.w2} status`;
    expectDenied(aimed, w, await run(w, aimed), w.w2);
    expectAllowed('git stash push -m wip-tag', await run(w, 'git stash push -m wip-tag'));
    expectAllowed('git status', await run(w, 'git status'));
  }, 900_000);

  it('AC2 git stash pop is also a bare-stash form, and is denied', async () => {
    const w = world();
    expectDenied('git stash pop', w, await run(w, 'git stash pop'));
  }, 900_000);
});

describe('AC6 #316.6b7d29d2 git aimed at another checkout is blocked however it is aimed: cd first, --git-dir, --work-tree, GIT_DIR, read-only commands, and from subagents', () => {
  it('AC6 every way of aiming git at the main checkout is denied and names it; own-worktree git is allowed', async () => {
    const w = world();
    const main = w.repo.dir;
    const gitDir = gitDirOf(w.repo);
    const aims: { command: string; names: string; extra?: object }[] = [
      { command: `cd ${main} && git status`, names: main },                                   // cd first
      { command: `git --git-dir=${gitDir} --work-tree=${main} status`, names: gitDir },        // --git-dir / --work-tree
      { command: `git --git-dir=${gitDir} log -1`, names: gitDir },                            // a read-only command
      { command: `GIT_DIR=${gitDir} git status`, names: gitDir },                              // GIT_DIR in the command
      { command: `git -C ${main} status`, names: main, extra: { agent_id: 'ad649ec810ae38d1e', agent_type: 'general-purpose' } }, // from a subagent
    ];
    for (const a of aims) expectDenied(a.command, w, await run(w, a.command, a.extra ?? {}), a.names);
    // Its twins: git aimed at the session's own worktree, and plain git in it, are allowed.
    expectAllowed(`git -C ${w.w1} status`, await run(w, `git -C ${w.w1} status`));
    expectAllowed('git log -1', await run(w, 'git log -1'));
  }, 900_000);
});
