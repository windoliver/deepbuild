// AC4: a hub restarted on that record folds to the same asks, tasks and stops held as the hub that ran through it.
// The hub's start opens the asks core on its record (packages/hub/src/core.ts, openRecordAndAsks); here the core that
// ran through AC1's session goes with its record, and a core opened on the same record at the same time folds it.

import { expect, test } from 'vitest';
import { Count2653, HERE, makeClock, openWorld, stopsHeld } from './helpers.ts';
import { oneSession, S1, STOPS } from './scenarios.ts';

/** A stop's number, from its ID's last ten letters (helpers.ts stopId). */
const numberOf = (id: string): number => [...id.slice(-10)].reduce((n, c) => n * 32 + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(c), 0);

test('AC4 #2653.3f98736d a hub restarted on that record folds to the same asks, tasks and stops held as the hub that ran through it', async () => {
  const w = await openWorld(HERE, makeClock());
  try {
    await oneSession([w], STOPS);
    const ran = { inbox: await w.asks.inbox(), needsYou: await w.asks.needsYou() };
    const live = await w.restart();
    const folded = { inbox: await w.asks.inbox(), needsYou: await w.asks.needsYou() };
    const held = await stopsHeld([new Count2653('ran', live.asks, live.record), new Count2653('restarted', w.asks, w.record)], S1);
    expect(folded, `the core restarted on the record of ${STOPS} stops holds the asks and tasks of the one that ran through it`).toEqual(ran);
    const [before, after] = [held.get('ran')!, held.get('restarted')!];
    const only = (a: Set<string>, b: Set<string>) => [...a].filter((id) => !b.has(id)).map(numberOf).sort((x, y) => x - y).slice(0, 20);
    expect({ held: after.size, gained: only(after, before), lost: only(before, after) }, `the restarted core holds the stops of S1 the one that ran holds (${before.size}), by number`)
      .toEqual({ held: before.size, gained: [], lost: [] });
  } finally {
    await w.close();
  }
}, 2_400_000);
