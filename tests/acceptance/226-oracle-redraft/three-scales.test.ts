// The #226 Oracle lane: the upstream math library's 3D-axes origin-shift test and its log twin (the one file the oracle
// page pins, lines 30 to 63, at commit a6d5cc02b430fb57d22add51236b6406fbf19d91; use: port), run against our output (#136: a linked test counts only when run against our output). No upstream code
// runs here and none is copied.
//
// Upstream, and ours:
//   - Upstream builds 3D axes whose ranges don't start at 0, linear and then log on all three axes, and asserts that a
//     point placed through the axes, at the corner of the three domains' low ends, lies where each single axis places
//     its own coordinate: a point reads its numbers through three scales, each on its own axis.
//   - Ours: `axes3d@1` with three `scale@1` items, lengths [8, 8, 8] m and `up: z`, and `mark.point@1` items parented
//     to the axes, each at its numbers and carrying `mod.axes@1`. Their world positions come from `deep-show`'s
//     `geometry` call (README: Assumed surfaces). Beside upstream's corner, each test places one point per axis that
//     moves off the corner along that axis alone, the criterion's point (2, 3, 1) (or its log twin, which moves along
//     all three), and the far corner, so each axis's own placement, the three together and the axes' lengths are read.
//   - Linear, domains [−4, 4] (the criterion): 8 m over 8 units is 1 m a unit, and the criterion's (2, 3, 1) at world
//     (2, 1, −3) fixes where 0 sits; with `up: z` math x is world +X, math z world +Y and math y world −Z (the design),
//     so (x, y, z) sits at world (x, z, −y), within the criterion's 1e-6 m.
//   - Log twin, domains [1, 10^4]: four decades over 8 m is 2 m a decade. The design doesn't say where a log domain's
//     low end sits beside the axes' origin, so the twin reads each point's offset from the corner (1, 1, 1), within the
//     same 1e-6 m.
import { describe, expect, it } from 'vitest';
import { AC1, TIMEOUT, TOL, axesDoc, dist, fmt, none, positionsOf, presented, showAndPlace, sub, useFolders, useShow, type V3 } from './helpers.ts';

const bin = useShow();
const folder = useFolders();

/** A point's numbers on the axes, and where the world must have it. */
interface Expect { at: V3; world: V3 }

/** Linear, domains [−4, 4]: (x, y, z) at world (x, z, −y), every value written out. */
const LINEAR: Record<string, Expect> = {
  point: { at: [2, 3, 1], world: [2, 1, -3] }, // the criterion's own numbers
  corner: { at: [-4, -4, -4], world: [-4, -4, 4] }, // upstream's point: the three domains' low ends
  along_x: { at: [2, -4, -4], world: [2, -4, 4] },
  along_y: { at: [-4, 3, -4], world: [-4, -4, -3] },
  along_z: { at: [-4, -4, 1], world: [-4, 1, 4] },
  far: { at: [4, 4, 4], world: [4, 4, -4] },
};

/** Log, domains [1, 10^4]: each point's offset from the corner (1, 1, 1), 2 m a decade, math y along world −Z. */
const LOG_CORNER = 'corner';
const LOG: Record<string, Expect> = {
  corner: { at: [1, 1, 1], world: [0, 0, 0] },
  along_x: { at: [1000, 1, 1], world: [6, 0, 0] }, // three decades along math x: 6 m along world +X
  along_y: { at: [1, 100, 1], world: [0, 0, -4] }, // two along math y: 4 m along world −Z
  along_z: { at: [1, 1, 10], world: [0, 2, 0] }, // one along math z: 2 m along world +Y
  point: { at: [1000, 100, 10], world: [6, 2, -4] }, // all three: the three offsets summed
  far: { at: [10_000, 10_000, 10_000], world: [8, 8, -8] }, // the whole domain: the axes' lengths
};

const atOf = (table: Record<string, Expect>): Record<string, V3> => Object.fromEntries(Object.entries(table).map(([id, e]) => [id, e.at]));

/** Why the points don't sit where the table has them; each failure names the point and its numbers. With `from`, offsets from that point are compared. */
function placementFailures(table: Record<string, Expect>, got: Map<string, V3>, from?: string): string[] {
  const base = from === undefined ? undefined : got.get(from);
  return Object.entries(table).flatMap(([id, e]) => {
    const p = got.get(id);
    if (p === undefined || (from !== undefined && base === undefined)) return [`${id} at ${fmt(e.at)}: no position`];
    const seen = base === undefined ? p : sub(p, base);
    const d = dist(seen, e.world);
    if (d <= TOL) return [];
    return [base === undefined
      ? `${id} at ${fmt(e.at)} sits at world ${fmt(p)}, ${d.toPrecision(3)} m from ${fmt(e.world)}`
      : `${id} at ${fmt(e.at)} sits ${fmt(seen)} from ${from} (at world ${fmt(p)}), ${d.toPrecision(3)} m from ${fmt(e.world)}`];
  });
}

/** Positions a program would give: `place` applied to each point's numbers. */
const placedBy = (table: Record<string, Expect>, place: (at: V3) => V3): Map<string, V3> => new Map(Object.entries(table).map(([id, e]) => [id, place(e.at)]));

/**
 * The judge fails its planted programs before the binary is asked: the right placements pass; a point left at its
 * numbers (the axes' transform alone, or `up: y`), math y taken to world +Z, and log scales read as linear each fail,
 * naming the point.
 */
function judgeFailsItsPlants(): void {
  const linear = ([x, y, z]: V3): V3 => [x, z, -y];
  expect(placementFailures(LINEAR, placedBy(LINEAR, linear)), 'the linear placement passes').toEqual([]);
  expect(placementFailures(LINEAR, placedBy(LINEAR, (a) => a)).join('\n'), 'a point left at its numbers fails, naming the criterion\'s point').toMatch(/^point at \(2, 3, 1\)/m);
  expect(placementFailures(LINEAR, placedBy(LINEAR, ([x, y, z]) => [x, z, y])).join('\n'), 'math y taken to world +Z fails').toMatch(/^along_y /m);
  const decades = (v: number): number => 2 * Math.log10(v) - 4;
  const log = ([x, y, z]: V3): V3 => [decades(x), decades(z), -decades(y)];
  expect(placementFailures(LOG, placedBy(LOG, log), LOG_CORNER), 'the log placement passes, wherever the axes put the corner').toEqual([]);
  const asLinear = (v: number): number => -4 + (8 * (v - 1)) / 9_999;
  expect(placementFailures(LOG, placedBy(LOG, ([x, y, z]) => [asLinear(x), asLinear(z), -asLinear(y)]), LOG_CORNER).join('\n'), 'log scales read as linear fail').toMatch(/^along_x /m);
}

describe(`${AC1} oracle: a point reads its numbers through the axes' three scales`, () => {
  it(`${AC1} linear: with domains [−4, 4], lengths [8, 8, 8] m and up: z, the point at (2, 3, 1) sits at world (2, 1, −3), and the corner and each axis's own point where their numbers put them, within 1e-6 m`, () => {
    judgeFailsItsPlants();
    const doc = axesDoc('Linear axes', 'linear', [-4, 4], atOf(LINEAR));
    const { shown, placed } = showAndPlace(bin(), folder(), doc, Object.keys(LINEAR));
    presented(shown, 'the linear axes and their points');
    none(placementFailures(LINEAR, positionsOf(placed, Object.keys(LINEAR), 'the linear axes')), 'each point on the linear axes sits at world (x, z, −y), within 1e-6 m');
  }, TIMEOUT);

  it(`${AC1} log twin: with log domains [1, 10^4], lengths [8, 8, 8] m and up: z, each point sits 2 m a decade from the corner (1, 1, 1) along its axes' world directions, within 1e-6 m`, () => {
    judgeFailsItsPlants();
    const doc = axesDoc('Log axes', 'log', [1, 10_000], atOf(LOG));
    const { shown, placed } = showAndPlace(bin(), folder(), doc, Object.keys(LOG));
    presented(shown, 'the log axes and their points');
    none(placementFailures(LOG, positionsOf(placed, Object.keys(LOG), 'the log axes'), LOG_CORNER), 'each point on the log axes sits 2 m a decade from the corner, math x along world +X, math z along +Y and math y along −Z, within 1e-6 m');
  }, TIMEOUT);
});
