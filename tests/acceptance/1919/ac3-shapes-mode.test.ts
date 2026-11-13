// #1919.4c1f2dbc: in a build without the physics module, physics shapes answers `module_missing`, naming the module, and
// a planted mode that returns an empty snapshot instead fails.
//
// Two deep-show builds (README: deep-show): `test-leave-out-physics`, the full set without the physics module, and its
// twin `test-physics-shapes-empty`, the same build whose physics shapes mode returns an empty snapshot instead. Each is
// asked for one `deep_show` of a small 3D scene in the `physics_shapes` mode (#411's `mode`, with pixels at 1 s). The
// judge is #411's module_missing answer: `code: "module_missing"`, `module: "physics"`, no snapshot and nothing drawn.
import { describe, it } from 'vitest';
import {
  CRITERIA, DOC, LEAVE_OUT_PHYSICS, SHAPES_EMPTY, SHOW_TIMEOUT, camera, caught, markBox, moduleMissingFailures, none, prebuildFeatures, runShow,
  scenario, sceneDoc, showBuildBin, showCall, useTemp, type JsonObject,
} from './helpers.ts';

prebuildFeatures([['deep-show', 'deep-show', LEAVE_OUT_PHYSICS], ['deep-show', 'deep-show', SHAPES_EMPTY]]);

const ID = CRITERIA[3];
const temp = useTemp();
const SCENE = sceneDoc('Crate', '2s', { cam: camera([0, 2, 8], [0, 0.5, 0]), crate: markBox([1, 1, 1], [0, 0.5, 0]) }, {});

/** physics shapes at 1 s on `feature`'s build: its one reply. */
function shapes(feature: string): JsonObject | undefined {
  const doc = DOC(1);
  const call = { ...showCall(doc, SCENE), t: '1s', size: [320, 180], include: ['issues', 'pixels'], mode: 'physics_shapes' };
  return runShow(showBuildBin(feature), scenario(temp(), [doc], [call]), `physics shapes on deep-show --features ${feature}`)[0];
}

describe(`${ID} physics shapes in a build without the physics module`, () => {
  it(`${ID} answers module_missing, naming the physics module, with no snapshot`, () => {
    none(moduleMissingFailures(shapes(LEAVE_OUT_PHYSICS)), 'physics shapes without the physics module');
  }, SHOW_TIMEOUT);

  it(`${ID} a planted mode that returns an empty snapshot instead fails`, () => {
    caught(moduleMissingFailures(shapes(SHAPES_EMPTY)), SHAPES_EMPTY);
  }, SHOW_TIMEOUT);
});
