// The criteria's worlds and scenes (README: Fixtures), shared by the files that run a logic item beside a world through
// `deep-show run`, and the handle probe every such file starts with.

import { DOC, box, handlesOf, logicCall, presented, runShow, scenario, sceneDoc, showCall, world, type Handles, type JsonObject, type LogicItem, markBox } from './helpers.ts';
import { ticker } from './programs.ts';

const STONE: JsonObject = { stone: { friction: 0.5, restitution: 0, density: 1000 } };
const use = (shape: string, extra: JsonObject = {}): JsonObject => ({ shape, contact_material: 'stone', ...extra });

/** The range's world ID, and its wall's start: a 1 × 4 × 4 m slab centred at x = 10.5 m, so its face is at x = 10 m. */
export const RANGE = 'range';
export const WALL_X = 10.5;
export const WALL_HALF = 0.5;
/**
 * Criteria 1 to 3: `wall` (static, or kinematic following the scene's `items/wall/at/pos`) and `post`, a static
 * 1 m cube at (5, 5, 0), off the ray from the origin along +x, so a hit naming the wall names it among two bodies.
 */
export function rangeWorld(kinematic: boolean): JsonObject {
  const wall: JsonObject = kinematic
    ? { kind: 'kinematic', shapes: [use('slab')], pose: { pos: [WALL_X, 0, 0] }, follow: 'items/wall/at/pos' }
    : { kind: 'static', shapes: [use('slab')], pose: { pos: [WALL_X, 0, 0] } };
  return world({
    contact_materials: STONE,
    shapes: { slab: box([WALL_HALF, 2, 2]), post: box([0.5, 0.5, 0.5]) },
    bodies: { wall, post: { kind: 'static', shapes: [use('post')], pose: { pos: [5, 5, 0] } } },
  });
}
/** The wall's channel when it moves: from x = 10.5 m at 0 s to 8.5 m at 2 s, linear, so its face moves at 1 m/s toward the origin. */
const WALL_CHANNEL: JsonObject = {
  wall: { target: 'items/wall/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [WALL_X, 0, 0], interp: 'linear' }, k1: { t: '2s', value: [WALL_X - 2, 0, 0], interp: 'hold' } } },
};
/** The range as a scene over 2 s: the world, the wall's box item (and, when kinematic, its channel), and `logic`. */
export function rangeScene(evidence: string, logic: Record<string, LogicItem>, kinematic = false): JsonObject {
  return sceneDoc(evidence, {
    title: kinematic ? 'Moving wall range' : 'Wall range', span: '2s', worlds: { [RANGE]: rangeWorld(kinematic) }, logic,
    items: { wall: markBox([2 * WALL_HALF, 4, 4], [WALL_X, 0, 0]) },
    ...(kinematic ? { extra: { channels: WALL_CHANNEL } } : {}),
  });
}
/** The same scene with no logic item: what `deep-physics` bakes of its world. */
export function withoutLogic(scene: JsonObject): JsonObject {
  const items = Object.fromEntries(Object.entries(scene['items'] as JsonObject).filter(([, i]) => (i as JsonObject)['kind'] !== 'logic@1'));
  const { assets: _assets, ...rest } = scene;
  return { ...rest, items };
}

/** physics.cast@1 on an item with `max_per_step` m, and its other params. */
export const castParams = (m: number, rest: JsonObject): JsonObject => ({ services: { 'physics.cast@1': { max_per_step: m } }, ...rest });

/**
 * The handles a scene's worlds and bodies are interned to (README: handles), read before a program that names its world
 * is assembled: the scene `make` builds, with the idle `ticker` as its one logic item, presented and stepped once.
 */
export function probeHandles(bin: string, evidence: string, make: (logic: Record<string, LogicItem>) => JsonObject, what: string): Handles {
  const doc = DOC(99);
  const scene = make({ probe: { program: ticker(), params: { writes: { n: { type: 'i32' } } } } });
  const [shown, ran] = runShow(bin, scenario(evidence, [doc], [showCall(doc, scene), logicCall(doc, 1)]), `${what}: the handle probe`);
  presented(shown, `${what}: the handle probe`);
  return handlesOf(ran, `${what}: the handle probe`);
}
