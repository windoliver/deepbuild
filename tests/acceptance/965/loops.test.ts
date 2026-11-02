// #965 AC1: a recorded Claude Code `/loop` session makes three turns, each from a `scheduled` prompt that changes
// src/cart.ts. The first two schedule their next wake-up in 60 s and end green: no journey runs on their snapshots,
// each stop replies when its fast-lane check ends, its line says the journey waits for the loop, and the second
// snapshot takes the first's held place. The third schedules no wake-up, and its stop starts the journey on its own
// snapshot. The record holds both held places. Through the real hub, deep-hook and Claude Code payloads (README).
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC1, allEvents, begin, cleanup, failureOf, heldOf, journeysOn, judgedAt, landing, runsOf, runStarted, shownHeld, shownRun, stopHub,
  J, UNIT, WAKE_LINE, type Ev, type Run, type StopSeen,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** The three turns, judged as they go: each stop's reading is asserted before the next turn, naming the stop. */
async function threeTurns(r: Run): Promise<void> {
  const { hub, s, clock } = r;
  const stops: StopSeen[] = [];
  const snaps: Record<string, string | undefined> = {};
  const runs = (e: readonly Ev[]) => runsOf(e, J).map((x) => shownRun(x, snaps)).join('; ') || 'none';
  for (let k = 1; k <= 3; k++) {
    await s.scheduled('/loop keep the cart total right');
    await s.editCart(k);
    if (k < 3) await s.wakeup(60);
    stops.push(await s.stop(`Pass ${k}: the cart rounds each line.`));
    const judged = await judgedAt(hub, s, k, stops[k - 1]);
    let events = judged.events;
    const stop = judged.stop;
    snaps[`S${k}`] = stop.snapshot;
    if (k < 3) {
      await landing();
      events = await allEvents(hub);
      console.log(`AC1 stop ${k}: line "${stops[k - 1]!.line}"; journeys: ${runs(events)}; held: ${shownHeld(events)}`);
      expect(journeysOn(events, stop.snapshot).map((x) => shownRun(x, snaps)), `stop ${k}: its turn scheduled the next wake-up in 60 s, so the 300 s journey waits for the loop: no journey may run on S${k}, where it would end stale`).toEqual([]);
      // Its reply comes when its fast-lane check ends: the hold records no slow time, and the check's run ended before it.
      const finished = events.find((e) => e.kind === 'run.finished' && events.some((x) => x.kind === 'run.started' && x.data.run === e.data.run && x.data.claim === stop.claim && x.data.check === UNIT));
      expect(finished, `stop ${k}: its fast-lane check ${UNIT} ran and ended`).toBeDefined();
      expect(stop.held, `stop ${k}: its held time is recorded (stop.held naming its claim)`).toBeDefined();
      expect(finished!.log_pos < stop.held!.log_pos, `stop ${k}: its reply comes once its fast-lane check has ended`).toBe(true);
      expect(stop.held!.data.slow, `stop ${k}: a loop's stop is held for its quick checks alone, so it records no slow hold: ${JSON.stringify(stop.held!.data)}`).toBe(0);
      expect(stops[k - 1]!.block, `stop ${k}: a green stop is no send-back`).toBeUndefined();
      expect(stops[k - 1]!.line, `stop ${k}: its line names the held journey and why`).toContain(WAKE_LINE);
      if (k === 2) {
        const first = heldOf(events, J, snaps.S1);
        expect(first, `stop 1: the journey's held place on S1 is in the record (check.held): ${shownHeld(events)}`).toBeDefined();
        expect(first!.replaced_by, `stop 2: the second snapshot takes the first's held place: ${shownHeld(events)}`).toBe(snaps.S2);
        expect(first!.started_at, 'stop 1: its held place never starts on S1').toBeNull();
      }
      // The next wake-up's prompt comes before its 60 s are up.
      await clock.pass(stops[k - 1]!.at + 55_000 - clock.now());
    } else {
      events = await runStarted(hub, stop.snapshot);
      console.log(`AC1 stop 3: line "${stops[2]!.line}"; journeys: ${runs(events)}; held: ${shownHeld(events)}`);
      const third = journeysOn(events, stop.snapshot);
      expect(third.map((x) => String(x.data.lane)), `stop 3: its turn scheduled no wake-up, so the loop has paused and its stop starts the 300 s journey on its own snapshot S3; journeys: ${runs(events)}`).toEqual(['slow']);
      expect(third[0]!.ts, 'stop 3: the journey starts once the stop has replied, not before').toBeGreaterThanOrEqual(stops[2]!.at);
      for (const n of [1, 2]) expect(journeysOn(events, snaps[`S${n}`]).map((x) => shownRun(x, snaps)), `stop ${n}: no journey ever runs on S${n}`).toEqual([]);
      const second = heldOf(events, J, snaps.S2);
      expect(second, `stop 2: the journey's held place on S2 is in the record (check.held): ${shownHeld(events)}`).toBeDefined();
      expect(second!.started_by, `stop 3: the second held place is started by the loop's pause: ${shownHeld(events)}`).toBe('loop_paused');
      expect(second!.started_at, 'stop 3: the second held place starts at stop 3').toBeGreaterThanOrEqual(stops[2]!.at);
      expect(heldOf(events, J, snaps.S1)?.replaced_by, `stop 1's held place stays replaced by S2: ${shownHeld(events)}`).toBe(snaps.S2);
    }
  }
}
async function scenario(plant?: string): Promise<void> {
  const r = await begin({ plant });
  try {
    await threeTurns(r);
  } finally {
    await stopHub(r.hub);
  }
}

describe(`${AC1} a /loop session's journey waits in its held place until the loop pauses`, () => {
  it(`${AC1} three scheduled turns: no journey on the first two snapshots, each line says it waits for the loop, the second takes the first's place, and the third stop starts it on its own snapshot`, async () => {
    await scenario();
  }, 420_000);
  it(`${AC1} (wrong program) the merge base's rule, turnEnded at every green stop (DEEP_HUB_PLANT=starts-on-every-green-stop), starts the journey at stop 1 and fails, naming the stop`, async () => {
    const failure = await failureOf(() => scenario('starts-on-every-green-stop'));
    expect(failure, 'a runner that starts the journey at every green stop must fail this test').not.toBeNull();
    expect(failure, 'the failure names the stop').toContain('stop 1');
  }, 420_000);
  it(`${AC1} (wrong program) a runner that holds every loop check (DEEP_HUB_PLANT=holds-every-loop-check) never starts the journey at stop 3 and fails, naming the stop`, async () => {
    const failure = await failureOf(() => scenario('holds-every-loop-check'));
    expect(failure, 'a runner that holds every loop check must fail this test').not.toBeNull();
    expect(failure, 'the failure names the stop').toContain('stop 3');
  }, 420_000);
});
