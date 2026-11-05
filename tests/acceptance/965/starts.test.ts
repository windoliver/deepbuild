// #965 AC2: in AC1's `/loop` session, a claim the agent makes in the loop's second turn (by `deep_claim`, or in a twin
// by `gh pr create`) starts the journey at that turn's green stop on its snapshot, and the third turn's stop holds
// again. In a third twin you type a message while the second turn runs, with no claim, and that turn's stop starts the
// journey. Each turn starts from a `scheduled` prompt, changes src/cart.ts and schedules its next wake-up in 60 s.
// Through the real hub, deep-hook, deep mcp and Claude Code payloads (README).
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC2, allEvents, begin, cleanup, failureOf, journeysOn, judgedAt, landing, runsOf, runStarted, shownHeld, shownRun, stopHub,
  J, WAKE_LINE, type Ev, type StopSeen,
} from './helpers.ts';

afterEach(cleanup, 60_000);

type Via = 'deep_claim' | 'gh pr create' | 'words';
/** What the second turn does besides its edit and wake-up, as the failure names it. */
const WHAT: Record<Via, string> = {
  deep_claim: 'the claim the agent made with deep_claim in the loop\'s turn',
  'gh pr create': 'the claim the agent made with `gh pr create` in the loop\'s turn',
  words: 'your words, typed while the turn ran, with no claim',
};
/** Your message while the second turn runs: a question, so it opens no task. */
const WORDS = 'why does the cart round half up?';

async function scenario(via: Via, plant?: string): Promise<void> {
  const r = await begin({ plant });
  const { hub, s, clock, ref } = r;
  try {
    const stops: StopSeen[] = [];
    const snaps: Record<string, string | undefined> = {};
    const runs = (e: readonly Ev[]) => runsOf(e, J).map((x) => shownRun(x, snaps)).join('; ') || 'none';
    for (let k = 1; k <= 3; k++) {
      await s.scheduled('/loop keep the cart total right');
      await s.editCart(k);
      if (k === 2 && via === 'words') s.queue(WORDS);
      await s.wakeup(60);
      if (k === 2 && via === 'deep_claim') await s.deepClaim(ref);
      if (k === 2 && via === 'gh pr create') await s.prCreate();
      stops.push(await s.stop(`Pass ${k}: the cart rounds each line.`));
      const judged = await judgedAt(hub, s, k, stops[k - 1]);
      let events = judged.events;
      const stop = judged.stop;
      snaps[`S${k}`] = stop.snapshot;
      if (k === 2) {
        events = await runStarted(hub, stop.snapshot);
        console.log(`AC2 ${via}, stop 2: line "${stops[1]!.line}"; journeys: ${runs(events)}; held: ${shownHeld(events)}`);
        expect(journeysOn(events, stop.snapshot).map((x) => String(x.data.lane)), `stop 2: ${WHAT[via]} starts the 300 s journey at that turn's green stop, on its snapshot S2, though the loop goes on; journeys: ${runs(events)}`).toEqual(['slow']);
        expect(journeysOn(events, stop.snapshot)[0]!.ts, 'stop 2: the journey starts once the stop has replied').toBeGreaterThanOrEqual(stops[1]!.at);
      } else {
        await landing();
        events = await allEvents(hub);
        console.log(`AC2 ${via}, stop ${k}: line "${stops[k - 1]!.line}"; journeys: ${runs(events)}; held: ${shownHeld(events)}`);
        expect(journeysOn(events, stop.snapshot).map((x) => shownRun(x, snaps)), `stop ${k}: a loop's turn with no claim and none of your words holds the 300 s journey for the loop: no journey may run on S${k}`).toEqual([]);
        expect(stops[k - 1]!.line, `stop ${k}: its line names the held journey and why`).toContain(WAKE_LINE);
      }
      if (k < 3) await clock.pass(stops[k - 1]!.at + 55_000 - clock.now());
    }
    expect(journeysOn(await allEvents(hub), snaps.S1).map((x) => shownRun(x, snaps)), 'stop 1: no journey ever runs on S1').toEqual([]);
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC2} a claim in a loop's turn, or your words, starts its journey at that turn's stop`, () => {
  it(`${AC2} the second turn calls deep_claim: its green stop starts the journey on its snapshot, and the third turn's stop holds again`, async () => {
    await scenario('deep_claim');
  }, 420_000);
  it(`${AC2} (twin) the second turn runs gh pr create: its green stop starts the journey on its snapshot, and the third turn's stop holds again`, async () => {
    await scenario('gh pr create');
  }, 420_000);
  it(`${AC2} (twin) you type a message while the second turn runs, with no claim: that turn's stop starts the journey, and the third turn's stop holds again`, async () => {
    await scenario('words');
  }, 420_000);
  it(`${AC2} (wrong program) a runner that holds a claim's stop for the loop (DEEP_HUB_PLANT=holds-claim-stop-for-loop) fails, naming the claim`, async () => {
    for (const via of ['deep_claim', 'gh pr create'] as const) {
      const failure = await failureOf(() => scenario(via, 'holds-claim-stop-for-loop'));
      expect(failure, `a runner that holds the stop of a claim by ${via} for the loop must fail this test`).not.toBeNull();
      expect(failure, 'the failure names the claim').toContain(via === 'deep_claim' ? 'deep_claim' : '`gh pr create`');
    }
  }, 840_000);
  it(`${AC2} (wrong program) a runner that counts your words only when they start a turn (DEEP_HUB_PLANT=words-only-at-turn-start) fails, naming the stop`, async () => {
    const failure = await failureOf(() => scenario('words', 'words-only-at-turn-start'));
    expect(failure, 'a runner that misses words typed mid-turn must fail this test').not.toBeNull();
    expect(failure, 'the failure names the stop').toContain('stop 2');
  }, 420_000);
});
