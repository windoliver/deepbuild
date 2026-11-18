// AC4 #1636.da99f8e9: "Over 20 seeds, the geometry audit on a capsule chain per branch finds no two branches overlapping
// by more than 2 mm outside 1.5 parent radii of their shared fork"
//
// The audit is #405's `geometry.audit`, a requirement of a claim of the agent's judged by `verdict`, with
// `{scope: scene, tolerance: {sunk: 0.002}, support: {floating: [the trees]}}`: a tree enters it as one solid per branch,
// `<item>#<branch>`, its capsule chain, and an overlap is excused only within 1.5 parent radii of a fork the two
// branches share (README: Assumed surfaces 6).
//   - First test: one document of 20 trees, the fixture's params at seeds 1 to 20, 30 m apart. The audit's row is PASS
//     with no `geometry.overlap`; and the test's own judge, the same rule on the capsule chains it measures from each
//     tree's rings (`geometry`), finds no overlap past 2 mm outside a shared fork's zone in any of them.
//   - Second test, the trap: two trees of seeds 1 and 2 at one place, whose trunks rise from the same point and share
//     no fork. The test's judge finds `a#b0` and `b#b0` passing into each other; the audit fails, naming both.
// Wrong programs: the base (no tree@1); siblings that leave their fork too close together, or children that cross a
// neighbour's branch; an audit that reads a tree as one solid, or skips the trees (the trap); an audit that excuses
// every pair at a fork wherever they meet (the first test's own judge).
import { describe, expect, it } from 'vitest';
import {
  AC, FIXTURE, TIMEOUT, claimId, claimOf, docId, geometry, none, overlapFailures, presented, reqId, requirementRow, runShow, scenario, show,
  topologyFailures, treeItem, treeRow, treesDoc, useBins, useFolders, verdict, type JsonObject,
} from './helpers.ts';

const ID = AC[4];
const NAME = `AC4 ${ID}`;
const bin = useBins(['deep-show']);
const folder = useFolders();
const SEEDS = Array.from({ length: 20 }, (_, k) => k + 1);
const tid = (seed: number): string => `tree-s${String(seed).padStart(2, '0')}`;
const audit = (floating: string[]): JsonObject => ({ kind: 'geometry.audit', scope: 'scene', tolerance: { sunk: 0.002 }, support: { floating } });

function audited(doc: string, n: number, trees: Record<string, JsonObject>): { rows: Map<string, ReturnType<typeof treeRow>>; row: ReturnType<typeof requirementRow> } {
  const ids = Object.keys(trees);
  const claims = { [claimId(n)]: claimOf(doc, reqId(n), audit(ids)) };
  const [shown, read, judged] = runShow(bin('deep-show'), scenario(folder(), [doc], [show(doc, treesDoc(trees)), geometry(doc, ids), verdict(claimId(n))], { claims }));
  presented(shown!, `${ids.length} trees`);
  return { rows: new Map(ids.map((id) => [id, treeRow(read!, id, id)])), row: requirementRow(judged!, reqId(n), 'the geometry audit') };
}

describe(`${NAME} no two branches overlap outside a shared fork, over 20 seeds`, () => {
  it(`${NAME} over seeds 1 to 20 the geometry audit on a capsule chain per branch finds no two branches overlapping by more than 2 mm outside 1.5 parent radii of their shared fork`, () => {
    const trees = Object.fromEntries(SEEDS.map((seed) => [tid(seed), treeItem({ ...FIXTURE, seed }, { at: { pos: [30 * (seed - 1), 0, 0] } })]));
    const { rows, row } = audited(docId(4), 4, trees);
    for (const [id, t] of rows) {
      none(topologyFailures(t, FIXTURE), `${id} has the fixture's 40 branches`);
      none(overlapFailures([{ item: id, row: t }]), `the capsule chains of ${id}'s rings: no two branches overlap past 2 mm outside 1.5 parent radii of a shared fork`);
    }
    const overlaps = row.issues.filter((i) => i.code === 'geometry.overlap');
    none(overlaps.map((i) => `${i.ids.join(' and ')}: ${JSON.stringify(i.raw).slice(0, 400)}`), 'the geometry audit finds no two branches overlapping');
    expect(row.result, `the audit's row passes: ${JSON.stringify(row.raw).slice(0, 2000)}`).toBe('PASS');
  }, 3 * TIMEOUT);

  it(`${NAME} the trap: two trees whose trunks rise from one point, and the audit names both trunks' capsule chains`, () => {
    const { rows, row } = audited(docId(5), 5, { a: treeItem({ ...FIXTURE, seed: 1 }), b: treeItem({ ...FIXTURE, seed: 2 }) });
    const own = overlapFailures([{ item: 'a', row: rows.get('a')! }, { item: 'b', row: rows.get('b')! }]);
    expect(own.some((f) => f.startsWith('a#b0 and b#b0 ')), `the trap is live: the two trunks pass into each other (${own.slice(0, 3).join('; ')})`).toBe(true);
    const named = row.issues.filter((i) => i.code === 'geometry.overlap').map((i) => i.ids.join(' and '));
    console.log(`${ID} the trap's overlaps: ${named.slice(0, 6).join('; ')}`);
    expect(named, `the audit names the two trunks' solids: ${JSON.stringify(row.raw).slice(0, 2000)}`).toContain('a#b0 and b#b0');
    expect(row.result, 'the audit fails the trap').not.toBe('PASS');
  }, 2 * TIMEOUT);
});
