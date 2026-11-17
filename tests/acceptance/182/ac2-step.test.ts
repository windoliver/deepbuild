// Criterion 2: with step height 0.35 m the same body walks up a 0.3 m step onto a floor 6 m long within 2 s, its
// lowest point 0.30 m up within 0.02 m, while a 0.4 m step stops it with its lowest point within 0.05 m of the floor for
// the whole 5 s; and with step height 0.25 m the 0.3 m step stops it too.
//
// The body is criterion 1's (slope limit 45°), its axis 1 m before the step's face, walked along +x at 2 m/s by the
// logic item `walker`'s move. "Stops it" also holds its front from passing the step's face (README: Readings).
import { describe, test } from 'vitest';
import {
  AC, HERO, RADIUS, TIMEOUT, bake, characterStates, characterWorld, heroBody, heroInputs, lowest, none, physics, prebuild,
  slab, standing, statesOf, walk, type JsonObject,
} from './helpers.ts';

prebuild(['shipped']);
const FACE = 1;
const STEPS = 600;
const AT_2S = 240;

/** A step `rise` m high whose face is at x = 1 and whose top floor runs 6 m; the body's axis at x = 0. */
function stepWorld(rise: number, stepHeight: number): JsonObject {
  return characterWorld({
    statics: { floor: slab(-5, 20, -1, 0), ledge: slab(FACE, FACE + 6, -1, rise) },
    movers: { [HERO]: heroBody([0, standing(0), 0], { slope: 45, step: stepHeight }) },
    inputs: heroInputs({ logic: 'walker' }),
  });
}

describe(`${AC[2]} a 0.35 m step height climbs a 0.3 m step and not a 0.4 m one, and 0.25 m stops at 0.3 m`, () => {
  test(`${AC[2]} up the 0.3 m step within 2 s, 0.30 m up within 0.02 m; the 0.4 m step, and the 0.3 m step under 0.25 m, keep its lowest point within 0.05 m of the floor for 5 s`, () => {
    const track = [walk(0, [2, 0, 0])];
    const [up, high, low] = physics([stepWorld(0.3, 0.35), stepWorld(0.4, 0.35), stepWorld(0.3, 0.25)].map((w) => bake(w, STEPS, { track, read: [HERO] })));
    const out: string[] = [];
    const climbed = statesOf(up!, HERO, 'the 0.3 m step under 0.35 m');
    const at = climbed[AT_2S]!;
    if (!characterStates([at], 'the 0.3 m step')[0]!.grounded) out.push('0.3 m step under 0.35 m: after 2 s the body isn\'t grounded');
    if (!(at.pos[0] > FACE && at.pos[0] < FACE + 6)) out.push(`0.3 m step under 0.35 m: after 2 s its axis is at x ${at.pos[0]}, not over the step's floor (x 1 to 7)`);
    if (Math.abs(lowest(at) - 0.3) > 0.02) out.push(`0.3 m step under 0.35 m: after 2 s its lowest point is ${lowest(at).toFixed(4)} m up, not 0.30 within 0.02`);
    for (const [label, reply] of [['0.4 m step under 0.35 m', high!], ['0.3 m step under 0.25 m', low!]] as const) {
      const states = statesOf(reply, HERO, label);
      const k = states.findIndex((s) => Math.abs(lowest(s)) > 0.05);
      if (k >= 0) out.push(`${label}: its lowest point is ${lowest(states[k]!).toFixed(4)} m up at step ${k}, past 0.05 m of the floor`);
      const past = states.findIndex((s) => s.pos[0] + RADIUS > FACE + 0.001);
      if (past >= 0) out.push(`${label}: its front reaches x ${(states[past]!.pos[0] + RADIUS).toFixed(4)} at step ${past}, past the step's face at x 1`);
    }
    none(out, 'rapier3d');
  }, TIMEOUT);
});
