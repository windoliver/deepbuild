// AC2 #556.92ad8bdf: "A 64 × 64 fixture whose logic keeps a flow field toward a core for spawns on its edges, with a
// wall placed by an entry at step 600 and lag 8 from the brief, passes the flow form at every step; a planted program
// that never refreshes its field after the wall fails grid.flow at step 608, naming the first cell whose next step
// enters the wall; and a planted field in which one cell steps to a neighbour of higher cost fails, naming the cell and
// rises"
//
// The flow fixture (programs.ts): 64 × 64 open cells, a core of 4 exit cells at the centre, a field (`next`, `cost`)
// computed by its own breadth-first search, 8 spawns on the edges. A policy puts one entry on its `wall` slider at 10 s,
// stamped at step 600, which blocks row 16 from x 16 to 47; the clean program refreshes its field 4 steps later, so
// from step 600 to 603 cells still step into the wall (this suite's scratch play: (31, 15) at step 601), which the
// brief's lag of 8 covers. grid.reach's flow form, {next, cost, solid: [blocked], targets: [exit], spawns, lag: 8},
// names a playtest of one run of 640 steps:
// - the clean program passes, its result listing no flow failure;
// - the stale twin, which never refreshes, fails grid.flow on its run at step 608, naming the first cell (in row-major
//   order) whose next step enters the wall at that step, read here from the twin's own values, and solid;
// - the rising twin, from step 300 (no grid change there), steps cell (10, 40) to its west neighbour, whose cost is one
//   higher: it fails grid.flow at step 300, naming (10, 40) and rises, both read here from its own values too.
// The wrong programs: the base (no grid.reach), a check that ignores the lag (it fails the clean program at step 600
// and names step 600 on the stale twin), one that counts the lag from another step, one that checks only the steps the
// grid changes or only the last step (no failure at step 300 on the rising twin), one that never compares costs.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, cellNamed, cellOf, failuresOf, lockPlay, macOnly, named, openHub, ownPlay, putPiece, reachOf, reachSpec, runCheck, shown, valuesOf, word,
  type GridIface, type Hub, type Obj,
} from './helpers.ts';
import { FLOW, FLOW_FORM, FLOW_PATH, WALL_POLICY, flowPiece, flowPlay, flowProgram, type FlowTwin } from './programs.ts';

const SEED = 556;
const input = (piece: string, play: Obj): Obj => ({ piece, play, bots: [WALL_POLICY], runs: 1, seed: SEED, span: { steps: FLOW.span }, goals: [], frames: { every: 0 } });
const REACH = { playtest: 'R-flow', flow: FLOW_FORM };
const GRID: GridIface = { size: [FLOW.size, FLOW.size], shape: 'square', moves: 4, classes: { open: [FLOW.open], blocked: [FLOW.blocked], exit: [FLOW.exit] } };
const DOCS: Record<FlowTwin, string> = { clean: DOC.flow, stale: DOC.stale, rising: DOC.rising };

let opened: Promise<{ pool: Pool; hub: Hub; play: Obj }> | undefined;
const setup = (): Promise<{ pool: Pool; hub: Hub; play: Obj }> => (opened ??= (async () => {
  const pool = await Pool.open(2);
  return { pool, hub: await openHub(pool), play: await lockPlay(flowPlay()) };
})());
/** The twin's arrays at step `k`, from this suite's own play of it with the wall policy for k + 1 steps. */
async function arraysAt(pool: Pool, at: string, k: number): Promise<{ cells: number[]; next: number[]; cost: number[] }[]> {
  const r = await ownPlay(pool, at, { seed: SEED, span: { steps: k + 1 }, bot: WALL_POLICY, values: [FLOW_PATH.cells, FLOW_PATH.next, FLOW_PATH.cost], frames: [] });
  const [cells, next, cost] = [FLOW_PATH.cells, FLOW_PATH.next, FLOW_PATH.cost].map((p) => valuesOf(r, p) as number[][]);
  expect(cells!.length, `${at}: a play of ${k + 1} steps answers each step's cells`).toBe(k + 1);
  return cells!.map((c, i) => ({ cells: c, next: next![i]!, cost: cost![i]! }));
}
/** The result's flow list, each entry's run, step, cell and why. */
const flowList = (r: Awaited<ReturnType<typeof runCheck>>): Obj[] => reachOf(r).flow.map(({ run, step, cell, why }) => ({ run, step, cell, why }));
/** The one grid.flow failure of the run. */
function flowFailure(r: Awaited<ReturnType<typeof runCheck>>): { step: number | undefined; cell: [number, number] | undefined; message: string } {
  expect(r.outcome, `grid.reach's flow form fails: ${shown(r)}`).toBe('failed');
  const fails = failuresOf(r, 'grid.flow:');
  expect(fails.map((f) => f.test), `one grid.flow failure, on the one run: ${shown(r)}`).toEqual(['bot 0 run 0']);
  const message = fails[0]!.message;
  return { step: named(message, 'step'), cell: cellNamed(message, 'cell'), message };
}

describe(`${AC[2]} grid.reach's flow form on a 64 × 64 flow field, with a wall at step 600 and lag 8`, () => {
  it(`${AC[2]} the clean program passes the flow form at every step`, async () => {
    macOnly();
    const { hub, play } = await setup();
    const piece = putPiece(DOCS.clean, flowPiece(flowProgram('clean')));
    const r = await runCheck(hub, reachSpec(REACH, input(piece, play)));
    expect(r.outcome, `the clean flow fixture passes: ${shown(r)}`).toBe('passed');
    expect(r.testsRun, `one run read: ${shown(r)}`).toBe(1);
    expect(reachOf(r).flow, 'its result lists no flow failure').toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} the stale twin fails grid.flow at step 608, naming the first cell whose next step enters the wall`, async () => {
    macOnly();
    const { pool, hub, play } = await setup();
    const piece = putPiece(DOCS.stale, flowPiece(flowProgram('stale')));
    const steps = await arraysAt(pool, piece, FLOW.wallAt + FLOW.lag);
    const before = steps[FLOW.wallAt - 1]!;
    const s = steps[FLOW.wallAt + FLOW.lag]!;
    const wall = s.cells.flatMap((v, i) => (v === FLOW.blocked && before.cells[i] !== FLOW.blocked ? [i] : []));
    expect(wall.length, `the wall entry blocks ${FLOW.wall.x1 - FLOW.wall.x0 + 1} cells at step ${FLOW.wallAt}`).toBe(FLOW.wall.x1 - FLOW.wall.x0 + 1);
    expect(steps.findIndex((x) => x.cells.some((v) => v === FLOW.blocked)), `the grid first changes at step ${FLOW.wallAt}`).toBe(FLOW.wallAt);
    const into = s.cells.findIndex((v, i) => v !== FLOW.blocked && s.next[i]! >= 0 && wall.includes(s.next[i]!));
    expect(into, 'at step 608 the stale field still steps cells into the wall').toBeGreaterThanOrEqual(0);
    const first = cellOf(GRID, into);

    const r = await runCheck(hub, reachSpec(REACH, input(piece, play)));
    const f = flowFailure(r);
    expect(f.step, `it fails at step ${FLOW.wallAt + FLOW.lag}, the lag after the wall: ${f.message}`).toBe(FLOW.wallAt + FLOW.lag);
    expect(f.cell, `naming the first cell whose next step enters the wall, [${first.join(', ')}]: ${f.message}`).toEqual(first);
    expect(word('solid').test(f.message), `and why: solid: ${f.message}`).toBe(true);
    expect(flowList(r), 'the result lists that run, step, cell and why').toEqual([{ run: 'bot 0 run 0', step: FLOW.wallAt + FLOW.lag, cell: first, why: 'solid' }]);
  }, TIMEOUT);

  it(`${AC[2]} the rising twin fails grid.flow, naming the cell that steps to a neighbour of higher cost and rises`, async () => {
    macOnly();
    const { pool, hub, play } = await setup();
    const piece = putPiece(DOCS.rising, flowPiece(flowProgram('rising')));
    const steps = await arraysAt(pool, piece, FLOW.rising.at);
    const c = FLOW.rising.cell[1] * FLOW.size + FLOW.rising.cell[0];
    const rises = (s: { next: number[]; cost: number[] }): boolean => s.next[c]! >= 0 && s.cost[s.next[c]!]! > s.cost[c]!;
    expect(rises(steps[FLOW.rising.at - 1]!), `before step ${FLOW.rising.at} the cell steps down its field`).toBe(false);
    expect(rises(steps[FLOW.rising.at]!), `from step ${FLOW.rising.at} it steps to a neighbour of higher cost`).toBe(true);

    const r = await runCheck(hub, reachSpec(REACH, input(piece, play)));
    const f = flowFailure(r);
    expect(f.cell, `naming the cell [${FLOW.rising.cell.join(', ')}]: ${f.message}`).toEqual([...FLOW.rising.cell]);
    expect(word('rises').test(f.message), `and rises: ${f.message}`).toBe(true);
    expect(f.step, `at step ${FLOW.rising.at}, the first step it rises: ${f.message}`).toBe(FLOW.rising.at);
    expect(flowList(r), 'the result lists that run, step, cell and why').toEqual([{ run: 'bot 0 run 0', step: FLOW.rising.at, cell: [...FLOW.rising.cell], why: 'rises' }]);
  }, TIMEOUT);
});
