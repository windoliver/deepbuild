// AC4 #556.2024793e: "On a 6 by 6 hex fixture with hex {orient: pointy, offset: odd}, whose only route from the start to
// the exit crosses between odd rows where the shift opens it, grid.reach passes; a planted runner that takes its
// neighbours by offset even finds no route on that clean fixture and fails grid.unreached, naming the exit cell, so the
// check and the drawn board never use two conventions"
//
// The hex fixture (programs.ts): 6 × 6, rows 0, 1, 4 and 5 open, row 2 open only at (3, 2) and row 3 only at (2, 3),
// the start (0, 0), the exit (5, 5). Its interface's grid is {shape: hex, hex: {orient: pointy, offset: odd}}, as Mark
// set: hex grid draws the board: odd rows shifted half a cell right, a cell's six neighbours those at cube distance 1.
// (3, 2) and (2, 3) are neighbours only with odd rows shifted, so the one route crosses from row 2 to row 3 there. This
// suite's own search (neighbours by cube distance) checks the fixture: with offset odd every open cell and the exit are
// reached, blocking either crossing cell leaves the exit unreached, and with offset even the exit is unreached.
// grid.reach {goals: [exit], every: [open], depths: []} names a playtest of one run of a policy that puts nothing:
// - through the hub, it passes, its one floor reached;
// - the plug-in's kit (README: The surface: reachKit): its reference fill passes the same spec, and its planted runner
//   `offset-even` fails grid.unreached on it, naming the exit cell [5, 5], its floor listing the cells this suite's
//   search leaves unreached when it takes neighbours by offset even.
// The wrong programs: the base (no grid.reach, no kit for it), a check that takes a square grid's 4 neighbours on a hex
// grid, or a hex grid's by offset even (it fails here the way the planted runner does), a kit with no such planted
// runner.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, cellNamed, cellOf, failuresOf, fillOf, indexOf, judgeFloor, lockPlay, macOnly, openHub, ownPlay, putPiece, reachKit, reachOf, reachSpec,
  runCheck, runFill, shown, valuesOf, type GridIface, type Obj,
} from './helpers.ts';
import { HEX, IDLE, hexCells, hexPiece, hexPlay, hexProgram } from './programs.ts';

const REACH = { playtest: 'R-hex', goals: ['exit'], every: ['open'], depths: [] };
const input = (piece: string, play: Obj): Obj => ({ piece, play, bots: [IDLE], runs: 1, seed: 556, span: { steps: 2 }, goals: [], frames: { every: 0 } });
const GRID = hexPlay().grid as GridIface;
const sorted = (cells: number[][]): string[] => cells.map((c) => c.join(',')).sort();

describe(`${AC[4]} a 6 × 6 pointy hex grid, odd rows shifted, whose one route needs the shift`, () => {
  it(`${AC[4]} grid.reach passes; a planted runner taking neighbours by offset even fails grid.unreached, naming the exit cell`, async () => {
    macOnly();
    const pool = await Pool.open(2);
    const piece = putPiece(DOC.hex, hexPiece(hexProgram()));
    // The fixture, as the replica publishes it and as this suite's own search reads it.
    const one = await ownPlay(pool, piece, { seed: 556, span: { steps: 1 }, bot: IDLE, values: ['hex.cells', 'hex.cell'], frames: [] });
    const cells = valuesOf(one, 'hex.cells')[0] as number[];
    expect([cells, valuesOf(one, 'hex.cell')[0]], 'the piece publishes the fixture\'s cells and the self unit on the start').toEqual([hexCells(), [...HEX.start]]);
    const start = indexOf(GRID, HEX.start);
    expect(judgeFloor(GRID, cells, [start], REACH.goals, REACH.every).cell, 'with odd rows shifted every open cell and the exit are reached').toBeNull();
    for (const [x, y] of HEX.crossing) {
      const shut = cells.map((v, i) => (i === indexOf(GRID, [x, y]) ? HEX.blocked : v));
      expect(judgeFloor(GRID, shut, [start], REACH.goals, []).cell, `with (${x}, ${y}) blocked the exit is unreached: the route crosses there`).toEqual([...HEX.exit]);
    }
    const even = judgeFloor(GRID, cells, [start], REACH.goals, REACH.every, [], 'even');
    expect(even.cell, 'taken by offset even, the exit is unreached').toEqual([...HEX.exit]);

    const hub = await openHub(pool);
    const play = await lockPlay(hexPlay());
    const spec = reachSpec(REACH, input(piece, play));
    const r = await runCheck(hub, spec);
    expect(r.outcome, `grid.reach passes on the hex fixture: ${shown(r)}`).toBe('passed');
    expect(reachOf(r).floors.map((f) => [f.run, f.step, f.reached]), 'its one run recorded its one floor, at step 0, reached').toEqual([['bot 0 run 0', 0, true]]);

    const kit = await reachKit(pool);
    const reference = await runFill(fillOf(kit, 'clean'), spec);
    expect(reference.outcome, `the kit's reference fill passes it too: ${shown(reference)}`).toBe('passed');
    const planted = await runFill(fillOf(kit, 'offset-even'), spec);
    expect(planted.outcome, `the planted runner taking neighbours by offset even fails: ${shown(planted)}`).toBe('failed');
    const f = failuresOf(planted, 'grid.unreached:');
    expect(f.length, `with grid.unreached: ${shown(planted)}`).toBe(1);
    expect(cellNamed(f[0]!.message, 'cell'), `naming the exit cell [${HEX.exit.join(', ')}]: ${f[0]!.message}`).toEqual([...HEX.exit]);
    const floor = reachOf(planted).floors[0];
    expect(sorted(floor?.unreached ?? []), 'its floor lists the cells a search by offset even leaves unreached').toEqual(sorted(even.unreached.map((c) => cellOf(GRID, c))));
  }, TIMEOUT);
});
