// AC1: a merge armed with --auto and no pull request number still holds pushes to its branch (README).
//
// #1523's world and thread (tests/acceptance/1523, imported by path): on branch b you type "Fix <link>, then create
// PR."; the agent fixes, commits, pushes and opens PR 12, and its claim is PASS on `head`; you type "merge PR 12". The
// agent then arms the merge as the issue writes it, naming no pull request: `gh pr merge --auto --squash
// --match-head-commit=<head>`, a merge call gated with auto true, the PASS head and no pr. A push to that branch,
// `git push origin b`, must then be denied naming guard merge-names-head. On the base the merge is recorded armed with
// an empty number, which the reader of armed merges skips, so the push runs.
import { afterEach, expect, test } from 'vitest';
import {
  Inconclusive, MERGE_ASK, PR_BRANCH, Session, allEvents, bash, cleanup, delivered, expectAllowed, expectDecided, loadReading, makeWorld, replyText, rulesIn, startHub, stopHub, verdict,
} from '../1523/helpers.ts';

const AC1 = 'AC1 #2120.9f18511b';
const RULE = 'merge-names-head';

afterEach(cleanup, 60_000);

test(`${AC1} with gh pr merge --auto armed on branch b naming no pull request, git push origin b is denied naming guard merge-names-head`, async (ctx) => verdict(ctx, async () => {
  const w = makeWorld();
  const hub = await startHub(w);
  try {
    const s = new Session(w);
    const head = await delivered(hub, s, AC1);
    await s.typed(MERGE_ASK);
    const arm = `gh pr merge --auto --squash --match-head-commit=${head}`;
    await expectAllowed(hub, s, bash(arm), `BLOCKED: ${AC1} arming the merge with auto, the PASS head ${head} and no number:`);
    // The load rule (README, Load): a merge the hub recorded armed on no branch, its git read of the branch timed out.
    const armed = (await allEvents(hub)).filter((e) => e.kind === 'session.reading' && String(e.data.reading).includes('armed with --auto on branch')).at(-1);
    if (armed && /on branch\s*$/.test(String(armed.data.reading))) throw new Inconclusive(`${AC1} the hub recorded the merge armed on no branch ("${String(armed.data.reading)}"), ${loadReading()}`);

    const push = `git push origin ${PR_BRANCH}`;
    const r = await s.call(bash(push));
    if (r.allowed) await expectDecided(hub, r, push, AC1);
    const said = replyText(r.before);
    expect(r.allowed ? 'it runs' : rulesIn(said).includes(RULE) ? `denied naming ${RULE}` : `denied naming ${rulesIn(said).join(', ') || 'no guard'}`,
      `${AC1} after \`${arm}\` armed the merge on ${PR_BRANCH} with no number, \`${push}\` is a push to that branch: it is denied naming guard ${RULE}; deep-hook's reply: ${JSON.stringify(said.slice(0, 600))}`)
      .toBe(`denied naming ${RULE}`);
  } finally {
    await stopHub(hub);
  }
}), 900_000);
