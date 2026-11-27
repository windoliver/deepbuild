// #3562 AC1: one session's 300 s journey is running. A second session stops green with a 300 s journey of its own.
// Its Stop hook's reply comes when its fast lane ends, and its line names the journey as queued. On the merge base
// the reply comes only when the first journey ends, and the test fails, naming the stop.
//
// Through a running hub (`deep hub run`, two check slots, a stepped clock), the real deep-hook and Claude Code
// payloads (README). The first session's journey holds the one slot slow runs may hold and goes on until the test
// ends it, which it does only to read what a hub that held the reply did with it.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC1, allEvents, begin, blocked, cleanup, endRun, finishedOf, heldTimeOf, journeyRunning, journeysOf, judged, QUEUED_LINE, SECOND, settle, shown, shownHeld,
  stop, stopHub, turn, type Going, type Judged, type Play, type Sent, type StopSeen,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const STOP = "the second session's stop";
/** How long before its hook gave up a stop's fast lane must have ended for a missing reply to be the hub's doing, not the machine's. */
const ROOM_MS = 15 * SECOND;

/**
 * No reply came to the stop while its hook waited. Unless the machine left the hub no room to make one (BLOCKED), the
 * first session's journey is ended and the record read for when the hub made the reply, and the test fails, naming
 * the stop.
 */
async function replyHeld(play: Play, going: Going, sent: Sent, judgedStop: Judged, seen: StopSeen, fastLaneSeenAt: number): Promise<void> {
  const gaveUp = seen.ran.timedOut ? 'was stopped by this test at its own limit' : 'returned with no line';
  // deadline: only tells a reply the hub held back from a machine too slow to make one inside the Stop hook's hold
  const room = seen.ran.ended - fastLaneSeenAt;
  if (room < ROOM_MS) blocked(`${STOP}: its fast lane had ended only ${Math.round(room / SECOND)} s before its Stop hook ${gaveUp}, so this machine left the hub no room to reply inside the hook's hold; this run says nothing`);
  // What the hub did with the reply is a reading beside the failure, never in its place.
  let made: string;
  try {
    endRun(going.run);
    const events = await settle(play.hub, (e) => finishedOf(e, going.run) !== undefined && heldTimeOf(e, judgedStop.claim) !== undefined, 60 * SECOND);
    const ended = finishedOf(events, going.run);
    const reply = heldTimeOf(events, judgedStop.claim);
    made = reply && ended && reply.log_pos > ended.log_pos
      ? `The hub made its reply only once the first session's journey had ended: its stop.held (log_pos ${reply.log_pos}, a hold of ${String(reply.data.total)} ms) comes after that journey's run.finished (log_pos ${ended.log_pos})`
      : reply
        ? `The record holds its reply (stop.held at log_pos ${reply.log_pos}, a hold of ${String(reply.data.total)} ms), which the session never got`
        : `The record holds no reply to it (no stop.held naming ${judgedStop.claim}) 60 s after this test ended the first session's journey`;
    made += `; slow-lane runs: ${events.filter((e) => e.kind === 'run.started' && e.data.lane === 'slow').map((e) => shown(e)).join('; ') || 'none'}`;
  } catch (error) {
    made = `When the hub made its reply could not be read (${error instanceof Error ? error.message.slice(0, 300) : String(error)})`;
  }
  console.log(`AC1 ${STOP}: sent at ${sent.at}; its Stop hook ${gaveUp} ${seen.repliedAt - sent.at} ms later. ${made}`);
  expect(seen.line, `${STOP}: its Stop hook's reply did not come when its fast lane ended. ${judgedStop.unit.data.check as string} had ended ${Math.round(room / SECOND)} s or more before the hook ${gaveUp}, while the first session's 300 s journey still held the slot. ${made}. The reply must come when the stop's fast lane ends, whatever the slow lane holds`).not.toBe('');
}

describe(`${AC1} a green stop's reply comes when its fast lane ends, whatever slot its slow checks wait for`, () => {
  it(`${AC1} one session's 300 s journey is running and a second session stops green with a 300 s journey of its own: its Stop hook's reply comes when its fast lane ends, and its line names the journey as queued`, async () => {
    const play = await begin(['first', 'second']);
    try {
      const [first, second] = play.players;
      // One session's 300 s journey is running.
      const going = await journeyRunning(play, first!);
      // A second session stops green with a 300 s journey of its own.
      await turn(second!);
      const sent = stop(second!);
      const judgedStop = await judged(play, sent);
      const fastLaneSeenAt = Date.now();
      // Its Stop hook returns by itself: with the hub's reply, or with none once its hold is over.
      const seen = await sent.hook;
      let events = await allEvents(play.hub);
      if (finishedOf(events, going.run)) blocked(`the first session's journey ended before ${STOP} was read, though this test never ended it; ${shown(going.run)}`);
      if (seen.line === '') await replyHeld(play, going, sent, judgedStop, seen, fastLaneSeenAt);

      expect(seen.block, `${STOP}: a green stop is let through, not sent back`).toBeUndefined();
      const own = journeysOf(events, second!);
      expect(own.map((x) => shown(x)), `${STOP}: its own 300 s journey waits for the slot the first session's journey holds, so no run of it may have started when the reply came`).toEqual([]);
      // The reply is the record's too: the stop's held time is stamped at it, once its fast-lane check has ended.
      events = await settle(play.hub, (e) => heldTimeOf(e, judgedStop.claim) !== undefined, 30 * SECOND);
      const reply = heldTimeOf(events, judgedStop.claim);
      console.log(`AC1 ${STOP}: sent at ${sent.at}; reply ${seen.repliedAt - sent.at} ms later on the hub's clock${reply ? ` (stop.held: a hold of ${String(reply.data.total)} ms)` : ''}; line "${seen.line}"; runs: ${[going.run, ...journeysOf(events, second!)].map((x) => shown(x)).join('; ')}; places in the record: ${shownHeld(events)}`);
      expect(reply, `${STOP}: its held time is in the record (a stop.held naming ${judgedStop.claim})`).toBeDefined();
      expect(judgedStop.ended.log_pos < reply!.log_pos, `${STOP}: its reply comes once its fast-lane check ${second!.unit} has ended, not before (run.finished at log_pos ${judgedStop.ended.log_pos}, stop.held at ${reply!.log_pos})`).toBe(true);
      expect(seen.line, `${STOP}: its line names its journey as queued`).toContain(QUEUED_LINE);
    } finally {
      await stopHub(play.hub);
    }
  }, 1_200_000);
});
