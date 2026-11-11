// AC2: the one count in the menu bar, in the list and in `deep inbox` is the same before and after rows are marked, and
// an absence with no state change marks nothing. A planted mark that adds to the one count fails, naming the surface.
//
// One world a real hub made (helpers.ts `COUNT_WORLD`), two asks open. The app is a replica of it per program, run in
// step on the replica's virtual clock; `deep inbox` is the real CLI on the real hub, as shipped and planted. Rows are
// marked by the real hub, for real Stop hooks, and its events reach each replica as its stream delivers them
// (helpers.ts `countRun`). Each plant's test first holds the shipped run to the same judge, so a plant can't look
// caught on a program that already fails.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, countRun, HOUR, ID, MIN, PLANT } from './helpers.ts';

afterAll(cleanup, 5 * MIN);

let ran: ReturnType<typeof countRun> | undefined;
const run = (): ReturnType<typeof countRun> => (ran ??= countRun());
const clean = 'the shipped app, hub and CLI already fail AC2, so a plant can\'t be told from them';

/** The failures of `plant`'s run that name `surface` once rows were marked. */
async function caught(plant: string, surface: RegExp): Promise<{ named: string[]; all: string[] }> {
  const runs = await run();
  expect(runs.get(undefined), clean).toEqual([]);
  const all = runs.get(plant)!;
  return { named: all.filter((f) => surface.test(f)), all };
}

describe(`#2028 AC2 ${ID.count}`, () => {
  it('the menu bar, the list and deep inbox read the record\'s open asks at 14:00, after an absence to 17:00 with no state change (which marks nothing), and once the hub marks two rows', async () => {
    expect((await run()).get(undefined)).toEqual([]);
  }, 8 * HOUR);

  it(`a planted menu bar that adds the unread rows to its count (${PLANT.menuBar}) fails, naming the menu bar`, async () => {
    const { named, all } = await caught(PLANT.menuBar, /^the menu bar reads \d+ after rows were marked/);
    expect(named, `the planted menu bar wasn't caught, naming the menu bar: ${JSON.stringify(all)}`).not.toEqual([]);
  }, 8 * HOUR);

  it(`a planted list that adds the unread rows to its Needs you count (${PLANT.list}) fails, naming the list`, async () => {
    const { named, all } = await caught(PLANT.list, /^the list's Needs you (heading reads \d+|lists \d+ rows) after rows were marked/);
    expect(named, `the planted list wasn't caught, naming the list: ${JSON.stringify(all)}`).not.toEqual([]);
  }, 8 * HOUR);

  it(`a planted deep inbox that adds the unread rows to its count (${PLANT.inbox}) fails, naming deep inbox`, async () => {
    const { named, all } = await caught(PLANT.inbox, /^deep inbox reads \d+ after rows were marked/);
    expect(named, `the planted deep inbox wasn't caught, naming deep inbox: ${JSON.stringify(all)}`).not.toEqual([]);
  }, 8 * HOUR);
});
