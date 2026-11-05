// #82 AC13: budgets, on the reference Mac in the local preflight, compared with the merge base: judging a stop that
// needs no new checks adds under 10 ms, and fast checks finish inside the 60-second hold.
//
// A blind suite can't build and time the merge base beside the change, so both are read on the hub as it stands
// (README, Budgets): one hub with the shipped 60 s hold, one session on item 99, whose R1 (expired-token.sh) passes
// once the agent makes FLAG.
//   - The fast checks: the agent makes FIX and FLAG and stops. The stop's fast-lane runs (the spec's unit check and
//     R1's check) all finish before its reply, and the reply comes inside the 60 s hold.
//   - Judging a stop that needs no new checks: five turns of each kind, interleaved, each reading src/auth.js and
//     stopping with nothing changed: a scheduled task's turn (judged: a claim, and no run started for it, since its
//     snapshot changed no check's inputs) and your typed question (an answer: not judged). What judging adds is the
//     median Stop hook time of the judged stops less that of the answers, through deep-hook as Claude Code runs it.
// A reading over its budget while the 1-minute load is past the core count is INCONCLUSIVE, never a fail, as
// tests/acceptance/325/timing.test.ts reads it. The harness is shown to fail on planted readings.
import { afterAll, describe, it } from 'vitest';
import {
  AC13, EXPIRED, FIX, FLAG, Inconclusive, askDraft, blocked, claimsOf, claimsIn, cleanup, failureOf, handles, item, lastPos, listed, loadReading,
  loaded, makeWorld, must, runsFor, Session, settle, shown, startHub, startOnItem, verdict, type Ran,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const QUESTION = 'what does checkToken compare the expiry with?';
const LOOP = '/loop every 10 minutes: re-read the auth middleware';
const HOLD_S = 60;
const ADDS_MS = 10;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
/** The 10 ms judge: what judging adds, read from the two kinds of stop's hook times. */
function addsUnder(judged: number[], answers: number[], budget = ADDS_MS): void {
  const added = median(judged) - median(answers);
  const reading = `judged stops ${judged.map((x) => x.toFixed(0)).join(', ')} ms (median ${median(judged).toFixed(1)}), answers ${answers.map((x) => x.toFixed(0)).join(', ')} ms (median ${median(answers).toFixed(1)}), ${loadReading()}`;
  if (added >= budget && loaded()) throw new Inconclusive(`${AC13} judging a stop that needs no new checks added ${added.toFixed(1)} ms: ${reading}, over ${budget} ms while the machine is loaded past its cores`);
  must(added < budget, `${AC13} judging a stop that needs no new checks adds under ${budget} ms: it added ${added.toFixed(1)} ms: ${reading}`);
}

describe(`${AC13} judging a stop that needs no new checks adds under 10 ms; fast checks finish inside the 60 s hold`, () => {
  it(`${AC13} item 99: the stop's fast-lane runs all end before its reply, inside the 60 s hold; a judged stop that needs no new checks adds under 10 ms over an answer`, async (ctx) => {
    await verdict(ctx, async () => {
      const w = makeWorld({ items: [item(99, 'Expired tokens are accepted', [EXPIRED])], drafts: [askDraft(QUESTION), askDraft(LOOP)] });
      const hub = await startHub(w, { hold: null });
      const s = new Session(w);
      const ref = await startOnItem(hub, s, 99, AC13);
      await s.edit(FIX.file, FIX.from, FIX.to);
      await s.edit(FLAG.file, FLAG.from, FLAG.to);
      const since = await lastPos(hub);
      const first = await s.stop('checkToken rejects expired tokens and flags them.');
      let events = await settle(hub, () => true);
      const claimed = handles(claimsOf(events, ref, since));
      const fast = runsFor(events, claimed).filter((r) => r.started.data.lane === 'fast');
      must(claimed.size > 0 && fast.length > 0, `BLOCKED: ${AC13} the stop after the fix is a claim whose checks run in the fast lane: ${listed(claimsOf(events, ref, since))}; runs ${fast.length}`);
      const late = fast.filter((r) => !r.finished || r.finished.ts > first.ended);
      const within = first.ms < HOLD_S * 1000;
      if ((late.length || !within) && loaded()) throw new Inconclusive(`${AC13} the fast checks (${fast.length}) ${late.length ? `left ${late.length} unfinished at the reply` : 'finished'}, the reply ${(first.ms / 1000).toFixed(1)} s after the stop, ${loadReading()}`);
      must(!late.length && within, `${AC13} fast checks finish inside the 60-second hold: ${late.length} of ${fast.length} fast-lane runs had not finished when the stop was answered ${(first.ms / 1000).toFixed(1)} s after it: ${listed(late.map((r) => r.started))}`);
      must(!blocked(first), `BLOCKED: ${AC13} the stop with R1 and the unit test passing is let through: ${shown(first)}`);

      const judged: Ran[] = [];
      const answers: Ran[] = [];
      const judgedFrom: number[] = [];
      for (let i = 0; i < 5; i++) {
        judgedFrom.push(await lastPos(hub));
        await s.scheduled(LOOP);
        await s.read('src/auth.js');
        judged.push(await s.stop(`Re-read the auth middleware, round ${i + 1}.`));
        judgedFrom.push(await lastPos(hub));
        await s.typed(QUESTION);
        await s.read('src/auth.js');
        answers.push(await s.stop('It compares exp with the current time in seconds.'));
      }
      events = await settle(hub, () => true);
      for (let i = 0; i < 5; i++) {
        const claims = claimsIn(events, judgedFrom[2 * i]!, judgedFrom[2 * i + 1]!);
        must(claims.length > 0, `BLOCKED: ${AC13} the scheduled task's turn ${i + 1} is judged (a claim): none recorded`);
        must(runsFor(events, handles(claims)).length === 0, `${AC13} the scheduled task's turn ${i + 1} changed nothing, so it needs no new checks (design: a stop that changed no check's inputs reuses results and runs nothing); the hub ran ${listed(runsFor(events, handles(claims)).map((r) => r.started))}`);
        must(claimsIn(events, judgedFrom[2 * i + 1]!, judgedFrom[2 * i + 2] ?? Infinity).length === 0, `BLOCKED: ${AC13} your typed question's turn ${i + 1} is an answer, not judged`);
        must(!blocked(judged[i]!) && !blocked(answers[i]!), `BLOCKED: ${AC13} both kinds of stop are let through in round ${i + 1}: ${shown(judged[i]!)} / ${shown(answers[i]!)}`);
      }
      addsUnder(judged.map((r) => r.ms), answers.map((r) => r.ms));
    });
  }, 600_000);

  it(`${AC13} (wrong program) the 10 ms reading fails on a judge that adds 15 ms`, async () => {
    const message = await failureOf(async () => { try { addsUnder([45, 46, 44, 47, 45], [30, 31, 29, 30, 30]); } catch (e) { if (e instanceof Inconclusive) throw Error(e.message); throw e; } });
    must(message !== null && /adds under 10 ms|added 15/.test(message), `${AC13} a judge that adds 15 ms fails the 10 ms budget: ${message ?? 'it passed'}`);
  });
});
