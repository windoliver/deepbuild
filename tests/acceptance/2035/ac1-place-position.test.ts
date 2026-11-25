// #2035.577758f2: "In a new fixture, a character at rest at x = 40 m in a 60 Hz world takes a `place` to x = 0 m at
// step 120. Drawn at 120 frames a second from 1.9 s to 2.2 s, every frame draws x = 40 m or x = 0 m within 1e-6 m, with
// exactly one change. A planted output that blends draws 20 m on one frame and fails, naming the item and the frame"
//
// The character's `pose` output, drawn on the item hero_figure, sampled by a bake at 120/1 (README: The surface under
// test). Which side of the place the frame half way between steps 120 and 121 shows is left open: each frame must be
// one of the two poses, and they change once. The wrong program is `deep-physics --planted place_blends`.
import { describe, expect, it } from 'vitest';
import { prebuild } from '../251/helpers.ts';
import { AC, HERO_ITEM, HERO_OUTPUT, TIMEOUT, WINDOW, drawnPoses, heroBake, namedBy, physics, positionFailures, type Pose } from './helpers.ts';

prebuild();

const ID = AC[1];
const drawnFrames = (twin?: 'place_blends'): Pose[] => {
  const [reply] = physics([heroBake()], twin, 'the character placed from x = 40 m to x = 0 m at step 120');
  return drawnPoses(reply!, HERO_OUTPUT, 'the character placed at step 120');
};

describe(`${ID} a place on a character body draws as a cut`, () => {
  it(`${ID} drawn at 120 frames a second from 1.9 s to 2.2 s, every frame draws x = 40 m or x = 0 m within 1e-6 m, with exactly one change`, () => {
    const failures = positionFailures(drawnFrames());
    expect(failures, `the character's drawn frames:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: place_blends) a planted output that blends draws 20 m on one frame and fails, naming the item and the frame`, () => {
    const poses = drawnFrames('place_blends');
    const twenty = WINDOW.filter((j) => Math.abs(poses[j]!.pos[0] - 20) <= 1e-6);
    expect(twenty.length, `place_blends draws x = 20 m on exactly one frame from 1.9 s to 2.2 s (frames ${twenty.join(', ') || 'none'})`).toBe(1);
    namedBy(positionFailures(poses), new RegExp(`\\bitem ${HERO_ITEM}\\b.*\\bframe ${twenty[0]}\\b`), 'place_blends');
  }, TIMEOUT);
});
