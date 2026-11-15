// #2075: a claim's slow checks when its fast lane is still running at the end of the stop's hold. Through a real hub,
// deep-hook and a Claude Code stand-in, with the slow check's run read from the record.
import { afterEach, describe, expect, it } from 'vitest';
import { allEvents, cleanup, FAST, QUESTION, runsOf, settle, SLOW, sleep, stopHub, stopPastHold, verdictsOf, play } from './helpers.ts';

afterEach(cleanup);
const SETTLE_MS = 45_000;
/** Long enough for a start that is going to happen: the checkout and the queue take a few seconds. */
const QUIET_MS = 12_000;

describe('a slow check after a fast check that runs past the hold', () => {
  it('AC1 starts once the fast check passes, with no new prompt, and the claim reaches a verdict', async () => {
    const p = await play('pass');
    try {
      const { claim } = await stopPastHold(p);
      const events = await settle(p.hub, (e) => runsOf(e, claim, SLOW).finished.length > 0 && verdictsOf(e, claim).some((v) => v.data.outcome === 'PASS'), SETTLE_MS);
      const fast = runsOf(events, claim, FAST);
      expect(fast.finished[0]?.data.outcome, 'the fast check passes after the hold').toBe('passed');
      const slow = runsOf(events, claim, SLOW);
      const seen = `${FAST} ended ${fast.finished[0]?.data.outcome} at log ${fast.finished[0]?.log_pos}; claim verdicts so far: ${JSON.stringify(verdictsOf(events, claim).map((v) => v.data.outcome))}; runs of ${SLOW}: ${slow.started.length}`;
      expect(slow.started, `the slow check ${SLOW} has no run in the record: the claim ${claim} is left pending (${seen})`).toHaveLength(1);
      expect(slow.started[0]!.data.lane).toBe('slow');
      expect(slow.started[0]!.log_pos, 'it starts after the fast check ended').toBeGreaterThan(fast.finished[0]!.log_pos);
      expect(slow.finished[0]?.data.outcome).toBe('passed');
      const prompts = events.filter((e) => e.kind === 'user.ask' && e.session === p.s.id);
      expect(prompts.every((e) => e.log_pos < fast.started[0]!.log_pos), 'no prompt came after the stop').toBe(true);
      expect(verdictsOf(events, claim).at(-1)?.data.outcome, `the claim reaches a verdict: ${JSON.stringify(verdictsOf(events, claim).at(-1)?.data.reasons)}`).toBe('PASS');
    } finally { await stopHub(p.hub); }
  }, 240_000);

  it('AC2 starts none when the fast check fails after the hold, and the verdict is FAIL', async () => {
    const p = await play('fail');
    try {
      const { claim } = await stopPastHold(p);
      let events = await settle(p.hub, (e) => runsOf(e, claim, FAST).finished.length > 0 && verdictsOf(e, claim).some((v) => v.data.outcome === 'FAIL'), SETTLE_MS);
      expect(runsOf(events, claim, FAST).finished[0]?.data.outcome, 'the fast check fails after the hold').toBe('failed');
      await sleep(QUIET_MS);
      events = await allEvents(p.hub);
      expect(runsOf(events, claim, SLOW).started, `the slow check ${SLOW} must not start after a FAIL`).toEqual([]);
      expect(verdictsOf(events, claim).at(-1)?.data.outcome).toBe('FAIL');
    } finally { await stopHub(p.hub); }
  }, 240_000);

  it('AC3 starts none of the old snapshot when a new prompt comes before the fast check ends', async () => {
    const p = await play('pass');
    try {
      const { claim } = await stopPastHold(p);
      await p.s.typed(QUESTION);
      const before = await allEvents(p.hub);
      expect(runsOf(before, claim, FAST).finished, 'the fast check still runs when the new prompt is sent').toEqual([]);
      const events = await settle(p.hub, (e) => runsOf(e, claim, FAST).finished.length > 0, SETTLE_MS);
      expect(runsOf(events, claim, FAST).finished[0]?.data.outcome, 'the fast check passes after the new prompt').toBe('passed');
      await sleep(QUIET_MS);
      const after = await allEvents(p.hub);
      expect(runsOf(after, claim, SLOW).started, `the old snapshot's slow check ${SLOW} must not start while the new turn runs`).toEqual([]);
    } finally { await stopHub(p.hub); }
  }, 240_000);
});
