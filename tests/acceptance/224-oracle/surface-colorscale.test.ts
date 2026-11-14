// Oracle #224.7f436e55 (AC3): "`color: {by: z, ramp: [a, b, c], domain: [−1, 1]}` gives a vertex at z = 0 role b's
// color within OKLab ΔE 0.01; `checker {cells: [8, 8]}` gives 64 cells with no two edge neighbours sharing a role"
//
// The two upstream tests the oracle page pins for criterion 3 (README: Sources), re-expressed against our output: a
// surface on 3D axes colored by its z through a five-color scale spread evenly over the z axis's range. The upstream
// mixes between colors in RGB and we mix in OKLab, so only the values at the scale's stops must agree: there, a vertex
// takes that stop's color exactly. Here each case is our `surface@1` parented to our `axes3d@1` and carrying
// `mod.axes@1`, `color: {by: z, ramp: [blue, green, yellow, orange, red], domain}` with the domain the z axis's range,
// read by `geometry` with `stage: "built"` (the builder's own positions, in the formula's numbers, and its
// `attributes.color`). Every vertex whose z is a stop's value within 1e-12 must be that stop's color within OKLab
// ΔE 0.01.
//   - The saddle z = v²/2 − u²/2 over [−3, 3]², z axis [−4, 4]: stops −4, −2, 0, 2, 4. `grid_lines: {u: 1, v: 1}` splits
//     the grid at whole u and v (the upstream draws its own grid on the surface), so all five stops are sampled
//     ((3, 1), (2, 0), (0, 0), (0, 2), (1, 3)); each must have a vertex.
//   - z = 2 sin u + 2 cos v over [−3, 3]², z axis [−5, 5]: stops −5, −2.5, 0, 2.5, 5. With lines every π/2 the
//     surface reaches the stop 0, at (0, ±π/2) and (−π/2, 0); it must have a vertex there. Its other stops aren't
//     reached on that grid, and a vertex that does sit on one is held to it all the same.
//   - The planted mismatch: the saddle with its ramp reversed fails the same check, naming the stop at z = −4.
import { describe, expect, it } from 'vitest';
import {
  AC, AXES, DAY_SKY, DOC, LOOK_FIELDS, MOD_AXES, PI, STROKE, TIMEOUT, admitted, ask, atStops, axesItem, colorsOf, failsNaming, geometry, meshOf,
  none, present, scales, sceneDoc, surface, useBins, type JsonObject,
} from '../224/helpers.ts';

useBins();
const ID = `Oracle ${AC[3].split(' ')[1]!}`;
const FIVE = ['blue', 'green', 'yellow', 'orange', 'red'];
const stopsOf = (lo: number, hi: number, ramp: readonly string[]): [number, string][] => ramp.map((role, k) => [lo + ((hi - lo) * k) / (ramp.length - 1), role]);

/** A surface over [−3, 3]² on 3D axes whose z axis spans [−zr, zr], colored through `ramp` over that span. */
function onAxes(z: string, zr: number, ramp: readonly string[], step: number): JsonObject {
  return sceneDoc('A surface colored by its height on 3D axes', {
    sky: DAY_SKY,
    ...scales({ type: 'linear', domain: [-3, 3] }, { type: 'linear', domain: [-3, 3] }, { type: 'linear', domain: [-zr, zr] }),
    [AXES]: axesItem({ lengths: [6, 6, 2 * zr] }),
    plot: surface({ fn: { x: 'u', y: 'v', z }, u: [-3, 3], v: [-3, 3], color: { by: 'z', ramp: [...ramp], domain: [-zr, zr] }, grid_lines: { u: step, v: step, stroke: STROKE } }, { parent: AXES, modifiers: [{ ...MOD_AXES }] }),
  }, LOOK_FIELDS);
}
function stopCheck(doc: JsonObject, expected: [number, string][], what: string): { failures: string[]; counts: number[] } {
  const [shownReply, geo] = ask([present(DOC(1), doc), geometry(DOC(1), ['plot'], '0s', { stage: 'built' })]);
  admitted(shownReply, what);
  const m = meshOf(geo, 'plot', what);
  const colors = colorsOf(m, what);
  expect(colors.domain, `${what}: color by value is per vertex`).toBe('point');
  return atStops(m, colors.values, expected);
}

describe(`${ID} a surface on 3D axes colored by its z through a five-color scale agrees at the scale's stops`, () => {
  it(`${ID} the saddle over [−3, 3]² and the sine surface, each on axes, take each stop's color at the stop`, () => {
    const saddleStops = stopsOf(-4, 4, FIVE);
    const saddle = stopCheck(onAxes('v^2 / 2 - u^2 / 2', 4, FIVE, 1), saddleStops, 'the saddle');
    saddleStops.forEach(([z], k) => expect(saddle.counts[k], `the saddle has a vertex at the stop z = ${z}`).toBeGreaterThan(0));
    none(saddle.failures, 'the saddle\'s vertices at the stops take the stops\' colors');
    const sine = stopCheck(onAxes('2 * sin(u) + 2 * cos(v)', 5, FIVE, PI / 2), stopsOf(-5, 5, FIVE), 'the sine surface');
    expect(sine.counts[2], 'the sine surface has a vertex at the stop z = 0').toBeGreaterThan(0);
    none(sine.failures, 'the sine surface\'s vertices at the stops take the stops\' colors');
  }, TIMEOUT);

  it(`${ID} the planted mismatch, the saddle's scale reversed, fails the same check, naming the stop at z = −4`, () => {
    const reversed = stopCheck(onAxes('v^2 / 2 - u^2 / 2', 4, [...FIVE].reverse(), 1), stopsOf(-4, 4, FIVE), 'the reversed saddle');
    failsNaming(reversed.failures, ['at z = -4', 'role blue'], 'the saddle with its scale reversed');
  }, TIMEOUT);
});
