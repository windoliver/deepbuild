// #322 AC8: the message to the agent names the missing proof precisely, never just "tests failed" (design: Where, not
// just what; The verdict in the chat; One cause, one send-back).
//
// The repo's spec names the unit check, which the agent makes pass (FIX); the task's definition names R1, "An expired
// token is rejected with 401", judged by the drafted check `.deepbuild/checks/expired-token.sh`, whose assertion is its
// line 3 and which fails until FLAG is made. The agent stops without FLAG. The stop is sent back, and its reason must
// name the requirement whose proof is missing (R1, or its text) and the check that fails (its file); it is never a
// bare "tests failed".
import { afterEach, describe, it } from 'vitest';
import {
  AC8, BEHAVIOR, BEHAVIOR_DRAFT, CHECK_FILE, FIX, claimsOf, cleanup, decision, expectTask, lastPos, lockedFor, makeWorld, must, replyText, R1, runOf, runsOf,
  Session, settle, startHub, trustRepo,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC8} the send-back names the missing proof precisely`, () => {
  it(`${AC8} with R1's check failing, the stop's send-back names R1 (or its text) and ${CHECK_FILE}, never just "tests failed"`, async () => {
    const w = makeWorld({ drafts: [BEHAVIOR_DRAFT()] });
    await trustRepo(w, true);
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.read('src/auth.js');
    let events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, BEHAVIOR, AC8)).length > 0; } catch { return false; } });
    const ref = expectTask(events, s, BEHAVIOR, AC8);
    must(lockedFor(events, ref).length > 0, `${AC8} the handed definition of ${ref} must lock: none was recorded`);
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    const stop = await s.stop('checkToken now rejects a token whose exp has passed; tests pass.');
    events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && runsOf(all, ref, since).some((r) => runOf(CHECK_FILE)(r) && r.finished !== undefined), 90_000);
    must(claimsOf(events, ref, since).length > 0, `${AC8} the stop must make a claim for ${ref}: no claim.made after it`);
    const run = runsOf(events, ref, since).find(runOf(CHECK_FILE));
    must(run?.finished?.data.outcome === 'failed', `${AC8} R1's check ${CHECK_FILE} fails on the claim (rejectsExpired is false): ${JSON.stringify(run?.finished?.data ?? run?.started.data ?? 'no run')}`);
    const reply = replyText(stop);
    must(decision(stop) === 'deny', `${AC8} the stop is sent back: deep-hook let it through (${reply.slice(0, 300) || 'no reason'})`);
    must(!/^\s*tests? failed\.?\s*$/i.test(reply), `${AC8} the message is never just "tests failed": ${reply}`);
    const r1 = R1();
    must(/\bR1\b/.test(reply) || reply.includes(r1.text), `${AC8} the message names the requirement whose proof is missing, R1 or "${r1.text}": ${reply.slice(0, 500)}`);
    must(reply.includes(CHECK_FILE) || reply.includes('expired-token.sh'), `${AC8} the message names the check that fails, ${CHECK_FILE}: ${reply.slice(0, 500)}`);
  }, 240_000);
});
