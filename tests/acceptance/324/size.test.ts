// #324 AC1: a change ten times the repo's usual size for its kind is sent back once with the numbers, then comes to
// you as one taste call, and its verdict is never FAIL for size alone (design: An agent says it's done, Size and
// scope; A question holds the send-back; the issue's Scope).
//
// The repo's history holds the changes you accepted (helpers.ts, HISTORY): its last 20 accepted feature changes each
// add 17 lines over 3 files, and the 15 most recent accepted changes are fixes of 400 lines each, so the usual size of
// a feature change is 17 lines, and only a reading that keeps to the issue's kind gets it. The task is a feature; its
// plan names every file the agent touches, so nothing is outside the plan, no dependency or folder is added, and the
// checks pass: the size is the only thing over. The agent makes the fix (FIX, FLAG: 2 lines added, 2 removed in
// src/auth.js) and adds 11 rule modules of 17 lines each under src/rules/: 189 lines added (191 added and removed)
// over 12 files, eleven times the usual 17.
//
// Stop 1 is sent back with the numbers (the lines, 189 or 191, and the usual 17) and the words "cut it to what the
// issue needs, or say why each part is needed". The agent says why and stops again (stop 2), still over: no second
// send-back with the numbers; one taste call for you instead, naming the biggest additions, with your taste deadline
// (3 days). A third stop raises no second taste call and is not sent back for size. No verdict on the task's claims is
// FAIL.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, asksRaised, BEHAVIOR, BEHAVIOR_DRAFT, CUT_IT, FIX, FLAG, TASTE_DEADLINE_MS, USUAL, claimsOf, cleanup, decision, jsLines, lastPos, listed, lockedTask, makeWorld, must, plan,
  replyText, runsDone, runsOf, said, Session, settle, sizeSendBack, startHub, taskVerdicts, tasteCalls, trustRepo,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const RULES = Array.from({ length: 11 }, (_, i) => `src/rules/r${String(i + 1).padStart(2, '0')}.js`);
const LINES = 17;
/** The change's lines: 2 added by FIX and FLAG plus 11 x 17 new; with the 2 they remove, 191. */
const ADDED = 2 + RULES.length * LINES;
const CHANGED = ADDED + 2;

describe(`${AC1} a change ten times the usual size: sent back once with the numbers, then one taste call, never FAIL`, () => {
  it(`${AC1} ${ADDED} lines over ${RULES.length + 1} files against a usual ${USUAL.lines} lines for a feature: stop 1 sent back with both numbers and "${CUT_IT}", stop 2 one taste call, stop 3 nothing more, no FAIL`, async () => {
    const w = makeWorld({ drafts: [BEHAVIOR_DRAFT(plan({ files: ['src/auth.js', ...RULES], parts: ['auth middleware', 'token rules'] }))] });
    await trustRepo(w);
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.read('src/auth.js');
    const ref = await lockedTask(hub, s, BEHAVIOR, AC1);
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    for (const [i, file] of RULES.entries()) await s.write(file, jsLines(`rule${i + 1}`, LINES));

    // Stop 1: the checks pass; the size is ten times the usual.
    const stop1 = await s.stop('Expired tokens are now rejected, with the token rules split into modules.');
    let events = await settle(hub, (all) => runsDone(all, ref, since), 90_000);
    must(claimsOf(events, ref, since).length > 0, `BLOCKED: ${AC1} the stop must make a claim for ${ref}: none after it`);
    // The base-commit run of R1 fails, as a fix's must; the claim's own runs are the ones on another commit.
    const failed = runsOf(events, ref, since).filter((r) => r.started.data.commit !== w.base && r.finished?.data.outcome !== 'passed');
    must(failed.length === 0, `BLOCKED: ${AC1} the claim's checks must pass, so size is the only thing over: ${failed.map((r) => said(r.finished ?? r.started)).join('; ')}`);
    const reply1 = replyText(stop1);
    must(decision(stop1) === 'deny', `${AC1} a change of ${ADDED} lines against a usual ${USUAL.lines} for a feature is sent back once with the numbers; stop 1 was let through: ${reply1.slice(0, 500) || 'no reason'}`);
    must(reply1.toLowerCase().includes(CUT_IT), `${AC1} the send-back says "${CUT_IT}": ${reply1.slice(0, 600)}`);
    must(new RegExp(`\\b(${ADDED}|${CHANGED})\\b`).test(reply1), `${AC1} the send-back carries the change's lines, ${ADDED} added (${CHANGED} added and removed): ${reply1.slice(0, 600)}`);
    must(new RegExp(`\\b${USUAL.lines}\\b`).test(reply1), `${AC1} the send-back carries the usual size it was compared with, ${USUAL.lines} lines, the median of the last 20 accepted feature changes (a median over the last 20 of any kind is 400): ${reply1.slice(0, 600)}`);
    must(tasteCalls(events, since).length === 0, `${AC1} the first time over is a send-back, not yet a taste call: ${listed(tasteCalls(events, since))}`);

    // Stop 2: the agent says why each part is needed, and the change is still over.
    const at2 = await lastPos(hub);
    await s.read('src/auth.js');
    const stop2 = await s.stop('Each part is needed: the eleven rule modules are the token rules the middleware applies.');
    events = await settle(hub, (all) => tasteCalls(all, since).length > 0, 60_000);
    must(!sizeSendBack(stop2), `${AC1} the numbers are sent back once; stop 2 was sent back with them again: ${replyText(stop2).slice(0, 500)}`);
    let taste = tasteCalls(events, since);
    must(taste.length === 1, `${AC1} still over after the send-back, it comes to you as one taste call: ${taste.length} taste calls after stop 2 (${listed(asksRaised(events, at2))})`);
    const call = taste[0]!;
    must(RULES.some((f) => JSON.stringify(call.data).includes(f)) || JSON.stringify(call.data).includes('src/rules'), `${AC1} the taste call shows the biggest additions, the rule modules under src/rules/: ${said(call)}`);
    const deadline = Number(call.data.deadline) - Number(call.ts);
    must(Math.abs(deadline - TASTE_DEADLINE_MS) < 10 * 60_000, `${AC1} the taste call takes your taste deadline, 3 days: it ends ${deadline} ms after it was raised (${said(call)})`);

    // Stop 3: nothing more for you, and no send-back for size.
    const at3 = await lastPos(hub);
    await s.read('src/auth.js');
    const stop3 = await s.stop('Waiting on your call about the size.');
    events = await settle(hub, (all) => all.some((e) => e.kind === 'agent.stop' && e.log_pos > at3), 30_000);
    events = await settle(hub, () => false, 3_000);
    must(!sizeSendBack(stop3), `${AC1} the numbers are sent back once; stop 3 was sent back with them again: ${replyText(stop3).slice(0, 500)}`);
    taste = tasteCalls(events, since);
    must(taste.length === 1, `${AC1} one taste call, never the same question twice: ${taste.length} after stop 3 (${listed(taste)})`);
    const verdicts = taskVerdicts(events, ref, since);
    must(verdicts.length > 0, `${AC1} the task's claims get a verdict: none after the work began`);
    const fail = verdicts.filter((v) => v.data.outcome === 'FAIL');
    must(fail.length === 0, `${AC1} size never turns a verdict to FAIL: ${listed(fail)}`);
  }, 480_000);
});
