// AC2: a push written with a force mark, --all or --mirror is held while a merge armed with --auto names its branch
// (README).
//
// The three values the issue gives pushBranches (packages/hub/src/named.ts, the function it names, imported by path);
// then #1523's world and thread (tests/acceptance/1523, imported by path): on branch b PR 12 is opened and its claim
// is PASS on `head`, you type "merge PR 12", and `gh pr merge 12 --auto --match-head-commit <head>` arms its merge on
// b. Each push so written must then be denied naming guard merge-names-head: `git push origin +b` and
// `git push -f origin +refs/heads/b` from b; `git push --all origin` and `git push --mirror origin` from another
// branch, c, since they push b too. On the base the refs read '+b' and '+refs/heads/b', and --all and --mirror read
// as the current branch, so every one of these pushes runs.
import { afterEach, expect, test } from 'vitest';
import { pushBranches } from '../../../packages/hub/src/named.ts';
import {
  Inconclusive, MERGE_ASK, PR_BRANCH, Session, allEvents, bash, cleanup, delivered, expectAllowed, expectDecided, git, loadReading, makeWorld, replyText, rulesIn, startHub, stopHub, verdict,
} from '../1523/helpers.ts';

const AC2 = 'AC2 #2120.eed5748f';
const RULE = 'merge-names-head';
const DENIED = `denied naming ${RULE}`;

afterEach(cleanup, 60_000);

test(`${AC2} pushBranches reads git push origin +b and git push -f origin +refs/heads/b as b, and git push --all origin as *; with PR 12's merge armed with --auto on b, each push so written is denied naming guard merge-names-head`, async (ctx) => verdict(ctx, async () => {
  const pushes: Record<string, string> = {};
  const w = makeWorld();
  const hub = await startHub(w);
  try {
    const s = new Session(w);
    const head = await delivered(hub, s, AC2);
    await s.typed(MERGE_ASK);
    await expectAllowed(hub, s, bash(`gh pr merge 12 --auto --match-head-commit ${head}`), `BLOCKED: ${AC2} arming PR 12's merge with --auto on ${PR_BRANCH}:`);
    // The load rule (README, Load): a merge the hub recorded armed on no branch, its git read of the branch timed out.
    const armed = (await allEvents(hub)).filter((e) => e.kind === 'session.reading' && String(e.data.reading).includes('armed with --auto on branch')).at(-1);
    if (armed && /on branch\s*$/.test(String(armed.data.reading))) throw new Inconclusive(`${AC2} the hub recorded PR 12's merge armed on no branch ("${String(armed.data.reading)}"), ${loadReading()}`);
    const pushed = async (push: string, from: string): Promise<void> => {
      const r = await s.call(bash(push));
      if (r.allowed) await expectDecided(hub, r, push, AC2);
      const rules = rulesIn(replyText(r.before));
      pushes[`${push} (from ${from})`] = r.allowed ? 'it runs' : rules.includes(RULE) ? DENIED : `denied naming ${rules.join(', ') || 'no guard'}: ${replyText(r.before).slice(0, 300)}`;
    };
    await pushed(`git push origin +${PR_BRANCH}`, PR_BRANCH);
    await pushed(`git push -f origin +refs/heads/${PR_BRANCH}`, PR_BRANCH);
    const other = await s.call(bash('git switch -q -c c'), { effect: () => { git(w.tmp, w.repo, ['switch', '-q', '-c', 'c']); } });
    if (!other.allowed) throw Error(`BLOCKED: ${AC2} the agent's switch to branch c must go through: ${replyText(other.before).slice(0, 300)}`);
    await pushed('git push --all origin', 'c');
    await pushed('git push --mirror origin', 'c');
  } finally {
    await stopHub(hub);
  }

  expect({
    pushBranches: {
      "pushBranches('git push origin +b', 'cur')": pushBranches('git push origin +b', 'cur'),
      "pushBranches('git push -f origin +refs/heads/b', 'cur')": pushBranches('git push -f origin +refs/heads/b', 'cur'),
      "pushBranches('git push --all origin', 'cur')": pushBranches('git push --all origin', 'cur'),
    },
    pushes,
  }, `${AC2} the refs are read without the force mark and refs/heads/, --all reads as every branch, and with PR 12's merge armed with --auto on ${PR_BRANCH} each push so written is denied naming guard ${RULE}`).toEqual({
    pushBranches: {
      "pushBranches('git push origin +b', 'cur')": ['b'],
      "pushBranches('git push -f origin +refs/heads/b', 'cur')": ['b'],
      "pushBranches('git push --all origin', 'cur')": ['*'],
    },
    pushes: {
      [`git push origin +${PR_BRANCH} (from ${PR_BRANCH})`]: DENIED,
      [`git push -f origin +refs/heads/${PR_BRANCH} (from ${PR_BRANCH})`]: DENIED,
      'git push --all origin (from c)': DENIED,
      'git push --mirror origin (from c)': DENIED,
    },
  });
}), 900_000);
