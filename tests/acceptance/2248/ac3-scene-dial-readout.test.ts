// #2248.ac6cea78: In a scene that lists a world, an output `{from: hinge, read: joint_coordinate, to:
// items/dial/at/rot/2}` turns the scene's dial as a hinge motor at 90°/s turns its wheel: 45° at 0.5 s within 1%, and
// an output reading a body's velocity writes its vertical part to a readout at every frame.
//
// The scene (helpers' `rigScene`; README: The scene) lists the world `rig`: a wheel on the hinge `hinge`, whose
// velocity motor turns it at 90°/s, and the ball dropped from rest, with the two outputs the criterion names. It is
// presented in `deep-show` and played frame by frame, 0 to 1 s at 60 frames a second, each frame on a step; the dial's
// rotation about z and the readout's text are read with `eval`'s `paths`. The wheel's own turn is the hinge's
// coordinate in the same world baked by `deep-physics`.
import { describe, expect, test } from 'vitest';
import {
  CRITERIA, DIAL_AT, DOC, FPS, G, READOUT_TEXT, SECOND, TIMEOUT, TURN, evalCall, list, numbersOf, physics, prebuild, prebuildShow,
  rigScene, runShow, scenario, sceneBake, show, showBin, showCall, shownNumber, unpresented, useTemp, valueAt,
} from './helpers.ts';

prebuild(['release']);
prebuildShow(['full']);

const ID = CRITERIA[3];
const temp = useTemp();
/** The scene's frames, 0 to 1 s, and the frame at 0.5 s. */
const FRAMES = Array.from({ length: FPS + 1 }, (_, f) => f);
const HALF_SECOND = FPS / 2;
/** The issue's angle at 0.5 s, deg, within 1%. */
const TURNED = 45;
const WITHIN = 0.01 * TURNED;
const within = (x: unknown): boolean => typeof x === 'number' && Math.abs(x - TURNED) <= WITHIN;

describe(`${ID} in a scene that lists a world, a hinge's coordinate turns the scene's dial and a body's velocity fills a readout`, () => {
  test(`${ID} an output {from: hinge, read: joint_coordinate, to: items/dial/at/rot/2} turns the scene's dial as a hinge motor at 90°/s turns its wheel: 45° at 0.5 s within 1%`, () => {
    const scene = rigScene(['turn', 'fall']);
    // The motor's wheel: the hinge's coordinate at each of the scene's frames, from the scene's world baked on its own.
    const [baked] = physics([sceneBake(scene, SECOND)]);
    const wheel = numbersOf(baked, TURN, 'the scene\'s world baked 1 s');
    expect(wheel.problems, `the hinge's coordinate is read from the bake:${list(wheel.problems)}`).toEqual([]);
    expect(wheel.values.length, 'the bake holds the hinge\'s coordinate at each of the scene\'s frames, 0 to 1 s').toBe(FRAMES.length);
    const wheelAt = wheel.values[HALF_SECOND]!;
    console.log(`the hinge's coordinate in the bake: ${wheelAt}° at 0.5 s, ${wheel.values[FPS]}° at 1 s`);
    expect(within(wheelAt), `the motor at 90°/s turns its wheel: the hinge's coordinate at 0.5 s is ${wheelAt}°, 45° within 1%`).toBe(true);

    const doc = DOC(1);
    const replies = runShow(showBin('full'), scenario(temp(), [doc], [showCall(doc, scene), ...FRAMES.map((f) => evalCall(doc, f, [DIAL_AT]))]), 'the scene, played');
    expect(unpresented(replies[0]), 'the scene is presented, each output of its world written where its `to` names').toBe('');
    const dial = FRAMES.map((f) => valueAt(replies[1 + f], DIAL_AT));
    console.log(`${DIAL_AT}: ${show(dial[0])}° at 0 s, ${show(dial[HALF_SECOND])}° at 0.5 s, ${show(dial[FPS])}° at 1 s`);
    expect(within(dial[HALF_SECOND]), `at 0.5 s the dial is turned ${show(dial[HALF_SECOND])}° about z; 45° within 1%`).toBe(true);
    const failures = FRAMES.flatMap((f) => {
      const d = dial[f];
      return typeof d === 'number' && Math.abs(d - wheel.values[f]!) <= 1e-3 ? [] : [`frame ${f}: the dial is turned ${show(d)}°, the motor's wheel ${wheel.values[f]}°`];
    });
    expect(failures, `the dial turns as the motor turns its wheel, at every frame:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${ID} an output reading a body's velocity writes its vertical part to a readout at every frame`, () => {
    // The same scene without the hinge's output, which at the base refuses the whole world: this clause is the readout's.
    const scene = rigScene(['fall']);
    const doc = DOC(2);
    const replies = runShow(showBin('full'), scenario(temp(), [doc], [showCall(doc, scene), ...FRAMES.map((f) => evalCall(doc, f, [READOUT_TEXT]))]), 'the scene, played');
    expect(unpresented(replies[0]), 'the scene is presented, its readout taking the output').toBe('');
    const texts = FRAMES.map((f) => valueAt(replies[1 + f], READOUT_TEXT));
    console.log(`${READOUT_TEXT}: ${show(texts[0])} at 0 s, ${show(texts[HALF_SECOND])} at 0.5 s, ${show(texts[FPS])} at 1 s`);
    // Dropped from rest, the ball's velocity after t seconds is (0, −9.81 t, 0) m/s: 0 at the first frame, −9.81 at the last.
    const failures = FRAMES.flatMap((f) => {
      const falls = f === 0 ? 0 : (-G * f) / FPS;
      const shown = shownNumber(texts[f]);
      return shown !== null && Math.abs(shown - falls) <= 1e-3 ? [] : [`frame ${f} (${(f / FPS).toFixed(3)} s): the readout shows ${show(texts[f])}; the ball's vertical velocity is ${falls.toFixed(4)} m/s`];
    });
    expect(failures, `the readout shows the vertical part of the ball's velocity at every frame:${list(failures)}`).toEqual([]);
  }, TIMEOUT);
});
