// AC3 #1636.1bc36a69: "Along each branch the frame turns between consecutive rings by no more than the declared roll plus
// 0.5°, measured from the rings' first vertices. A planted builder using curvature frames flips at an inflection and
// fails, naming the branch and the ring"
//
// The fixture tree (helpers.ts `FIXTURE`, `roll: 30`), read by `geometry` (README: Assumed surfaces 4). For each two
// consecutive rings of a branch, the turn is the angle about the branch between ring k's first vertex (from its centre,
// in its plane) carried to ring k + 1's plane by the least rotation between the two rings' normals (Newell's, over
// their vertices), and ring k + 1's first vertex (README: Readings). The bound is the declared roll plus 0.5°: 30.5°.
//   - First test, the shipped builder: no turn passes 30.5° on any of the 40 branches' 280 ring pairs; and the tree has
//     an inflection, a branch whose curvature from its ring centres reverses between two interior rings (README: Assumed
//     surfaces 3), since the plant is judged there.
//   - Second test, `planted: tree_curvature_frames` (README: Planted programs), beside the shipped build: some turn
//     passes 30.5°, each failure names its branch and ring, and one of them lies at an inflection the shipped build has
//     (the same branch, a ring within one of it).
// Wrong programs: the base (no tree@1); the plant; frames held to an up vector, which spin where a branch passes near it;
// a twist accumulated along the branch faster than the roll.
import { describe, expect, it } from 'vitest';
import {
  AC, FIXTURE, TIMEOUT, docId, frameTurns, geometry, inflections, none, presented, runShow, scenario, show, topologyFailures, treeItem, treeRow,
  treesDoc, turnFailure, useBins, useFolders, type Planted, type TreeRow,
} from './helpers.ts';

const ID = AC[3];
const NAME = `AC3 ${ID}`;
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(3);
const BOUND = FIXTURE.roll + 0.5;

function built(planted?: Planted): TreeRow {
  const [shown, read] = runShow(bin('deep-show'), scenario(folder(), [DOC], [show(DOC, treesDoc({ tree: treeItem(FIXTURE) })), geometry(DOC, ['tree'])], planted ? { planted } : {}));
  presented(shown!, `the fixture tree${planted ? ` under ${planted}` : ''}`);
  return treeRow(read!, 'tree', `the fixture tree${planted ? ` under ${planted}` : ''}`);
}

describe(`${NAME} rotation-minimizing frames along every branch`, () => {
  it(`${NAME} along each branch of the fixture the frame turns between consecutive rings by no more than roll 30° + 0.5°, and the fixture has an inflection to judge the plant at`, () => {
    const row = built();
    none(topologyFailures(row, FIXTURE), 'the fixture has its 40 branches');
    const turns = frameTurns(row);
    expect(turns.length, 'every branch\'s ring pairs are measured: 40 branches × 7').toBe(40 * (FIXTURE.rings - 1));
    none(turns.filter((t) => Math.abs(t.deg) > BOUND).map((t) => turnFailure(t, BOUND)), `no frame turns more than ${BOUND}° between consecutive rings`);
    const bends = inflections(row);
    console.log(`${ID} the shipped fixture: largest turn ${Math.max(...turns.map((t) => Math.abs(t.deg))).toFixed(3)}°, inflections at ${bends.map((b) => `${b.branch} ring ${b.ring}`).join(', ') || 'none'}`);
    expect(bends.length, 'the fixture tree has a branch whose curvature reverses (README: Assumed surfaces 3), where the planted curvature frames flip').toBeGreaterThan(0);
  }, 2 * TIMEOUT);

  it(`${NAME} the planted tree_curvature_frames flips at an inflection and fails, naming the branch and the ring`, () => {
    const bends = inflections(built());
    const planted = built('tree_curvature_frames');
    const over = frameTurns(planted).filter((t) => Math.abs(t.deg) > BOUND);
    const failures = over.map((t) => turnFailure(t, BOUND));
    console.log(`${ID} tree_curvature_frames:\n  ${failures.slice(0, 8).join('\n  ')}`);
    expect(failures.length, 'the planted builder\'s frames turn past the bound somewhere').toBeGreaterThan(0);
    expect(failures.every((f) => /^branch b\d+ ring \d+:/.test(f)), 'each failure names its branch and its ring').toBe(true);
    const atBend = over.filter((t) => bends.some((b) => b.branch === t.branch && Math.abs(b.ring - t.ring) <= 1));
    expect(atBend.map((t) => turnFailure(t, BOUND)), `a failure lies at an inflection of the shipped build (${bends.map((b) => `${b.branch} ring ${b.ring}`).join(', ') || 'none'})`).not.toEqual([]);
  }, 2 * TIMEOUT);
});
