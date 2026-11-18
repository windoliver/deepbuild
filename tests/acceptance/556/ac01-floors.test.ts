// AC1 #556.9ac3832b: "grid.reach over 200 descender runs of the clean fixture, with goals [exit] and every [open] at
// depths [1, 2], passes and reports how many runs generated each depth; a planted generator that walls the exit room
// behind blocked cells on 1 seed in 50 fails grid.unreached in the runs with those seeds, naming each run's seed, the
// depth, the exit cell and the nearest reached cell; a planted generator that puts a vault's key inside its own vault
// fails, naming the vault's first unreached cell; and with depths [1, 2, 3, 4], floor 4 never generated, grid.reach is
// BLOCKED, naming depth 4 and its 0 runs, never PASS"
//
// The clean fixture is #555's crawler (3 floors of 32 × 32 from each run's own seed, a vault behind one locked cell, its
// key in a room between), under #555's locked interface. grid.reach names a playtest of 200 descender runs of 150 steps
// with piece_seed run, seed SEED; its input {goals: [exit], every: [open], depths: [1, 2]}. This suite reads each floor
// from the replica itself, never from the check: each run's first floor from its own one-step play of the run's seed,
// and each later floor from its own replay of the run's recorded track (the step its depth changes), and runs its own
// breadth-first search over each (helpers.ts) for what grid.reach must name.
// - Clean: passes, 200 runs read; for each run, its floors are one at each depth it reached, at the step it got there,
//   each reached; coverage counts the runs that reached depths 1, 2 and 3 as the replays do.
// - Walled twin (walls each floor's exit room on a seed that is 0 modulo 50, and publishes `walled`): fails
//   grid.unreached in exactly the runs this suite's own plays find walled (on this suite's seed, WALLED_RUNS of 200),
//   each failure naming the run's seed, depth 1, the floor's exit cell and the reached cell nearest it, as this suite's
//   own search finds them; nothing else fails.
// - Key-in-vault twin, 3 runs: every floor its runs record fails grid.unreached, naming the vault's first unreached
//   cell (an open cell behind the locked cell, in row-major order), the exit reached.
// - Depths [1, 2, 3, 4] on the clean runs: no floor fails, depth 4 (the crawler has 3 floors) is BLOCKED: the result is
//   `missing` with a failure starting BLOCKED: that names depth 4 and 0 runs, coverage holds depth 4 at 0, and the
//   verdict on a requirement it covers is BLOCKED, never PASS.
// The wrong programs: the base (no grid.reach), a check that reads the piece's own reachable flags or the floors no run
// generated, one with no key-and-door closure (it fails the clean fixture at its vault), one that opens a lock without
// its key (it passes the key-in-vault twin), one that names another cell or the start as nearest, one that passes a
// depth it never saw.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, cellNamed, cellOf, failuresOf, indexOf, judgeFloor, lockPlay, macOnly, named, openHub, ownPlay, putPiece, reachOf, reachSpec, runCheck,
  runPlays, runSeed, search, shown, valuesOf, word, type GridIface, type Hub, type Obj,
} from './helpers.ts';
import { judge } from '../184/helpers.ts';
import { CLASS, crawlerPiece, crawlerPlay, crawlerProgram } from '../555/programs.ts';
import { CRAWLER_REACH, CRAWLER_RUNS, WALLED_DOC_SEED, WALLED_ONE_IN, WALLED_PATH, crawlerTwinPiece, crawlerTwinProgram, descenderInput } from './programs.ts';

const { seed: SEED, runs: RUNS, span: SPAN } = CRAWLER_RUNS;
/** The runs of SEED whose seeds wall the twin's exit rooms, as this suite's own plays found them (README: How the fixtures were checked). */
const WALLED_RUNS = 5;
const VAULT_RUNS = 3;
const REACH = { ...CRAWLER_REACH, goals: [...CRAWLER_REACH.goals], every: [...CRAWLER_REACH.every], depths: [...CRAWLER_REACH.depths] };
const GRID = crawlerPlay().grid as GridIface;
const input = descenderInput;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const sorted = (cells: number[][]): string[] => cells.map((c) => c.join(',')).sort();

let opened: Promise<{ pool: Pool; hub: Hub; play: Obj }> | undefined;
const setup = (): Promise<{ pool: Pool; hub: Hub; play: Obj }> => (opened ??= (async () => {
  const pool = await Pool.open(2);
  return { pool, hub: await openHub(pool), play: await lockPlay(crawlerPlay()) };
})());

/** A floor as this suite reads it from the replica: its depth, the step it was recorded at, its cells and its start (the hero's cell). */
interface Seen { depth: number; step: number; cells: number[]; start: number }
/**
 * Run i's floors, from this suite's own replay of the track grid.reach's play of it recorded (its seed, piece_seed run):
 * one at step 0 and one at each step its depth changes (README: The surface). With `grids` false only depths and steps.
 */
async function floorsOf(pool: Pool, piece: string, i: number, grids: boolean): Promise<Seen[]> {
  const seed = runSeed(SEED, i);
  const plays = runPlays(pool, piece, 'descender', seed);
  expect(plays.length, `run ${i} (seed ${seed}) was played in a replica with the descender`).toBeGreaterThan(0);
  const values = ['crawler.depth', ...(grids ? ['crawler.grid', 'crawler.cell'] : [])];
  const again = await ownPlay(pool, piece, { seed, piece_seed: 'run', span: { steps: SPAN }, track: plays[0]!.reply['entries'], values, frames: [] });
  expect(again['final'], `run ${i}'s track replays here to the run's final hash`).toBe(plays[0]!.reply['final']);
  const depth = valuesOf(again, 'crawler.depth').map((v) => Number((v as number[])[0]));
  const grid = valuesOf(again, 'crawler.grid') as number[][];
  const cell = valuesOf(again, 'crawler.cell') as number[][];
  return depth.flatMap((d, k) => (k === 0 || d !== depth[k - 1]
    ? [{ depth: d, step: k, cells: grids ? grid[k]! : [], start: grids ? indexOf(GRID, [cell[k]![0]!, cell[k]![1]!]) : -1 }] : []));
}

describe(`${AC[1]} grid.reach over every floor the descender's runs generate`, () => {
  it(`${AC[1]} the clean crawler passes over 200 descender runs, counting the runs that generated each depth`, async () => {
    macOnly();
    const { pool, hub, play } = await setup();
    const piece = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const r = await runCheck(hub, reachSpec(REACH, input(piece, play)));
    expect(r.outcome, `grid.reach passes on the clean crawler: ${shown(r)}`).toBe('passed');
    expect(r.testsRun, 'it read the 200 runs').toBe(RUNS);
    const x = reachOf(r);
    const runs = await Promise.all(range(RUNS).map((i) => floorsOf(pool, piece, i, false)));
    const want: Record<string, number> = {};
    for (const floors of runs) for (const f of floors) want[String(f.depth)] = (want[String(f.depth)] ?? 0) + 1;
    expect([want['1'], (want['2'] ?? 0) > 0], 'every run generates depth 1, and some depth 2').toEqual([RUNS, true]);
    for (const d of new Set(['1', '2', ...Object.keys(want)])) expect(x.coverage[d], `coverage ${d}: the runs that generated depth ${d}`).toBe(want[d] ?? 0);
    runs.forEach((floors, i) => {
      const listed = x.floors.filter((f) => f.run === `bot 0 run ${i}`).sort((a, b) => a.step - b.step);
      expect(listed.map((f) => [f.depth, f.step, f.seed]), `run ${i}'s floors: one at each depth it reached, at the step it got there`).toEqual(floors.map((f) => [f.depth, f.step, runSeed(SEED, i)]));
      expect(listed.filter((f) => !f.reached || f.unreached.length > 0).map((f) => f.depth), `run ${i}: every floor reached`).toEqual([]);
    });
  }, TIMEOUT);

  it(`${AC[1]} the walled-exit twin fails grid.unreached in the runs whose seeds wall it, naming the seed, depth 1, the exit and the nearest reached cell`, async () => {
    macOnly();
    const { pool, hub, play } = await setup();
    const piece = putPiece(DOC.walled, crawlerTwinPiece(crawlerTwinProgram('walled'), 'walled', WALLED_DOC_SEED));
    // Each run's first floor, from this suite's own one-step play of its seed.
    const firsts = await Promise.all(range(RUNS).map(async (i) => {
      const seed = runSeed(SEED, i);
      const a = await ownPlay(pool, piece, { seed, piece_seed: 'run', span: { steps: 1 }, values: ['crawler.grid', 'crawler.cell', WALLED_PATH], frames: [] });
      const cells = valuesOf(a, 'crawler.grid')[0] as number[];
      const cell = valuesOf(a, 'crawler.cell')[0] as number[];
      const walled = Number((valuesOf(a, WALLED_PATH)[0] as number[])[0]) === 1;
      return { i, seed, cells, walled, judged: judgeFloor(GRID, cells, [indexOf(GRID, [cell[0]!, cell[1]!])], REACH.goals, REACH.every) };
    }));
    const walled = firsts.filter((f) => f.walled);
    expect(walled.length, `1 seed in ${WALLED_ONE_IN} walls the twin's exit rooms: on this suite's seeds, ${WALLED_RUNS} of ${RUNS} runs`).toBe(WALLED_RUNS);
    for (const f of firsts) {
      const exit = cellOf(GRID, f.cells.indexOf(CLASS.exit));
      expect(f.judged.cell, `run ${f.i}: this suite's own search ${f.walled ? 'misses the walled exit first' : 'reaches every cell of the floor'}`).toEqual(f.walled ? exit : null);
    }

    const r = await runCheck(hub, reachSpec(REACH, input(piece, play)));
    expect(r.outcome, `grid.reach fails on the walled twin: ${shown(r)}`).toBe('failed');
    const fails = failuresOf(r, 'grid.unreached:');
    expect(fails.map((f) => f.test).sort(), 'grid.unreached in exactly the runs whose seeds wall the exit').toEqual(walled.map((w) => `bot 0 run ${w.i}`).sort());
    expect(r.failures.filter((f) => !f.message.startsWith('grid.unreached:')).map((f) => f.message), 'nothing else fails').toEqual([]);
    const x = reachOf(r);
    for (const w of walled) {
      const f = fails.find((y) => y.test === `bot 0 run ${w.i}`)!;
      const exit = cellOf(GRID, w.cells.indexOf(CLASS.exit));
      expect(named(f.message, 'seed'), `it names run ${w.i}'s seed: ${f.message}`).toBe(w.seed);
      expect(named(f.message, 'depth'), `and depth 1: ${f.message}`).toBe(1);
      expect(cellNamed(f.message, 'cell'), `and the exit cell [${exit.join(', ')}]: ${f.message}`).toEqual(exit);
      expect(cellNamed(f.message, 'nearest'), `and the reached cell nearest it, [${w.judged.nearest!.join(', ')}]: ${f.message}`).toEqual(w.judged.nearest);
      const floors = x.floors.filter((y) => y.run === `bot 0 run ${w.i}`);
      expect(floors.map((y) => [y.depth, y.step, y.seed, y.reached]), `run ${w.i} recorded its one floor, unreached`).toEqual([[1, 0, w.seed, false]]);
      expect(sorted(floors[0]!.unreached), `run ${w.i}: the floor lists the cells this suite's search leaves unreached`).toEqual(sorted(w.judged.unreached.map((c) => cellOf(GRID, c))));
      expect(floors[0]!.nearest, `run ${w.i}: and the nearest reached cell`).toEqual(w.judged.nearest);
    }
  }, TIMEOUT);

  it(`${AC[1]} the key-in-vault twin fails every floor, naming the vault's first unreached cell`, async () => {
    macOnly();
    const { pool, hub, play } = await setup();
    const piece = putPiece(DOC.vault, crawlerTwinPiece(crawlerTwinProgram('vault'), 'vault', SEED));
    const r = await runCheck(hub, reachSpec(REACH, input(piece, play, VAULT_RUNS)));
    expect(r.outcome, `grid.reach fails on the key-in-vault twin: ${shown(r)}`).toBe('failed');
    const x = reachOf(r);
    let count = 0;
    for (const i of range(VAULT_RUNS)) {
      const floors = await floorsOf(pool, piece, i, true);
      const fails = failuresOf(r, 'grid.unreached:', `bot 0 run ${i}`);
      expect(fails.length, `run ${i}: one grid.unreached failure for each floor it recorded (${floors.length}): ${shown(r)}`).toBe(floors.length);
      for (const fl of floors) {
        const j = judgeFloor(GRID, fl.cells, [fl.start], REACH.goals, REACH.every);
        const exit = fl.cells.indexOf(CLASS.exit);
        expect([j.reached.has(exit), j.cell !== null], `run ${i} depth ${fl.depth}: the exit is reached and a cell isn't`).toEqual([true, true]);
        const unlocked = fl.cells.map((v) => (v === CLASS.locked ? CLASS.open : v));
        expect(search(GRID, unlocked, [fl.start]).has(indexOf(GRID, j.cell!)), `run ${i} depth ${fl.depth}: [${j.cell!.join(', ')}] lies behind the lock, in the vault`).toBe(true);
        const f = fails.find((y) => named(y.message, 'depth') === fl.depth);
        expect(f, `run ${i}: a grid.unreached failure names depth ${fl.depth}: ${shown(r)}`).toBeDefined();
        expect(cellNamed(f!.message, 'cell'), `run ${i} depth ${fl.depth}: it names the vault's first unreached cell [${j.cell!.join(', ')}]: ${f!.message}`).toEqual(j.cell);
        expect(named(f!.message, 'seed'), `and the run's seed: ${f!.message}`).toBe(runSeed(SEED, i));
        const listed = x.floors.find((y) => y.run === `bot 0 run ${i}` && y.depth === fl.depth);
        expect([listed?.step, listed?.reached], `run ${i} depth ${fl.depth}: recorded at step ${fl.step}, unreached`).toEqual([fl.step, false]);
        count++;
      }
    }
    expect(count, 'the key-in-vault runs recorded floors').toBeGreaterThanOrEqual(VAULT_RUNS);
  }, TIMEOUT);

  it(`${AC[1]} with depths [1, 2, 3, 4] grid.reach is BLOCKED, naming depth 4 and its 0 runs, never PASS`, async () => {
    macOnly();
    const { hub, play } = await setup();
    const piece = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const r = await runCheck(hub, reachSpec({ ...REACH, depths: [1, 2, 3, 4] }, input(piece, play)));
    expect(r.outcome, `depth 4, never generated, leaves grid.reach BLOCKED (missing), not passed: ${shown(r)}`).toBe('missing');
    expect(failuresOf(r, 'grid.unreached'), 'no floor fails').toEqual([]);
    const blocked = failuresOf(r, 'BLOCKED:');
    expect(blocked.length, `one depth is BLOCKED: ${shown(r)}`).toBe(1);
    expect(word('depth 4').test(blocked[0]!.message) && word('0 runs').test(blocked[0]!.message), `it names depth 4 and its 0 runs: ${blocked[0]!.message}`).toBe(true);
    const x = reachOf(r);
    expect([x.coverage['4'], x.coverage['1']], 'coverage counts 0 runs at depth 4 and 200 at depth 1').toEqual([0, RUNS]);
    const v = judge(r, 'definition');
    expect(v.requirements[0]?.outcome, `the requirement it covers is BLOCKED: ${JSON.stringify(v.reasons).slice(0, 600)}`).toBe('BLOCKED');
    expect(v.outcome, 'never PASS').not.toBe('PASS');
  }, TIMEOUT);
});
