// #1294 AC4: with the hub stopped, `git reset --hard` in a tree with tracked edits is denied, naming the command for you
// to run, while `git reset --soft HEAD~1` is allowed. Scope's fourth bullet says the same of every command of the class.
// The hub ran and stopped, so the session is one it knew. Nothing here plays the hub: deep-hook decides alone, which is
// the point, so no call here can be INCONCLUSIVE.
import { afterEach, describe, it } from 'vitest';
import {
  AC4, SCOPE, begin, changed, cleanup, decision, denialProblem, digestOf, edit, git, makeWorld, must, newSession, pre, runCommand, shown, startHub, stopHub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const HARD = 'git reset --hard';
const SOFT = 'git reset --soft HEAD~1';
const OTHERS = ['git checkout -- .', 'git restore --staged --worktree .', 'git switch -f main', 'git stash drop', 'git stash clear'];

describe(`AC4 ${AC4} with the hub stopped, git reset --hard in a tree with tracked edits is denied, naming the command for you to run, while git reset --soft HEAD~1 is allowed`, () => {
  it(`AC4 \`${HARD}\` is denied by deep-hook alone, naming the command for you to run, and didn't run (the edit is still there); \`${SOFT}\` is allowed and runs, keeping the edit`, async () => {
    const who = `AC4 ${AC4}`;
    const w = makeWorld();
    const a = edit(w);
    const parent = git(w, ['rev-parse', 'HEAD~1']).trim();
    const tip = git(w, ['rev-parse', 'HEAD']).trim();
    const hub = await startHub(w);
    const s = newSession(w);
    await begin(s, 'Start clean.');
    await stopHub(hub);

    const hard = await pre(s, HARD);
    if (decision(hard.r) === 'allow') {
      const ran = await runCommand(w, s, HARD, hard.id);
      throw Error(`${who} \`${HARD}\` must be denied with the hub stopped: deep-hook's PreToolUse allowed it (${shown(hard.r)}); run as Claude Code runs it (${shown(ran)}), src/a.ts ${digestOf(a.file) === a.digest ? 'kept' : 'lost'} its edit`);
    }
    const problem = denialProblem(hard, HARD);
    must(problem === null, `${who} ${problem}`);
    console.log(`proof #1294 hub stopped, denied: ${JSON.stringify(`${hard.r.stdout}${hard.r.stderr}`.slice(0, 600))}`);
    must(digestOf(a.file) === a.digest && git(w, ['rev-parse', 'HEAD']).trim() === tip, `${who} \`${HARD}\` must not have run: src/a.ts must keep its edit and HEAD ${tip}`);

    const soft = await pre(s, SOFT);
    must(decision(soft.r) === 'allow', `${who} \`${SOFT}\` must be allowed with the hub stopped: deep-hook's PreToolUse ended ${decision(soft.r)} (${shown(soft.r)})`);
    const ran = await runCommand(w, s, SOFT, soft.id);
    must(ran.code === 0, `BLOCKED: \`${SOFT}\` must run in the test's repository: ${shown(ran)}`);
    must(git(w, ['rev-parse', 'HEAD']).trim() === parent, `BLOCKED: \`${SOFT}\` must move HEAD to ${parent}`);
    must(digestOf(a.file) === a.digest, `${who} \`${SOFT}\` keeps the edit: src/a.ts lost it`);
  }, 600_000);
});

describe(`${SCOPE} with the hub stopped, every command of the class is denied with the command for you to run (no checkbox; Scope's fourth bullet)`, () => {
  it(`Scope ${OTHERS.join(', ')}: with tracked edits and a stash entry, each is denied, naming itself`, async () => {
    const w = makeWorld();
    edit(w);
    git(w, ['stash', 'push', '-q', '-m', 'wip-1294']);
    const a = edit(w);
    const hub = await startHub(w);
    const s = newSession(w);
    await begin(s, 'Start clean.');
    await stopHub(hub);
    const problems: string[] = [];
    for (const command of OTHERS) {
      const problem = denialProblem(await pre(s, command), command);
      if (problem) problems.push(problem);
    }
    must(!problems.length, `${SCOPE} ${problems.join('; ')}`);
    must(digestOf(a.file) === a.digest && JSON.stringify(changed(w)) === '["src/a.ts"]', `${SCOPE} a denied command must leave the tree as it was: it lists ${JSON.stringify(changed(w))}`);
  }, 600_000);
});
