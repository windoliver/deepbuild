// AC3 #556.abf74c91: "With piece_seed run, the clean crawler fixture's 200 descender runs generate 200 different first
// floors by grid hash, which grid.reach's report counts per depth, and each run replays from its seed and track to its
// full-state hashes; a planted play mode that keeps the document's seed generates one first floor in all 200 runs, so
// the walled-exit twin fails every run or none, and this criterion fails, naming the count of distinct floors"
//
// Criterion 1's playtest of the clean crawler (#555's): 200 descender runs of 150 steps, seed 3556, piece_seed run.
// - On replicas of the env-plants build: grid.reach passes; its report counts 200 distinct floors at depth 1, and at
//   each depth as many distinct floors as runs that generated it; each run's first floor in the report has the hash
//   (README: The surface: SHA-256 of the cells as i32 little-endian) of the grid this suite's own one-step play of the
//   run's seed publishes, and those 200 grids differ. Each run's play (piece_seed run, its seed) and this suite's own
//   replay of its recorded track from the same seed reach the same full-state hash at every checkpoint and at the end;
//   played from the document's seed instead, run 0's track ends elsewhere.
// - On replicas planted with `keeps-document-seed` (DEEP_DRIVE_PLANT; README: The surface), grid.reach's report counts
//   1 distinct first floor in 200 runs, every one the document seed's floor, so this criterion's judge
//   (distinctFirstFloors) fails, naming 1; and the walled-exit twin, whose document seed walls, fails grid.unreached in
//   every run or none (here every run).
// The wrong programs: the base (no grid.reach, no plant), a play mode that keeps the document's seed, a replay that
// drops the run's seed, a report that counts runs and not floors, a floor recorded at the wrong step or from another run.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, canon, floorHash, failuresOf, lockPlay, macOnly, openHub, ownPlay, putPiece, reachOf, reachSpec, runCheck, runPlays, runSeed, shown,
  valuesOf, type Hub, type Obj, type Reach,
} from './helpers.ts';
import { crawlerPiece, crawlerPlay, crawlerProgram, SEED as CRAWLER_DOC_SEED } from '../555/programs.ts';
import { CRAWLER_REACH, CRAWLER_RUNS, WALLED_DOC_SEED, crawlerTwinPiece, crawlerTwinProgram, descenderInput } from './programs.ts';

const { seed: SEED, runs: RUNS, span: SPAN } = CRAWLER_RUNS;
const PLANT = 'keeps-document-seed';
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
/** This criterion's judge on grid.reach's report: none when the 200 runs generated 200 different first floors, else a failure naming the count. */
const distinctFirstFloors = (x: Reach): string | null => (x.distinct['1'] === RUNS ? null : `the runs generated ${x.distinct['1']} distinct first floors, not ${RUNS}`);

let opened: Promise<{ pool: Pool; hub: Hub; play: Obj }> | undefined;
const setup = (): Promise<{ pool: Pool; hub: Hub; play: Obj }> => (opened ??= (async () => {
  const pool = await Pool.open(2);
  return { pool, hub: await openHub(pool), play: await lockPlay(crawlerPlay()) };
})());
/** The grid a run seed's first step publishes, by this suite's own one-step play of it. */
async function firstFloor(pool: Pool, piece: string, seed: number, pieceSeed: 'run' | 'own'): Promise<string> {
  const a = await ownPlay(pool, piece, { seed, piece_seed: pieceSeed, span: { steps: 1 }, values: ['crawler.grid'], frames: [] });
  return floorHash(valuesOf(a, 'crawler.grid')[0] as number[]);
}

describe(`${AC[3]} each run generates its own floors from its seed, and replays from it`, () => {
  it(`${AC[3]} 200 descender runs generate 200 different first floors, which the report counts per depth, and each replays from its seed and track`, async () => {
    macOnly();
    const { pool, hub, play } = await setup();
    const piece = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const r = await runCheck(hub, reachSpec(CRAWLER_REACH, descenderInput(piece, play)));
    expect(r.outcome, `grid.reach passes on the clean crawler: ${shown(r)}`).toBe('passed');
    const x = reachOf(r);
    expect(distinctFirstFloors(x), 'the report counts 200 distinct first floors').toBeNull();
    for (const d of Object.keys(x.coverage).filter((k) => x.coverage[k]! > 0)) {
      const hashes = new Set(x.floors.filter((f) => String(f.depth) === d).map((f) => f.hash));
      expect([x.distinct[d], hashes.size], `depth ${d}: as many distinct floors as runs that generated it (${x.coverage[d]}), as the floors' hashes count`).toEqual([x.coverage[d], x.coverage[d]]);
    }
    const mine = await Promise.all(range(RUNS).map((i) => firstFloor(pool, piece, runSeed(SEED, i), 'run')));
    expect(new Set(mine).size, 'the 200 run seeds\' first floors, as this suite plays them, differ').toBe(RUNS);
    range(RUNS).forEach((i) => {
      const f = x.floors.find((y) => y.run === `bot 0 run ${i}` && y.depth === 1);
      expect([f?.seed, f?.step, f?.hash], `run ${i}'s first floor: its seed, step 0, the hash of the grid its seed generates`).toEqual([runSeed(SEED, i), 0, mine[i]]);
    });

    // Each run replays from its seed and its track to its full-state hashes.
    const gaps: string[] = [];
    await Promise.all(range(RUNS).map(async (i) => {
      const seed = runSeed(SEED, i);
      const p = runPlays(pool, piece, 'descender', seed)[0];
      if (!p) return void gaps.push(`run ${i} (seed ${seed}) was never played with the descender`);
      const again = await ownPlay(pool, piece, { seed, piece_seed: 'run', span: { steps: SPAN }, track: p.reply['entries'], values: [], frames: [] });
      if (canon(again['checkpoints']) !== canon(p.reply['checkpoints']) || again['final'] !== p.reply['final']) gaps.push(`run ${i}'s track, replayed from its seed, doesn't reach its full-state hashes`);
      if (i === 0) {
        const own = await ownPlay(pool, piece, { seed, piece_seed: 'own', span: { steps: SPAN }, track: p.reply['entries'], values: [], frames: [] });
        if (own['final'] === p.reply['final']) gaps.push('run 0\'s track replayed from the document\'s seed ends where the run did: the run seed changes nothing');
      }
    }));
    expect(gaps, 'every run replays from its seed and track').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a play mode that keeps the document's seed generates one first floor in all 200 runs: the walled twin fails every run or none, and this criterion fails naming the count`, async () => {
    macOnly();
    const { pool: clean } = await setup();
    const pool = await Pool.open(2, { plant: PLANT });
    const hub = await openHub(pool);
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const r = await runCheck(hub, reachSpec(CRAWLER_REACH, descenderInput(piece, play)));
    const x = reachOf(r);
    expect(distinctFirstFloors(x), `on ${PLANT} the report counts one first floor, and this criterion's judge fails naming 1: ${shown(r)}`).toBe(`the runs generated 1 distinct first floors, not ${RUNS}`);
    const own = await firstFloor(clean, piece, CRAWLER_DOC_SEED, 'own');
    const firsts = x.floors.filter((f) => f.depth === 1);
    expect([firsts.length, firsts.every((f) => f.hash === own)], 'all 200 runs\' first floors are the document seed\'s floor').toEqual([RUNS, true]);

    const walled = putPiece(DOC.walled, crawlerTwinPiece(crawlerTwinProgram('walled'), 'walled', WALLED_DOC_SEED));
    const w = await runCheck(hub, reachSpec(CRAWLER_REACH, descenderInput(walled, play)));
    const failed = new Set(failuresOf(w, 'grid.unreached:').map((f) => f.test));
    expect([0, RUNS], `the walled twin fails grid.unreached in every run or none: ${failed.size} of ${RUNS}: ${shown(w)}`).toContain(failed.size);
    expect(failed.size, 'its document seed walls, so every run').toBe(RUNS);
  }, TIMEOUT);
});
