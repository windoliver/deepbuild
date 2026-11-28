import { describe, expect, it } from 'vitest';
import {
  AC, ID_ORDER, REPRO_ORDER, SECONDS, TIMEOUT, TIMES, VASE, VASE_POS, arr, brief, liftedDoc, none, num, obj, presented, query, restedAt, run, scenarioOf,
  show, useFolders, useShow, type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[1];
const bin = useShow();
const folder = useFolders();
const TOLERANCE = 0.002;

function restFailures(c: V3, s: number): string[] {
  const want = restedAt(s);
  const failures: string[] = [];
  if (Math.abs(c[0] - VASE.x) > 1e-6 || Math.abs(c[2] - VASE.z) > 1e-6) failures.push(`at ${s} s the vase left its axis (0, −1, 0): it is at x ${c[0]}, z ${c[2]}, written at x ${VASE.x}, z ${VASE.z}`);
  if (Math.abs(c[1] - want[1]) > TOLERANCE) failures.push(`at ${s} s the vase's centre is at y ${c[1]}, not ${want[1]} where it rests on the table the channel has lifted (within ${TOLERANCE} m)`);
  return failures;
}
function judgeFailsItsPlants(): void {
  none(SECONDS.flatMap((s) => restFailures(restedAt(s), s)), 'the judge passes the vase on the lifted top at 0, 1 and 2 s');
  expect(SECONDS.flatMap((s) => restFailures([VASE.x, VASE.start, VASE.z], s)).length, 'the judge fails the vase left where it was written, at every time').toBe(3);
  expect(SECONDS.flatMap((s) => restFailures(restedAt(0), s)).length, 'the judge fails the vase rested at 0 s and left there, at 1 and 2 s').toBe(2);
  expect(restedAt(2)[1] - restedAt(0)[1], 'the rested vase follows the lift').toBeCloseTo(0.25, 12);
}

function vaseAt(reply: JsonObject, what: string): V3[] {
  const values = arr(obj(reply['values'], `${what}: the query's values`)[VASE_POS], `${what}: values[${VASE_POS}]`);
  expect(values.length, `${what}: one value per time (${TIMES.join(', ')}): ${brief(reply)}`).toBe(TIMES.length);
  return values.map((v, k): V3 => {
    const at = arr(v, `${what}: ${VASE_POS} at ${TIMES[k]}`);
    expect(at.length, `${what}: ${VASE_POS} at ${TIMES[k]} holds three numbers`).toBe(3);
    return [num(at[0], `${VASE_POS}[0]`), num(at[1], `${VASE_POS}[1]`), num(at[2], `${VASE_POS}[2]`)];
  });
}

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
    const repro = shownAndRead(REPRO_ORDER);
    const byId = shownAndRead(ID_ORDER);
    expect(repro, `the vase's rested place at ${TIMES.join(', ')} is the same in both orders: ID order ${brief(byId)}, the other ${brief(repro)}`).toEqual(byId);
  }, TIMEOUT);
});
