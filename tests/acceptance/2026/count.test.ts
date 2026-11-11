// AC2: Needs you never leaves out an open ask: its count always matches the record's open asks. A property over
// generated records, each seeded through the real record and asks core with the hub stopped, from a recorded seed:
// sessions whose asks are left open, answered, applied by a decision, defaulted (some undone again), escalated,
// cancelled, superseded, made moot, cancelled by an agent's hook (which closes nothing), put off with Later, held for a
// message the agent hasn't read, and folded into an exception. For each, a real hub serves the record; the app's first
// screen over it (#1002's `deep-replica --first-screen`) gives Needs you's rows, Home's count (the list's Needs you
// heading) and the menu bar's, and `deep inbox` gives its own; each must be the record's open asks, which this suite
// reads from the hub's log by the design's close rule (helpers.ts `openAsks`). The judge is then held to the first
// record with its oldest open ask taken out of Needs you's rows, so a judge that passes anything can't pass here.
import { afterAll, describe, expect, it } from 'vitest';
import { mulberry32 } from '../16/helpers.ts';
import {
  appBins, askAndClose, cleanup, deepHook, eventsOf, firstScreen, hubOf, ID, inbox, later, makeHome, MINUTE, needCli, oneNumberFailures, openAsks, seed,
  stopHub, surfaces, typed, type Close,
} from './helpers.ts';

afterAll(cleanup, 5 * MINUTE);

/** The recorded seed and how many records: each stream's seed is SEED + its index, named in its failures. */
const SEED = 2026;
const STREAMS = 5;
/** What becomes of each ask; `undefined` leaves it open. */
const FATES: (Close | 'later' | undefined)[] = [undefined, undefined, undefined, 'answered', 'decision', 'defaulted', 'undone-default', 'escalated', 'cancelled', 'superseded', 'moot', 'agent-cancel', 'later'];

interface Plan { name: string; typed: boolean; asks: (Close | 'later' | undefined)[] }
/**
 * One record's sessions: every fate once, in an order of the seed's, dealt into sessions of one to four asks, about a
 * third of them typed to first so their asks are held. No session reaches the fold by accident (a decision's close raises
 * one more ask, closed at once); every other record adds a session of six asks left open, which folds its sixth into an
 * exception. At most fourteen open asks, so every row fits the first screen's list.
 */
function plan(seed: number): Plan[] {
  const rng = mulberry32(Math.imul(seed, 2654435761) >>> 0);
  const fates = [...FATES];
  for (let i = fates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [fates[i], fates[j]] = [fates[j], fates[i]];
  }
  const plans: Plan[] = [];
  while (fates.length) plans.push({ name: `s${seed}-${plans.length}`, typed: rng() < 0.3, asks: fates.splice(0, 1 + Math.floor(rng() * 4)) });
  if (seed % 2 === 0) plans.push({ name: `s${seed}-fold`, typed: false, asks: Array.from({ length: 6 }, () => undefined) });
  return plans;
}

describe(`#2026 AC2 ${ID.count}`, () => {
  it('Needs you never leaves out an open ask: its count always matches the record\'s open asks', async () => {
    needCli();
    const [{ plain }] = await Promise.all([appBins(), deepHook()]);
    const failures: string[] = [];
    let held = false;
    for (let k = 0; k < STREAMS; k++) {
      const plans = plan(SEED + k);
      const home = makeHome();
      await seed(home, async (s) => {
        for (const p of plans) {
          await s.start(p.name);
          if (p.typed) await typed(s, p.name, 'use the blue header instead');
          for (const [n, fate] of p.asks.entries()) {
            const question = `Record ${SEED + k}, ${p.name}, ask ${n}: keep it on SQLite or plain files?`;
            if (fate === 'later') {
              const { ask } = await askAndClose(s, p.name, question);
              await later(s, p.name, ask);
            } else {
              await askAndClose(s, p.name, question, fate);
            }
          }
        }
      });
      const hub = await hubOf(home);
      try {
        const record = openAsks(await eventsOf(hub));
        const reading = { surfaces: surfaces((await firstScreen(plain.replica, home)).snapshot), inbox: await inbox(home) };
        const wrong = oneNumberFailures(reading, record);
        console.log(`#2026 AC2 record ${SEED + k}: ${record.open.size} open, ${record.closed.size} closed (${[...new Set(record.closed.values())].join(', ')}); ${wrong.length} wrong`);
        failures.push(...wrong.map((w) => `record ${SEED + k} (${JSON.stringify(plans)}): ${w}`));
        // The judge itself, once: Needs you with the record's oldest open ask taken out of its rows fails, naming it.
        if (!held && !wrong.length && record.open.size) {
          held = true;
          const oldest = [...record.open.keys()][0]!;
          const twin = { ...reading, surfaces: { ...reading.surfaces, rows: reading.surfaces.rows.filter((id) => id !== oldest) } };
          expect(oneNumberFailures(twin, record).some((f) => f.startsWith('Needs you leaves out') && f.includes(oldest)), `the judge misses Needs you leaving out ${oldest}`).toBe(true);
        }
      } finally {
        await stopHub(hub);
      }
    }
    expect(failures).toEqual([]);
    expect(held, 'no record here passed, so the judge was never held to a Needs you that leaves an ask out').toBe(true);
  }, 120 * MINUTE);
});
