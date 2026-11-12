// AC1: Needs you loads in under a second with 30 days of history (the design's Numbers: "The app: Inbox loaded in
// under 1 second, with 30 days of history"). The history is #26's heavy month, seeded through the real record and
// asks core with the hub stopped: 30 days of 20 sessions, each with its start, five asks, a decision and an open item,
// the asks past their deadlines defaulted, so the last day's stay open. A real hub then serves it, and the app's first
// screen over that hub (#1002's `deep-replica --first-screen`, the app's own reader and views) is timed from its
// spawn to the line it prints once its first frame is drawn. A load counts only once that screen's Needs you holds
// the record: its count the record's open asks and its rows among them, never "reading" or empty.
import { afterAll, describe, expect, it } from 'vitest';
import {
  appBins, cleanup, deepHook, eventsOf, firstScreen, homeNumbers, hubOf, ID, inconclusive, makeHome, MINUTE, needCli, openAsks, seed, seedMonth,
  stopHub, surfaces, timingProblem,
} from './helpers.ts';

afterAll(cleanup, 5 * MINUTE);

const LIMIT_MS = 1000;
/** Timed launches, after one that isn't timed: macOS checks a new binary at its first exec. */
const RUNS = 5;

describe(`#2026 AC1 ${ID.load}`, () => {
  it('Needs you loads in under a second with 30 days of history', async () => {
    needCli();
    const [{ plain }] = await Promise.all([appBins(), deepHook()]);
    const home = makeHome();
    await seed(home, (s) => seedMonth(s, '/work/shop', 'ledger'));
    const hub = await hubOf(home);
    try {
      expect(openAsks(await eventsOf(hub)).open.size, 'the month leaves its last day\'s asks open').toBeGreaterThan(0);
      await firstScreen(plain.replica, home);
      const runs: number[] = [];
      const open: number[] = [];
      for (let n = 0; n < RUNS; n++) {
        // The last day's asks reach their deadlines while this runs, and the hub defaults them: the record is read on
        // each side of a launch, and the count it shows must be one the record held between the two.
        const before = openAsks(await eventsOf(hub));
        const shot = await firstScreen(plain.replica, home);
        const after = openAsks(await eventsOf(hub));
        const shown = surfaces(shot.snapshot);
        const count = homeNumbers(shown.home);
        const held = `the record held ${before.open.size === after.open.size ? before.open.size : `${before.open.size} to ${after.open.size}`} open asks`;
        expect(count.length === 1 && count[0]! <= before.open.size && count[0]! >= after.open.size, `launch ${n + 1}: the first screen's Needs you hasn't loaded the record (${held}): ${JSON.stringify(shown.home ?? null)}`).toBe(true);
        expect(shown.rows.length, `launch ${n + 1}: the first screen's Needs you draws no row of the open asks (${held})`).toBeGreaterThan(0);
        expect(shown.rows.filter((id) => !before.open.has(id)), `launch ${n + 1}: Needs you draws rows the record holds no open ask for`).toEqual([]);
        runs.push(shot.firstFrameMs);
        open.push(count[0]!);
      }
      const reading = `${open.join(', ')} open asks among 30 days of history; ms from spawn to the first frame, with Needs you read: ${runs.map((ms) => ms.toFixed(0)).join(', ')} (limit ${LIMIT_MS})`;
      console.log(`#2026 AC1: ${reading}`);
      if (Math.max(...runs) <= LIMIT_MS) return;
      const problem = timingProblem();
      if (problem) inconclusive(`${problem}; ${reading}`);
      expect.fail(`Needs you took more than a second to load with 30 days of history: ${reading}`);
    } finally {
      await stopHub(hub);
    }
  }, 180 * MINUTE);
});
