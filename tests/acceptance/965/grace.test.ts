// #965 AC4: a turn another session's message started (origin `session`) ends green, and no automatic prompt comes
// by 60 s after its reply: the journey starts at 60 s, and its verdict reaches the session at its next prompt. In a
// twin the next message comes at 40 s, its turn changes src/cart.ts, and no journey starts on the first snapshot.
// Through the real hub, deep-hook and Claude Code payloads (README).
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC4, allEvents, begin, cleanup, failureOf, journeysOn, judgedAt, landing, parseLine, runsOf, runStarted, SECOND, settle, shownHeld, shownRun, stopHub, J,
  type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** Another session's message, as Claude Code delivers it: an automatic prompt nobody typed here. */
const MESSAGE = 'From the pricing session: the cart total is off by a cent on three-line orders.';
/** Your next prompt: a question, so it opens no task. */
const QUESTION = 'what does the cart show for an empty order?';

async function noPrompt(plant?: string): Promise<void> {
  // The journey here really ends, a few seconds after it starts, so its verdict is made.
  const { hub, s, clock } = await begin({ plant, world: { journeyRealMs: 3000 } });
  try {
    await s.peer(MESSAGE);
    await s.editCart(1);
    const stop = await s.stop('Fixed the three-line rounding.');
    const judged = (await judgedAt(hub, s, 1, stop)).stop;
    const S1 = judged.snapshot;
    const snaps = { S1 };
    const runs = (e: readonly Ev[]) => runsOf(e, J).map((x) => shownRun(x, snaps)).join('; ') || 'none';
    await clock.pass(50 * SECOND - (clock.now() - stop.repliedAt));
    let events = await allEvents(hub);
    console.log(`AC4 no prompt, 50 s after the reply: line "${stop.line}"; journeys: ${runs(events)}; held: ${shownHeld(events)}`);
    expect(journeysOn(events, S1).map((x) => shownRun(x, snaps)), 'stop 1: a turn another session\'s message started may be followed by another prompt nothing foresees, so the 300 s journey waits through the 60 s grace window: none may start in its first 50 s').toEqual([]);
    await clock.pass(15 * SECOND);
    events = await runStarted(hub, S1, 30_000);
    console.log(`AC4 no prompt, 65 s after the reply: journeys: ${runs(events)}; held: ${shownHeld(events)}`);
    const journey = journeysOn(events, S1);
    expect(journey.map((x) => String(x.data.lane)), `stop 1: no automatic prompt came by 60 s after its reply, so the loop has paused and the journey starts then, on S1; journeys: ${runs(events)}`).toEqual(['slow']);
    expect(journey[0]!.ts - stop.repliedAt, 'stop 1: the journey starts 60 s after the reply, not before').toBeGreaterThanOrEqual(60 * SECOND - 1000);
    expect(journey[0]!.ts - stop.repliedAt, 'stop 1: the journey starts at the end of the 60 s grace window, not long after').toBeLessThanOrEqual(65 * SECOND + 25 * SECOND);
    // The journey passes; its verdict reaches the session at its next prompt.
    const claim = judged.claim;
    events = await settle(hub, (e) => e.some((x) => x.kind === 'verdict.made' && x.subject === claim && x.data.outcome === 'PASS'), 60_000);
    expect(events.filter((x) => x.kind === 'verdict.made' && x.subject === claim).map((x) => String(x.data.outcome)), `stop 1: once the journey has run, the claim's verdict is made: ${runs(events)}`).toContain('PASS');
    const next = await s.typed(QUESTION);
    const context = String(parseLine(next.stdout)?.hookSpecificOutput?.additionalContext ?? '');
    expect(context, `stop 1: the verdict reaches the session at its next prompt: its reply carries the line; it said ${JSON.stringify(next.stdout.slice(0, 600))}`).toContain('PASS');
  } finally {
    await stopHub(hub);
  }
}

async function promptAt40(plant?: string): Promise<void> {
  const { hub, s, clock } = await begin({ plant });
  try {
    await s.peer(MESSAGE);
    await s.editCart(1);
    const first = await s.stop('Fixed the three-line rounding.');
    const S1 = (await judgedAt(hub, s, 1, first)).stop.snapshot;
    await clock.pass(40 * SECOND - (clock.now() - first.repliedAt));
    await s.peer('From the pricing session: two-line orders are off too.');
    await s.editCart(2);
    const second = await s.stop('Fixed two-line orders too.');
    const S2 = (await judgedAt(hub, s, 2, second)).stop.snapshot;
    await clock.pass(70 * SECOND - (clock.now() - first.repliedAt));
    await landing();
    const events = await allEvents(hub);
    const snaps = { S1, S2 };
    console.log(`AC4 next message at 40 s: journeys: ${runsOf(events, J).map((x) => shownRun(x, snaps)).join('; ') || 'none'}; held: ${shownHeld(events)}`);
    expect(journeysOn(events, S1).map((x) => shownRun(x, snaps)), 'stop 1: the next message came 40 s after its reply, inside the grace window, and its turn changed src/cart.ts, so no journey may start on the first snapshot').toEqual([]);
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC4} a turn no fact foresees the next prompt of waits the 60 s grace window`, () => {
  it(`${AC4} a turn another session's message started ends green; no automatic prompt by 60 s after its reply, and the journey starts at 60 s; its verdict reaches the session at its next prompt`, async () => {
    await noPrompt();
  }, 420_000);
  it(`${AC4} (twin) the next message comes at 40 s and its turn changes src/cart.ts: no journey starts on the first snapshot`, async () => {
    await promptAt40();
  }, 420_000);
  it(`${AC4} (wrong program) a runner with no grace timer (DEEP_HUB_PLANT=no-grace-window) never starts the first journey and fails, naming the stop`, async () => {
    const failure = await failureOf(() => noPrompt('no-grace-window'));
    expect(failure, 'a runner with no grace timer must fail this test').not.toBeNull();
    expect(failure, 'the failure names the stop').toContain('stop 1');
  }, 420_000);
  it(`${AC4} (wrong program) a runner that starts the journey at the stop (DEEP_HUB_PLANT=starts-on-every-green-stop) runs the twin's and fails, naming the stop`, async () => {
    const failure = await failureOf(() => promptAt40('starts-on-every-green-stop'));
    expect(failure, 'a runner that starts the journey at the stop must fail this test').not.toBeNull();
    expect(failure, 'the failure names the stop').toContain('stop 1');
  }, 420_000);
});
