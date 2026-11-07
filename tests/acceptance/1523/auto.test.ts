// #1523 AC6: `pushTargets` and `pushBranches` read the new push forms.
//
// - One thread works on branch `b`: the fix is committed, pushed, the PR opened and the claim PASS on `head` (#84's
//   flow); you type "merge PR 12". `jj git push --bookmark b` goes through (the thread names the push and nothing is
//   armed). Then `gh pr merge 12 --auto --match-head-commit <head>` goes through, arming the merge on `b`, and
//   `jj git push --bookmark b` is denied by `merge-names-head`.
// - In another thread, whose prompt names no push, `jj git push --remote fork` is held, and its card names the remote
//   `fork` as a target of its plan.
import { afterEach, describe, it } from 'vitest';
import {
  AC6, MERGE_ASK, PR_BRANCH, Session, bash, cleanup, delivered, each, expectAllowed, expectDenied, expectHeld, makeWorld, must, startHub, stopHub, unasked, verdict, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const RULE = 'merge-names-head';
const PUSH_B = `jj git push --bookmark ${PR_BRANCH}`;
const TO_FORK = 'jj git push --remote fork';

/** Every target the card shows: its own list, and each step's of its plan. */
const targetsOf = (card: Line): Line[] => [...((card.targets ?? []) as Line[]), ...((card.plan?.steps ?? []) as Line[]).flatMap((s) => (s.targets ?? []) as Line[])];

describe(`${AC6} jj pushes meet the armed --auto merge and name their remote on the card`, () => {
  it(`${AC6} with gh pr merge --auto armed on branch ${PR_BRANCH}, ${PUSH_B} is denied by ${RULE}; the card of ${TO_FORK} names fork`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Session(w);
      const head = await delivered(hub, s, AC6);
      await s.typed(MERGE_ASK);
      await each<() => Promise<void>>([
        async () => {
          await expectAllowed(hub, s, bash(PUSH_B), `${AC6} before any merge is armed, in a thread that names the push,`);
          await expectAllowed(hub, s, bash(`gh pr merge 12 --auto --match-head-commit ${head}`), `BLOCKED: ${AC6} arming the merge on ${PR_BRANCH} (#84's flow):`);
          const denied = await expectDenied(hub, s, bash(PUSH_B), `${AC6} with gh pr merge --auto armed on branch ${PR_BRANCH},`);
          must(denied.rules.includes(RULE), `${AC6} \`${PUSH_B}\` must be denied by ${RULE} while the merge armed on ${PR_BRANCH} is pending; its denial names ${denied.rules.join(', ')}: ${denied.text.slice(0, 600)}`);
        },
        async () => {
          const other = await unasked(hub, w);
          const { ask, card } = await expectHeld(hub, other, TO_FORK, ['push'], AC6);
          const targets = targetsOf(card);
          must(targets.some((t) => t.ref === 'fork'), `${AC6} the card of ask:${ask.id}, holding \`${TO_FORK}\`, must name the remote fork as a target: its targets are ${JSON.stringify(targets)}`);
        },
      ], (judge) => judge());
    } finally {
      await stopHub(hub);
    }
  }), 900_000);
});
