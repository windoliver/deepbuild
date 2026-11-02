// #965 AC3: a green stop in a turn whose cron job is next due in 15 minutes starts the 300 s journey when its
// fast-lane check ends, since the journey ends before the cron's next prompt, and holds a 20-minute check, whose line
// names the cron. The turn starts from a `scheduled` prompt, changes src/cart.ts and creates the cron job (CronCreate,
// its response's nextFireAt 15 minutes on). Through the real hub, deep-hook and Claude Code payloads (README).
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC3, allEvents, begin, cleanup, CRON_LINE, failureOf, heldOf, J, journeysOn, judgedAt, landing, MINUTE, runsOf, runStarted, shownHeld, shownRun, SOAK, stopHub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

async function scenario(plant?: string): Promise<void> {
  const { hub, s, clock } = await begin({ plant, world: { soak: true } });
  try {
    await s.scheduled('/loop keep the cart total right');
    await s.editCart(1);
    await s.cron(clock.now() + 15 * MINUTE);
    const stop = await s.stop('Pass 1: the cart rounds each line.');
    const S1 = (await judgedAt(hub, s, 1, stop)).stop.snapshot;
    let events = await runStarted(hub, S1);
    await landing();
    events = await allEvents(hub);
    const snaps = { S1 };
    const shown = (check: string) => runsOf(events, check).map((x) => shownRun(x, snaps)).join('; ') || 'none';
    console.log(`AC3: line "${stop.line}"; ${J}: ${shown(J)}; ${SOAK}: ${shown(SOAK)}; held: ${shownHeld(events)}`);
    const journey = journeysOn(events, S1);
    expect(journey.map((x) => String(x.data.lane)), `${J}: the cron job is next due in 15 minutes, after the 300 s journey would end, so the loop pauses for it and the stop starts it when its fast-lane check ends; ${J} runs: ${shown(J)}`).toEqual(['slow']);
    expect(journey[0]!.ts, `${J}: it starts when the stop's fast-lane check ends, within seconds of the reply`).toBeLessThanOrEqual(stop.repliedAt + 15_000);
    expect(journeysOn(events, S1, SOAK).map((x) => shownRun(x, snaps)), `${SOAK}: the 20-minute check would end after the cron's next prompt, 15 minutes on, so it is held for the loop and must not start`).toEqual([]);
    const held = heldOf(events, SOAK, S1);
    expect(held, `${SOAK}: its held place is in the record (check.held): ${shownHeld(events)}`).toBeDefined();
    expect(held!.reason, `${SOAK}: held for the cron`).toContain('cron');
    expect(held!.started_at, `${SOAK}: its held place has not started`).toBeNull();
    expect(heldOf(events, J, S1), `${J}: the journey started at the stop, so it was never held: ${shownHeld(events)}`).toBeUndefined();
    expect(stop.line, 'the line names the held check and the cron it waits for').toContain(CRON_LINE);
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC3} a cron job due in 15 minutes lets the 300 s journey start and holds a 20-minute check`, () => {
  it(`${AC3} the stop starts the journey when its fast-lane check ends and holds the 20-minute check, whose line names the cron`, async () => {
    await scenario();
  }, 300_000);
  it(`${AC3} (wrong program) a runner that holds every loop check (DEEP_HUB_PLANT=holds-every-loop-check) leaves the journey unrun and fails, naming the check`, async () => {
    const failure = await failureOf(() => scenario('holds-every-loop-check'));
    expect(failure, 'a runner that holds every loop check must fail this test').not.toBeNull();
    expect(failure, 'the failure names the check').toContain(J);
  }, 300_000);
});
