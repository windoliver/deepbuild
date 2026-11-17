// Criterion 17: the body (radius 0.3 m, offset 0.01 m), walking at 2 m/s for 2 s at 120 Hz into the corner of two
// vertical walls that meet at 60°, 15° off the corner's bisector, ends with its axis within 1 cm of the rest point where
// it touches both, (0.3 + 0.01) ÷ sin 30° = 0.62 m from the corner's edge along the bisector, and moves less than 1 mm
// over the last second; a move away along the bisector at 2 m/s then carries it 1.00 m farther in 0.5 s, within 2 cm;
// and a planted controller that resolves each wall alone alternates between them, moves more than 1 mm in a step during
// the last second and fails, naming the step.
//
// The corner's edge is the vertical line through the origin; the bisector runs along −x out of the corner, each wall's
// inner face 30° off it. The body starts on the bisector 1.5 m from the edge and walks toward the corner 15° off the
// bisector, toward the +z wall. "Moves less than 1 mm over the last second" is the path it travels, summed step by step,
// from step 120 to 240. The move away is stamped 240. The wrong program is `--planted corner_one_wall_at_a_time`.
import { describe, expect, test } from 'vitest';
import {
  AC, HERO, OFFSET, RADIUS, TIMEOUT, bake, box, caught, characterWorld, heroBody, named, none, physics, prebuild, slab, standing,
  statesOf, walk, type Runner, type Static, type State, type Vec3,
} from './helpers.ts';

prebuild(['shipped']);
const START = 1.5;
const LENGTH = 3;
const THICK = 0.2;
const REST = (RADIUS + OFFSET) / Math.sin(Math.PI / 6);

/** A wall whose inner face runs from the corner's edge along `dir` (unit, in the x–z plane); `out` points away from inside. */
function wall(dir: Vec3, out: Vec3, yaw: number): Static {
  const along = LENGTH / 2 - THICK;
  const pos: Vec3 = [dir[0] * along + out[0] * THICK / 2, 1, dir[2] * along + out[2] * THICK / 2];
  return { shape: box([LENGTH / 2, 1, THICK / 2]), pos, rot: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] };
}
function cornerWorld(): ReturnType<typeof characterWorld> {
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  return characterWorld({
    statics: {
      floor: slab(-6, 2, -1, 0, 4),
      wall_a: wall([-c, 0, s], [s, 0, c], Math.PI / 6),
      wall_b: wall([-c, 0, -s], [s, 0, -c], -Math.PI / 6),
    },
    movers: { [HERO]: heroBody([-START, standing(0), 0]) },
  });
}
const edge = (st: State): number => Math.hypot(st.pos[0], st.pos[2]);
const toward: Vec3 = [2 * Math.cos(Math.PI / 12), 0, 2 * Math.sin(Math.PI / 12)];

/** The run into the corner and away, and everything wrong with it; each step in the last second that moves over 1 mm is named. */
function cornerFailures(r: Runner): string[] {
  const [reply] = physics([bake(cornerWorld(), 300, { track: [walk(0, toward), walk(240, [-2, 0, 0])], read: [HERO] })], r);
  const st = statesOf(reply!, HERO, 'into the corner');
  const out: string[] = [];
  const at = st[240]!;
  const off = Math.hypot(at.pos[0] + REST, at.pos[2]);
  if (off > 0.01) out.push(`after 2 s its axis is at (${at.pos[0].toFixed(4)}, ${at.pos[2].toFixed(4)}), ${off.toFixed(4)} m from the rest point ${REST.toFixed(2)} m out along the bisector, not within 1 cm`);
  let path = 0;
  for (let k = 121; k <= 240; k++) {
    const step = Math.hypot(...[0, 1, 2].map((i) => st[k]!.pos[i]! - st[k - 1]!.pos[i]!));
    path += step;
    if (step > 0.001) { out.push(`it moves ${step.toFixed(5)} m in step ${k}, during the last second`); break; }
  }
  if (path >= 0.001) out.push(`it travels ${path.toFixed(5)} m over the last second, not less than 1 mm`);
  const away = edge(st[300]!) - edge(at);
  if (Math.abs(away - 1) > 0.02) out.push(`moving away along the bisector it ends ${away.toFixed(4)} m farther from the corner's edge in 0.5 s, not 1.00 within 2 cm`);
  return out;
}

describe(`${AC[17]} pushed into a corner the body rests touching both walls`, () => {
  test(`${AC[17]} into a 60° corner 15° off its bisector it rests within 1 cm of 0.62 m out, still over the last second; then 1.00 m farther in 0.5 s`, () => {
    expect(Math.abs(REST - 0.62), 'the rest point is (0.3 + 0.01) ÷ sin 30° = 0.62 m from the edge').toBeLessThan(1e-9);
    none(cornerFailures({}), 'rapier3d');
  }, TIMEOUT);

  test(`${AC[17]} a controller that resolves each wall alone (--planted corner_one_wall_at_a_time) moves more than 1 mm in a step in the last second and fails, naming the step`, () => {
    const failures = cornerFailures({ planted: 'corner_one_wall_at_a_time' });
    caught(failures, 'the controller that resolves each wall alone');
    expect(failures.some((f) => /in step (12[1-9]|1[3-9]\d|2[0-3]\d|240), during the last second/.test(f)), `a failure names a step of the last second it moved more than 1 mm: ${failures.join('; ')}`).toBe(true);
    named(failures, ['during the last second'], 'its failure');
  }, TIMEOUT);
});
