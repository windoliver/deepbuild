// AC3 #2018.f054ee4c: a planted group count that includes moot asks fails, naming the group. The fixture's shop holds
// an open ask and one that went moot, and docs an open ask and an unblock task that took its default; the app's list is
// the replica's over a copy of the hub's record, read with `deep status --json` at one log_pos. Every count a group's
// heading shows is the length of the list it opens (README, Pinned 3).
import { afterAll, describe, expect, test } from 'vitest';
import { atOneLogPos, cleanup, groupCountFailures, ID, mainWorld, MOOT_ASK, none, type World } from './helpers.ts';

afterAll(cleanup, 60_000);
let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= mainWorld());
const MIN = 60_000;

/** What's wrong with the list's group counts, against the app's own rows and `deep status --json`'s at that log_pos. */
async function failures(plant?: string): Promise<string[]> {
  const w = await world();
  const { r, seen, status } = await atOneLogPos(w, plant);
  try {
    return [...new Set([...groupCountFailures(seen.snapshot, seen.rows), ...groupCountFailures(seen.snapshot, status.rows, "the app's list, against deep status --json at that log_pos")])];
  } finally {
    await r.stop();
  }
}

describe(ID.counts, () => {
  test(`${ID.counts}: every group count on the sidebar is the length of the list it opens, at the same log_pos, with a moot ask in the group`, async () => {
    const w = await world();
    expect(w.asks.map((a) => a.question), 'the fixture raised an ask that went moot').toContain(MOOT_ASK);
    none(await failures(), 'each group count the list shows');
  }, 30 * MIN);

  test(`${ID.counts}: a planted group count that includes moot asks fails, naming the group`, async () => {
    const found = await failures('group-count-moot');
    expect(found.some((f) => /^group heading:(needs-you|shop) /.test(f)), `DEEP_HUB_PLANT=group-count-moot in the replica's env-plants build must fail naming a group that holds the moot ask, heading:needs-you or heading:shop: ${JSON.stringify(found)}`).toBe(true);
    none(found.filter((f) => /^group heading:(docs|search) /.test(f)), 'no group without a moot ask is named');
  }, 30 * MIN);
});
