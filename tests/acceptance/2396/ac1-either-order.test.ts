// #2396.e524c371: "The document above presents with its items in either order, and the vase's rested place at 0, 1
// and 2 s is the same in both."
//
// Fixture (helpers.ts, `liftedDoc`): the issue's document. `vase`, a ball of radius 0.1 m written at (0.2, 1.0, 0.1),
// rests on `table` (`rest: {owner: vase, kind: rest_on, on: table}`, every default), a 1.2 × 0.05 × 0.8 m top whose
// height the channel `lift` keys from 0 at 0 s to 0.25 m at 2 s; plus `cam`, a camera, and `flag`, a slab 3 m to the
// side. It is listed in the issue's two orders, cam, flag, table, vase (ID order) and cam, table, vase, flag, with the
// same IDs, order keys and fields; each is shown by the working agent in a run of its own under the same document ID.
//
// asserts, for each order:
//   - the show is presented, with no error issue (no no_support);
//   - deep_query of items/vase/at/pos at 0, 1 and 2 s: the vase is rested on the moving table, its centre at the
//     table's top plus its radius, 0.125, 0.25 and 0.375 m, within 2 mm, and x and z as written (the test's own judge,
//     from the fixture's numbers);
// and across the two orders: the vase's place at 0, 1 and 2 s is the same JSON numbers.
//
// Wrong programs this fails on:
//   - the base: the cam, table, vase, flag listing is refused with no_support (the live rest reads the table's
//     transform from the flag's program slot, so nothing lies under the vase);
//   - a program that leaves the vase unrested in both orders (where it was written, y 1.0): a gap in both;
//   - a program that rests the vase once at check and never again: y 0.125 at 1 and 2 s, under the lifted top;
//   - a program whose rest depends on the listing: the two orders' places differ.
import { describe, expect, it } from 'vitest';
import {
  AC, ID_ORDER, REPRO_ORDER, SECONDS, TIMEOUT, TIMES, VASE, VASE_POS, arr, brief, liftedDoc, none, num, obj, presented, query, restedAt, run, scenarioOf,
  show, useFolders, useShow, type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[1];
const bin = useShow();
const folder = useFolders();
/** Within the geometry audit's 2 mm (canvas primitives: Geometry audit), as #2013 judges a rest. */
const TOLERANCE = 0.002;

/** Why the vase's centre `c` at `s` seconds isn't rested on the lifted table: it left its axis, or it isn't on the top. */
function restFailures(c: V3, s: number): string[] {
  const want = restedAt(s);
  const failures: string[] = [];
  if (Math.abs(c[0] - VASE.x) > 1e-6 || Math.abs(c[2] - VASE.z) > 1e-6) failures.push(`at ${s} s the vase left its axis (0, −1, 0): it is at x ${c[0]}, z ${c[2]}, written at x ${VASE.x}, z ${VASE.z}`);
  if (Math.abs(c[1] - want[1]) > TOLERANCE) failures.push(`at ${s} s the vase's centre is at y ${c[1]}, not ${want[1]} where it rests on the table the channel has lifted (within ${TOLERANCE} m)`);
  return failures;
}
/** The judge fails its planted places: the vase where it was written, and rested once at 0 s and left there. */
function judgeFailsItsPlants(): void {
  none(SECONDS.flatMap((s) => restFailures(restedAt(s), s)), 'the judge passes the vase on the lifted top at 0, 1 and 2 s');
  expect(SECONDS.flatMap((s) => restFailures([VASE.x, VASE.start, VASE.z], s)).length, 'the judge fails the vase left where it was written, at every time').toBe(3);
  expect(SECONDS.flatMap((s) => restFailures(restedAt(0), s)).length, 'the judge fails the vase rested at 0 s and left there, at 1 and 2 s').toBe(2);
  expect(restedAt(2)[1] - restedAt(0)[1], 'the rested vase follows the lift').toBeCloseTo(0.25, 12);
}

/** The vase's evaluated centre at each of the query's times. */
function vaseAt(reply: JsonObject, what: string): V3[] {
  const values = arr(obj(reply['values'], `${what}: the query's values`)[VASE_POS], `${what}: values[${VASE_POS}]`);
  expect(values.length, `${what}: one value per time (${TIMES.join(', ')}): ${brief(reply)}`).toBe(TIMES.length);
  return values.map((v, k): V3 => {
    const at = arr(v, `${what}: ${VASE_POS} at ${TIMES[k]}`);
    expect(at.length, `${what}: ${VASE_POS} at ${TIMES[k]} holds three numbers`).toBe(3);
    return [num(at[0], `${VASE_POS}[0]`), num(at[1], `${VASE_POS}[1]`), num(at[2], `${VASE_POS}[2]`)];
  });
}

/** One listing shown in a run of its own: presented, and the vase's place at 0, 1 and 2 s. */
function shownAndRead(listing: readonly string[]): V3[] {
  const what = `the document listed ${listing.join(', ')}`;
  const [shown, read] = run(bin(), scenarioOf(folder(), [show(liftedDoc(listing)), query([VASE_POS], TIMES)]));
  presented(shown!, what);
  const places = vaseAt(read!, what);
  none(places.flatMap((c, k) => restFailures(c, SECONDS[k]!)), `${what}: the vase rests on the moving table at 0, 1 and 2 s`);
  return places;
}

describe(`${ID} a moving rest_on presents with its items in either order`, () => {
  it(`${ID} listed cam, flag, table, vase and cam, table, vase, flag, the document presents, and the vase rests in the same place at 0, 1 and 2 s`, () => {
    judgeFailsItsPlants();
    // The order the base refuses goes first, so the base fails on its no_support.
    const repro = shownAndRead(REPRO_ORDER);
    const byId = shownAndRead(ID_ORDER);
    expect(repro, `the vase's rested place at ${TIMES.join(', ')} is the same in both orders: ID order ${brief(byId)}, the other ${brief(repro)}`).toEqual(byId);
  }, TIMEOUT);
});
