// Criterion 2 (no upstream test): "grid_path@1's fixture, a 5 × 5 grid with 8-connected moves of unit cost, no
// diagonal past a blocked cell, and walls on (2, 0) to (2, 3), finds a 10-move route from (0, 0) to (4, 0), and the
// library links; a planted grid_path that cuts a wall's corner returns an 8-move route and is refused at link, naming
// the fixture, the route array and the first element that differs; and a library that ships no fixture is refused,
// naming the library, and never links"
//
// Through `deep-logic check` and `bake` (README: deep-logic, Fixture). The fixture's expected route and move count are
// this suite's own breadth-first search of the issue's grid (programs.ts: bfsRoute, with grid_path@1's documented
// neighbor order), never a library's output. The planted library is grid_path with the corner rule taken out: under
// a fixture of its own (bfsRoute with `cut`) it links and its route is 8 moves; shipped with grid_path@1's fixture it
// is refused at link, and the first element of `route` that differs is found here by comparing the two searches.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, arraysAt, bakeCall, bakeOf, checkCall, fixtureId, fixturePiece, logicBin, onHost, prebuild, refusedOf, show } from './helpers.ts';
import { gridPath1, mazePiece, pack, routeExpect, routeFixture } from './libs.ts';
import { FIXTURE_GRID, bfsRoute, routeArray } from './programs.ts';

prebuild(() => { logicBin(); });

describe(`${AC[2]} a library links only once its own fixtures pass`, () => {
  it(`${AC[2]} grid_path@1's fixture finds the 10-move route from (0, 0) to (4, 0) round the wall, and the library links`, () => {
    const route = bfsRoute(FIXTURE_GRID);
    expect(route && route.length - 1, 'the issue\'s grid has a 10-move route, by this suite\'s own search').toBe(10);
    const lib = gridPath1();
    const f = lib.fixtures[0]!;
    const p = fixturePiece(lib, f, [pack('gridcore', [lib])]);
    const [check, bake] = onHost([checkCall(p), bakeCall(p, f.steps)]);
    const receipt = admitted(check!, 'check of grid_path@1\'s fixture item')['fixture']!;
    expect(receipt.libraries.map((l) => l.name), 'grid_path@1 links').toEqual(['grid_path@1']);
    expect(receipt.libraries[0]!.fixtures.map((x) => [x.fixture, x.verdict]), 'its one fixture ran and passed').toEqual([[fixtureId(lib, f), 'PASS']]);
    const b = bakeOf(bake!, 'the fixture item\'s bake');
    expect(arraysAt(b, 'fixture', 0), 'the linked library finds the 10-move route').toEqual(routeExpect(FIXTURE_GRID));
  }, TIMEOUT);

  it(`${AC[2]} a planted grid_path that cuts a wall's corner returns an 8-move route and is refused at link, naming the fixture, the route array and the first element that differs`, () => {
    const honest = routeArray(bfsRoute(FIXTURE_GRID));
    const cut = bfsRoute(FIXTURE_GRID, true);
    expect(cut && cut.length - 1, 'cutting a corner, the search finds 8 moves').toBe(8);
    const first = routeArray(cut).findIndex((v, i) => v !== honest[i]);
    expect(first, 'the two routes differ').toBeGreaterThanOrEqual(0);
    // Its own fixture, worked with the corner cut, so it links and its route can be read.
    const own = gridPath1({ cut: true }, [routeFixture(FIXTURE_GRID, true)]);
    // The same library shipped with grid_path@1's fixture.
    const planted = gridPath1({ cut: true });
    const f = planted.fixtures[0]!;
    const [ownBake, refused] = onHost([bakeCall(mazePiece(own, [pack('cutpack', [own])]), 1), checkCall(mazePiece(planted, [pack('gridcore', [planted])]))]);
    const b = bakeOf(ownBake!, 'the planted library under its own fixture');
    expect(arraysAt(b, 'maze', 0), 'the planted grid_path returns an 8-move route').toEqual(routeExpect(FIXTURE_GRID, true));
    const r = refusedOf(refused!, 'the planted grid_path with grid_path@1\'s fixture');
    expect([r.code, r.item], 'it is refused at link, naming the item').toEqual(['link_refused', 'maze']);
    const named = r.refusals.find((x) => x['fixture'] === fixtureId(planted, f));
    expect(named, `a refusal names the fixture ${fixtureId(planted, f)}: ${show(r.refusals as never)}`).toBeDefined();
    expect([named!['library'], named!['step'], named!['array'], named!['index'], named!['expected'], named!['actual']],
      `and the route array's first element that differs (#${first})`).toEqual(['grid_path@1', 0, 'route', first, honest[first], routeArray(cut)[first]]);
  }, TIMEOUT);

  it(`${AC[2]} a library that ships no fixture is refused, naming the library, and never links`, () => {
    const bare = gridPath1({}, []);
    const p = mazePiece(bare, [pack('gridcore', [bare])]);
    const [check, bake] = onHost([checkCall(p), bakeCall(p, 1)]);
    for (const [reply, what] of [[check!, 'check'], [bake!, 'bake']] as const) {
      const r = refusedOf(reply, `${what} of a piece linking a library with no fixture`);
      expect([r.code, r.item], `${what} is refused at link, naming the item`).toEqual(['link_refused', 'maze']);
      expect(r.refusals.some((x) => x['library'] === 'grid_path@1' && x['fixture'] === undefined), `a refusal names the library: ${show(r.refusals as never)}`).toBe(true);
    }
  }, TIMEOUT);
});
