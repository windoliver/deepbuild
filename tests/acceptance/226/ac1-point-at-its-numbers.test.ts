// AC1 #226.c218cc0a: "With domains [−4, 4] on each axis, lengths [8, 8, 8] m and `up: z`, a point mark parented to the
// axes and carrying `mod.axes@1` at (2, 3, 1) sits at world (2, 1, −3) within 1e-6 m"
//
// The axes (`axes3d@1` on `xs`, `ys` and `zs`, linear, domains [−4, 4] as written, lengths [8, 8, 8] m, `up: z`) stand
// at the world origin; the point `pt` is a `mark.point@1` parented to them, carrying `mod.axes@1 {axes: axes}`, its own
// position (2, 3, 1) (README: Readings). `view3d` draws one frame and reports `pt`'s position in world space (`world`,
// README: Assumed surfaces 3): it is (2, 1, −3) within 1e-6 m, distance measured in 3D.
// Wrong programs: the base (no axes3d@1, no mod.axes@1, no `world`); a point placed at its own position unmapped
// (2, 3, 1); `up: y` read for `up: z` (2, 3, 1); math y mapped to +Z (2, 1, 3); a domain mapped from its start, not its
// numbers (6, 5, −7).
import { describe, expect, it } from 'vitest';
import { AC, PLAIN, TIMEOUT, axesDoc, fmt, framesOf, length, pointOnAxes, requireMetal, runGpu, sub, useBins, useOut, worldOf, writeJson, type V3 } from './helpers.ts';

const ID = AC[1];
const NAME = `AC1 ${ID}`;
const bin = useBins(['deep-gpu']);
const out = useOut();
const WANT: V3 = [2, 1, -3];

describe(`${NAME} a point on the axes sits at its numbers`, () => {
  it(`${NAME} with domains [−4, 4], lengths [8, 8, 8] m and up: z, the point carrying mod.axes@1 at (2, 3, 1) sits at world (2, 1, −3) within 1e-6 m`, () => {
    requireMetal();
    const dir = out();
    const doc = writeJson(dir, 'point', axesDoc('point-226', [640, 360], { pt: pointOnAxes([2, 3, 1]) }));
    const [reply] = runGpu(bin('deep-gpu'), dir, [{ call: 'view3d', doc, look: PLAIN, size: [640, 360], frames: 1, world: ['pt'] }]);
    const [frame] = framesOf(reply!, 1, 'the point on the axes');
    const at = worldOf(frame!, 'pt', 'the point on the axes');
    expect(at.length, 'a point mark has one position').toBe(1);
    const off = length(sub(at[0]!, WANT));
    expect(off, `the point carrying mod.axes@1 at (2, 3, 1) sits at world ${fmt(at[0]!, 9)}, ${off.toExponential(3)} m from (2, 1, −3)`).toBeLessThanOrEqual(1e-6);
  }, TIMEOUT);
});
