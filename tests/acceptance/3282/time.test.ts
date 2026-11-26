// AC1 and AC2: at the list's 260 width, an open taste call's row draws its time, and a session row still keeps 12
// characters of its title. One world, a real hub's record (#1808's `makeWorld`): five open taste calls in shop, each on a
// session of its own, and a session in docs titled #1808's twelve. Each test reads the replica on a copy of that record,
// opened at 960×640, where the list is 260 wide. AC1 reads each call row's `<row>:time` slot by its drawn bounds and the
// strings drawn inside it, not by its name alone (#1345 AC8 read the name only, so it passes with the slot 0 wide).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanup, driveBins, ID, listWidth, makeWorld, MIN, OPENING, PLANT, PLANT1808, QUESTIONS, replicaOf, sessionOf, SPECS, timeFailures,
  TITLE, topAsk, twelveFailures, type Call, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
let world: World;
let calls: Call[];
beforeAll(async () => {
  // The replica's two builds first (#1808's driveBins), so no test's time holds a build.
  await driveBins();
  world = await makeWorld(SPECS);
  calls = world.asks.map((a) => ({ handle: a.handle, question: a.question }));
}, 90 * MIN);

/** The window as the app opens it, at 260 wide, and the topmost call row the list draws. */
async function timesOf(plant?: string): Promise<{ failures: string[]; top: string | undefined }> {
  const r = await replicaOf(world, OPENING, plant);
  try {
    const s = (await r.see()).snapshot;
    const width = listWidth(s);
    if (Math.abs(width - 260) > 4) return { failures: [`the list is ${width} wide, not 260`], top: undefined };
    return { failures: timeFailures(s, calls), top: topAsk(s, calls) };
  } finally {
    await r.stop();
  }
}

describe(`AC1 ${ID.time} an open taste call's row draws its time`, () => {
  it(`AC1 ${ID.time}: at a 260-wide list, each open taste call's row draws its time in a slot with width that holds the time's text`, async () => {
    expect(calls.map((c) => c.question), 'the world holds the five open taste calls').toEqual([...QUESTIONS]);
    expect(await timesOf()).toMatchObject({ failures: [] });
  }, 30 * MIN);

  it(`AC1 ${ID.time} wrong program: a planted row that draws its time 0 wide fails, naming the row`, async () => {
    const { failures, top } = await timesOf(PLANT.askTime0Wide);
    expect(top, 'the planted list draws the taste call rows').toBeDefined();
    // Only the planted row fails (README, Surfaces: ask-time-0-wide), and its failure names it.
    expect(failures.filter((f) => !f.startsWith(`row ${top} (`)), `the planted list draws every call row but ${top} as shipped`).toEqual([]);
    expect(failures.join('\n'), 'the planted row draws its time in a slot 0 wide, and its failure names it').toMatch(new RegExp(`^row ${top} \\("[^"]+"\\) draws its time "[^"]+" in a slot 0 wide`, 'm'));
  }, 30 * MIN);
});

/** At 260 wide beside the five call rows, the session row reading INCONCLUSIVE and how much of its title it shows. */
async function titleFailures(plant?: string): Promise<string[]> {
  const r = await replicaOf(world, OPENING, plant);
  try {
    return await twelveFailures(r, sessionOf(world, 'twelve').id);
  } finally {
    await r.stop();
  }
}

describe(`AC2 ${ID.twelve} session rows keep 12 characters of title`, () => {
  it(`AC2 ${ID.twelve}: at 260 wide, beside the open taste call rows, a session row reading INCONCLUSIVE shows at least 12 characters of its title`, async () => {
    expect(await titleFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC2 ${ID.twelve} wrong program: #1808's planted row that shows 8 fails, naming the row`, async () => {
    const twelve = sessionOf(world, 'twelve');
    expect((await titleFailures(PLANT1808.titleEight)).join('\n'), "#1808's planted row (title-shows-8)").toContain(`row session:${twelve.id} ("${TITLE.twelve}") reading INCONCLUSIVE shows 8 characters of its title`);
  }, 30 * MIN);
});
