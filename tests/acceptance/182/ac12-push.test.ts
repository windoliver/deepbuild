// Criterion 12: walking at 2 m/s into a resting 10 kg dynamic box on flat ground, the body stops within its offset plus
// 1 mm of the box's face and the box moves under 1 mm over 2 s; a planted character body stepped as a plain kinematic
// body, which the backend lets shove dynamic bodies, moves the box more than 0.1 m and fails, naming the box and the
// step it first moved.
//
// The box, 1 m on a side, rests on the floor with its near face 1.2 m before the body's front. "It first moved" is the
// first step the box is more than 1 mm from where it started, the criterion's own bound. The wrong program is
// `--planted character_as_kinematic`.
import { describe, expect, test } from 'vitest';
import {
  AC, HERO, OFFSET, RADIUS, TIMEOUT, bake, box, caught, characterWorld, heroBody, named, none, physics, prebuild, slab,
  standing, statesOf, walk, type Runner, type State, type Vec3,
} from './helpers.ts';

prebuild(['shipped']);
const STEPS = 240;
const BOX = 'box';
const FACE = 1.5;

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The run and everything wrong with it: the body's gap to the box's face at the end, and the box's every move. */
function pushRun(r: Runner): { failures: string[]; boxStates: State[] } {
  const w = characterWorld({
    statics: { floor: slab(-5, 10, -1, 0) },
    movers: {
      [HERO]: heroBody([0, standing(0), 0]),
      [BOX]: { kind: 'dynamic', shapes: [{ shape: 'crate', contact_material: 'm' }], pose: { pos: [FACE + 0.5, 0.5, 0] }, mass: 10 },
    },
    shapes: { crate: box([0.5, 0.5, 0.5]) },
  });
  const [reply] = physics([bake(w, STEPS, { track: [walk(0, [2, 0, 0])], read: [HERO, BOX] })], r);
  const hero = statesOf(reply!, HERO, 'the body');
  const boxStates = statesOf(reply!, BOX, 'the box');
  const failures: string[] = [];
  const end = hero[STEPS]!;
  const face = boxStates[STEPS]!.pos[0] - 0.5;
  const gap = face - (end.pos[0] + RADIUS);
  if (Math.abs(gap) > OFFSET + 0.001) failures.push(`the body's front ends ${gap.toFixed(5)} m from the box's face, not within its offset plus 1 mm (${OFFSET + 0.001} m)`);
  const k = boxStates.findIndex((s) => dist(s.pos, boxStates[0]!.pos) > 0.001);
  if (k >= 0) failures.push(`the box ${BOX} moved more than 1 mm, first at step ${k}; it ends ${dist(boxStates[STEPS]!.pos, boxStates[0]!.pos).toFixed(4)} m from where it rested`);
  return { failures, boxStates };
}

describe(`${AC[12]} the body stops at a dynamic box and never pushes it`, () => {
  test(`${AC[12]} walking into a resting 10 kg box, the body stops within its offset plus 1 mm of its face and the box moves under 1 mm over 2 s`, () => {
    none(pushRun({}).failures, 'rapier3d');
  }, TIMEOUT);

  test(`${AC[12]} a character stepped as a plain kinematic body (--planted character_as_kinematic) moves the box more than 0.1 m and fails, naming the box and the step it first moved`, () => {
    const { failures, boxStates } = pushRun({ planted: 'character_as_kinematic' });
    const moved = Math.max(...boxStates.map((s) => dist(s.pos, boxStates[0]!.pos)));
    expect(moved, 'the plain kinematic body shoves the box more than 0.1 m').toBeGreaterThan(0.1);
    caught(failures, 'the plain kinematic body');
    const first = boxStates.findIndex((s) => dist(s.pos, boxStates[0]!.pos) > 0.001);
    named(failures, [`box ${BOX}`, `first at step ${first}`], 'its failure');
  }, TIMEOUT);
});
