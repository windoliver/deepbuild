// AC4 #2019.3a943830: a fixture Claude Code session on a version past its facts reads watch-only on its row and verdict
// line; a row that reads "sent back" with no hold delivered fails, naming the session.
//
// The session is the Proof's fixture's `watchonly` (helpers.ts, `mainWorld`): played through a real hub with its
// transcript on Claude Code 2.1.321, past its facts' 2.1.299, 2.1.304 and 2.1.308, then a stop that claims done and a
// FAIL on that claim, seeded with no send-back: no hold was delivered. Its row is read in `deep status --json` and the
// app's list, its verdict line under its row in `deep status` (README, Pinned 1 and 2).
import { afterAll, describe, expect, test } from 'vitest';
import {
  allEvents, blockOf, cleanup, control, deep, drawn, ID, idOf, mainWorld, MIN, none, PLANT, restartWith, rowOf, statusRows, TITLES, watchOnlyFailures, type Main,
} from './helpers.ts';

afterAll(cleanup, 120_000);
let made: Promise<Main> | undefined;
const world = (): Promise<Main> => (made ??= mainWorld());

describe(ID.watchOnly, () => {
  test(`${ID.watchOnly}: a fixture Claude Code session on a version past its facts reads watch-only on its row and verdict line, and not "sent back" with no hold delivered`, async () => {
    const w = await world();
    const id = idOf(w, 'watchonly');
    const conn = await control(w.hub);
    const events = await allEvents(conn).finally(() => conn.close());
    expect(events.some((e) => e.kind === 'verdict.made' && e.session === id && e.data.outcome === 'FAIL'), 'the fixture session\'s claim has its FAIL').toBe(true);
    expect(events.some((e) => e.kind === 'claim.sent_back' && e.session === id), 'the fixture session was sent nothing back: no hold was delivered').toBe(false);
    const row = rowOf((await statusRows(w)).rows, id);
    const block = blockOf((await deep(w, ['status'])).stdout, TITLES.watchonly);
    none(watchOnlyFailures({ row, block, drawn: (await drawn(w)).snapshot }, id), 'the session on a version past its facts');
  }, 30 * MIN);

  test(`${ID.watchOnly}: a planted row that reads "sent back" with no hold delivered fails, naming the session`, async () => {
    const w = await world();
    const id = idOf(w, 'watchonly');
    await restartWith(w, PLANT.sentBackWithoutHold);
    const row = rowOf((await statusRows(w, { plant: PLANT.sentBackWithoutHold })).rows, id);
    const block = blockOf((await deep(w, ['status'], PLANT.sentBackWithoutHold)).stdout, TITLES.watchonly);
    const failures = watchOnlyFailures({ row, block }, id);
    expect(failures.some((f) => f.includes(id) && /reads "sent back"/.test(f)), `DEEP_HUB_PLANT=${PLANT.sentBackWithoutHold} must fail naming the session ${id}: ${JSON.stringify(failures)}`).toBe(true);
  }, 30 * MIN);
});
