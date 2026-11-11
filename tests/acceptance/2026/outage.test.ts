// AC5: with Needs you showing three asks, the hub is stopped: within 2 s the menu bar, Home and Needs you say it isn't
// answering and since when, and on reconnect they show the record at the new `log_pos`; a view that shows nothing needs
// you, or keeps the old count as live, fails, naming the surface.
//
// The app is the real window on a real hub (#1546's `deep-live --view needs-you --watch`, the app's own record reader
// and tick, one line per frame, each with the window's snapshot and the menu bar's title: README, Pinned 1). Home is
// the list's Needs you heading, which reads the count (the issue's Reads under #1453); Needs you is the list's section
// below it. Three asks are seeded through the real record and asks core; the hub is stopped by its PID; while it is
// down the core cancels one of them in the record, so the record the hub serves when it starts again holds two, at a
// new `log_pos`. Times are this Mac's wall clock: the stop from the signal, each frame from the line it wrote.
import { afterAll, describe, expect, it } from 'vitest';
import {
  appBins, askAndClose, backFailures, cancelWhileDown, cleanup, clocksBetween, deepHook, downFailures, eventsOf, homeNumbers, hubOf, ID, inconclusive,
  logPos, makeHome, MINUTE, needCli, numberIn, openAsks, PLANT, SECOND, seed, shownIn, stopHub, timingProblem, Watch, type Hub,
} from './helpers.ts';

afterAll(cleanup, 5 * MINUTE);

const LIMIT_MS = 2 * SECOND;
/** How long after the stop the surfaces are watched for what they say. */
const WATCHED_MS = 15 * SECOND;

interface Outcome { down: string[]; back: string[]; downMs?: number }

/** The issue's scenario with the app built plain, or with `plant`: what each surface got wrong while the hub was down and once it was back. */
async function scenario(plant?: string): Promise<Outcome> {
  needCli();
  const [built] = await Promise.all([appBins(), deepHook()]);
  const home = makeHome();
  const asks: string[] = [];
  await seed(home, async (s) => {
    await s.start('outage');
    for (const n of [1, 2, 3]) asks.push((await askAndClose(s, 'outage', `Outage ${n}: keep the sessions on SQLite or plain files?`)).ask);
  });
  let hub: Hub | undefined = await hubOf(home);
  let watch: Watch | undefined;
  try {
    const before = openAsks(await eventsOf(hub));
    if (before.open.size !== 3) throw Error(`BLOCKED: the seeded record holds ${before.open.size} open asks, not three`);
    watch = await Watch.start((plant ? built.plants : built.plain).live, home, plant);
    const three = await watch.first((f) => {
      const s = shownIn(f);
      return numberIn(s.menuBar) === 3 && homeNumbers(s.home).join() === '3' && s.rows.length === 3;
    }, 0, 2 * MINUTE);
    if (!three) {
      const last = watch.last();
      return { down: [`Needs you never showed the three asks before the hub stopped: ${JSON.stringify(last ? shownIn(last) : null)}`], back: [] };
    }

    // The hub stops.
    const stopped = Date.now();
    await stopHub(hub);
    hub = undefined;
    const clocks = clocksBetween(stopped, stopped + LIMIT_MS);
    const said = await watch.first((f) => downFailures(shownIn(f), clocks).length === 0, stopped, WATCHED_MS);
    const down: string[] = [];
    if (!said) {
      const last = watch.last()!;
      down.push(...downFailures(shownIn(last), clocks).map((d) => `${d} (the last frame, ${last.at - stopped} ms after the stop)`));
    }
    // No frame of the outage says nothing needs you, on any surface.
    for (const f of watch.frames().filter((frame) => frame.at >= stopped)) {
      const s = shownIn(f);
      for (const [surface, words] of [['the menu bar', [s.menuBar]], ['Home', s.home?.words ?? []], ['Needs you', s.section]] as const) {
        const nothing = words.find((w) => /nothing needs you/i.test(w));
        if (nothing && !down.some((d) => d.startsWith(`${surface} says nothing needs you`))) down.push(`${surface} says nothing needs you while the hub isn't answering: ${JSON.stringify(nothing)} (${f.at - stopped} ms after the stop)`);
      }
    }

    // While it is down, the record moves; then the hub starts and the app reconnects.
    await cancelWhileDown(home, 'outage', asks[0]!);
    const restarted = Date.now();
    hub = await hubOf(home);
    const now = await logPos(hub);
    const after = openAsks(await eventsOf(hub));
    const backAt = await watch.first((f) => backFailures(f, shownIn(f), after, now).length === 0, restarted, 2 * MINUTE);
    const last = watch.last()!;
    const back = backAt ? [] : backFailures(last, shownIn(last), after, now).map((b) => `${b} (the last frame, ${last.at - restarted} ms after the hub started again)`);
    return { down, back, ...(said ? { downMs: said.at - stopped } : {}) };
  } finally {
    await watch?.stop();
    if (hub) await stopHub(hub);
  }
}

let clean: Outcome | undefined;
const cleanRun = async (): Promise<Outcome> => (clean ??= await scenario());
const failuresOf = (o: Outcome): string[] => [...o.down.map((d) => `while the hub is down: ${d}`), ...o.back.map((b) => `once it's back: ${b}`)];

describe(`#2026 AC5 ${ID.outage}`, () => {
  it('within 2 s of the hub stopping, the menu bar, Home and Needs you say it isn\'t answering and since when; on reconnect they show the record at the new log_pos', async () => {
    const outcome = await cleanRun();
    expect(failuresOf(outcome)).toEqual([]);
    const reading = `every surface said the hub isn't answering, and since when, ${outcome.downMs!.toFixed(0)} ms after the stop (limit ${LIMIT_MS})`;
    console.log(`#2026 AC5: ${reading}`);
    if (outcome.downMs! <= LIMIT_MS) return;
    const problem = timingProblem();
    if (problem) inconclusive(`${problem}; ${reading}`);
    expect.fail(`the surfaces said the hub isn't answering later than 2 s after it stopped: ${reading}`);
  }, 60 * MINUTE);

  it(`a Needs you that shows nothing needs you while the hub is down (${PLANT.downNothing}) fails, naming Needs you`, async () => {
    expect(failuresOf(await cleanRun()), 'the clean run already fails AC5, so the plant can\'t be told from it').toEqual([]);
    const failures = failuresOf(await scenario(PLANT.downNothing));
    expect(failures.filter((f) => f.startsWith('while the hub is down: Needs you')), `the Needs you that shows nothing needs you wasn't caught, naming Needs you: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, 60 * MINUTE);

  it(`a menu bar that keeps the old count as live (${PLANT.downKeepsCount}) fails, naming the menu bar`, async () => {
    expect(failuresOf(await cleanRun()), 'the clean run already fails AC5, so the plant can\'t be told from it').toEqual([]);
    const failures = failuresOf(await scenario(PLANT.downKeepsCount));
    expect(failures.filter((f) => f.startsWith('while the hub is down: the menu bar')), `the menu bar that keeps the old count wasn't caught, naming the menu bar: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, 60 * MINUTE);
});
