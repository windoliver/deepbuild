// #82 AC3: a stop with no work since the turn began isn't a claim, with two exceptions (design: Every stop is judged:
// "After the app's own resume prompt, when the interrupted turn had done work and left asks open, the session gets one
// automatic continue. A stop that leaves an ask open with nothing done gets one send-back naming the requirements
// still unmet").
//
// One hub, two sessions, each on its own item whose R1 (expired-token.sh) fails until FLAG:
//   item 21, terminal: you type `Fix <link>` (an ask, so not an answer) and the agent stops with no tool call. That
//     stop is no claim, and gets one send-back naming R1; its next stop, again with nothing done, is no claim and is
//     not sent back again.
//   item 22, the desktop app: you type `Fix <link>`, the agent edits src/auth.js, and the app is quit in the middle of
//     a Bash call (PreToolUse with no PostToolUse, SessionEnd other). Reopened, the session resumes and the app sends
//     its resume prompt (the 2.1.299 desktop-resume session's shape); the agent stops with no tool call. That stop is
//     no claim, and the session gets one automatic continue: the Stop's reply keeps it going, or DeepBuild's waiter
//     wakes it, with nothing typed. By its third stop with nothing done it is let through.
import { afterAll, describe, it } from 'vitest';
import { verdict,
  AC3, CRITERIA, EXPIRED, blocked, claimsOf, cleanup, continuation, item, lastPos, listed, makeWorld, must, names, replyText,
  Session, settle, shown, startHub, startOnItem, typedAfter,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC3} a stop with no work isn't a claim; one continue after the app's resume prompt, one send-back for an ask left open`, () => {
  it(`${AC3} item 21: the stop with nothing done after your ask is no claim and gets one send-back naming R1; item 22: after the desktop app's resume prompt the no-work stop is no claim and the session gets one automatic continue`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(21, 'Expired tokens are accepted', [EXPIRED]), item(22, 'Expired tokens are accepted', [EXPIRED])] });
    const hub = await startHub(w);

    // ---- Item 21: your ask, and a stop with nothing done.
    const a = new Session(w);
    const refA = await startOnItem(hub, a, 21, `${AC3} [item 21]`, { read: false });
    const sinceA = await lastPos(hub);
    const first = await a.stop('I will start on the expired-token fix next.');
    const second = await a.stop('Still planning the fix.');
    let events = await settle(hub, () => true);
    must(claimsOf(events, refA, sinceA).length === 0, `${AC3} [item 21] a stop with no work since the turn began isn't a claim: ${listed(claimsOf(events, refA, sinceA))}`);
    must(blocked(first), `${AC3} [item 21] the stop that leaves your ask open with nothing done gets one send-back naming the requirements still unmet; deep-hook let it through: ${shown(first)}`);
    must(names(replyText(first), 'R1', CRITERIA.expired), `${AC3} [item 21] the send-back names R1 ("${CRITERIA.expired}"), the requirement still unmet: ${replyText(first).slice(0, 500)}`);
    must(!blocked(second), `${AC3} [item 21] the send-back is one: the next stop with nothing done is let through: ${shown(second)}`);

    // ---- Item 22: the desktop app quits mid-turn, reopens and sends its resume prompt.
    const b = new Session(w, 'desktop');
    const refB = await startOnItem(hub, b, 22, `${AC3} [item 22]`);
    await b.edit('src/auth.js', 'note: 0,', 'note: 1,');
    await b.begin('Bash', { command: 'npm test', description: 'Run the tests' });
    await b.end('other');
    await b.start('resume');
    const resumedAt = await lastPos(hub);
    await b.resumePrompt();
    const r1 = await b.stopWaiting('Resumed.', 45_000);
    const woke = await continuation(r1.stop, r1.waiter);
    const r2 = await b.stop('Resumed.');
    const r3 = await b.stop('Resumed.');
    events = await settle(hub, () => true);
    must(claimsOf(events, refB, resumedAt).length === 0, `${AC3} [item 22] the stops with no work after the resume prompt aren't claims: ${listed(claimsOf(events, refB, resumedAt))}`);
    must(typedAfter(events, b, resumedAt).length === 0, `BLOCKED: ${AC3} [item 22] nothing is typed after the resume: ${listed(typedAfter(events, b, resumedAt))}`);
    must(woke !== undefined, `${AC3} [item 22] after the app's own resume prompt, with the interrupted turn's work done and its ask open, the session gets one automatic continue: the no-work stop was let through (${shown(r1.stop)}) and no waiter woke it within 45 s`);
    must(!blocked(r3) || !blocked(r2), `${AC3} [item 22] the continue is one: by the third no-work stop the session is let through; the second and third were both kept going: ${replyText(r2).slice(0, 200)} / ${replyText(r3).slice(0, 200)}`);
  }), 600_000);
});
