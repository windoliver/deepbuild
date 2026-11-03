// #322 AC13: with the account's window at your reserve, a claim on a task whose definition hasn't locked runs the repo
// spec's checks, goes back FAIL when the spec's unit check fails, and otherwise shows BLOCKED with the cause plan
// window, never PASS; when the window resets and the definition locks, the claim is judged against it. A gate that
// waits for the lock before running any check (DEEP_HUB_PLANT=lock-before-any-check) holds the FAIL back and fails
// this test (design: Timing and cost: "while the drafting job waits at your reserve it shows BLOCKED (cause: plan
// window, owner: you). The repo's spec checks run meanwhile, so a FAIL goes back at once, and nothing passes until the
// definition locks").
//
// Your reserve is 10% (`plan.reserve_pct` in config.json). The account's five-hour window is reported 95% used
// through the base's `windows.report` (README, The plan window), so the drafting of the task's definition, the handed
// one, waits: no definition locks while the window is at the reserve. Stop 1, with the unit test failing: sent back
// FAIL naming unit. Stop 2, after FIX: no PASS; BLOCKED with the cause plan window. Then the window is reported reset
// (0% used, a later reset): the definition locks, and stop 3's claim is judged against it: R1's drafted check runs.
import { afterEach, describe, it } from 'vitest';
import {
  AC13, BEHAVIOR, BEHAVIOR_DRAFT, CHECK_FILE, FIX, claimsOf, cleanup, decision, expectTask, failureOf, lastPos, lockedFor, makeWorld, must, replyText, reportWindow,
  runOf, runsOf, said, Session, settle, startHub, taskVerdicts, trustRepo,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const HOUR = 3_600_000;

async function atReserve(plant?: string): Promise<void> {
  const w = makeWorld({ drafts: [BEHAVIOR_DRAFT()], reservePct: 10 });
  await trustRepo(w, true);
  const hub = await startHub(w, { plant });
  await reportWindow(hub, 95, Date.now() + 5 * HOUR);
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read('src/auth.js');
  let events = await settle(hub, (all) => { try { expectTask(all, s, BEHAVIOR, AC13); return true; } catch { return false; } });
  const ref = expectTask(events, s, BEHAVIOR, AC13);

  // Stop 1: the unit test fails.
  let since = await lastPos(hub);
  await s.edit('src/auth.js', 'module.exports = {', '// auth middleware\nmodule.exports = {');
  const first = await s.stop('Done.');
  events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && runsOf(all, ref, since).some((r) => runOf('unit')(r) && r.finished !== undefined), 90_000);
  must(!lockedFor(events, ref).length, `${AC13} with the window at your reserve the drafting job waits, so the definition of ${ref} must not lock: ${lockedFor(events, ref).map(said).join('; ')}`);
  must(claimsOf(events, ref, since).length > 0, `${AC13} the stop makes a claim for ${ref} though its definition hasn't locked: no claim.made after it`);
  must(runsOf(events, ref, since).some(runOf('unit')), `${AC13} the claim runs the repo spec's unit check meanwhile: its runs are ${runsOf(events, ref, since).map((r) => String(r.started.data.check)).join(', ') || 'none'}`);
  const reply1 = replyText(first);
  must(decision(first) === 'deny' && reply1.includes('unit'), `${AC13} the spec's unit check fails, so the stop goes back FAIL at once, naming unit, with the window still at the reserve: ${decision(first) === 'deny' ? reply1.slice(0, 400) : `the stop was allowed (${reply1.slice(0, 300) || 'no reason'})`}`);

  // Stop 2: the unit test passes; the definition still waits.
  since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const second = await s.stop('checkToken now rejects a token whose exp has passed; tests pass.');
  events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && taskVerdicts(all, ref, since).some((v) => v.data.outcome !== 'pending'), 90_000);
  const reply2 = replyText(second);
  must(!/\bPASS\b/.test(reply2), `${AC13} nothing passes until the definition locks: the stop's reply must never say PASS: ${reply2.slice(0, 400)}`);
  const verdicts = taskVerdicts(events, ref, since).filter((v) => v.data.outcome !== 'pending');
  must(!verdicts.some((v) => v.data.outcome === 'PASS'), `${AC13} no verdict PASS while the definition waits: ${verdicts.map(said).join('; ')}`);
  const blocked = verdicts.find((v) => v.data.outcome === 'BLOCKED' && /plan window/i.test(JSON.stringify(v.data)));
  must(blocked !== undefined || /BLOCKED/.test(reply2) && /plan window/i.test(reply2), `${AC13} with the unit check passing and the drafting job waiting at your reserve, the claim shows BLOCKED with the cause plan window: verdicts ${verdicts.map(said).join('; ') || 'none'}; reply ${reply2.slice(0, 300)}`);

  // The window resets, the definition locks, and the next claim is judged against it.
  await reportWindow(hub, 0, Date.now() + 10 * HOUR);
  events = await settle(hub, (all) => lockedFor(all, ref).length > 0, 60_000);
  must(lockedFor(events, ref).length > 0, `${AC13} once the window resets the drafting job runs and the definition of ${ref} locks: none was recorded 60 s after the reset`);
  since = await lastPos(hub);
  await s.edit('src/auth.js', '// auth middleware', '// auth middleware, checked');
  const third = await s.stop('Done.');
  events = await settle(hub, (all) => runsOf(all, ref, since).some((r) => runOf(CHECK_FILE)(r) && r.finished !== undefined), 90_000);
  must(runsOf(events, ref, since).some(runOf(CHECK_FILE)), `${AC13} after the lock the claim is judged against the definition: R1's check ${CHECK_FILE} runs for a claim of ${ref}; its runs are ${runsOf(events, ref, since).map((r) => String(r.started.data.check)).join(', ') || 'none'}`);
  must(decision(third) === 'deny', `${AC13} R1's check fails (rejectsExpired is false), so the claim judged against the definition goes back: ${replyText(third).slice(0, 300) || 'the stop was allowed'}`);
}

describe(`${AC13} the account's window at your reserve`, () => {
  it(`${AC13} the spec's checks run before the lock: FAIL goes back naming unit, a green spec shows BLOCKED (plan window), never PASS; after the reset the definition locks and the claim is judged against it`, async () => {
    await atReserve();
  }, 480_000);

  it(`${AC13} (wrong program) a gate that waits for the lock before running any check (DEEP_HUB_PLANT=lock-before-any-check) holds the FAIL back and fails this test`, async () => {
    const failure = await failureOf(() => atReserve('lock-before-any-check'));
    must(failure !== null, `${AC13} the planted gate must fail this test: it passed`);
    must(failure.includes('unit'), `${AC13} the planted gate fails where the held-back FAIL shows, the unit check; it failed elsewhere: ${failure}`);
  }, 480_000);
});
