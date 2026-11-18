// AC6 #556.d8d26095: "On #1048's 2-layer fixture, grid.reach passes with the gate and the teleporter in place, and fails
// with grid.unreached, naming the exit, once the teleporter's row is removed; a planted runner that treats stacked cells
// on two layers as neighbours passes that twin, and the conformance kit catches it, naming the cell"
//
// #1048's map (its programs.ts): 2 layers of 16 × 16, cells named (x, layer × 16 + y); the start (1, 1) in room A on the
// surface, the exit (14, 14) in room B, walled apart; the gate 85 ↔ 341 (two-way, down to the cave) and the teleporter
// 426 → 153 (one-way, up into room B). The no-teleporter twin is the map with the teleporter's row removed from its
// links (`nlinks` 1, the gate alone); this suite's copy of the map's text, with both links, assembles to #1048's map byte
// for byte. Under the cave corridor (y 26, layer 1) lie room B's cells (9, 10) and (10, 10) on the surface, so a search
// that takes the cell stacked above or below as a neighbour walks into room B without the teleporter. This suite's own
// search checks it: with both links every open cell and the exit are reached; with the gate alone the exit is not; with
// stacked cells as neighbours it is again.
// grid.reach {goals: [exit], every: [open], depths: []} names a playtest of 2 explorer runs:
// - the map passes; the twin fails grid.unreached in each run, naming the exit [14, 14], its floor listing the cells
//   this suite's search leaves unreached;
// - the plug-in's kit (README: The surface): its planted runner `stacked-layers` passes the twin; its reference fill
//   fails it naming the exit; and the kit run on that planted runner (runKit, its fixed part) reads FAIL, a failed case
//   naming the cell [14, 14] (its fixture #1048's map without the teleporter's row).
// The wrong programs: the base (no grid.reach, no kit for it), a check that ignores links (it fails the map), that
// takes a one-way link both ways, or that steps between stacked cells (it passes the twin), a kit that admits that runner.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, cellNamed, cellOf, failuresOf, fillOf, judgeFloor, lockPlay, macOnly, openHub, ownPlay, putPiece, reachKit, reachOf, reachSpec, runCheck,
  runFill, shown, valuesOf, type GridIface, type Obj,
} from './helpers.ts';
import { runKit } from '../../../packages/conformance/src/index.ts';
import { LINKS, mapPiece, mapPlay, mapProgram } from '../1048/programs.ts';
import { GATE_ONLY, MAP, idx, mapTwinProgram } from './programs.ts';

const REACH = { playtest: 'R-map', goals: ['exit'], every: ['open'], depths: [] };
const EXPLORER: Obj = { explorer: { every: 1 } };
const input = (piece: string, play: Obj): Obj => ({ piece, play, bots: [EXPLORER], runs: 2, seed: 556, span: { steps: 60 }, goals: [], piece_seed: 'own', frames: { every: 0 } });
const GRID = mapPlay().grid as GridIface;
const EXIT = [...MAP.exit];
const sorted = (cells: number[][]): string[] => cells.map((c) => c.join(',')).sort();
/** Every cell of the surface and the cell stacked under it, as two-way links: what a runner that steps between stacked cells adds. */
const STACKED = Array.from({ length: MAP.size * MAP.size }, (_, i) => [i, i + MAP.size * MAP.size, 1]);

describe(`${AC[6]} grid.reach follows #1048's layers and links`, () => {
  it(`${AC[6]} the map passes; without the teleporter's row it fails naming the exit; the stacked-layers runner passes that twin and the kit catches it, naming the cell`, async () => {
    macOnly();
    expect(mapTwinProgram(LINKS).sha, 'this suite\'s copy of the map\'s text, with both links, is #1048\'s map').toBe(mapProgram().sha);
    const pool = await Pool.open(2);
    const map = putPiece(DOC.map, mapPiece(mapProgram()));
    const twin = putPiece(DOC.noTeleporter, mapPiece(mapTwinProgram(GATE_ONLY)));
    const one = await ownPlay(pool, twin, { seed: 556, span: { steps: 1 }, values: ['map.cells', 'map.cell', 'map.links', 'map.nlinks'], frames: [] });
    expect([valuesOf(one, 'map.links')[0], valuesOf(one, 'map.nlinks')[0], valuesOf(one, 'map.cell')[0]], 'the twin lists the gate\'s row alone, the hero on the start').toEqual([[...LINKS[0]!, 0, 0, 0], [1], [...MAP.start]]);
    const cells = valuesOf(one, 'map.cells')[0] as number[];
    const start = idx(MAP.start);
    expect(judgeFloor(GRID, cells, [start], REACH.goals, REACH.every, LINKS).cell, 'with the gate and the teleporter every open cell and the exit are reached').toBeNull();
    const twinJudged = judgeFloor(GRID, cells, [start], REACH.goals, REACH.every, GATE_ONLY);
    expect(twinJudged.cell, 'with the gate alone the exit is unreached').toEqual(EXIT);
    expect(judgeFloor(GRID, cells, [start], REACH.goals, REACH.every, [...GATE_ONLY, ...STACKED]).cell, 'with stacked cells as neighbours it is reached again').toBeNull();

    const hub = await openHub(pool);
    const play = await lockPlay(mapPlay());
    const passed = await runCheck(hub, reachSpec(REACH, input(map, play)));
    expect(passed.outcome, `grid.reach passes on the map with its gate and teleporter: ${shown(passed)}`).toBe('passed');
    const twinSpec = reachSpec(REACH, input(twin, play));
    const failed = await runCheck(hub, twinSpec);
    expect(failed.outcome, `grid.reach fails on the twin without the teleporter's row: ${shown(failed)}`).toBe('failed');
    const fails = failuresOf(failed, 'grid.unreached:');
    expect(fails.map((f) => f.test).sort(), 'grid.unreached in each of its 2 runs').toEqual(['bot 0 run 0', 'bot 0 run 1']);
    for (const f of fails) expect(cellNamed(f.message, 'cell'), `naming the exit [${EXIT.join(', ')}]: ${f.message}`).toEqual(EXIT);
    for (const floor of reachOf(failed).floors) {
      expect(sorted(floor.unreached), `${floor.run}: its floor lists the cells this suite's search leaves unreached`).toEqual(sorted(twinJudged.unreached.map((c) => cellOf(GRID, c))));
    }

    const kit = await reachKit(pool);
    const stacked = fillOf(kit, 'stacked-layers');
    const wrong = await runFill(stacked, twinSpec);
    expect(wrong.outcome, `the planted runner that treats stacked cells as neighbours passes the twin: ${shown(wrong)}`).toBe('passed');
    const reference = await runFill(fillOf(kit, 'clean'), twinSpec);
    expect(cellNamed(failuresOf(reference, 'grid.unreached:')[0]?.message ?? '', 'cell'), `the kit's reference fill fails it, naming the exit: ${shown(reference)}`).toEqual(EXIT);
    const report = await runKit(kit as never, stacked as never, { parts: ['fixed'] });
    expect(report.verdict, `the kit catches the stacked-layers runner: ${JSON.stringify(report.cases.filter((c) => c.outcome !== 'PASS')).slice(0, 1500)}`).toBe('FAIL');
    const caught = report.cases.filter((c) => c.outcome === 'FAIL' && JSON.stringify(cellNamed(c.message, 'cell')) === JSON.stringify(EXIT));
    expect(caught.length, `a failed case names the cell [${EXIT.join(', ')}]: ${JSON.stringify(report.cases.map((c) => [c.id, c.outcome, c.message])).slice(0, 1500)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
