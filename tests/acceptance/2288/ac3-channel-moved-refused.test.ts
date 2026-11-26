// AC3 #2288.e6a5f511: an instancer moved by a channel while a world writes its columns is refused at check, naming the
// instancer and the channel.
//
// Criterion 1's turned lab (helpers.ts: turnedScene), whose world writes the columns of `tiles` through the output
// `{from: "tile#*", to: "items/tiles"}`, plus the scene's channel `nudge` on `items/tiles/at/pos`: (5, 0, 0) at 0 s,
// where the item's own `at` puts it, then linearly to (6, 0, 0) at 1 s. So at t = 0 the instancer is where criterion 1
// builds over it, and only the channel moves it after.
//
// "At check" is the world's check in its scene, `deep-physics`'s `{"call": "check", "scene", "world": "turned"}` (#1918's
// call, the one that holds a scene's world refusals; deep-show's physics module refuses what it refuses). Its reply
// holds an error issue that names the instancer `tiles` and the channel `nudge`, each in the issue's `ids`, as a segment
// of its `path`, as a word in its `what`, or as its `actual`. The same scene without the channel checks with no error,
// so neither refusing every turned instancer nor every instancer a world writes passes.
import { describe, expect, it } from 'vitest';
import {
  AC, CHANNEL, TILES, TIMEOUT, TURNED_WORLD, errorsOf, namesId, none, physics, prebuild, sceneCheck, show, turnedScene,
} from './helpers.ts';

prebuild();

const ID = AC[3];

describe(`AC3 ${ID} an instancer a channel moves can't take a world's columns`, () => {
  it(`AC3 ${ID} an instancer moved by a channel while a world writes its columns is refused at check, naming the instancer and the channel`, () => {
    const [moved, still] = physics([sceneCheck(turnedScene(true), TURNED_WORLD), sceneCheck(turnedScene(false), TURNED_WORLD)]);
    const errors = errorsOf(moved, 'the turned lab with the channel nudge on items/tiles/at/pos');
    const naming = errors.filter((e) => namesId(e, TILES) && namesId(e, CHANNEL));
    expect(naming.length, `an error issue names both the instancer ${TILES} and the channel ${CHANNEL}; the errors: ${show(errors)}`).toBeGreaterThan(0);
    none(errorsOf(still, 'the turned lab with no channel').map((e) => show(e)), 'the same scene with no channel moving the instancer checks with no error');
  }, TIMEOUT);
});
