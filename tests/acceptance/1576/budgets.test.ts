// #1576's budgets on a phone's reads (README): the bytes of a cold open as the record grows (AC1, AC2), the queries
// of a reconnect (AC4), and two runs of every budget under load (AC5), on records of 1,000 and 100,000 sessions seeded
// through the real record and asks core before each hub starts; and AC1's and AC4's planted wrong programs (README,
// Wrong programs). Every number here is a count of bytes, frames or queries, never a time, so AC1, AC2 and AC4 judge
// the first of AC5's two runs, taken under load.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  ceilings, cleanup, coldOpen, judgeGrowth, judgeQueries, judgeSame, judgeUnder, onRecord, playTurn, PLANT, PLANTED_IN, queriesOf,
  reconnect, recordOf, shared, started, stopHubs, underLoad, type Numbers, type Open, type Read, type Turn,
} from './helpers.ts';

afterEach(stopHubs, 120_000);
afterAll(cleanup, 120_000);

const [SMALL, LARGE] = [1000, 100_000];
const small = shared(() => recordOf(SMALL));
const large = shared(() => recordOf(LARGE));

/** A cold open on a hub on each record, and a reconnect after the small one's; `refused` when the hub names no such plant. */
async function measure(plant?: string): Promise<{ refused: string | null; small?: Open; reads?: Read[]; large?: Open }> {
  const s = await onRecord(await small(), plant);
  if (!s.hub) return { refused: s.refused };
  const openSmall = await coldOpen(s.hub);
  const reads = await reconnect(s.hub);
  await stopHubs();
  const l = await onRecord(await large(), plant);
  if (!l.hub) return { refused: l.refused };
  const openLarge = await coldOpen(l.hub);
  await stopHubs();
  return { refused: null, small: openSmall, reads, large: openLarge };
}
/** One run of every budget: the cold opens and the reconnect, then the recorded turn on a hub of its own. */
async function run(): Promise<{ small: Open; reads: Read[]; large: Open; turn: Turn }> {
  const r = await measure();
  const turn = await playTurn(started(await onRecord(undefined)));
  await stopHubs();
  return { small: r.small!, reads: r.reads!, large: r.large!, turn };
}
/** A run's numbers, by budget; a count that can't be read is said, never 0. */
const numbersOf = (r: Awaited<ReturnType<typeof run>>): Numbers => {
  const uncounted = r.reads.find((read) => !Number.isSafeInteger(queriesOf(read.reply)));
  return {
    [`cold-open bytes on ${SMALL} sessions`]: r.small.bytes,
    [`cold-open bytes on ${LARGE} sessions`]: r.large.bytes,
    "a turn's frames": r.turn.frames,
    "a turn's bytes": r.turn.bytes,
    'queries per reconnect': uncounted ? `${uncounted.method}'s reply carries no queries` : r.reads.reduce((sum, read) => sum + (queriesOf(read.reply) as number), 0),
  };
};
/** The records seeded first, with nothing beside them; then the first run under load. */
const first = shared(async () => {
  await small();
  await large();
  return underLoad(run);
});

describe('AC1 #1576.bd04ffbe cold-open bytes on a record of 1,000 sessions and on one of 100,000 differ by under 10%', () => {
  it('AC1 #1576.bd04ffbe a cold open (the app\'s hello, inbox.read, sessions.read) costs the same bytes, within 10%, on 1,000 sessions and on 100,000', async () => {
    const r = await first();
    expect(judgeGrowth({ sessions: SMALL, open: r.small }, { sessions: LARGE, open: r.large })).toBeNull();
  }, 7_200_000);

  it(`AC1 #1576.bd04ffbe (wrong program) the planted ${PLANT.everyRow} fails it, naming ${PLANTED_IN.everyRow}`, async () => {
    const r = await measure(PLANT.everyRow);
    expect(r.refused, `the planted wrong program ${PLANT.everyRow} runs`).toBeNull();
    expect(judgeGrowth({ sessions: SMALL, open: r.small! }, { sessions: LARGE, open: r.large! })).toMatch(new RegExp(`, not under 10%: ${PLANTED_IN.everyRow.replace('.', '\\.')} grew most`));
  }, 3_600_000);
});

describe('AC2 #1576.cfed4450 a cold open is under 1 MiB on the 100,000-session fixture', () => {
  it('AC2 #1576.cfed4450 every byte the hub sends a cold open on 100,000 sessions comes to under 1 MiB', async () => {
    expect(judgeUnder(LARGE, (await first()).large)).toBeNull();
  }, 7_200_000);
});

describe('AC4 #1576.61b3806a queries per reconnect are counted and held', () => {
  it('AC4 #1576.61b3806a each read of a reconnect on 1,000 sessions counts its queries, and their sum is at or under the ceiling in benchmarks/budgets.json', async () => {
    expect(judgeQueries((await first()).reads, ceilings())).toBeNull();
  }, 7_200_000);

  it(`AC4 #1576.61b3806a (wrong program) the planted ${PLANT.rowQuery} fails it, naming ${PLANTED_IN.rowQuery}`, async () => {
    const s = await onRecord(await small(), PLANT.rowQuery);
    expect(s.refused ?? null, `the planted wrong program ${PLANT.rowQuery} runs`).toBeNull();
    await coldOpen(s.hub!);
    expect(judgeQueries(await reconnect(s.hub!), ceilings())).toMatch(new RegExp(`, past the ceiling of \\d+: ${PLANTED_IN.rowQuery.replace('.', '\\.')} ran`));
  }, 3_600_000);
});

describe('AC5 #1576.f767c108 two runs of each budget under load give identical numbers', () => {
  it('AC5 #1576.f767c108 with a busy process per core beside both, two runs read the same cold-open bytes on both records, the same turn\'s frames and bytes, and the same queries per reconnect', async () => {
    const a = numbersOf(await first());
    const b = numbersOf(await underLoad(run));
    expect(judgeSame(a, b)).toBeNull();
  }, 7_200_000);
});
