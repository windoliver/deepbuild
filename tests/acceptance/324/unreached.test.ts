// #324 AC4: files changed that neither the plan nor any requirement's check reaches are listed in the claim, sent back
// once, and then come to you as one taste call with the diff (design: Size and scope, "files outside the plan, code
// no test reaches … Over that, the hold sends the numbers back once …; still over, it's one taste call for you").
//
// The task's plan names src/auth.js alone. The repo's checks are the spec's unit test and R1's drafted check, both of
// which load src/auth.js, which loads src/clock.js: so src/clock.js is outside the plan but reached by every check,
// and src/billing.js, which nothing loads, is reached by neither. The agent makes the fix (FIX, FLAG, so the checks
// pass), rewords src/clock.js's comment, and adds a line to src/billing.js.
//
// Stop 1: the record of the claim lists src/billing.js in a list that names neither src/auth.js (the plan's) nor
// src/clock.js (a check's); the stop is sent back, naming src/billing.js and not src/clock.js. Stop 2, after the agent
// says why, is not sent back for it again; one taste call reaches you naming src/billing.js with the diff (the line it
// added, or a diff it carries). Stop 3 raises no second one.
import { afterEach, describe, it } from 'vitest';
import {
  AC4, BEHAVIOR, BEHAVIOR_DRAFT, FIX, FLAG, claimRecord, claimsOf, cleanup, decision, lastPos, listed, listsNaming, lockedTask, makeWorld, must, plan, replyText, runsDone,
  said, Session, settle, startHub, tasteCalls, trustRepo, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const PLAN = plan({ files: ['src/auth.js'], parts: ['auth middleware'] });
const BILLING = 'src/billing.js';
const CLOCK = 'src/clock.js';
const ADDED_LINE = '// ROUNDING: invoice totals round half up to the cent.';
/** Whether a stop's reply is a send-back naming src/billing.js. */
const sentBackFor = (r: Parameters<typeof decision>[0]): boolean => decision(r) === 'deny' && replyText(r).includes(BILLING);
/** Whether a taste call carries the diff: the line the change added, or a field named for a diff with something in it. */
const withDiff = (ask: Ev): boolean => JSON.stringify(ask.data).includes('ROUNDING') || JSON.stringify(ask.data).match(/"[^"]*diff[^"]*":\s*("[^"]+"|\{|\[)/i) !== null;

describe(`${AC4} changed files neither the plan nor a check reaches: listed, sent back once, then one taste call with the diff`, () => {
  it(`${AC4} ${BILLING} is listed apart from src/auth.js and ${CLOCK}, sent back at stop 1, then one taste call with its diff at stop 2, nothing more at stop 3`, async () => {
    const w = makeWorld({ drafts: [BEHAVIOR_DRAFT(PLAN)] });
    await trustRepo(w);
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.read('src/auth.js');
    const ref = await lockedTask(hub, s, BEHAVIOR, AC4);
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    await s.edit(CLOCK, "// The middleware's clock.", "// The middleware's clock, in milliseconds.");
    await s.edit(BILLING, '// Billing: invoice totals.', `// Billing: invoice totals.\n${ADDED_LINE}`);

    const stop1 = await s.stop('Expired tokens are now rejected; I also noted the rounding rule in billing.');
    let events = await settle(hub, (all) => runsDone(all, ref, since), 90_000);
    must(claimsOf(events, ref, since).length > 0, `BLOCKED: ${AC4} the stop must make a claim for ${ref}: none after it`);
    const record = claimRecord(events, ref, since);
    const lists = listsNaming(record.map((e) => e.data), BILLING);
    const apart = lists.filter((l) => !l.some((x) => x.includes('src/auth.js') || x.includes(CLOCK)));
    must(apart.length > 0, `${AC4} ${BILLING} is changed and neither the plan (src/auth.js) nor any check (they load src/auth.js and ${CLOCK}) reaches it: the claim must list it apart from those two; lists naming it: ${JSON.stringify(lists).slice(0, 600)}; the claim's record is ${listed(record)}`);
    const reply1 = replyText(stop1);
    must(sentBackFor(stop1), `${AC4} the stop is sent back once, naming ${BILLING}: ${decision(stop1) === 'deny' ? 'sent back' : 'let through'} with ${reply1.slice(0, 500) || 'no reason'}`);
    must(!reply1.includes(CLOCK), `${AC4} ${CLOCK} is reached by every check, so the send-back never lists it: ${reply1.slice(0, 600)}`);

    await s.read(BILLING);
    const stop2 = await s.stop('The rounding note documents a rule the auth fix relies on for its invoice line.');
    events = await settle(hub, (all) => tasteCalls(all, since).length > 0, 60_000);
    must(!sentBackFor(stop2), `${AC4} ${BILLING} is sent back once; stop 2 was sent back for it again: ${replyText(stop2).slice(0, 500)}`);
    let taste = tasteCalls(events, since);
    must(taste.length === 1, `${AC4} still there after the send-back, it comes to you as one taste call: ${taste.length} (${listed(taste)})`);
    must(JSON.stringify(taste[0]!.data).includes(BILLING), `${AC4} the taste call names ${BILLING}: ${said(taste[0])}`);
    must(withDiff(taste[0]!), `${AC4} the taste call comes with the diff (the line ${BILLING} gained): ${said(taste[0])}`);

    const at3 = await lastPos(hub);
    await s.read(BILLING);
    const stop3 = await s.stop('Waiting on your call about billing.');
    events = await settle(hub, (all) => all.some((e) => e.kind === 'agent.stop' && e.log_pos > at3), 30_000);
    events = await settle(hub, () => false, 3_000);
    must(!sentBackFor(stop3), `${AC4} ${BILLING} is sent back once; stop 3 was sent back for it again: ${replyText(stop3).slice(0, 500)}`);
    taste = tasteCalls(events, since);
    must(taste.length === 1, `${AC4} one taste call, never the same question twice: ${taste.length} after stop 3 (${listed(taste)})`);
  }, 480_000);
});
