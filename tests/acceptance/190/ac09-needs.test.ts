// Criterion 9 (no upstream test): "A tactics item that links only a pathing library which needs grid_path@1 merges
// both, in that dependency order, and its receipt names both; needs that reach both grid_path@1 and grid_path@2 are
// refused, naming both versions; two libraries that need each other are refused, naming the cycle; and a planted
// linker that links in listing order instead of dependency order leaves an import unresolved and is refused, naming
// the import"
//
// Through `deep-logic check` and `bake` (README: deep-logic, Pack: needs). `tactics` links only pathing@1, whose
// pack entry needs grid_path@1; pathing's `plan` returns the route's second cell (programs.ts: planOf, from this
// suite's own search). scout@1 needs grid_path@2, so linking pathing@1 and scout@1 reaches both versions. ping@1
// and pong@1 need each other. `linker_links_in_listing_order` links the libraries as listed, each one's needs after
// it, so pathing's import of lib:grid_path.find_route comes before grid_path.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, arraysAt, bakeCall, bakeOf, checkCall, importOf, logicBin, onHost, piece, prebuild, refusedOf, show, type JsonObject, type Lib, type PackSpec } from './helpers.ts';
import { gridPath1, gridPath2, pack, pathing1, pingPong1, scout1, vLayout } from './libs.ts';
import { FIXTURE_GRID, V_WRITES, bfsRoute, pingProgram, planOf, tacticsProgram } from './programs.ts';

prebuild(() => { logicBin(); });

const tacticsPiece = (links: Lib[], packs: PackSpec[]): JsonObject =>
  piece({ seed: 190_09, packs, items: { tactics: { program: tacticsProgram(vLayout(), FIXTURE_GRID), writes: V_WRITES, links } } });
const kit = (): { grid: Lib; pathing: Lib; packs: PackSpec[] } => {
  const grid = gridPath1();
  const pathing = pathing1([grid]);
  return { grid, pathing, packs: [pack('tactics', [grid, pathing])] };
};

describe(`${AC[9]} the linker follows each library's needs in dependency order`, () => {
  it(`${AC[9]} a tactics item that links only pathing@1, which needs grid_path@1, merges both in dependency order, and its receipt names both`, () => {
    const { grid, pathing, packs } = kit();
    const [check, bake] = onHost([checkCall(tacticsPiece([pathing], packs)), bakeCall(tacticsPiece([pathing], packs), 1)]);
    const receipt = admitted(check!, 'check of tactics')['tactics']!;
    expect(receipt.libraries.map((l) => [l.name, l.hash]), 'the receipt names grid_path@1, then pathing@1, with their hashes')
      .toEqual([['grid_path@1', grid.program.sha], ['pathing@1', pathing.program.sha]]);
    expect(arraysAt(bakeOf(bake!, 'the bake of tactics'), 'tactics', 0), 'pathing plans through grid_path: the route\'s second cell').toEqual({ v: [planOf(bfsRoute(FIXTURE_GRID))] });
  }, TIMEOUT);

  it(`${AC[9]} needs that reach both grid_path@1 and grid_path@2 are refused naming both versions, and two libraries that need each other are refused naming the cycle`, () => {
    const { grid, pathing } = kit();
    const scout = scout1();
    const two = tacticsPiece([pathing, scout], [pack('tactics', [grid, gridPath2(), pathing, scout])]);
    const { ping, pong } = pingPong1();
    const cycle = piece({ seed: 190_091, packs: [pack('pingpong', [ping, pong])], items: { rally: { program: pingProgram(vLayout()), writes: V_WRITES, links: [ping] } } });
    const [a, b] = onHost([checkCall(two), checkCall(cycle)]);
    const ra = refusedOf(a!, 'needs that reach grid_path@1 and grid_path@2');
    expect([ra.code, ra.item], 'refused at check, naming the item').toEqual(['link_refused', 'tactics']);
    const versions = ra.refusals.map((r) => r['versions']).find(Array.isArray) as string[] | undefined;
    expect([...(versions ?? [])].sort(), `a refusal names both versions: ${show(ra.refusals as never)}`).toEqual(['grid_path@1', 'grid_path@2']);
    const rb = refusedOf(b!, 'two libraries that need each other');
    expect([rb.code, rb.item], 'refused at check, naming the item').toEqual(['link_refused', 'rally']);
    const named = rb.refusals.map((r) => r['cycle']).find(Array.isArray) as string[] | undefined;
    expect([...new Set(named ?? [])].sort(), `a refusal names the cycle: ${show(rb.refusals as never)}`).toEqual(['ping@1', 'pong@1']);
  }, TIMEOUT);

  it(`${AC[9]} a planted linker that links in listing order (linker_links_in_listing_order) leaves an import unresolved and is refused, naming the import`, () => {
    const { pathing, packs } = kit();
    const [reply] = onHost([checkCall(tacticsPiece([pathing], packs))], ['linker_links_in_listing_order']);
    const r = refusedOf(reply!, 'the planted linker\'s check of tactics');
    expect([r.code, r.item], 'refused at check, naming the item').toEqual(['link_refused', 'tactics']);
    expect(r.refusals.map(importOf), `a refusal names the unresolved import: ${show(r.refusals as never)}`).toContain('lib:grid_path.find_route');
  }, TIMEOUT);
});
