// AC1: "Rebuilding a recipe with the same inputs keeps its generated items' IDs, and a patch aimed at a
// generated item is refused as derived"
//
// asserts: on the stored chart board (your layer: c1 and c2, each chart.bars@1 with n = 5, and a plain
// rect) in the build without scene3d, revision 0 expands c1 into exactly c1.bars.0 … c1.bars.4; a patch to
// the plain rect, then a patch of c1's n to 6 and one back to 5, each apply, and after each rebuild with
// n = 5 the derived IDs, the expansion key and the derived items are the ones revision 0 had; a `set` on
// c1.bars.1 and a `delete` of c1.bars.3 are each refused with `derived_item` naming the derived item, and
// revision 0 stays current.

import { describe, expect, it } from 'vitest';
import {
  CHART, DOC, R1, canon, currents, derivedIds, errors, expansionOf, fixture, issues, outcome, patch, patchId, read, revisionsOf, run, scenario, sorted,
  useBuilds, useEvidence, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();
const BOARD = fixture('chart-board.json');
const BARS = derivedIds('c1', 'bars', 5);

const setN = (id: string, base: number, n: number): JsonObject =>
  ({ patch: id, doc: DOC.a, base, reason: `set c1's n to ${n}`, ops: [{ op: 'set', id: 'c1', path: 'items/c1/params/n', value: n }] });

describe('AC1 rebuilding a recipe with the same inputs keeps its derived IDs, and a patch aimed at a derived item is refused as derived', () => {
  it('AC1 after a patch elsewhere and after n goes to 6 and back to 5, c1 expands into the same derived IDs under the same key', () => {
    const [first, moved, afterMove, up, down, back] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: { panel: 'main', document: BOARD } }, [CHART], [
      read(DOC.a),
      patch(DOC.a, { patch: patchId(1), doc: DOC.a, base: 0, reason: 'nudge the frame', ops: [{ op: 'set', id: 'frame', path: 'items/frame/params/box', value: [20, 20, 600, 320] }] }),
      read(DOC.a),
      patch(DOC.a, setN(patchId(2), 1, 6)),
      patch(DOC.a, setN(patchId(3), 2, 5)),
      read(DOC.a),
    ]));
    const at0 = expansionOf(first!, 'c1', 'revision 0');
    expect(sorted(Object.keys(at0.derived)), 'c1 with n = 5 expands into c1.bars.0 … c1.bars.4').toEqual(BARS);
    for (const [reply, what] of [[moved!, 'the patch to the plain rect'], [up!, 'the patch of n to 6'], [down!, 'the patch of n back to 5']] as const) {
      expect(outcome(reply), `${what} applies: ${JSON.stringify(reply['issues']).slice(0, 600)}`).toBe('applied');
    }
    expect(sorted(Object.keys(expansionOf(up!, 'c1', 'with n = 6').derived)), 'with n = 6 c1 expands into six bars').toEqual(derivedIds('c1', 'bars', 6));
    for (const [reply, what] of [[afterMove!, 'after the frame moved'], [back!, 'after n went to 6 and back to 5']] as const) {
      const now = expansionOf(reply, 'c1', what);
      expect(sorted(Object.keys(now.derived)), `${what}, the rebuild with n = 5 keeps the derived IDs`).toEqual(BARS);
      expect(now.key, `${what}, the rebuild with the same inputs has the same expansion key`).toBe(at0.key);
      expect(canon(now.derived), `${what}, the rebuild with the same inputs gives the same derived items`).toBe(canon(at0.derived));
    }
  });

  it('AC1 a set on c1.bars.1 and a delete of c1.bars.3 are each refused with derived_item naming the item, and revision 0 stays current', () => {
    const [before, set, del, after] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: { panel: 'main', document: BOARD } }, [CHART], [
      revisionsOf(DOC.a),
      patch(DOC.a, { patch: patchId(4), doc: DOC.a, base: 0, reason: 'widen one bar', ops: [{ op: 'set', id: 'c1.bars.1', path: 'items/c1.bars.1/params/box', value: [0, 0, 32, 48] }] }),
      patch(DOC.a, { patch: patchId(5), doc: DOC.a, base: 0, reason: 'drop one bar', ops: [{ op: 'delete', id: 'c1.bars.3' }] }),
      revisionsOf(DOC.a),
    ]));
    for (const [reply, id] of [[set!, 'c1.bars.1'], [del!, 'c1.bars.3']] as const) {
      expect(outcome(reply), `the patch aimed at ${id} is refused`).toBe('refused');
      const derived = errors(issues(reply)).filter((i) => i.code === 'derived_item');
      expect(derived.length, `the refusal of the patch aimed at ${id} carries a derived_item error: ${JSON.stringify(reply['issues']).slice(0, 600)}`).toBeGreaterThan(0);
      expect(derived.some((i) => i.ids.includes(id)), `a derived_item issue names ${id}: ${JSON.stringify(derived.map((i) => i.ids))}`).toBe(true);
    }
    expect(currents(before!).length, 'revision 0 of the stored board is current').toBe(1);
    expect(currents(after!), 'revision 0 is still current after the two refusals').toEqual(currents(before!));
  });
});
