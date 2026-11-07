// AC5: a claim with green commands that touches no PR and states no number starts no review job and no numbers job,
// by a count of the fake's calls (issue Scope: the review runs "on every claim that opens or updates a PR", and "A
// claim that states none needs no numbers check").
//
// AC1's world, the fake reviewer first on the runner's login PATH with room in the plan window, so a hub that reviews
// every claim would call it. The session fixes the auth middleware (green commands), opens no PR, and stops with words
// that hold no number. The fake's calls are the review jobs the runner recorded (`job.list`, kind review); a numbers
// job is any run of the claim other than its command checks (the spec's unit check and R1's drafted check).
import { afterAll, describe, it } from 'vitest';
import {
  AC5, CLEAN, DRAFT, FIX, HOUR, cleanup, claimAfter, commandsGreen, judged, lastPos, must, openTask, reportWindow, reviewJobs, reviewWorld, settle, startHub,
  trustRepo,
} from './helpers.ts';
import { runOf, runsOf } from '../322/helpers.ts';

afterAll(cleanup, 60_000);

/** The prompt: the change alone, no pull request asked for. */
const PROMPT = 'make the auth middleware reject expired tokens';

describe(`${AC5} a claim that touches no PR and states no number starts no review job and no numbers job`, () => {
  it(`${AC5} green commands, no PR, no number: the fake reviewer is never called and the claim runs only its command checks`, async () => {
    const w = reviewWorld({ drafts: [{ ...DRAFT, ask: PROMPT }] });
    await trustRepo(w, true);
    const hub = await startHub(w);
    await reportWindow(hub, 5, Date.now() + 3 * HOUR);
    const { s, ref } = await openTask(hub, w, PROMPT, AC5);
    await s.read('src/auth.js');
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
    await s.stop('Expired tokens are rejected now, and the checks pass.');

    await judged(hub, ref, since);
    // A while longer: a review or numbers job the gate starts after the verdict, in the slow lane, is counted too.
    const settledAt = Date.now();
    const events = await settle(hub, () => Date.now() - settledAt > 20_000, 30_000);
    const claim = claimAfter(events, ref, since);
    must(claim !== undefined, `BLOCKED: ${AC5} the stop must make a claim for ${ref}: none was recorded`);
    commandsGreen(events, ref, since, AC5, claim, w.base);
    const reviews = await reviewJobs(hub);
    must(reviews.length === 0, `${AC5} ${claim} touches no PR, so the fake reviewer is never called: the runner recorded ${reviews.length} review job(s): ${JSON.stringify(reviews)}`);
    const others = runsOf(events, ref, since).filter((r) => !runOf('unit')(r) && !runOf('.deepbuild/checks/expired-token.sh')(r));
    must(others.length === 0, `${AC5} ${claim} states no number and touches no PR, so it runs only its command checks: other runs started ${JSON.stringify(others.map((r) => r.started.data))}`);
  }, 600_000);
});
