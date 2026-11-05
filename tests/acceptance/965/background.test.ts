// #965 AC5: a Claude Code session runs `npm run e2e` through Bash with `run_in_background: true` and ends its turn
// green (a turn you typed, after the one that opened the ask): the journey is held, and its line says it waits for the command. When the command's process group ends at 4
// minutes with the session idle, the journey starts then. In a twin the command never ends: the journey starts 30
// minutes after the stop, the session's row names `npm run e2e` as still running, and the command's process is still
// alive afterwards. In a third twin the end notice wakes the agent at 20 minutes, and that turn starts another
// background command and ends green: its snapshot takes the place, and its journey starts 30 minutes after that stop,
// at 50 minutes. Through the real hub, deep-hook and Claude Code payloads, minutes passing on the hub's stepped clock
// (README, Surfaces: test.clock).
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC5, alive, allEvents, begin, cleanup, E2E, E2E_LINE, failureOf, heldOf, J, journeysOn, judgedAt, landing, MINUTE, readingsOf, runsOf, runStarted, SECOND,
  shownHeld, shownRun, stopHub, type Ev, type Run, type StopSeen,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** Your prompt for the turn: a question, so it opens no task of its own; the turn works the ask you opened before. */
const PROMPT = 'Is the rounding right yet? Run the e2e suite in the background to see.';
/**
 * The turn after the opening one: you type PROMPT; the agent changes src/cart.ts, starts `npm run e2e` in the
 * background and stops green.
 */
async function firstTurn(plant?: string): Promise<{ r: Run; stop: StopSeen; S1: string | undefined; call: string; group: number }> {
  const r = await begin({ plant });
  try {
    await r.s.typed(PROMPT);
    await r.s.editCart(1);
    const { call, group } = await r.s.background(E2E);
    const stop = await r.s.stop(`The cart rounds each line; \`${E2E}\` runs in the background.`);
    const S1 = (await judgedAt(r.hub, r.s, 1, stop)).stop.snapshot;
    await landing();
    const events = await allEvents(r.hub);
    console.log(`AC5 stop 1: line "${stop.line}"; journeys: ${runsOf(events, J).map((x) => shownRun(x, { S1 })).join('; ') || 'none'}; held: ${shownHeld(events)}`);
    expect(stop.line, `stop 1: its line names the held journey and the command it waits for`).toContain(E2E_LINE);
    expect(journeysOn(events, S1).map((x) => shownRun(x, { S1 })), `stop 1: \`${E2E}\` still runs in the background, so the 300 s journey is held at the stop`).toEqual([]);
    return { r, stop, S1, call, group };
  } catch (error) {
    await stopHub(r.hub);
    throw error;
  }
}
/** Lets the hub's clock reach `at`. */
const until = (r: Run, at: number): Promise<void> => r.clock.pass(at - r.clock.now());
const shown = (events: readonly Ev[], snaps: Record<string, string | undefined>) => runsOf(events, J).map((x) => shownRun(x, snaps)).join('; ') || 'none';

async function groupEnds(plant?: string): Promise<void> {
  const { r, stop, S1, group } = await firstTurn(plant);
  try {
    await until(r, stop.at + 3.5 * MINUTE);
    expect(journeysOn(await allEvents(r.hub), S1).map((x) => shownRun(x, { S1 })), `stop 1: the journey stays held while \`${E2E}\` runs, 3.5 minutes on`).toEqual([]);
    await until(r, stop.at + 4 * MINUTE);
    process.kill(-group, 'SIGTERM');
    const endedAt = r.clock.now();
    const events = await runStarted(r.hub, S1, 30_000);
    console.log(`AC5 process group ended at 4 minutes: journeys: ${shown(events, { S1 })}; held: ${shownHeld(events)}`);
    const journey = journeysOn(events, S1);
    expect(journey.map((x) => String(x.data.lane)), `stop 1: \`${E2E}\`'s process group ended at 4 minutes with the session idle, so the session's facts emptied and the journey starts then, not at the next stop or the cap; journeys: ${shown(events, { S1 })}`).toEqual(['slow']);
    expect(journey[0]!.ts, 'stop 1: the journey starts once the process group has ended').toBeGreaterThanOrEqual(stop.at + 4 * MINUTE);
    expect(journey[0]!.ts, 'stop 1: the journey starts within seconds of the process group ending').toBeLessThanOrEqual(endedAt + 30 * SECOND);
    const held = heldOf(events, J, S1);
    expect(held?.started_by, `stop 1: its held place was started by the loop's pause: ${shownHeld(events)}`).toBe('loop_paused');
    expect(held!.started_at, 'stop 1: when the process group ended').toBeGreaterThanOrEqual(stop.at + 4 * MINUTE);
  } finally {
    await stopHub(r.hub);
  }
}

async function neverEnds(plant?: string): Promise<void> {
  const { r, stop, S1, group } = await firstTurn(plant);
  try {
    await until(r, stop.at + 29.5 * MINUTE);
    expect(journeysOn(await allEvents(r.hub), S1).map((x) => shownRun(x, { S1 })), `stop 1: the journey stays held while \`${E2E}\` runs, 29.5 minutes on`).toEqual([]);
    await until(r, stop.at + 30.5 * MINUTE);
    const events = await runStarted(r.hub, S1, 30_000);
    console.log(`AC5 command never ends, 30.5 minutes on: journeys: ${shown(events, { S1 })}; held: ${shownHeld(events)}; row: ${JSON.stringify(readingsOf(events, r.s))}`);
    const journey = journeysOn(events, S1);
    expect(journey.map((x) => String(x.data.lane)), `stop 1: background work holds a stop's slow checks at most 30 minutes from that stop, so the journey must not be left pending past 30 minutes; journeys: ${shown(events, { S1 })}`).toEqual(['slow']);
    expect(journey[0]!.ts, 'stop 1: the journey starts 30 minutes after the stop, not before').toBeGreaterThanOrEqual(stop.at + 30 * MINUTE);
    expect(journey[0]!.ts, 'stop 1: the journey starts at the 30 minutes, not long after').toBeLessThanOrEqual(stop.at + 30.5 * MINUTE + 30 * SECOND);
    const row = readingsOf(events, r.s).filter((x) => x.includes(E2E) && /still running/i.test(x));
    expect(row.length, `the session's row names \`${E2E}\` as still running once the 30 minutes are up: ${JSON.stringify(readingsOf(events, r.s))}`).toBeGreaterThan(0);
    expect(alive(group), `DeepBuild never stops background work: \`${E2E}\`'s process (group ${group}) is still alive after the journey started`).toBe(true);
    expect(heldOf(events, J, S1)?.started_by, `stop 1: its held place was started by the cap: ${shownHeld(events)}`).toBe('cap');
  } finally {
    await stopHub(r.hub);
  }
}

async function wokenAt20(plant?: string): Promise<void> {
  const { r, stop: first, S1, call, group } = await firstTurn(plant);
  const { s, hub } = r;
  try {
    // The end notice wakes the agent at 20 minutes; that turn starts the command again in the background and ends green.
    await until(r, first.at + 20 * MINUTE);
    await s.notice(call, E2E);
    process.kill(-group, 'SIGTERM');
    await s.editCart(2);
    await s.background(E2E);
    const second = await s.stop(`The cart rounds three-line orders too; \`${E2E}\` runs again in the background.`);
    const S2 = (await judgedAt(hub, s, 2, second)).stop.snapshot;
    const snaps = { S1, S2 };
    await landing();
    let events = await allEvents(hub);
    console.log(`AC5 woken at 20 minutes, stop 2: line "${second.line}"; journeys: ${shown(events, snaps)}; held: ${shownHeld(events)}`);
    expect(second.line, 'stop 2: its line names the held journey and the command it waits for').toContain(E2E_LINE);
    expect(heldOf(events, J, S1)?.replaced_by, `stop 2: its snapshot takes the held place of stop 1's: ${shownHeld(events)}`).toBe(S2);
    await until(r, first.at + 30.5 * MINUTE);
    events = await allEvents(hub);
    expect(runsOf(events, J).map((x) => shownRun(x, snaps)), `stop 2: the newer stop took the place and gets 30 minutes of its own, so nothing starts 30 minutes after stop 1`).toEqual([]);
    await until(r, second.at + 29.5 * MINUTE);
    expect(runsOf(await allEvents(hub), J).map((x) => shownRun(x, snaps)), `stop 2: the journey stays held 29.5 minutes after stop 2`).toEqual([]);
    await until(r, second.at + 30.5 * MINUTE);
    events = await runStarted(hub, S2, 30_000);
    console.log(`AC5 woken at 20 minutes, 50.5 minutes on: journeys: ${shown(events, snaps)}; held: ${shownHeld(events)}`);
    const journey = journeysOn(events, S2);
    expect(journey.map((x) => String(x.data.lane)), `stop 2: its journey starts 30 minutes after stop 2, at 50 minutes, on its snapshot S2; journeys: ${shown(events, snaps)}`).toEqual(['slow']);
    expect(journey[0]!.ts, 'stop 2: not before 30 minutes after stop 2').toBeGreaterThanOrEqual(second.at + 30 * MINUTE);
    expect(journey[0]!.ts - first.at, 'stop 2: at 50 minutes from stop 1').toBeGreaterThanOrEqual(50 * MINUTE);
    expect(journey[0]!.ts, 'stop 2: at the 30 minutes, not long after').toBeLessThanOrEqual(second.at + 30.5 * MINUTE + 30 * SECOND);
    expect(journeysOn(events, S1).map((x) => shownRun(x, snaps)), 'stop 1: no journey ever runs on S1').toEqual([]);
    expect(heldOf(events, J, S2)?.started_by, `stop 2: its held place was started by the cap: ${shownHeld(events)}`).toBe('cap');
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC5} background work holds a stop's slow checks until it ends, at most 30 minutes from that stop`, () => {
  it(`${AC5} the journey is held while \`npm run e2e\` runs in the background, and starts when its process group ends at 4 minutes with the session idle`, async () => {
    await groupEnds();
  }, 300_000);
  it(`${AC5} (twin) the command never ends: the journey starts 30 minutes after the stop, the row names \`npm run e2e\` as still running, and its process is still alive`, async () => {
    await neverEnds();
  }, 300_000);
  it(`${AC5} (twin) the end notice wakes the agent at 20 minutes and that turn runs the command again: its snapshot takes the place, and its journey starts 30 minutes after that stop, at 50 minutes`, async () => {
    await wokenAt20();
  }, 300_000);
  it(`${AC5} (wrong program) a runner with no limit (DEEP_HUB_PLANT=holds-background-without-limit) leaves the journey pending past 30 minutes and fails, naming the stop`, async () => {
    const failure = await failureOf(() => neverEnds('holds-background-without-limit'));
    expect(failure, 'a runner with no limit must fail this test').not.toBeNull();
    expect(failure, 'the failure names the stop').toContain('stop 1');
    expect(failure, 'and that the journey was left pending past 30 minutes').toContain('pending past 30 minutes');
  }, 300_000);
  it(`${AC5} (wrong program) a runner that times the cap from the first stop (DEEP_HUB_PLANT=caps-from-first-stop) starts the third twin's journey at 30 minutes and fails, naming the stop`, async () => {
    const failure = await failureOf(() => wokenAt20('caps-from-first-stop'));
    expect(failure, 'a runner that times the cap from the first stop must fail this test').not.toBeNull();
    expect(failure, 'the failure names the stop').toContain('stop 2');
  }, 300_000);
  it(`${AC5} (wrong program) a runner that rechecks facts only at stops (DEEP_HUB_PLANT=rechecks-facts-at-stops-only) holds the first twin's journey until the cap and fails, naming the stop`, async () => {
    const failure = await failureOf(() => groupEnds('rechecks-facts-at-stops-only'));
    expect(failure, 'a runner that rechecks facts only at stops must fail this test').not.toBeNull();
    expect(failure, 'the failure names the stop').toContain('stop 1');
  }, 300_000);
});
