// #853.22cd6328: "Particles bounce off a moving kinematic floor at the step it moves, and none passes through a
// static wall in 600 steps; a planted step that tests only the particle's end position lets fast particles tunnel
// and fails, naming the particle"
//
// The lift (helpers.ts: liftDoc; judges.ts: LIFT). The world `stage` holds one kinematic box whose `follow` channel
// keeps its top at y = 0 until 1 s, raises it 1.2 m/s for 1 s and stops it at 1.2 m. 1,024 particles of the item
// `beads`, born at 0 s 1 cm above it, lie on it before it moves. Through `view3d` at 60 frames a second with `read`
// of `beads.buffer` at every frame from 50 to 150: the drawn floor is where the channel puts it at each frame (so the
// fixture's own floor is the one the test computes); before step 60 every particle is at rest on the floor; at each
// step the floor moves, 61 to 120, no particle is more than 5 mm under the floor's top at that step's own time (the
// floor moves 20 mm a step, so particles that meet the floor a step late are 20 mm under it at step 61); and after
// the floor stops each particle rises at least 0.0367 m above it, half of what 1.2 m/s carries it (1.2² ÷ (2 × 9.81) =
// 0.0734 m), so it bounced off the floor and wasn't only carried by it.
//
// The corridor (helpers.ts: corridorDoc; judges.ts: CORRIDOR). The world `room` holds two static walls 2 cm thick,
// their near faces at x = ±3 m. 1,024 particles of the item `shots`, born at 0 s around the origin, leave at 24 m/s
// along +x with no force on them: 0.4 m a step, 20 times the wall's thickness. `read` of `shots.buffer` at every
// frame 0 to 600: no particle is ever past a wall's far face. The guards: each particle moves 0.4 m from step 1 to
// step 2, and at least 80% of them are seen short of the near face with a step that would end past the far face, so
// the walls are met by particles fast enough to cross them in one step. The planted `particles_collide_at_end` tests
// a particle against the walls only where its step ends, so those particles tunnel, and the same check fails on it
// with "particle <i> passed through the wall: at step <k> it is at x = …". At the base no kind
// `particles.stepped@1` exists.
import { describe, expect, it } from 'vitest';
import { CORRIDOR, LIFT, liftProblems, liftTop, range, wallProblems } from './judges.ts';
import {
  BEADS, LIFT_PATH, SHOTS, ac, arr, bufferOn, carriedOn, corridorDoc, failsNaming, frameAt, judgesHold, liftDoc, none, num, requireGpu, run, useBin, useOut,
  view3dCall, view3dFrames, writeJson, type Planted,
} from './helpers.ts';

const bin = useBin();
const out = useOut();

/** The corridor played 600 steps: the problems of a particle past a wall's far face, each naming the particle. */
function corridorProblems(planted?: Planted): string[] {
  const dir = out();
  const what = `the corridor${planted ? ` under --planted ${planted}` : ''}`;
  const [reply] = run(bin(), dir, [view3dCall({ doc: writeJson(dir, 'corridor.json', corridorDoc()), frames: CORRIDOR.steps + 1, capture: 'every', read: [SHOTS] })], planted);
  const frames = view3dFrames(reply!, what);
  const states = range(0, CORRIDOR.steps).map((s) => {
    const f = frameAt(frames, s, what);
    expect(carriedOn(f, SHOTS, what).step, `${what}: frame ${s} reads the buffer at step ${s}`).toBe(s);
    return bufferOn(dir, f, SHOTS, what).words;
  });
  return wallProblems(states);
}

describe(`${ac(2)} particles collide with the world's shapes: a kinematic floor where it is at the step, a static wall however fast they move`, () => {
  it(`${ac(2)} particles at rest on a kinematic floor are never under it at a step it moves, and bounce off it once it stops`, () => {
    judgesHold();
    requireGpu();
    const dir = out();
    const what = 'the lift';
    const steps = range(LIFT.restFrom, LIFT.last);
    const [reply] = run(bin(), dir, [view3dCall({ doc: writeJson(dir, 'lift.json', liftDoc()), frames: LIFT.last + 1, capture: steps, read: [BEADS], evaluate: [LIFT_PATH] })]);
    const frames = view3dFrames(reply!, what);
    const states = new Map<number, Float32Array>();
    for (const s of steps) {
      const f = frameAt(frames, s, what);
      expect(carriedOn(f, BEADS, what).step, `${what}: frame ${s} reads the buffer at step ${s}`).toBe(s);
      // The fixture's own floor: the drawn box follows the channel the kinematic body follows.
      const pos = arr(f.values?.[LIFT_PATH], `${what}: frame ${s}: the floor's evaluated position`).map((v, i) => num(v, `${what}: frame ${s}: the floor's position[${i}]`));
      expect(Math.abs(pos[1]! + LIFT.half[1] - liftTop(s)), `${what}: at frame ${s} the floor's top is at ${liftTop(s)} m, as its channel puts it (it is at ${pos[1]! + LIFT.half[1]} m)`).toBeLessThanOrEqual(1e-5);
      states.set(s, bufferOn(dir, f, BEADS, what).words);
    }
    none(liftProblems(states), 'the particles lie on the floor before it moves, are never under it at a step it moves, and bounce off it once it stops');
  }, 3_600_000);

  it(`${ac(2)} none of 1,024 particles moving 20 wall thicknesses a step passes through a static wall in 600 steps; a planted step that tests only the particle's end position (--planted particles_collide_at_end) lets them tunnel and fails, naming the particle`, () => {
    judgesHold();
    requireGpu();
    none(corridorProblems(), 'no particle is past a wall\'s far face at any of 600 steps, and the particles reach the walls fast enough to cross them in one step');
    failsNaming(corridorProblems('particles_collide_at_end'), [/particle \d+ passed through the wall: at step \d+ it is at x = /], 'the planted particles_collide_at_end');
  }, 3_600_000);
});
