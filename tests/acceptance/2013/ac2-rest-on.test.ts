// #2013.8f9fddef: "rest_on puts a vase on a table so the geometry audit finds no gap and no overlap past 2 mm, and a
// static item resolves at check with nothing per frame"
//
// Fixture (helpers.ts, `vaseDoc`), shown by the working agent through deep_show: `table`, a 1.2 × 0.05 × 0.8 m top
// tilted 20° about +Z, and `vase`, a ball of radius 0.1 m written 0.3 m left of the table's centre at y 1.2, with the
// constraint `rest: {owner: vase, kind: rest_on, on: table}` and every default (axis (0, −1, 0), contact true_shape,
// offset 0, max_drop 10). Nothing in the document moves. The definition's check on it is the scene audit at 2 mm,
// `{kind: geometry.audit, scope: scene, tolerance: {sunk: 0.002, touch: 0.002, land: 0.002}, support: {floating:
// [table]}}`, a requirement of a claim of the agent's.
//
// asserts:
//   - the vase's evaluated place (`deep_query` of items/vase/at/pos): it moved along the axis alone (x and z as
//     written), and its ball is within 2 mm of the table's true shape, neither apart nor passing in (the test's own
//     judge, from the fixture's numbers: the centre rests at y 0.82383);
//   - the geometry audit's row on the verdict is PASS with no error or warning: no gap, no overlap;
//   - nothing per frame: of six frames 1/60 s apart, every one after the first runs no node (`ran` is 0).
//
// Wrong programs this fails on, with no planted program in shipped code:
//   - a rest_on that leaves the item where it was (or rests it on the ground plane y = 0, as the base's does): the vase
//     is 0.35 m above the table or 0.52 m under it, and the audit reports it floating;
//   - a rest_on that rests bounds on bounds: the table's bounds top is at y 1.0287, so the vase stops 0.286 m above the
//     tilted top, a gap;
//   - a rest_on that drops the vase's lowest point onto the surface under its centre: the ball passes 6.0 mm into the
//     tilted top, an overlap past 2 mm;
//   - a rest_on that solves again in every frame (as the base's constraints do): frames after the first run a node.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, TOLERANCE, VASE, VASE_CHECK, arr, brief, claimId, claimOf, docId, frames, isObject, none, num, obj, passFailures, presented, query, reqId,
  rowOf, run, scenarioOf, show, useFolders, useShow, vaseDoc, vaseGap, vaseRestY, verdict,
  type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[2];
const bin = useShow();
const folder = useFolders();
const DOC = docId(2);
const POS = 'items/vase/at/pos';

/** Why the vase with its centre at `c` doesn't rest on the table: it left its axis, or a gap or an overlap past 2 mm. */
function restFailures(c: V3): string[] {
  const failures: string[] = [];
  if (Math.abs(c[0] - VASE.x) > 1e-6 || Math.abs(c[2]) > 1e-6) failures.push(`the vase left its axis (0, −1, 0): it is at x ${c[0]}, z ${c[2]}, written at x ${VASE.x}, z 0`);
  const gap = vaseGap(c);
  if (gap > TOLERANCE) failures.push(`the vase at y ${c[1]} is ${gap} m from the table's true shape: a gap past ${TOLERANCE} m`);
  if (gap < -TOLERANCE) failures.push(`the vase at y ${c[1]} passes ${-gap} m into the table's true shape: an overlap past ${TOLERANCE} m`);
  return failures;
}
/** The judge fails its planted places: where the vase was written, bounds on bounds, and its lowest point on the surface under its centre. */
function judgeFailsItsPlants(): void {
  expect(restFailures([VASE.x, vaseRestY(), 0]), 'the judge passes the vase where its ball touches the tilted top').toEqual([]);
  expect(restFailures([VASE.x, VASE.start, 0]).join(), 'the judge fails the vase left where it was written').toContain('a gap');
  expect(restFailures([VASE.x, 0, 0]).join(), 'the judge fails the vase rested on the ground plane').toContain('a gap');
  expect(restFailures([VASE.x, 1.0287 + VASE.r, 0]).join(), 'the judge fails the vase rested on the table\'s bounds').toContain('a gap');
  expect(restFailures([VASE.x, vaseRestY() - 0.0064, 0]).join(), 'the judge fails the vase dropped onto the surface under its centre').toContain('an overlap');
  expect(restFailures([VASE.x + 0.01, vaseRestY() + 0.00364, 0]).join(), 'the judge fails a vase that slid sideways').toContain('left its axis');
}

/** The vase's evaluated centre from a deep_query reply. */
function vaseAt(reply: JsonObject): V3 {
  const at = arr(arr(obj(reply['values'], 'the query\'s values')[POS], `values[${POS}]`)[0], `${POS} at 0 s`);
  expect(at.length, `${POS} holds three numbers`).toBe(3);
  return [num(at[0], `${POS}[0]`), num(at[1], `${POS}[1]`), num(at[2], `${POS}[2]`)];
}

describe(`${ID} rest_on puts a vase on a table at check`, () => {
  it(`${ID} the vase's true shape meets the table's, and the geometry audit finds no gap and no overlap past 2 mm`, () => {
    judgeFailsItsPlants();
    const claims = { [claimId(2)]: claimOf(DOC, reqId(2), VASE_CHECK) };
    const [shown, read, judged] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, vaseDoc()), query(DOC, [POS]), verdict(claimId(2))], { claims }));
    presented(shown!, 'the vase over the table');
    none(restFailures(vaseAt(read!)), 'rest_on (on: table) puts the vase on the table\'s true shape, within 2 mm');
    none(passFailures(rowOf(judged!, reqId(2), 'the vase on the table'), 'the geometry audit of the vase on the table'), 'the geometry audit finds no gap and no overlap past 2 mm');
  }, TIMEOUT);

  it(`${ID} the static vase resolves at check: it rests on the table in the revision shown, and no frame after the first runs anything`, () => {
    judgeFailsItsPlants();
    const COUNT = 6;
    const [shown, read, played] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, vaseDoc()), query(DOC, [POS]), frames(DOC, COUNT)]));
    presented(shown!, 'the vase over the table');
    none(restFailures(vaseAt(read!)), 'the vase rests on the table once the revision is checked');
    const list = arr(played!['frames'], 'the frames reply\'s frames').filter(isObject);
    expect(list.length, `${COUNT} frames`).toBe(COUNT);
    const ran = list.slice(1).map((f, k) => num(f['ran'], `frame ${k + 1}: ran`));
    expect(ran, `nothing per frame: with nothing moving, no frame after the first runs a node (each frame's ran): ${brief(list.map((f) => f['ran'] ?? null))}`).toEqual(ran.map(() => 0));
  }, TIMEOUT);
});
