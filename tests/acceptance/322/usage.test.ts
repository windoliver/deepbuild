// #322 AC6: an agent whose last message says "usage limit reached" with no rate-limit record behind it is judged like
// any stop and sent back (design: Tasks close themselves, "an agent that writes 'usage limit reached' still gets its
// send-back"; Every stop is judged).
//
// The repo's spec names the unit check, which fails until the agent makes FIX. No definition is handed for the
// prompt, so the task's definition hasn't locked; the claim is judged on the repo's spec meanwhile (design: Timing and
// cost). The agent edits an unrelated line and stops with Claude Code's own words for a spent plan window, with no
// API-error entry in the transcript and no rate-limit record: the stop must be recorded as a claim with a cause that is
// no plan window or rate limit (there is no such record), a claim made for the task, and the stop sent back naming
// the spec's unit check.
import { afterEach, describe, it } from 'vitest';
import { AC6, BEHAVIOR, claimsOf, cleanup, decision, expectTask, lastPos, makeWorld, must, replyText, runOf, runsOf, Session, settle, startHub, stopsOf, trustRepo } from './helpers.ts';

afterEach(cleanup, 60_000);

const WORDS = 'Claude usage limit reached. Your limit will reset at 5pm (UTC).';

describe(`${AC6} "usage limit reached" with no rate-limit record`, () => {
  it(`${AC6} the stop whose last message says "${WORDS}" is judged like any stop: a claim on the task, no plan-window cause, and sent back naming the failing unit check`, async () => {
    const w = makeWorld();
    await trustRepo(w, true);
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.read('src/auth.js');
    let events = await settle(hub, (all) => { try { expectTask(all, s, BEHAVIOR, AC6); return true; } catch { return false; } });
    const ref = expectTask(events, s, BEHAVIOR, AC6);
    const since = await lastPos(hub);
    await s.edit('src/auth.js', 'module.exports = {', '// auth middleware\nmodule.exports = {');
    const stop = await s.stop(WORDS);
    events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && runsOf(all, ref, since).some((r) => runOf('unit')(r) && r.finished !== undefined), 90_000);
    const recorded = stopsOf(events, s).filter((e) => e.log_pos > since);
    must(recorded.length === 1, `${AC6} the stop must be recorded once as agent.stop: ${recorded.length} were`);
    const [st] = recorded;
    must(st!.data.claim === true, `${AC6} the stop's turn edited src/auth.js, so the stop rule reads it as a claim whatever its words say (claim: true): ${JSON.stringify(st!.data).slice(0, 500)}`);
    must(st!.data.cause !== 'plan_window_spent' && st!.data.cause !== 'rate_limited' && st!.data.plan_resets === undefined, `${AC6} with no rate-limit record behind the words, the cause comes from structure, never from the text: not plan_window_spent or rate_limited, and no plan_resets: ${JSON.stringify(st!.data).slice(0, 500)}`);
    must(claimsOf(events, ref, since).length > 0, `${AC6} the stop must make a claim for ${ref}, as any stop that did work does: no claim.made after it`);
    const reply = replyText(stop);
    must(decision(stop) === 'deny', `${AC6} the spec's unit check fails, so the stop is sent back: deep-hook let it through (${reply.slice(0, 300) || 'no reason'})`);
    must(reply.includes('unit'), `${AC6} the send-back names the failing unit check: ${reply.slice(0, 400)}`);
  }, 240_000);
});
