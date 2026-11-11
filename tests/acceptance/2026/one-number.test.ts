// AC4: a replica fixture with each close kind (applied by a decision, answered, defaulted, escalated, cancelled,
// superseded, moot), a folded exception, a later ask and a held ask shows one number in the menu bar, on Home and in
// `deep inbox`, and the rows Needs you lists add up to it; a planted count that leaves out a decision's close, or
// counts sessions, fails, naming the surface.
//
// The fixture (helpers.ts `closeKinds`) is a record seeded through the real record and asks core with the hub
// stopped; a real hub then serves it. The app's first screen over that hub (#1002's `deep-replica --first-screen`)
// gives the menu bar's title, Home's count (the list's Needs you heading, the issue's Reads under #1453) and the rows
// Needs you lists; the real `deep inbox` its count and rows. Each must be the record's open asks (helpers.ts
// `openAsks`). The plants are the app's, selected with DEEP_HUB_PLANT in an `env-plants` build (README, Pinned).
import { afterAll, describe, expect, it } from 'vitest';
import {
  appBins, cleanup, closeKinds, deepHook, eventsOf, FIXTURE_SESSIONS, firstScreen, hubOf, ID, inbox, makeHome, MINUTE, needCli, oneNumberFailures, openAsks,
  PLANT, stopHub, surfaces, type Hub,
} from './helpers.ts';

let world: Promise<{ home: string; hub: Hub; record: ReturnType<typeof openAsks>; inbox: Awaited<ReturnType<typeof inbox>> }> | undefined;
/** The fixture's hub, started once for the file. */
function fixture(): NonNullable<typeof world> {
  world ??= (async () => {
    needCli();
    await deepHook();
    const home = makeHome();
    await closeKinds(home);
    const hub = await hubOf(home);
    const record = openAsks(await eventsOf(hub));
    return { home, hub, record, inbox: await inbox(home) };
  })();
  return world;
}
afterAll(async () => {
  if (world) await world.then((w) => stopHub(w.hub), () => undefined);
  await cleanup();
}, 5 * MINUTE);

/** The fixture as the app shows it, by the plain build or, with `plant`, the planted one; what's wrong, each naming its surface. */
async function judged(plant?: string): Promise<string[]> {
  const [w, built] = await Promise.all([fixture(), appBins()]);
  const shot = await firstScreen((plant ? built.plants : built.plain).replica, w.home, plant);
  return oneNumberFailures({ surfaces: surfaces(shot.snapshot), inbox: w.inbox }, w.record);
}
let clean: string[] | undefined;
const cleanRun = async (): Promise<string[]> => (clean ??= await judged());

describe(`#2026 AC4 ${ID.oneNumber}`, () => {
  it('the fixture shows one number in the menu bar, on Home and in deep inbox, and the rows Needs you lists add up to it', async () => {
    const w = await fixture();
    // The fixture is what the issue names: every close kind, a fold, a later ask and a held ask, eleven left open.
    const kinds = new Set(w.record.closed.values());
    expect([...kinds].sort(), 'the fixture closes an ask each way the issue names').toEqual(['ask.answered', 'ask.cancelled', 'ask.defaulted', 'ask.escalated', 'ask.moot', 'ask.superseded', 'decision.applied']);
    expect(w.record.open.size, 'the fixture leaves eleven asks open').toBe(11);
    expect(await cleanRun()).toEqual([]);
  }, 120 * MINUTE);

  it(`a planted count that leaves out a decision's close (${PLANT.skipsDecision}) fails, naming Home`, async () => {
    expect(await cleanRun(), 'the clean run already fails AC4, so the plant can\'t be told from it').toEqual([]);
    const failures = await judged(PLANT.skipsDecision);
    expect(failures.filter((f) => f.startsWith('Home')), `the planted count that leaves out a decision's close wasn't caught, naming Home: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, 120 * MINUTE);

  it(`a planted count that counts sessions (${PLANT.countsSessions}) fails, naming the menu bar`, async () => {
    expect(await cleanRun(), 'the clean run already fails AC4, so the plant can\'t be told from it').toEqual([]);
    const w = await fixture();
    expect(FIXTURE_SESSIONS, 'the fixture has fewer sessions than open asks, so a count of sessions can\'t pass for one of asks').toBeLessThan(w.record.open.size);
    const failures = await judged(PLANT.countsSessions);
    expect(failures.filter((f) => f.startsWith('the menu bar')), `the planted count of sessions wasn't caught, naming the menu bar: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, 120 * MINUTE);
});
