// #82 AC12: a stop whose claim is INCONCLUSIVE or pending goes through: the claim stays open, and its open item names
// the runs or the answer still needed (design: An agent says it's done, the diagram's "INCONCLUSIVE or pending: allow
// the stop, the claim still open; an open item names the runs or the answer still needed"; How runs become one of
// five verdicts: "a check with runs still to come … is pending"; "a requirement whose oracle is you is pending until
// you answer").
//
// Item 95 has two requirements, neither failing: R1, "The checkout journey accepts a valid token", judged by
// checkout-journey.sh, handed with an expected time of 10 minutes, so its run never fits the stop's fast lane and is
// still to come; R2, "You approve the new error page wording", whose oracle is you, with no check. The agent fixes the
// unit test and stops. The Stop lets it through; no verdict on its claim is PASS and the task isn't closed; and the
// open items recorded for the task name R1's run still needed (R1, its text or its check) and R2's answer still needed
// (R2, its text, or "answer").
import { afterAll, describe, it } from 'vitest';
import {
  AC12, CHECKS, CRITERIA, FIX, SLOW_MS, blocked, claimsOf, cleanup, closedAfter, handles, item, lastPos, listed, makeWorld, must, names,
  openItemsOf, Session, settle, shown, startHub, startOnItem, verdictsIn,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const REQS = [
  { text: CRITERIA.journey, check: CHECKS.journey, on_base: 'passes' as const, expected_ms: SLOW_MS },
  { text: CRITERIA.approve, check: null, on_base: 'passes' as const, oracle: 'person' as const },
];

describe(`${AC12} a stop whose claim is INCONCLUSIVE or pending goes through, the claim open, its open item naming what's still needed`, () => {
  it(`${AC12} item 95: R1's run still to come and R2 waiting on your answer, the stop is let through, the claim stays open, and its open items name R1's run and R2's answer`, async () => {
    const w = makeWorld({ items: [item(95, 'The checkout journey and the error page', REQS)] });
    const hub = await startHub(w);
    const s = new Session(w);
    const ref = await startOnItem(hub, s, 95, AC12);
    await s.edit(FIX.file, FIX.from, FIX.to);
    const since = await lastPos(hub);
    const stop = await s.stop('checkToken now rejects a token whose exp has passed.');
    const replied = await lastPos(hub);
    const events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && openItemsOf(all, ref, since).length >= 2, 30_000);
    const claims = handles(claimsOf(events, ref, since));
    must(claims.size > 0, `${AC12} the stop after the fix is a claim for ${ref}: none recorded`);
    must(!blocked(stop), `${AC12} a stop whose claim is pending goes through: deep-hook kept it going: ${shown(stop)}`);
    const passed = verdictsIn(events, since, replied + 1).filter((v) => claims.has(String(v.data.claim)) && v.data.outcome === 'PASS');
    must(passed.length === 0 && closedAfter(events, ref, since).length === 0, `${AC12} the claim stays open: no PASS and the task not closed at the stop: ${listed([...passed, ...closedAfter(events, ref, since)])}`);
    const items = openItemsOf(events, ref, since).map((e) => String(e.data.text ?? ''));
    must(items.some((t) => names(t, 'R1', CRITERIA.journey) || t.includes('checkout-journey')), `${AC12} an open item names the run still needed, R1's ("${CRITERIA.journey}", checkout-journey.sh): ${JSON.stringify(items)}`);
    must(items.some((t) => names(t, 'R2', CRITERIA.approve) || /\banswer\b/i.test(t)), `${AC12} an open item names the answer still needed, R2's ("${CRITERIA.approve}"): ${JSON.stringify(items)}`);
  }, 600_000);
});
