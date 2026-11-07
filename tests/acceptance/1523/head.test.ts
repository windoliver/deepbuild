// #1523 AC5: the GraphQL merge and `gt merge` meet `merge-names-head`. One thread: the fix is committed, pushed, the PR
// opened and the claim PASS on `head` (#84's flow); you type "merge PR 12". Then:
//
// - `gh api graphql` running `mergePullRequest` with no `expectedHeadOid` is denied by `merge-names-head`;
// - `gt merge`, which can't name a head, is denied by `merge-names-head`, the denial naming
//   `gh pr merge --match-head-commit`;
// - the same GraphQL call with `expectedHeadOid` set to `head`, the commit the PASS is pinned to, runs.
import { afterEach, describe, it } from 'vitest';
import { AC5, MERGE_ASK, Session, bash, cleanup, delivered, each, expectAllowed, expectDenied, graphqlMerge, makeWorld, must, startHub, stopHub, verdict } from './helpers.ts';

afterEach(cleanup, 60_000);

const RULE = 'merge-names-head';
const POINTS_TO = /gh pr merge\b[^\n]*--match-head-commit/;

describe(`${AC5} a GraphQL merge names its head by expectedHeadOid; gt merge can't, and is denied`, () => {
  it(`${AC5} in a thread that names a merge, the GraphQL merge with no head and gt merge are denied by ${RULE}, gt merge's denial naming gh pr merge --match-head-commit, and the GraphQL merge with expectedHeadOid set to the PASS's commit runs`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Session(w);
      const head = await delivered(hub, s, AC5);
      await s.typed(MERGE_ASK);
      await each<() => Promise<void>>([
        async () => {
          const denied = await expectDenied(hub, s, bash(graphqlMerge()), AC5);
          must(denied.rules.includes(RULE), `${AC5} \`${denied.label}\` names no head and must be denied by ${RULE}; its denial names ${denied.rules.join(', ')}: ${denied.text.slice(0, 600)}`);
        },
        async () => {
          const denied = await expectDenied(hub, s, bash('gt merge'), AC5);
          must(denied.rules.includes(RULE), `${AC5} \`gt merge\` can't name a head and must be denied by ${RULE}; its denial names ${denied.rules.join(', ')}: ${denied.text.slice(0, 600)}`);
          must(POINTS_TO.test(denied.text), `${AC5} the denial of \`gt merge\` must point to gh pr merge --match-head-commit: ${denied.text.slice(0, 600)}`);
        },
        () => expectAllowed(hub, s, bash(graphqlMerge(head)), `${AC5} with expectedHeadOid ${head}, the commit the PASS is pinned to,`),
      ], (judge) => judge());
    } finally {
      await stopHub(hub);
    }
  }), 900_000);
});
