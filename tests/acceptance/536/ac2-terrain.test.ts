// AC2 #536.b30a306f: On that pointy odd fixture with terrains water, sand and grass, precedence [grass, sand, water] and
// an atlas holding every tile the fixture needs, the terrain recipe gives each cell a tile whose six edge labels are,
// edge by edge, the neighbour's terrain where it comes before the cell's own in the precedence and the cell's own
// otherwise, an edge off the grid taking the cell's own; a planted expansion that reads a square grid's four sides as the
// neighbours fails, naming the first cell whose labels differ; corners_and_sides on a hex grid is refused at check,
// naming the rule; with one needed tile removed from the atlas the recipe is refused at check, naming a cell and the six
// labels it wanted; adding a cell at (6, 0) of its neighbours' terrain changes no other cell's tile; and a tile column
// that reads a logic array passes the document check while a terrain recipe whose cells name a logic array is refused,
// naming the field
//
// The fixture (helpers.ts `terrainDoc`, `FLOOR`, `TILES`): a `tiles.terrain@1` instance `floor` with `rules: edges_6`
// on the 6 × 6 pointy odd hex grid, cell [32, 28], 36 cells of water, sand and grass, precedence [grass, sand, water],
// seed 536, its tiles declared `{tile, terrain, edges}`. Everything goes through `deep-canvas-render check {doc, look,
// store, planted?}`: the recipe's choice is its `expansions` (../467/helpers.ts `tilesOf`), a refusal its error issues.
// The expected labels come from the design's rules, computed here (helpers.ts `neighbours`, `wanted`): neighbours at
// cube distance 1, edges 0 to 5 counterclockwise on screen from the one facing +x, precedence, off-grid edges the cell's
// own. Cells are compared in the order the recipe writes them, row by row. README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import {
  AC, EMPTY_WASM, FLOOR, TILES, TIMEOUT, atlasPng, cellsOf, check, describeErrors, doc, failsNaming, fieldsOf, holdsArray,
  labelProblems, logicItem, logicTileSet, namesItem, namesWord, none, putAssets, shown, squareSides, terrainDoc, tilesFor,
  tilesOf, useDir, useRender, wanted, type Issue, type JsonObject,
} from './helpers.ts';

const ID = AC[2];
const bin = useRender();
const dir = useDir();

/** A store holding the recipe's atlas, and the atlas's SHA-256. */
function atlasStore(): { store: string; asset: string } {
  const store = dir();
  const [asset] = putAssets(store, [atlasPng()]);
  return { store, asset: asset! };
}
function passing(doc: JsonObject, store: string, what: string, planted?: string): Map<string, number> {
  const { answer, errors } = check(bin(), doc, { store, ...(planted ? { planted } : {}) });
  expect(answer['ok'], `${what} passes the check: ${describeErrors(errors)} ${answer['code'] ? shown(answer) : ''}`).toBe(true);
  return tilesOf(answer);
}
function refused(doc: JsonObject, store: string, what: string): Issue[] {
  const { answer, errors } = check(bin(), doc, { store });
  expect(answer['ok'], `${what} is refused at check: ${shown(answer['expansions'])}`).toBe(false);
  expect(errors.length, `${what}: the refusal is an error issue: ${shown(answer)}`).toBeGreaterThan(0);
  return errors;
}
const listed = (errors: Issue[]): string => errors.map((e) => shown(e.raw)).join('\n  ');

describe(`${ID} six-edge terrain rules on the hex fixture`, () => {
  it(`${ID} each cell takes a tile whose six edge labels are the neighbour's terrain where it comes before the cell's own in the precedence and the cell's own otherwise, off-grid edges the cell's own`, () => {
    const { store, asset } = atlasStore();
    const cells = cellsOf(FLOOR);
    for (const [cx, cy, t] of FLOOR) expect(tilesFor(t, wanted(cells, cx, cy)).length, `the atlas holds the tile (${cx}, ${cy}) needs`).toBeGreaterThan(0);
    const tiles = passing(terrainDoc('terrain', asset), store, 'the terrain fixture');
    expect([...tiles.keys()].sort(), 'the expansion gives each of the 36 cells one tile').toEqual(FLOOR.map(([x, y]) => `${x},${y}`).sort());
    none(labelProblems(tiles, FLOOR), 'each cell\'s tile has the labels the design wants');
  }, TIMEOUT);

  it(`${ID} a planted expansion that reads a square grid's four sides as the neighbours fails, naming the first cell whose labels differ`, () => {
    const { store, asset } = atlasStore();
    const tiles = passing(terrainDoc('terrain-square-sides', asset), store, 'the terrain fixture with terrain_reads_square_sides', 'terrain_reads_square_sides');
    const planted = TILES.find((t) => t.tile === tiles.get('1,0'));
    expect(planted?.edges, 'the planted reading takes (1, 1), below (1, 0), for edge 4 and gives (1, 0) a sand edge there').toEqual(wanted(cellsOf(FLOOR), 1, 0, squareSides));
    const problems = labelProblems(tiles, FLOOR);
    failsNaming(problems, 'cell (1, 0)', 'the expansion that reads a square grid\'s four sides');
    expect(problems[0], 'the first failure names the first cell whose labels differ').toContain('cell (1, 0)');
  }, TIMEOUT);

  it(`${ID} corners_and_sides on a hex grid is refused at check, naming the rule`, () => {
    const { store, asset } = atlasStore();
    const errors = refused(terrainDoc('terrain-corners-and-sides', asset, { rules: 'corners_and_sides' }), store, 'corners_and_sides on the hex fixture');
    const naming = errors.filter((e) => namesItem(e, 'floor') && (e.path === 'items/floor/params/rules' || namesWord(e, 'corners_and_sides')));
    expect(naming.length, `an error names the recipe and the rule (its path items/floor/params/rules, or corners_and_sides in its fields); the errors:\n  ${listed(errors)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ID} with one needed tile removed from the atlas the recipe is refused at check, naming a cell and the six labels it wanted`, () => {
    const { store, asset } = atlasStore();
    // (1, 1), sand, wants [sand, sand, sand, sand, grass, grass]: grass below it on edges 4 and 5. No other cell wants that tile.
    const want = wanted(cellsOf(FLOOR), 1, 1);
    const gone = tilesFor('sand', want);
    expect(gone.length, `one tile is (1, 1)'s: ${shown(want)}`).toBe(1);
    expect(FLOOR.filter(([cx, cy, t]) => t === 'sand' && wanted(cellsOf(FLOOR), cx, cy).join() === want.join()).map(([x, y]) => `${x},${y}`), 'no other cell wants it').toEqual(['1,1']);
    const tiles = TILES.filter((t) => t !== gone[0]).map((t) => ({ tile: t.tile, terrain: t.terrain, edges: t.edges }));
    const errors = refused(terrainDoc('terrain-missing-tile', asset, { tiles }), store, `the fixture without tile ${gone[0]!.tile}`);
    const index = FLOOR.findIndex(([x, y]) => x === 1 && y === 1);
    const naming = errors.filter((e) => namesItem(e, 'floor') && (holdsArray(fieldsOf(e), [1, 1]) || e.path === `items/floor/params/cells/${index}`) && holdsArray(fieldsOf(e), want));
    expect(naming.length, `an error names the recipe, cell (1, 1) and the six labels it wanted [${want.join(', ')}] in its own fields; the errors:\n  ${listed(errors)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ID} adding a cell at (6, 0) of its neighbours' terrain changes no other cell's tile`, () => {
    const { store, asset } = atlasStore();
    const map = cellsOf(FLOOR);
    expect([map.get('5,0'), map.get('5,1')], 'its neighbours on the grid, (5, 0) and (5, 1), are water').toEqual(['water', 'water']);
    const before = passing(terrainDoc('terrain', asset), store, 'the terrain fixture');
    // Written first, so a choice drawn in written order, or by the cell's index, would move every other cell's.
    const after = passing(terrainDoc('terrain-with-6-0', asset, { cells: [[6, 0, 'water'], ...FLOOR] }), store, 'the fixture with (6, 0) added');
    expect(after.has('6,0'), 'the added cell takes a tile').toBe(true);
    const moved = FLOOR.filter(([x, y]) => after.get(`${x},${y}`) !== before.get(`${x},${y}`)).map(([x, y]) => `(${x}, ${y}): ${before.get(`${x},${y}`)} → ${after.get(`${x},${y}`)}`);
    expect(moved, 'adding (6, 0) changes no other cell\'s tile').toEqual([]);
  }, TIMEOUT);

  it(`${ID} a tile column that reads a logic array passes the document check`, () => {
    const { store, asset } = atlasStore();
    const [program] = putAssets(store, [EMPTY_WASM]);
    const { answer, errors } = check(bin(), doc('logic-tile-column', [224, 148], [logicItem(program!), logicTileSet(asset)]), { store });
    expect(answer['ok'], `the set whose tile column reads board.tiles passes the document check: ${describeErrors(errors)}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} a terrain recipe whose cells name a logic array is refused, naming the field`, () => {
    const { store, asset } = atlasStore();
    const [program] = putAssets(store, [EMPTY_WASM]);
    const errors = refused(terrainDoc('logic-terrain-cells', asset, { cells: { array: 'board.terrain', as: 'u8' } }, [logicItem(program!)]), store, 'the recipe whose cells read board.terrain');
    const naming = errors.filter((e) => namesItem(e, 'floor') && namesWord(e, 'cells'));
    expect(naming.length, `an error names the recipe and its field cells; the errors:\n  ${listed(errors)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
