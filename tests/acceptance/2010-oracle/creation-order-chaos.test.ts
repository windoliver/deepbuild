// The rule of Unreal Engine's Chaos test DeterministicSim_DifferentCreationOrder, in
// Engine/Source/Programs/HeadlessChaos/Private/HeadlessChaosTestRewind.cpp at commit
// 396c9f059903aed5fec78ecd3d437a40c6415368 of https://github.com/EpicGames/UnrealEngine. That source is Epic's, under
// the Unreal Engine EULA ("All Rights Reserved"), which doesn't let its code be redistributed outside licensees, so
// nothing of it is ported or copied here: this file asserts the same rule, from a second engine, on a scene of our own
// written from the test's published parameters, on deep-physics's output (#136).
//
// The rule: fifty dynamic boxes created in reverse order end, after 20 steps of 1/30 s under gravity, with zero position
// and zero rotation error against the run that created them in order. Ours: fifty 1 m boxes stacked 1 m apart, each
// 5 cm further along z than the one below, on a static 20 × 10 × 20 m box whose top is y 0, 20 steps at 30 Hz with
// g = 9.8 m/s²; the second run's document writes the bodies in reverse order. Every body's position and rotation after
// step 20 must be equal to the bit, and every step hash with them.
import { describe, expect, it } from 'vitest';
import {
  CAPACITY, CRITERIA, TIMEOUT, ask, bake, box, none, prebuild, reversedBodies, statesOf, stepHashes, world, type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];
const STEPS = 20;
const COUNT = 50;

function tower(): { w: JsonObject; ids: string[] } {
  const bodies: JsonObject = { base: { kind: 'static', shapes: [{ shape: 'base', contact_material: 'plain' }], pose: { pos: [0, -5, 0] } } };
  const ids: string[] = [];
  for (let i = 0; i < COUNT; i++) {
    const id = `box${String(i).padStart(2, '0')}`;
    ids.push(id);
    bodies[id] = { kind: 'dynamic', shapes: [{ shape: 'cube', contact_material: 'plain' }], pose: { pos: [0, i + 0.5, 0.05 * i] }, mass: 1 };
  }
  const w = world({
    step_rate: 30,
    gravity: [0, -9.8, 0],
    capacity: CAPACITY,
    contact_materials: { plain: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes: { base: box([10, 5, 10]), cube: box([0.5, 0.5, 0.5]) },
    bodies,
  });
  return { w, ids };
}

describe(`${ID} Chaos's DeterministicSim_DifferentCreationOrder rule, on deep-physics's output`, () => {
  it(`${ID} fifty boxes written in reverse order end ${STEPS} steps later with zero position and rotation error, and the same step hashes`, () => {
    const { w, ids } = tower();
    const [forward, reverse] = ask([bake(w, STEPS), bake(reversedBodies(w), STEPS)]);
    expect(stepHashes(reverse!, STEPS + 1, 'the reverse-order run'), 'the same step hashes').toEqual(stepHashes(forward!, STEPS + 1, 'the in-order run'));
    const off: string[] = [];
    for (const id of ids) {
      const a = statesOf(forward!, id, STEPS + 1, 'the in-order run')[STEPS]!;
      const b = statesOf(reverse!, id, STEPS + 1, 'the reverse-order run')[STEPS]!;
      if (a.pos.some((v, i) => v !== b.pos[i])) off.push(`${id}: position [${a.pos.join(', ')}] in order, [${b.pos.join(', ')}] reversed`);
      if (a.rot.some((v, i) => v !== b.rot[i])) off.push(`${id}: rotation [${a.rot.join(', ')}] in order, [${b.rot.join(', ')}] reversed`);
    }
    none(off, 'zero position and rotation error');
  }, TIMEOUT);
});
