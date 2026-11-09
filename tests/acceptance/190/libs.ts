// The libraries of this suite as packs carry them (README: Libraries), each with the fixtures it ships. Every
// fixture's expected values are worked in programs.ts from first principles (bfsRoute, planOf, nextTurn, BigLib.top),
// never read from a library. Layouts come from `check` of a whole module that only names the writes (helpers:
// layoutFor), once per file.

import { layoutFor, piece, type FixtureSpec, type JsonObject, type Layout, type Lib, type PackSpec } from './helpers.ts';
import {
  FIXTURE_GRID, ROUTE_WRITES, V_WRITES, bfsRoute, bigLib, bigProgram, bulk, bulkProgram, counter, gridPath, layoutProbe, nextTurn,
  pathing, pingPong, pingProgram, planOf, routeArray, routeProgram, scout, tacticsProgram, topProgram, turns, turnsProgram,
  type Grid, type GridPathOptions,
} from './programs.ts';

let routeL: Layout | undefined;
let vL: Layout | undefined;
export const routeLayout = (): Layout => (routeL ??= layoutFor(layoutProbe(), ROUTE_WRITES));
export const vLayout = (): Layout => (vL ??= layoutFor(layoutProbe(), V_WRITES));

/** A route item's expected arrays at step 0: the route's cells and its move count, from bfsRoute. */
export const routeExpect = (g: Grid, cut = false): Record<string, number[]> => {
  const cells = bfsRoute(g, cut);
  return { route: routeArray(cells), moves: [cells ? cells.length - 1 : -1] };
};
/** grid_path@1's fixture (the issue's): the 5 × 5 grid, one step, the route and its 10 moves expected (route first). */
export const routeFixture = (g: Grid = FIXTURE_GRID, cut = false): FixtureSpec =>
  ({ program: routeProgram(routeLayout(), g), writes: ROUTE_WRITES, steps: 1, expect: { '0': routeExpect(g, cut) } });

/** grid_path@1 with its fixture; options make its planted or one-byte-apart twins, which ship the same fixture. */
export const gridPath1 = (o: GridPathOptions = {}, fixtures: FixtureSpec[] = [routeFixture()]): Lib =>
  ({ name: 'grid_path@1', program: gridPath(o), exports: ['find_route'], fixtures });
/** grid_path@2: the same search and `version`, with the same fixture. */
export const gridPath2 = (): Lib => ({ name: 'grid_path@2', program: gridPath({ v2: true }), exports: ['find_route', 'version'], fixtures: [routeFixture()] });
/** pathing@1, which needs grid_path@1 (or, with `needs` [], declares none); its fixture plans on the fixture grid. */
export const pathing1 = (needs: Lib[] = [gridPath1()]): Lib => ({
  name: 'pathing@1', program: pathing(), exports: ['plan'], needs,
  fixtures: [{ program: tacticsProgram(vLayout(), FIXTURE_GRID), writes: V_WRITES, steps: 1, expect: { '0': { v: [planOf(bfsRoute(FIXTURE_GRID))] } } }],
});
/** scout@1, which needs grid_path@2; its fixture counts the fixture grid's moves. */
export const scout1 = (): Lib => {
  const cells = bfsRoute(FIXTURE_GRID);
  return {
    name: 'scout@1', program: scout(), exports: ['scout'], needs: [gridPath2()],
    fixtures: [{ program: tacticsProgram(vLayout(), FIXTURE_GRID, 'scout', 'scout'), writes: V_WRITES, steps: 1, expect: { '0': { v: [cells ? cells.length - 1 : -1] } } }],
  };
};
/** ping@1 and pong@1, which need each other; each fixture expects ping(3) (or pong(3)) = 0. */
export function pingPong1(): { ping: Lib; pong: Lib } {
  const fixture = (me: 'ping' | 'pong'): FixtureSpec => ({ program: pingProgram(vLayout(), me), writes: V_WRITES, steps: 1, expect: { '0': { v: [0] } } });
  const ping: Lib = { name: 'ping@1', program: pingPong('ping'), exports: ['ping'], fixtures: [fixture('ping')] };
  const pong: Lib = { name: 'pong@1', program: pingPong('pong'), exports: ['pong'], fixtures: [fixture('pong')], needs: [ping] };
  ping.needs = [pong];
  return { ping, pong };
}
/** turns@1: next_turn over 3 steps, expected 1, 2, 0. */
export const turns1 = (): Lib => ({
  name: 'turns@1', program: turns(), exports: ['next_turn'],
  fixtures: [{ program: turnsProgram(vLayout()), writes: V_WRITES, steps: 3, expect: Object.fromEntries([0, 1, 2].map((k) => [String(k), { v: [nextTurn(k, 3)] }])) }],
});
/** bulk@1 of `n` data bytes; its fixture reads its first byte, 97, with 8 MiB of memory. */
export const bulk1 = (n: number): Lib => ({
  name: 'bulk@1', program: bulk(n), exports: ['first'],
  fixtures: [{ program: bulkProgram(vLayout()), writes: V_WRITES, budget: { memory: 8 }, steps: 1, expect: { '0': { v: [97] } } }],
});
/** big_a@1 and big_b@1, about 500 KB each, and the 1 MB program that links both (criterion 10). */
export function bigSet(): { a: Lib; b: Lib; program: ReturnType<typeof bigProgram> } {
  const lib = (name: 'big_a' | 'big_b', seed: number): Lib => {
    const b = bigLib(name, 500_000, seed);
    return { name: `${name}@1`, program: b.program, exports: ['top'], fixtures: [{ program: topProgram(vLayout(), name), writes: V_WRITES, steps: 1, expect: { '0': { v: [b.top(0)] } } }] };
  };
  return { a: lib('big_a', 190_101), b: lib('big_b', 190_102), program: bigProgram(vLayout(), 1_000_000) };
}

/** An installed pack (or one the working agent wrote) carrying `libs`. */
export const pack = (name: string, libs: Lib[], version = '1.0.0', origin: 'installed' | 'agent' = 'installed'): PackSpec => ({ name, version, origin, libs });

// The pieces of criteria 1, 4 and 7 (and 5's large grid).

/** The second piece's grid: 6 × 4 with a wall to go round. */
export const CHASE_GRID: Grid = { w: 6, h: 4, walls: [[1, 1], [2, 1], [3, 1], [4, 2], [4, 3]], from: [0, 3], to: [5, 0] };
/** A grid too large for one step's fuel: 160 × 160, open, corner to corner (25,600 cells searched). */
export const LARGE_GRID: Grid = { w: 160, h: 160, walls: [], from: [0, 0], to: [159, 159] };
/** A piece whose one item `id` runs a route program on `grid`, linking `lib` from `packs`. */
export const routePiece = (id: string, grid: Grid, lib: Lib, packs: PackSpec[], seed: number): JsonObject =>
  piece({ seed, packs, items: { [id]: { program: routeProgram(routeLayout(), grid, id), writes: ROUTE_WRITES, links: [lib] } } });
/** The first piece: `maze`, on the fixture grid. */
export const mazePiece = (lib: Lib, packs: PackSpec[]): JsonObject => routePiece('maze', FIXTURE_GRID, lib, packs, 190_011);
/** The second piece: `chase`, on CHASE_GRID. */
export const chasePiece = (lib: Lib, packs: PackSpec[]): JsonObject => routePiece('chase', CHASE_GRID, lib, packs, 190_012);
/** A piece without links: `plain`, a counter (a whole module), naming `packs` when given. */
export const plainPiece = (packs?: PackSpec[]): JsonObject =>
  piece({ seed: 190_013, ...(packs ? { packs } : {}), items: { plain: { program: counter(vLayout()), writes: V_WRITES } } });
