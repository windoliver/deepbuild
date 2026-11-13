// The Oracle lane for AC1 #226.c218cc0a: "With domains [−4, 4] on each axis, lengths [8, 8, 8] m and `up: z`, a point
// mark parented to the axes and carrying `mod.axes@1` at (2, 3, 1) sits at world (2, 1, −3) within 1e-6 m"
//
// The oracle page links one upstream test file for this criterion: a test that a point placed through a 3D axes'
// three scales lands where each of its three axes places that coordinate, once on linear scales and once on log ones
// (README: Sources). Re-expressed against our own output, with our numbers, copying no upstream code: the axes of
// criterion 1 (`axes3d@1`, lengths [8, 8, 8] m, `up: z`), with points parented to them and carrying `mod.axes@1`,
// drawn by `view3d` with `world` and `axes` (the #226 suite's Assumed surfaces 2 and 3). For each point (a, b, c) and
// each axis, the point's world position measured along that axis's own direction equals the place that axis gives its
// tick at that coordinate: (P − T_x(a)) · û_x = 0, (P − T_y(b)) · û_y = 0 and (P − T_z(c)) · û_z = 0 within 1e-6 m,
// where T_axis(v) is the tick's `at` and û_axis runs from the axis's first tick to its last.
// - linear: domains [−4, 4]; the points (2, 3, 1), the criterion's own, and (−4, −4, −4), the domains' start corner;
// - log: domains [1, 1000] on all three; the points (10, 1000, 100) and (1, 1, 1), the domains' start corner.
// Each coordinate is a tick of its axis (ticks on 1 × 10^k: every whole number on [−4, 4], each decade on [1, 1000]).
import { describe, expect, it } from 'vitest';
import {
  AC, AXES, DAY_SKY, PLAIN, TIMEOUT, axesItem, dot, fmt, framesOf, orbitCamera, pointOnAxes, requireMetal, runGpu, scales, sessionDoc, sub, sun, ticksOf, unit,
  useBins, useOut, worldOf, writeJson, type Axis, type ScaleSpec, type V3,
} from './helpers.ts';

const ID = AC[1];
const NAME = `Oracle ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();

/** Each failure of the per-axis judge for the points drawn on axes over `spec`, each naming the point and the axis. */
function placeFailures(spec: ScaleSpec, points: Record<string, V3>, what: string): string[] {
  requireMetal();
  const dir = out();
  const items = Object.fromEntries(Object.entries(points).map(([id, c]) => [id, pointOnAxes(c)]));
  const doc = writeJson(dir, 'oracle', sessionDoc(`oracle-226-${spec.type}`, [640, 360], {
    cam: orbitCamera('orthographic', 35, 25, 30), sky: DAY_SKY, sun: sun(3, [-40, 30, 0]), ...scales(spec, spec, spec), [AXES]: axesItem(), ...items,
  }));
  const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc, look: PLAIN, size: [640, 360], frames: 1, world: Object.keys(points), axes: true }]);
  const [frame] = framesOf(reply!, 1, what);
  const ticks = ticksOf(frame!, AXES, what);
  const failures: string[] = [];
  const axes: Axis[] = ['x', 'y', 'z'];
  for (const [id, coords] of Object.entries(points)) {
    const at = worldOf(frame!, id, what);
    expect(at.length, `${what}: ${id} has one position`).toBe(1);
    axes.forEach((axis, i) => {
      const on = ticks.filter((t) => t.axis === axis).sort((p, q) => p.value - q.value);
      expect(on.length, `${what}: the ${axis} axis has ticks`).toBeGreaterThan(1);
      const tick = on.find((t) => t.value === coords[i]);
      expect(tick, `${what}: the ${axis} axis has a tick at ${coords[i]}`).toBeDefined();
      const direction = unit(sub(on.at(-1)!.at, on[0]!.at));
      const off = dot(sub(at[0]!, tick!.at), direction);
      if (Math.abs(off) > 1e-6) failures.push(`${what}: ${id} at (${coords.join(', ')}) sits at world ${fmt(at[0]!)}, ${off.toExponential(3)} m along the ${axis} axis from that axis's tick at ${coords[i]} ${fmt(tick!.at)}`);
    });
  }
  return failures;
}

describe(`${NAME} a point placed through the axes' three scales lands where each axis places its coordinate`, () => {
  it(`${NAME} on linear scales over [−4, 4], the points (2, 3, 1) and (−4, −4, −4)`, () => {
    expect(placeFailures({ type: 'linear', domain: [-4, 4] }, { pt: [2, 3, 1], corner: [-4, -4, -4] }, 'linear axes'), 'each point reads its numbers through the three scales').toEqual([]);
  }, TIMEOUT);

  it(`${NAME} its log twin: on log scales over [1, 1000], the points (10, 1000, 100) and (1, 1, 1)`, () => {
    expect(placeFailures({ type: 'log', domain: [1, 1000] }, { pt: [10, 1000, 100], corner: [1, 1, 1] }, 'log axes'), 'each point reads its numbers through the three scales').toEqual([]);
  }, TIMEOUT);
});
