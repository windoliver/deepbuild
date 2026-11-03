// #322 AC5: a claim's definition is the repo's spec plus the task's definition, combined by the verdict rules in one
// stated order that every run uses (design: How runs become one of five verdicts, precedence FAIL > INVALID > BLOCKED >
// INCONCLUSIVE > PASS; Whose checks count).
//
// The repo's spec names the unit check; the task's definition names R1, judged by the drafted check. Two worlds: in
// the first the agent makes the unit test pass and leaves R1 failing; in the second the reverse. On each claim both
// checks run (a run.started of each for a claim of the task), the verdict is FAIL by the precedence, and the stop is
// sent back naming the failing check. "One stated order": the claim's checks run in the same order in both worlds,
// the spec's and the definition's, so the order never depends on which one fails.
import { afterEach, describe, it } from 'vitest';
import {
  AC5, BEHAVIOR, BEHAVIOR_DRAFT, CHECK_FILE, FIX, FLAG, claimsOf, cleanup, decision, expectTask, lastPos, lockedFor, makeWorld, must, replyText, runOf,
  runsOf, Session, settle, startHub, taskVerdicts, trustRepo, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

interface Claimed { ref: string; since: number; events: Ev[]; reply: string; order: string[] }

async function claimWith(edit: typeof FIX | typeof FLAG, failing: string): Promise<Claimed> {
  const w = makeWorld({ drafts: [BEHAVIOR_DRAFT()] });
  await trustRepo(w, true);
  const hub = await startHub(w);
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read('src/auth.js');
  let events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, BEHAVIOR, AC5)).length > 0; } catch { return false; } });
  const ref = expectTask(events, s, BEHAVIOR, AC5);
  must(lockedFor(events, ref).length > 0, `${AC5} the handed definition of ${ref} must lock: none was recorded`);
  const since = await lastPos(hub);
  await s.edit(edit.file, edit.from, edit.to);
  const stop = await s.stop('Done.');
  events = await settle(hub, (all) => runsOf(all, ref, since).some(runOf('unit')) && runsOf(all, ref, since).some(runOf(CHECK_FILE)) && taskVerdicts(all, ref, since).some((v) => v.data.outcome !== 'pending'), 90_000);
  const who = `${AC5} [${failing} failing]`;
  must(claimsOf(events, ref, since).length > 0, `${who} the stop must make a claim for ${ref}: no claim.made after it`);
  const runs = runsOf(events, ref, since);
  must(runs.some(runOf('unit')), `${who} the repo spec's unit check must run on the claim: its runs are ${runs.map((r) => String(r.started.data.check)).join(', ') || 'none'}`);
  must(runs.some(runOf(CHECK_FILE)), `${who} the definition's R1 check ${CHECK_FILE} must run on the claim: its runs are ${runs.map((r) => String(r.started.data.check)).join(', ') || 'none'}`);
  const verdicts = taskVerdicts(events, ref, since).filter((v) => v.data.outcome !== 'pending');
  must(verdicts.length > 0, `${who} the claim must get a verdict: none was made`);
  const last = verdicts[verdicts.length - 1]!;
  must(last.data.outcome === 'FAIL', `${who} ${failing} failed on every run, so the combined verdict is FAIL by the precedence FAIL > INVALID > BLOCKED > INCONCLUSIVE > PASS: ${JSON.stringify(last.data).slice(0, 500)}`);
  const reply = replyText(stop);
  must(decision(stop) === 'deny' && reply.includes(failing), `${who} the stop is sent back naming ${failing}: ${reply.slice(0, 400) || 'the stop was allowed with no reason'}`);
  const order = runs.filter((r) => runOf('unit')(r) || runOf(CHECK_FILE)(r)).map((r) => (runOf('unit')(r) ? 'unit' : CHECK_FILE));
  return { ref, since, events, reply, order: [...new Set(order)] };
}

describe(`${AC5} the repo's spec plus the task's definition, in one order`, () => {
  it(`${AC5} with the unit test passing and R1 failing the claim runs both and is FAIL naming ${CHECK_FILE}; with R1 passing and the unit test failing it is FAIL naming unit; both claims run the checks in the same order`, async () => {
    const r1Fails = await claimWith(FIX, CHECK_FILE);
    const unitFails = await claimWith(FLAG, 'unit');
    must(JSON.stringify(r1Fails.order) === JSON.stringify(unitFails.order), `${AC5} every run uses one stated order for the spec's and the definition's checks: the first claim ran ${r1Fails.order.join(' then ')}, the second ${unitFails.order.join(' then ')}`);
  }, 480_000);
});
