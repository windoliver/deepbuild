// AC3 #2386.022a979d: On a square grid with cell [16, 16], a set with `atlas.cell: [16, 32]`, `draw: [16, 32]` and
// `anchor: [0.5, 0.75]` gives the row at cell (2, 3) the box [24, 24, 16, 32]. A free row of the same atlas with
// `anchor: [0.5, 1]` at (100, 50) has the box [92, 18, 16, 32], and turned 90° it turns about (100, 50). A planted draw
// that anchors every quad at its center fails, naming the first row
//
// The fixtures (fixtures.ts `treesDoc`, `turnedDoc`), each set at the page's origin, so the criterion's boxes are page
// u as written: `tree`, one row on cell (2, 3) of the square grid; `free`, one free row of the same atlas at (100, 50)
// with `anchor: [0.5, 1]`; and, on a page of its own, the same free row with `angle` 90. Each set holds one row, so its
// bounds are that row's box. Through `deep-show run`: `spatial` (the set's bounds; the index, probed on each side of
// the box) and `deep_show` with pixels (its `visible` table; the turned row's snapshot). "Turns about (100, 50)" is
// judged without choosing a sense: the box is one of the two quarter turns of [92, 18, 16, 32] about that point, and
// the snapshot draws over exactly that box. The planted program is the scenario's `planted: "draw_anchors_at_center"`.
// README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import { TREE_DRAW, TREE_GRID, quadAt, squareCentre, treeAtlas, treesDoc, turnedDoc } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, boundsOf, boxProblems, boxText, drawnExtent, failsNaming, none, once, pngOf, presented, putEvidence, runShow, sameBox, scenario,
  showCall, shownSnapshot, sideProbes, spatialCall, useBin, useTemp, type Box, type Image, type JsonObject, type Planted, type Pt,
} from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-show');
const temp = useTemp();
const D = { trees: DOC(1), turned: DOC(2) };
/** The issue's boxes and point, written out. */
const TREE: Box = [24, 24, 16, 32];
const FREE: Box = [92, 18, 16, 32];
const ABOUT: Pt = [100, 50];
/** [92, 18, 16, 32] turned a quarter turn about (100, 50): clockwise on screen, and the other way. */
const TURNED: [Box, Box] = [[100, 42, 32, 16], [68, 42, 32, 16]];
/** What the planted draw gives the tree: its 16 × 32 quad with its own center on the cell's center (32, 48). */
const TREE_CENTERED: Box = [24, 32, 16, 32];

/** `b` turned a quarter turn about `p`, clockwise on screen (y down) when `cw`. */
function quarterTurn([x, y, w, h]: Box, [px, py]: Pt, cw: boolean): Box {
  const corners: Pt[] = ([[x, y], [x + w, y + h]] as Pt[]).map(([cx, cy]): Pt => (cw ? [px - (cy - py), py + (cx - px)] : [px + (cy - py), py - (cx - px)]));
  const [a, b] = corners as [Pt, Pt];
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), h, w];
}

interface Part { shown: JsonObject; spatial: JsonObject }
interface Run { trees: Part; turned: Part; turnedSnapshot: Image }
function treesRun(planted?: Planted): Run {
  const ev = temp();
  const atlas = putEvidence(ev, treeAtlas());
  const calls = [
    showCall(D.trees, treesDoc(atlas), true), spatialCall(D.trees, [...sideProbes(TREE), ...sideProbes(FREE)]),
    showCall(D.turned, turnedDoc(atlas), true), spatialCall(D.turned, [...sideProbes(TURNED[0]), ...sideProbes(TURNED[1])]),
  ];
  const panels = [{ doc: D.trees, rect: [0, 0, 640, 320] as Box }, { doc: D.turned, rect: [0, 340, 640, 320] as Box }];
  const r = runShow(bin(), scenario(ev, panels, calls, planted ? { planted } : {}), 'AC3 the tree and the free row') as [JsonObject, JsonObject, JsonObject, JsonObject];
  presented(r[0], 'the tree and the free row');
  presented(r[2], 'the free row turned 90°');
  return { trees: { shown: r[0], spatial: r[1] }, turned: { shown: r[2], spatial: r[3] }, turnedSnapshot: pngOf(ev, shownSnapshot(r[2], 'the turned row'), 'the turned row\'s snapshot') };
}

/** The criterion's checks, in its order; each failure names its row and both boxes. */
const treeProblems = (run: Run): string[] => boxProblems('tree#0', 'row tree#0 at cell (2, 3)', run.trees.shown, run.trees.spatial, 0, TREE);
const freeProblems = (run: Run): string[] => boxProblems('free#0', 'row free#0, free at (100, 50)', run.trees.shown, run.trees.spatial, 8, FREE);
function turnedProblems(run: Run): string[] {
  const named = 'row free#0, free at (100, 50) turned 90°';
  const each = TURNED.map((b, k) => boxProblems('free#0', named, run.turned.shown, run.turned.spatial, 8 * k, b));
  const k = each.findIndex((p) => p.length === 0);
  const turns = `[92, 18, 16, 32] turned a quarter turn about (100, 50), ${boxText(TURNED[0])} or ${boxText(TURNED[1])}`;
  if (k < 0) return [`${named}: its box is ${boxText(boundsOf(run.turned.spatial, 'free', named))}, not ${turns} (${each[0]![0]})`];
  const over = drawnExtent(run.turnedSnapshot);
  return over && sameBox(over, TURNED[k]!) ? [] : [`${named}: its box is ${boxText(TURNED[k]!)}, but the snapshot draws over ${over ? boxText(over) : 'nothing'}`];
}
const problems = (run: Run): string[] => [...treeProblems(run), ...freeProblems(run), ...turnedProblems(run)];

const honest = once(() => treesRun());

describe(`${ID} a tall tile on a square grid, and a free row, draw from their anchors`, () => {
  it(`${ID} with atlas.cell [16, 32], draw [16, 32] and anchor [0.5, 0.75] on a square grid of cell [16, 16], the row at cell (2, 3) has the box [24, 24, 16, 32]`, () => {
    expect(quadAt(squareCentre(TREE_GRID, 2, 3), TREE_DRAW, [0.5, 0.75]), 'the issue\'s rule gives its own box: the drawn quad placed so its anchor is on the cell\'s center (32, 48)').toEqual(TREE);
    none(treeProblems(honest()), 'the box of the row at cell (2, 3)');
  }, TIMEOUT);

  it(`${ID} a free row of the same atlas with anchor [0.5, 1] at (100, 50) has the box [92, 18, 16, 32]`, () => {
    expect(quadAt(ABOUT, TREE_DRAW, [0.5, 1]), 'the issue\'s rule gives its own box: the drawn quad placed so its anchor is on (100, 50)').toEqual(FREE);
    none(freeProblems(honest()), 'the box of the free row');
  }, TIMEOUT);

  it(`${ID} turned 90°, the free row turns about (100, 50)`, () => {
    expect([quarterTurn(FREE, ABOUT, true), quarterTurn(FREE, ABOUT, false)], 'the fixture: the two quarter turns of [92, 18, 16, 32] about (100, 50)').toEqual(TURNED);
    none(turnedProblems(honest()), 'the free row turned 90°');
  }, TIMEOUT);

  it(`${ID} planted draw_anchors_at_center anchors every quad at its center and fails, naming the first row`, () => {
    const twin = treesRun('draw_anchors_at_center');
    const tree = boundsOf(twin.trees.spatial, 'tree', 'the tree under draw_anchors_at_center');
    expect(sameBox(tree, TREE_CENTERED), `the planted draw keeps the tree's 16 × 32 quad and centers it on the cell's center: ${boxText(TREE_CENTERED)}; it gives ${boxText(tree)}`).toBe(true);
    const failures = problems(twin);
    failsNaming(failures, [/tree#0/, /cell \(2, 3\)/], 'the boxes under draw_anchors_at_center');
    expect(failures[0], 'the first failure names the first row, the tree at cell (2, 3)').toContain('tree#0');
  }, TIMEOUT);
});
