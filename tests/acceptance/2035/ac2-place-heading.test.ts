// #2035.9b03a44c: "The same `place` also turns the body 90° about the up axis, and no frame draws a heading between 1°
// and 89°. A planted output that holds position and blends rotation draws 45° on one frame and fails, naming the item"
//
// Criterion 1's fixture, whose place also turns the character 90° about +Y; the heading is the drawn rotation's turn of
// +Z about +Y. The frames read are criterion 1's, 1.9 s to 2.2 s at 120 a second, and the place must have turned it: 0°
// at 1.9 s and 90° at 2.2 s, each within 1°. The wrong program is `deep-physics --planted place_blends_rotation`.
import { describe, expect, it } from 'vitest';
import { prebuild } from '../251/helpers.ts';
import {
  AC, HERO_ITEM, HERO_OUTPUT, TIMEOUT, WINDOW, drawnPoses, heading, headingFailures, heroBake, namedBy, physics, positionFailures,
  type Pose,
} from './helpers.ts';

prebuild();

const ID = AC[2];
const drawnFrames = (twin?: 'place_blends_rotation'): Pose[] => {
  const [reply] = physics([heroBake()], twin, 'the character placed and turned 90° at step 120');
  return drawnPoses(reply!, HERO_OUTPUT, 'the character placed and turned at step 120');
};

describe(`${ID} a place that turns a character body draws its turn as a cut`, () => {
  it(`${ID} the place turns the body 90° about the up axis, and no frame draws a heading between 1° and 89°`, () => {
    const failures = headingFailures(drawnFrames());
    expect(failures, `the character's drawn headings:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: place_blends_rotation) a planted output that holds position and blends rotation draws 45° on one frame and fails, naming the item`, () => {
    const poses = drawnFrames('place_blends_rotation');
    const position = positionFailures(poses);
    expect(position, `place_blends_rotation holds the position across the place:\n  ${position.join('\n  ')}`).toEqual([]);
    const at45 = WINDOW.filter((j) => Math.abs(Math.abs(heading(poses[j]!)) - 45) <= 0.5);
    expect(at45.length, `place_blends_rotation draws a heading of 45° on exactly one frame from 1.9 s to 2.2 s (frames ${at45.join(', ') || 'none'})`).toBe(1);
    namedBy(headingFailures(poses), new RegExp(`\\bitem ${HERO_ITEM}\\b.* draws a heading of .*between 1° and 89°`), 'place_blends_rotation');
  }, TIMEOUT);
});
