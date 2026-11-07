// AC1: a claim that opens a PR, with its commands green and a planted bug in the diff, goes through the real hub with
// a fake reviewer that reports the bug at its file and line; the session gets one send-back naming them. On the merge
// base the same claim passes, and this test fails naming the claim (issue Scope: "The review check runs on every claim
// that opens or updates a PR … through the runner and under your reserve, as #87 states"; design: In version 0, the
// review check's "one send-back of structured items (file, line, rule and the quoted text)").
//
// The session fixes the auth middleware (the spec's unit check and R1's drafted check pass) and, in the same edit,
// adds `isAdmin: (user) => user.role = 'admin'` on src/auth.js's line 4, which no command check sees. It opens PR 21
// with `gh pr create` and stops. The second model is the fake reviewer, first on the runner's login PATH, with room
// in the plan window: it reports the assignment at src/auth.js:4. The send-back reaches the session in the stop's
// reply, or, when the review lands after the stop's hold, with the session's next prompt.
import { afterAll, describe, it } from 'vitest';
import {
  AC1, ASK, BUG, BUGGY, FIX, HOUR, cleanup, claimAfter, commandsGreen, judged, lastPos, must, openPr, openTask, reportWindow, reviewJobs, reviewWorld,
  sayVerdicts, startHub, taskVerdicts, told, trustRepo, type Ran,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** Whether a text names the bug's file and line. */
const names = (text: string): boolean => text.includes(`${BUG.file}:${BUG.line}`) || (text.includes(BUG.file) && new RegExp(`\\bline ${BUG.line}\\b`).test(text));

describe(`${AC1} a planted bug in a PR's diff comes back from the review as one send-back naming its file and line`, () => {
  it(`${AC1} the claim opening PR 21 with green commands and the planted bug at ${BUG.file}:${BUG.line} gets one send-back naming ${BUG.file}:${BUG.line}`, async () => {
    const w = reviewWorld();
    await trustRepo(w, true);
    const hub = await startHub(w);
    await reportWindow(hub, 5, Date.now() + 3 * HOUR);
    const { s, ref } = await openTask(hub, w, ASK, AC1);
    await s.read('src/auth.js');
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(BUGGY.file, BUGGY.from, BUGGY.to);
    await openPr(s, AC1);
    const stop = await s.stop('Expired tokens are rejected now, and the pull request is open for review.');

    let events = await judged(hub, ref, since);
    const claim = claimAfter(events, ref, since);
    must(claim !== undefined, `BLOCKED: ${AC1} the stop after opening PR 21 must make a claim for ${ref}: none was recorded`);
    commandsGreen(events, ref, since, AC1, claim, w.base);

    // Where the send-back reaches the session: the stop's reply, else the next prompt's.
    const delivered: { where: string; ran: Ran }[] = [{ where: 'the stop\'s reply', ran: stop }];
    if (!names(told(stop))) delivered.push({ where: 'the next prompt\'s reply', ran: await s.typed('What is left on this change?') });
    events = await judged(hub, ref, since, { standMs: 0 });
    const naming = delivered.filter((d) => names(told(d.ran)));
    const jobs = await reviewJobs(hub);
    must(naming.length === 1, `${AC1} ${claim} opened PR 21 with green commands and the planted bug at ${BUG.file}:${BUG.line}; the session must get one send-back naming ${BUG.file}:${BUG.line}, `
      + `and ${naming.length} did (${delivered.map((d) => `${d.where}: ${told(d.ran).slice(0, 400).replace(/\s+/g, ' ')}`).join(' / ')}). `
      + `Review jobs the runner recorded: ${jobs.length}. Verdicts on ${claim}: ${sayVerdicts(taskVerdicts(events, ref, since))}`);
  }, 600_000);
});
