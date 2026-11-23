// AC4 #2386.dd0857c2: On an isometric grid with cell [32, 16] and no `draw`, a click at (4, 2) selects the row at cell
// (0, 0), and a click at (8, 4), on the edge it shares with (1, 0), selects (0, 0). With `draw: [32, 32]` and `anchor:
// [0.5, 0.75]`, a click at (0, −12), on the standing part of the tile at (0, 0), selects the row at cell (−1, −1) when
// the set has one and nothing when it doesn't. On the third criterion's square grid a click at (32, 30) never selects
// the tree at (2, 3). A planted hit test that reads quads selects (1, 0) at (4, 2) and fails, naming the click and both
// rows
//
// The click boards (fixtures.ts), each in a panel of its own at 4 px a u, so every point below is a whole panel px:
//   `board`  a 4 × 4 isometric board, cell [32, 16], opaque tiles with no `draw`, at (80, 24) of its page; cell (cx, cy)
//            is row 4 cy + cx, so (0, 0) is board#0 and (1, 0) board#1;
//   `tall`   the same grid with `draw: [32, 32]` and `anchor: [0.5, 0.75]`, at (32, 48), on two pages: on one the set
//            holds cell (−1, −1), written first (tall#0), and cell (0, 0) (tall#1); on the other cell (0, 0) alone (tall#0);
//   `tree`   criterion 3's document, its sets at the page's origin.
// Through `deep-show run` on the scope's virtual clock, as #535's suite clicks rows: each document presented, its
// panel's `scope` read for the camera, then a press and its release at each point (`input`), read as `state.selection`.
// Before a click is read, the criterion's own geometry is checked (the diamond, the shared edge, the cell), and where
// the criterion puts a click on a tile's standing part, the spatial index is asked that a box about the point meets
// that tile's row, so the click lands on the drawn quad the criterion names. The planted program is the scenario's
// `planted: "grid_hit_reads_quads"`. README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import {
  BOARD_GRID, BOARD_POS, TALL_ANCHOR, TALL_DRAW, TALL_POS, TREE_DRAW, TREE_GRID, boardDoc, holds, inDiamond, isoCentre, quadAt, squareCentre, tallDoc,
  treeAtlas, treesDoc,
} from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, failsNaming, metBy, none, once, presented, putEvidence, runShow, scenario, selectionOf, solidAtlas, toPanel, useBin,
  useTemp, viewOf, type Box, type JsonObject, type Panel, type Planted, type Pt,
} from './helpers.ts';

const ID = AC[4];
const bin = useBin('deep-show');
const temp = useTemp();
const D = { board: DOC(1), two: DOC(2), one: DOC(3), trees: DOC(4) };
const PANELS: Panel[] = [
  { doc: D.board, rect: [0, 0, 640, 384] }, { doc: D.two, rect: [680, 0, 256, 256] }, { doc: D.one, rect: [960, 0, 256, 256] },
  { doc: D.trees, rect: [0, 400, 640, 320] },
];
/** The issue's points: on the boards in the set's own u, on the tree's page in page u. */
const INSIDE: Pt = [4, 2];
const ON_EDGE: Pt = [8, 4];
const STANDING: Pt = [0, -12];
const BESIDE_TREE: Pt = [32, 30];
/** A point inside the tree's own cell, whether a square grid centers its cells on (cx × w, cy × h) or puts their corners there. */
const IN_TREE_CELL: Pt = [36, 52];
const from = (pos: Pt, [x, y]: Pt): Pt => [pos[0] + x, pos[1] + y];
/** A 1 u box about a page point: the spatial index's rows that stand over it. */
const about = ([x, y]: Pt): Box => [x - 0.5, y - 0.5, 1, 1];
/** Each board's rows by ID, as a failure names them. */
const BOARD = { 'board#0': 'the row at cell (0, 0) (board#0)', 'board#1': 'the row at cell (1, 0) (board#1)' };
const TWO = { 'tall#0': 'the row at cell (-1, -1) (tall#0)', 'tall#1': 'the row at cell (0, 0) (tall#1)' };
const ONE = { 'tall#0': 'the row at cell (0, 0) (tall#0)' };
const TREES = { 'tree#0': 'the tree at cell (2, 3) (tree#0)' };
const said = (selection: string[], rows: Record<string, string>): string => (selection.length ? selection.map((id) => rows[id] ?? id).join(' and ') : 'nothing');

interface Clicks {
  /** Each document's `deep_show` reply. */
  shown: Record<keyof typeof D, JsonObject>;
  /** The rows the spatial index holds under each click that the criterion puts on a tile's standing part. */
  under: { two: string[]; one: string[]; trees: string[] };
  /** The selection after each click. */
  selected: { inside: string[]; onEdge: string[]; two: string[]; one: string[]; inTreeCell: string[]; besideTree: string[] };
}
function clicks(planted?: Planted): Clicks {
  const ev = temp();
  const board = putEvidence(ev, solidAtlas([32, 16], [[64, 112, 72], [104, 152, 96]]));
  const tall = putEvidence(ev, solidAtlas([32, 32], [[196, 64, 48], [236, 196, 64]]));
  const docs = { board: boardDoc(board), two: tallDoc(tall, true), one: tallDoc(tall, false), trees: treesDoc(putEvidence(ev, treeAtlas())) };
  const o = { clock: true, ...(planted ? { planted } : {}) };
  const opened = (s: Script): { shown: number[]; scopes: number[] } => ({
    shown: (Object.keys(D) as (keyof typeof D)[]).map((k) => s.present(D[k], docs[k])),
    scopes: PANELS.map((_, i) => s.scope(`p${i + 1}`)),
  });
  // The camera each panel's scope shows its document with, before any input.
  const first = new Script();
  const firstAt = opened(first);
  const before = runShow(bin(), scenario(ev, PANELS, first.calls, o), 'AC4 the boards, presented and their scopes read');
  const [vBoard, vTwo, vOne, vTrees] = firstAt.scopes.map((i, k) => viewOf(before[i]!, `panel p${k + 1}`));
  // The clicks.
  const s = new Script();
  const at = opened(s);
  const under = { two: s.spatial(D.two, [about(from(TALL_POS, STANDING))]), one: s.spatial(D.one, [about(from(TALL_POS, STANDING))]), trees: s.spatial(D.trees, [about(BESIDE_TREE)]) };
  const click = {
    inside: s.click('p1', toPanel(vBoard!, from(BOARD_POS, INSIDE))), onEdge: s.click('p1', toPanel(vBoard!, from(BOARD_POS, ON_EDGE))),
    two: s.click('p2', toPanel(vTwo!, from(TALL_POS, STANDING))), one: s.click('p3', toPanel(vOne!, from(TALL_POS, STANDING))),
    inTreeCell: s.click('p4', toPanel(vTrees!, IN_TREE_CELL)), besideTree: s.click('p4', toPanel(vTrees!, BESIDE_TREE)),
  };
  const r = runShow(bin(), scenario(ev, PANELS, s.calls, o), 'AC4 the clicks');
  const shown = Object.fromEntries((Object.keys(D) as (keyof typeof D)[]).map((k, i) => [k, r[at.shown[i]!]!])) as Clicks['shown'];
  const selected = Object.fromEntries(Object.entries(click).map(([k, i]) => [k, selectionOf(r[i]!, `the click ${k}`)])) as Clicks['selected'];
  return {
    shown, selected,
    under: { two: metBy(r[under.two]!, 0, 'the tall board with (-1, -1)'), one: metBy(r[under.one]!, 0, 'the tall board without (-1, -1)'), trees: metBy(r[under.trees]!, 0, 'the tree\'s page') },
  };
}

/** One click's failure, naming the click and both rows: the one it selects and the one it must. */
const missed = (point: Pt, selection: string[], want: string[], rows: Record<string, string>): string[] =>
  (JSON.stringify(selection) === JSON.stringify(want) ? [] : [`click (${point[0]}, ${point[1]}) selects ${said(selection, rows)}, not ${said(want, rows)}`]);
/** The criterion's checks, clause by clause. */
const boardProblems = (c: Clicks): string[] => [...missed(INSIDE, c.selected.inside, ['board#0'], BOARD), ...missed(ON_EDGE, c.selected.onEdge, ['board#0'], BOARD)];
function tallProblems(c: Clicks): string[] {
  const out: string[] = [];
  // The tile at (0, 0) is tall#1 where the set holds (-1, -1) too, and tall#0 where it stands alone.
  if (!c.under.two.includes('tall#1')) out.push(`on the board with a row at (-1, -1), the tile at (0, 0) doesn't stand over (0, -12): the spatial index holds ${said(c.under.two, TWO)} there`);
  if (!c.under.one.includes('tall#0')) out.push(`on the board without a row at (-1, -1), the tile at (0, 0) doesn't stand over (0, -12): the spatial index holds ${said(c.under.one, ONE)} there`);
  return [
    ...out, ...missed(STANDING, c.selected.two, ['tall#0'], TWO).map((f) => `${f}, on the board with a row at (-1, -1)`),
    ...missed(STANDING, c.selected.one, [], ONE).map((f) => `${f}, on the board without a row at (-1, -1)`),
  ];
}
function treeProblems(c: Clicks): string[] {
  const out: string[] = [];
  if (!c.under.trees.includes('tree#0')) out.push(`the tree at (2, 3) doesn't stand over (32, 30): the spatial index holds ${said(c.under.trees, TREES)} there`);
  out.push(...missed(IN_TREE_CELL, c.selected.inTreeCell, ['tree#0'], TREES).map((f) => `${f}: a click inside the tree's own cell must reach it`));
  if (c.selected.besideTree.includes('tree#0')) out.push(`click (32, 30) selects ${said(c.selected.besideTree, TREES)}, whose cell (2, 3) doesn't hold the point`);
  return out;
}

const honest = once(() => clicks());

describe(`${ID} a row on a grid is hit through its cell and nothing else`, () => {
  it(`${ID} on an isometric grid with cell [32, 16] and no draw, a click at (4, 2) selects the row at cell (0, 0), and a click at (8, 4), on the edge it shares with (1, 0), selects (0, 0)`, () => {
    // The criterion's geometry: (4, 2) lies in (0, 0)'s diamond and outside (1, 0)'s, whose quad still covers it; (8, 4) lies on both diamonds' edges.
    expect(inDiamond(BOARD_GRID, [0, 0], INSIDE), 'the fixture: (4, 2) lies inside the diamond of (0, 0)').toBeLessThan(1);
    expect(inDiamond(BOARD_GRID, [1, 0], INSIDE), 'the fixture: (4, 2) lies outside the diamond of (1, 0)').toBeGreaterThan(1);
    expect(holds(quadAt(isoCentre(BOARD_GRID, 1, 0), BOARD_GRID, [0.5, 0.5]), INSIDE), 'the fixture: the quad of (1, 0), drawn above, covers (4, 2)').toBe(true);
    expect([inDiamond(BOARD_GRID, [0, 0], ON_EDGE), inDiamond(BOARD_GRID, [1, 0], ON_EDGE)], 'the fixture: (8, 4) lies on the edge (0, 0) and (1, 0) share').toEqual([1, 1]);
    const c = honest();
    presented(c.shown.board, 'the flat board');
    none(boardProblems(c), 'the two clicks on the flat board');
  }, TIMEOUT);

  it(`${ID} with draw [32, 32] and anchor [0.5, 0.75], a click at (0, −12), on the standing part of the tile at (0, 0), selects the row at cell (−1, −1) when the set has one and nothing when it doesn't`, () => {
    // The criterion's geometry: (0, −12) lies in (0, 0)'s drawn quad, outside its diamond, and inside the diamond of (−1, −1).
    expect(holds(quadAt(isoCentre(BOARD_GRID, 0, 0), TALL_DRAW, TALL_ANCHOR), STANDING), 'the fixture: the drawn quad of the tile at (0, 0) covers (0, −12)').toBe(true);
    expect(inDiamond(BOARD_GRID, [0, 0], STANDING), 'the fixture: (0, −12) lies outside the diamond of (0, 0), on the tile\'s standing part').toBeGreaterThan(1);
    expect(inDiamond(BOARD_GRID, [-1, -1], STANDING), 'the fixture: (0, −12) lies inside the diamond of (−1, −1)').toBeLessThan(1);
    const c = honest();
    presented(c.shown.two, 'the tall board with a row at (−1, −1)');
    presented(c.shown.one, 'the tall board without one');
    none(tallProblems(c), 'the click on the tile\'s standing part');
  }, TIMEOUT);

  it(`${ID} on the third criterion's square grid a click at (32, 30) never selects the tree at (2, 3)`, () => {
    // The criterion's geometry: (32, 30) lies in the tree's drawn quad and outside its cell's square, wherever a square grid puts a cell's corner.
    const centre = squareCentre(TREE_GRID, 2, 3);
    expect(holds(quadAt(centre, TREE_DRAW, [0.5, 0.75]), BESIDE_TREE), 'the fixture: the tree\'s drawn quad covers (32, 30)').toBe(true);
    for (const cell of [quadAt(centre, TREE_GRID, [0.5, 0.5]), quadAt(centre, TREE_GRID, [0, 0])]) {
      expect(holds(cell, BESIDE_TREE), 'the fixture: the square of cell (2, 3) doesn\'t hold (32, 30)').toBe(false);
      expect(holds(cell, IN_TREE_CELL), 'the fixture: the square of cell (2, 3) holds (36, 52)').toBe(true);
    }
    const c = honest();
    presented(c.shown.trees, 'the tree\'s page');
    none(treeProblems(c), 'the click beside the tree');
  }, TIMEOUT);

  it(`${ID} planted grid_hit_reads_quads selects (1, 0) at (4, 2) and fails, naming the click and both rows`, () => {
    const twin = clicks('grid_hit_reads_quads');
    expect(twin.selected.inside, 'the planted hit test reads quads: at (4, 2) it takes the row at (1, 0), whose quad is drawn above').toEqual(['board#1']);
    failsNaming(boardProblems(twin), [/click \(4, 2\)/, /cell \(0, 0\)/, /cell \(1, 0\)/], 'the clicks under grid_hit_reads_quads');
    // The clauses the merge base already meets fail on this program too: it takes the tile whose quad stands over the point.
    failsNaming(tallProblems(twin), [/click \(0, -12\) selects the row at cell \(0, 0\)/], 'the click on the standing part under grid_hit_reads_quads');
    failsNaming(treeProblems(twin), [/click \(32, 30\)/, /tree#0/], 'the click beside the tree under grid_hit_reads_quads');
  }, TIMEOUT);
});
