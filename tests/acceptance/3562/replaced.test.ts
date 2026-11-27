// #3562 AC2: the second session stops again 60 s later with `src/cart.ts` changed, before any slot frees. No run
// starts on its first snapshot, the record's queue shows that place replaced, and the journey runs once, on the
// second snapshot. The merge base starts the first snapshot's run and fails, naming the snapshot.
//
// Through a running hub (`deep hub run`, two check slots, a stepped clock), the real deep-hook and Claude Code
// payloads (README). No stop's reply is waited on past 30 s after its fast lane: a hub that holds it fails AC1's test,
// and this one goes on. The slot frees when the test ends the first session's journey, after the second stop. "No run
// starts on its first snapshot" is read at two events: the first run of the second session's journey to start once the
// slot is free, and, once that run has ended, the start of a journey the first session queues after it, which the
// freed slot reaches only when nothing waits ahead of it.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC2, allEvents, begin, blocked, cleanup, endRun, finishedOf, heldOf, journeyRunning, journeysOf, judged, replied, SECOND, settle, shown, shownHeld,
  START_WAIT_MS, stop, stopHub, turn,
} from './helpers.ts';
import { notReplaced } from './readings.ts';

afterEach(cleanup, 60_000);

describe(`${AC2} a place still queued is taken by a newer snapshot, however long it has waited`, () => {
  it(`${AC2} the second session stops again 60 s later with src/cart.ts changed, before any slot frees: no run starts on its first snapshot, the record's queue shows that place replaced, and the journey runs once, on the second snapshot`, async () => {
    const play = await begin(['first', 'second']);
    try {
      const [first, second] = play.players;
      const going = await journeyRunning(play, first!);

      // The second session stops green: its journey waits for the slot.
      await turn(second!);
      const one = stop(second!);
      const S1 = (await judged(play, one)).snapshot;
      await replied(one);
      // It stops again 60 s later, on the hub's clock, with src/cart.ts changed.
      await play.clock.pass(one.at + 60 * SECOND - play.clock.now());
      await turn(second!);
      const two = stop(second!);
      const S2 = (await judged(play, two)).snapshot;
      await replied(two);
      if (S1 === S2) blocked(`the second session's two stops name one snapshot (${S1}), though its second turn changed src/cart.ts`);
      const snaps = { 'the first snapshot': S1, 'the second snapshot': S2 };
      const first7 = `the first snapshot (${S1.slice(0, 7)})`;
      const second7 = `the second snapshot (${S2.slice(0, 7)})`;
      const mine = (e: Parameters<typeof journeysOf>[0]): string[] => journeysOf(e, second!).map((x) => shown(x, snaps));

      // Before any slot frees: the first session's journey still runs, and nothing of the second session's has started.
      let events = await allEvents(play.hub);
      if (finishedOf(events, going.run)) blocked(`the first session's journey ended before the second session's second stop, though this test never ended it; ${shown(going.run)}`);
      expect(mine(events), `${first7}, ${second7}: the first session's journey still holds the slot, so no run of ${second!.journey} may have started on either`).toEqual([]);

      // The slot frees. The journey's first run is on the second snapshot.
      endRun(going.run);
      events = await settle(play.hub, (e) => journeysOf(e, second!).length > 0, START_WAIT_MS);
      let runs = journeysOf(events, second!);
      console.log(`AC2 the slot freed (the first session's journey ended by the test): runs of ${second!.journey}: ${mine(events).join('; ') || 'none'}; places in the record: ${shownHeld(events)}`);
      expect(runs.length > 0, `${second7}: no run of ${second!.journey} started within ${START_WAIT_MS / SECOND} s of the slot freeing; the journey must run once, on it`).toBe(true);
      expect(runs.filter((x) => x.data.commit === S1).map((x) => shown(x, snaps)), `${first7}: a run of ${second!.journey} started on it when the slot freed. The second session stopped again 60 s after it with src/cart.ts changed, before any slot freed, so ${second7} took its queued place and no run may start on ${first7}`).toEqual([]);
      expect(String(runs[0]!.data.commit), `${second7}: the journey's run is on it; runs: ${mine(events).join('; ')}`).toBe(S2);

      // That run ends. Then the first session stops again: its journey is queued behind whatever still waits, so its
      // start is the event at which nothing of the second session's can still be waiting to start.
      endRun(runs[0]!);
      events = await settle(play.hub, (e) => finishedOf(e, runs[0]!) !== undefined, START_WAIT_MS);
      if (!finishedOf(events, runs[0]!)) blocked(`the second session's journey run on ${second7} did not end within ${START_WAIT_MS / SECOND} s of this test ending it; ${shown(runs[0]!, snaps)}`);
      await turn(first!);
      const next = stop(first!);
      const nextClaim = (await judged(play, next)).claim;
      const reached = (e: Parameters<typeof journeysOf>[0]): boolean => journeysOf(e, first!).some((x) => x.data.claim === nextClaim);
      events = await settle(play.hub, (e) => reached(e) || journeysOf(e, second!).length > 1, START_WAIT_MS);
      runs = journeysOf(events, second!);
      console.log(`AC2 once the run on the second snapshot ended: runs of ${second!.journey}: ${mine(events).join('; ')}; the first session's next journey ${reached(events) ? 'started' : 'has not started'}; places in the record: ${shownHeld(events)}`);
      expect(runs.filter((x) => x.data.commit === S1).map((x) => shown(x, snaps)), `${first7}: a run of ${second!.journey} started on it once the run on ${second7} had ended. ${second7} took its queued place before any slot freed, so no run may ever start on ${first7}`).toEqual([]);
      expect(mine(events).length, `${second7}: the journey runs once, on it; runs: ${mine(events).join('; ')}`).toBe(1);
      expect(reached(events), `${first7}: "no run starts on it" is read when the first session's next journey starts, which the free slot reaches once nothing waits ahead of it; that journey did not start within ${START_WAIT_MS / SECOND} s of its green stop`).toBe(true);

      // The record's queue shows the first snapshot's place replaced: read as #965's suite reads a place.
      expect(notReplaced(heldOf(events, second!.journey, S1), second!.journey, S1, S2), `${first7}: the record's queue shows the place ${second!.journey} took on it replaced by ${second7}; the record's places: ${shownHeld(events)}`).toEqual([]);
    } finally {
      await stopHub(play.hub);
    }
  }, 2_400_000);
});
