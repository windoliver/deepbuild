// #2013.2dab09c8: "poisson with min_distance 0.5 m over a 10 × 10 m plate keeps every pair at least 0.5 m apart and
// leaves no empty disc of radius 1.0 m centered more than 0.5 m inside the plate, and with density 0 over the left
// half places no point there; a planted sampler that stops after 10 points passes the distance rule and fails the
// empty-disc rule"
//
// Fixture (helpers.ts, `poissonDoc`), shown by the working agent through deep_show: `plate`, a flat 10 × 10 m
// `plate@1` centred on the origin (x and z from −5 to 5, y 0), and `stones`, an instancer of one 0.1 m prototype fed by
// `from: {distribute: {on: plate, mode: poisson, min_distance: 0.5, seed: 2013}}`; in the second document also
// `density: "max(sign(position.x), 0)"`, which is 0 over the left half (x < 0) and 1 over the right. The scatter is
// read back by the `geometry` call's row for the instancer, `elements: [{id, proto, pos}]`.
//
// asserts:
//   - the plain scatter: every point lies on the plate; every pair is at least 0.5 m apart; and no disc of radius
//     1.0 m centred more than 0.5 m inside the plate (|x| and |z| under 4.5) is empty of points;
//   - with density 0 over the left half: at least two points, every one on the plate, none with x < 0, every pair at
//     least 0.5 m apart;
//   - the planted `distribute_stops_after_10_points` (the scenario's `planted`: the sampler stops after 10 points;
//     everything else as shipped): 10 points, every pair at least 0.5 m apart, so it passes the distance rule; and an
//     empty disc of radius 1.0 m centred more than 0.5 m inside the plate, so it fails the empty-disc rule.
//
// Wrong programs this fails on: the planted one, which the criterion names; and, by the same assertions, a sampler
// that fills only part of the plate, one that packs points closer than 0.5 m to fill it, and a density field that is
// ignored or read mirrored.
import { describe, expect, it } from 'vitest';
import {
  AC, DISC_RADIUS, INSIDE, LEFT_HALF_EMPTY, MIN_DISTANCE, PLANTED_POINTS, PLATE, STONES, STOPS_AFTER_10, TIMEOUT, distanceFailures, docId, elementsOf,
  emptyDisc, geometry, judgesFailTheirPlants, none, poissonDoc, presented, run, scenarioOf, show, useFolders, useShow,
  type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[3];
const bin = useShow();
const folder = useFolders();
const DOC = docId(3);

/** The points of `stones` in `document`, from one fresh process, under a planted program or none. */
function points(document: JsonObject, what: string, planted?: string): V3[] {
  const [shown, read] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, document), geometry(DOC, [STONES])], planted ? { planted } : {}));
  presented(shown!, `${what} (an instancer fed by from: distribute)`);
  return elementsOf(read!, STONES, 1, what).map((e) => e.pos);
}
/** The points that don't lie on the plate: off its plane, or past its edge. */
const offPlate = (pts: readonly V3[]): string[] =>
  pts.filter((p) => Math.abs(p[1]) > 1e-6 || Math.abs(p[0]) > PLATE / 2 + 1e-6 || Math.abs(p[2]) > PLATE / 2 + 1e-6).map((p) => `(${p.join(', ')})`);
/** Why `pts` break the empty-disc rule: the disc found. */
function discFailures(pts: readonly V3[]): string[] {
  const disc = emptyDisc(pts, PLATE, INSIDE, DISC_RADIUS);
  return disc ? [`the disc of radius ${DISC_RADIUS} m centred at x ${disc.centre[0]}, z ${disc.centre[1]} is empty: its nearest point is ${disc.nearest} m away`] : [];
}

describe(`${ID} poisson with min_distance 0.5 m over a 10 × 10 m plate`, () => {
  it(`${ID} keeps every pair at least 0.5 m apart and leaves no empty disc of radius 1.0 m centred more than 0.5 m inside the plate`, () => {
    judgesFailTheirPlants();
    const pts = points(poissonDoc(MIN_DISTANCE), 'the stones on the plate');
    none(offPlate(pts), 'every point lies on the 10 × 10 m plate');
    none(distanceFailures(pts, MIN_DISTANCE, `the scatter of ${pts.length} points`), `every pair is at least ${MIN_DISTANCE} m apart`);
    none(discFailures(pts), `the ${pts.length} points leave no empty disc of radius ${DISC_RADIUS} m centred more than ${INSIDE} m inside the plate`);
  }, TIMEOUT);

  it(`${ID} with density 0 over the left half places no point there`, () => {
    judgesFailTheirPlants();
    const pts = points(poissonDoc(MIN_DISTANCE, { density: LEFT_HALF_EMPTY }), 'the stones with density 0 over the left half');
    none(offPlate(pts), 'every point lies on the 10 × 10 m plate');
    none(distanceFailures(pts, MIN_DISTANCE, `the scatter of ${pts.length} points`), `the right half is scattered: at least two points, every pair at least ${MIN_DISTANCE} m apart`);
    none(pts.filter((p) => p[0] < 0).map((p) => `(${p.join(', ')})`), 'no point lies in the left half (x < 0), where the density is 0');
  }, TIMEOUT);

  it(`${ID} the planted sampler that stops after 10 points passes the distance rule and fails the empty-disc rule`, () => {
    judgesFailTheirPlants();
    const pts = points(poissonDoc(MIN_DISTANCE), 'the stones under the planted sampler', STOPS_AFTER_10);
    expect(pts.length, `the planted sampler ${STOPS_AFTER_10} stops after ${PLANTED_POINTS} points`).toBe(PLANTED_POINTS);
    none(distanceFailures(pts, MIN_DISTANCE, 'the planted sampler\'s points'), 'the planted sampler passes the distance rule');
    expect(discFailures(pts).length, 'the planted sampler fails the empty-disc rule: its 10 points leave an empty disc of radius 1.0 m').toBe(1);
  }, TIMEOUT);
});
