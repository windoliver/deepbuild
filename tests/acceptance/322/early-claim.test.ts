// #322 AC10: a claim made before its definition locks waits for the lock within the hold and otherwise stays
// pending; a gate that judges it on the repo spec alone (DEEP_HUB_PLANT=spec-only-judges-early-claim) gives PASS on
// the fixture and fails this test (design: Timing and cost; Every stop is judged).
//
// The fixture: the repo's spec names the unit check, which the agent makes pass (FIX). The issue, from the test work
// source, carries an outside comment, so its handed definition waits for your one answer before it locks (#303's
// rule): the lock is held open for as long as the test wants. The stop's hold is shortened to 8 s
// (DEEP_HUB_TEST_STOP_HOLD_MS). The agent stops before the lock: the stop makes a claim, waits for the lock within the
// hold (the hook lasts about the hold), and replies with the claim pending, never PASS; no verdict PASS is made. Then
// your answer locks the definition, and the claim is judged against it: R1's drafted check runs for a claim of the task.
import { afterEach, describe, it } from 'vitest';
import {
  AC10, FIX, answer, asksRaised, claimsOf, cleanup, failureOf, itemTask, keeping, lastPos, lockedFor, makeWorld, must, replyText, runOf, runsOf, said, Session,
  settle, shown, startHub, taskVerdicts, trustRepo, CHECK_FILE,
} from './helpers.ts';
import { WORK_LINK, workComment, workDraftWithComment, workIssue } from './work.ts';

afterEach(cleanup, 60_000);

const HOLD_MS = 8000;

async function claimBeforeLock(plant?: string): Promise<void> {
  const w = makeWorld({ drafts: [workDraftWithComment(7)], readings: [workIssue(7), workComment(7)] });
  await trustRepo(w, true);
  const hub = await startHub(w, { plant, holdMs: HOLD_MS });
  const s = new Session(w);
  await s.start();
  const since = await lastPos(hub);
  await s.typed(`Fix ${WORK_LINK(7)}`);
  await s.read('src/auth.js');
  let events = await settle(hub, (all) => itemTask(all, s) !== undefined && asksRaised(all, since).length > 0);
  const ref = itemTask(events, s);
  must(ref !== undefined, `${AC10} the session started from ${WORK_LINK(7)} must open one task under its thread`);
  const asks = asksRaised(events, since);
  must(asks.length === 1 && !lockedFor(events, ref!).length, `${AC10} BLOCKED: the fixture's definition must wait for your one answer before it locks (#303): ${asks.length} asks, ${lockedFor(events, ref!).length} locks`);

  // The claim before the lock.
  const stopAt = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const stop = await s.stop('checkToken now rejects a token whose exp has passed; tests pass.');
  events = await settle(hub, (all) => claimsOf(all, ref!, stopAt).length > 0, 20_000);
  must(claimsOf(events, ref!, stopAt).length > 0, `${AC10} the stop before the lock still makes a claim for ${ref}: no claim.made after it`);
  must(stop.ms >= HOLD_MS * 0.6, `${AC10} the claim waits for the lock within the hold (${HOLD_MS} ms): the Stop hook replied after ${stop.ms.toFixed(0)} ms, before the hold could end`);
  const reply = replyText(stop);
  must(!/\bPASS\b/.test(reply), `${AC10} the definition hasn't locked, so the claim stays pending and the reply never says PASS: ${reply.slice(0, 400)}`);
  const passed = taskVerdicts(events, ref!, stopAt).filter((v) => v.data.outcome === 'PASS');
  must(!passed.length, `${AC10} no verdict PASS is made on a claim whose definition hasn't locked: ${passed.map(said).join('; ')}`);
  must(!lockedFor(events, ref!).length, `${AC10} BLOCKED: the definition locked without your answer, so the fixture can't hold the claim before its lock: ${lockedFor(events, ref!).map(said).join('; ')}`);

  // Your answer locks it, and the claim is judged against it.
  const option = keeping(asks[0]!);
  const r = await answer(w, asks[0]!, option ?? 'keep');
  must(r.code === 0, `${AC10} your answer through deep inbox answer must count, exit 0: ${shown(r)}`);
  events = await settle(hub, (all) => lockedFor(all, ref!).length > 0 && runsOf(all, ref!, stopAt).some((x) => runOf(CHECK_FILE)(x)), 90_000);
  must(lockedFor(events, ref!).length > 0, `${AC10} after your answer the definition of ${ref} locks: none was recorded`);
  const runs = runsOf(events, ref!, stopAt);
  must(runs.some(runOf(CHECK_FILE)), `${AC10} once the definition locks, the claim is judged against it: R1's check ${CHECK_FILE} runs for a claim of ${ref}; the runs are ${runs.map((x) => String(x.started.data.check)).join(', ') || 'none'}`);
}

describe(`${AC10} a claim before its definition locks`, () => {
  it(`${AC10} the stop before the lock makes a claim that waits within the hold and stays pending, never PASS; after your answer locks the definition the claim is judged against it`, async () => {
    await claimBeforeLock();
  }, 300_000);

  it(`${AC10} (wrong program) a gate that judges the early claim on the repo spec alone (DEEP_HUB_PLANT=spec-only-judges-early-claim) gives PASS on the fixture and fails this test`, async () => {
    const failure = await failureOf(() => claimBeforeLock('spec-only-judges-early-claim'));
    must(failure !== null, `${AC10} the planted gate must fail this test: it passed`);
    must(/PASS/.test(failure), `${AC10} the planted gate fails where its PASS shows; it failed elsewhere: ${failure}`);
  }, 300_000);
});
