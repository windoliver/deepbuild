// AC4: with no second model free, a claim that needs a review reads BLOCKED or INCONCLUSIVE, never PASS (issue Scope:
// "A kind that can't run, because no second model is free or a source is out of reach, reads as #87 and #68 state,
// never PASS"; #87: "With the window at your reserve, the review waits and the claim shows BLOCKED with the cause plan
// window").
//
// AC1's claim without the planted bug: green commands, PR 21 opened, a clean diff. Your plan reserve is 10% and the
// account's five-hour window reads 95% used, so the second model's job may not start: no second model is free.
import { afterAll, describe, it } from 'vitest';
import {
  AC4, ASK, CLEAN, FIX, HOUR, cleanup, claimAfter, commandsGreen, judged, lastPos, must, openPr, openTask, outcomeOf, reportWindow, reviewWorld, sayVerdicts,
  settle, startHub, taskVerdicts, trustRepo,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC4} with no second model free, a claim that needs a review is BLOCKED or INCONCLUSIVE, never PASS`, () => {
  it(`${AC4} PR 21's claim, green commands and a clean diff, with the plan window at your reserve, reads BLOCKED or INCONCLUSIVE and never PASS`, async () => {
    const w = reviewWorld();
    await trustRepo(w, true);
    const hub = await startHub(w);
    await reportWindow(hub, 5, Date.now() + 3 * HOUR);
    const { s, ref } = await openTask(hub, w, ASK, AC4);
    // The window reaches your reserve once the definition is locked (a later reset, so the reading replaces the first).
    await reportWindow(hub, 95, Date.now() + 3 * HOUR + 60_000);
    await s.read('src/auth.js');
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
    await openPr(s, AC4);
    await s.stop('Expired tokens are rejected now, and the pull request is open for review.');

    let events = await judged(hub, ref, since);
    const claim = claimAfter(events, ref, since);
    must(claim !== undefined, `BLOCKED: ${AC4} the stop after opening PR 21 must make a claim for ${ref}: none was recorded`);
    commandsGreen(events, ref, since, AC4, claim, w.base);
    // A while longer, so a PASS made later than the first verdict is seen too.
    const settledAt = Date.now();
    events = await settle(hub, () => Date.now() - settledAt > 20_000, 30_000);
    const verdicts = taskVerdicts(events, ref, since);
    must(verdicts.length > 0, `${AC4} ${claim} must be judged: no verdict was recorded`);
    must(!verdicts.some((v) => outcomeOf(v) === 'PASS'), `${AC4} ${claim} needs a review and no second model is free (the window at your reserve), so it is never PASS: ${sayVerdicts(verdicts)}`);
    const last = outcomeOf(verdicts.at(-1));
    must(last === 'BLOCKED' || last === 'INCONCLUSIVE', `${AC4} ${claim} reads BLOCKED or INCONCLUSIVE while its review can't run: it reads ${last} (${sayVerdicts(verdicts)})`);
  }, 600_000);
});
