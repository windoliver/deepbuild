// AC6 #1636.0863f261: "`leaves {per_twig: 6}` places exactly 6 cards per twig, each centred in its twig's last 20% of
// length, and the card count is part of the bound before the build"
//
// The fixture tree (helpers.ts `FIXTURE`: `leaves {per_twig: 6, size: 0.12}`; 36 twigs, the branches of level 3 and up,
// README: Assumed surfaces 2), read by `geometry` with its `cards` (Assumed surfaces 4).
//   - First test: each twig holds exactly 6 cards (216 in all) and no other branch holds one; each card's centre (the
//     mean of its vertices) lies within the card size, 0.12 m, of its twig's centreline (the polyline through its ring
//     centres), at 80% to 100% of the twig's length along it (0.5% of the length allowed for the polyline, README:
//     Readings); no two cards and no card and tube share a vertex.
//   - Second test: the same tree with `per_twig: 6` and with `per_twig: 3`, each `estimate_only` (nothing built) and
//     then built: each bound equals its build's vertex count; the builds hold 216 and 108 cards; the tubes' vertices
//     are the same in both, and the two bounds differ by exactly the cards' vertices.
// Wrong programs: the base (no tree@1); cards on the tips only, or on every branch; cards spread along the whole twig, or
// at its base; a bound computed without the cards (it misses by their vertices); cards made after the count.
import { describe, expect, it } from 'vitest';
import {
  AC, FIXTURE, TIMEOUT, cardFailures, declaredOf, docId, geometry, none, presented, runShow, scenario, show, topology, topologyFailures, treeItem,
  treeRow, treesDoc, useBins, useFolders,
} from './helpers.ts';

const ID = AC[6];
const NAME = `AC6 ${ID}`;
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(7);
const TWIGS = topology(FIXTURE).twigs;

describe(`${NAME} leaf cards at the twigs, counted before the build`, () => {
  it(`${NAME} leaves {per_twig: 6} places exactly 6 cards on each twig, each centred in its twig's last 20% of length`, () => {
    const [shown, read] = runShow(bin('deep-show'), scenario(folder(), [DOC], [show(DOC, treesDoc({ tree: treeItem(FIXTURE) })), geometry(DOC, ['tree'])]));
    presented(shown!, 'the fixture tree');
    const row = treeRow(read!, 'tree', 'the fixture tree');
    none(topologyFailures(row, FIXTURE), 'the fixture has its 40 branches');
    expect(row.cards.length, `the fixture's ${TWIGS} twigs hold 6 cards each`).toBe(6 * TWIGS);
    none(cardFailures(row, 6, FIXTURE.leaves.size), 'each twig holds 6 cards, each centred in its last 20%');
  }, 2 * TIMEOUT);

  it(`${NAME} the card count is part of the vertex bound computed before the build`, () => {
    const three = { ...FIXTURE, leaves: { per_twig: 3, size: FIXTURE.leaves.size } };
    const doc = treesDoc({ six: treeItem(FIXTURE), three: treeItem(three, { at: { pos: [20, 0, 0] } }) });
    const [shown, bound, read] = runShow(bin('deep-show'), scenario(folder(), [DOC], [show(DOC, doc), geometry(DOC, ['six', 'three'], { estimate_only: true }), geometry(DOC, ['six', 'three'])]));
    presented(shown!, 'the trees with 6 and 3 cards a twig');
    const tubes: number[] = [];
    const bounds: number[] = [];
    for (const [id, per] of [['six', 6], ['three', 3]] as const) {
      const declared = declaredOf(bound!, id, `the bound of ${id}`);
      const row = treeRow(read!, id, id);
      expect(row.cards.length, `${id} holds ${per} cards on each of its ${TWIGS} twigs`).toBe(per * TWIGS);
      expect(row.positions.length, `${id}'s vertex count equals the bound computed before the build`).toBe(declared);
      const cardVertices = row.cards.reduce((s, c) => s + c.vertices.length, 0);
      tubes.push(declared - cardVertices);
      bounds.push(declared);
    }
    expect(tubes[1], 'the tubes hold the same vertices whatever the cards').toBe(tubes[0]);
    expect(bounds[0]! - bounds[1]!, 'the bound before the build grows by exactly the extra cards\' vertices').toBeGreaterThan(0);
  }, 2 * TIMEOUT);
});
