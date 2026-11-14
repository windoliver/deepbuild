// The rules of two cases of the second upstream engine's rewind suite (`…TestRewind.cpp` in its headless test program,
// at commit 396c9f059903aed5fec78ecd3d437a40c6415368, the Oracle page's pin for #522's criterion 5, its vendor copy
// under `doneright/oracles/vendor/`). That source is under the engine's own EULA ("All Rights Reserved"), which doesn't
// let its code be redistributed outside licensees, so nothing of it is ported or copied: this file asserts the same
// rules on scenes of our own, written from the cases' published parameters, on deep-physics's output (#136).
//
// RewindTest_Resim's rule: rewind to an earlier step and simulate again with a corrected input there, and the run stays
// in sync (its 12 steps, its rewind to step 7). Ours: a 0.5 m ball falling from 10 m, a checkpoint every 5 steps; a
// live view runs to step 12, then a late poke stamped at step 7 arrives (#522's `late`): the world restores its
// checkpoint at step 5, steps to 12 again, and its record equals a straight bake with the poke at step 7 on its track.
// DeterministicSim_DifferentCreationOrder's rule: fifty bodies created in reverse order end with zero position and
// rotation error (its 50 boxes, 20 steps of 1/30 s). Ours, on the same late path: the #2010 Oracle lane's tower of fifty
// 1 m boxes at 30 Hz, the document written forward and in reverse; each runs to step 20 in a live view, takes a late
// poke of its lowest box stamped at step 10 and steps forward again; both records equal each other and a straight bake
// of the forward document with the poke on its track, so the reversed one's states are the forward one's to the bit.
// Dropping the replaced steps' occurrences is ours, and stays with tests/acceptance/522/.
import { describe, expect, it } from 'vitest';
import {
  CAPACITY, CRITERIA, TIMEOUT, ask, bakeCall, box, hashesOf, live, open, pokeAt, prebuild, recordCall, recordOf, reversedBodies, sphere, world,
  type JsonObject, type Recorded,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[5];

/** A live view of `w` run to step `to`; a late `entry` added there; the world back at `to`: its record. */
async function lateRecord(w: JsonObject, to: number, span: number, entry: JsonObject, restoredAt: number): Promise<Recorded> {
  const l = live();
  try {
    const { s } = await open(l, w, [], span);
    const there = await s.land(await s.frame({ seek: to }));
    expect(there?.at, `the world runs to step ${to}`).toBe(to);
    const late = await s.frame({ late: entry });
    expect(late.restored, `the late entry restores the checkpoint at step ${restoredAt}`).toBe(restoredAt);
    const back = await s.land(late);
    expect(back?.at, `and the world steps to ${to} again`).toBe(to);
    return recordOf(await l.call(recordCall(s.id)), `the record at step ${to}`);
  } finally { l.stop(); }
}

const fall = (): JsonObject => world({
  contact_materials: { plain: { friction: 0.5, restitution: 0, density: 1000 } },
  shapes: { ball: sphere(0.5) },
  bodies: { ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'plain' }], pose: { pos: [0, 10, 0] }, mass: 1 } },
  inputs: { poke: { kind: 'poke', targets: ['ball'] } },
  checkpoint: { every: 5 },
});

function tower(): JsonObject {
  const bodies: JsonObject = { base: { kind: 'static', shapes: [{ shape: 'base', contact_material: 'plain' }], pose: { pos: [0, -5, 0] } } };
  for (let i = 0; i < 50; i++) bodies[`box${String(i).padStart(2, '0')}`] = { kind: 'dynamic', shapes: [{ shape: 'cube', contact_material: 'plain' }], pose: { pos: [0, i + 0.5, 0.05 * i] }, mass: 1 };
  return world({
    step_rate: 30, gravity: [0, -9.8, 0], capacity: CAPACITY,
    contact_materials: { plain: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes: { base: box([10, 5, 10]), cube: box([0.5, 0.5, 0.5]) },
    bodies,
    inputs: { poke: { kind: 'poke', targets: Array.from({ length: 50 }, (_, i) => `box${String(i).padStart(2, '0')}`) } },
    checkpoint: { every: 5 },
  });
}

describe(`${ID} the rewind suite's rules on our late entry: a resim with a corrected input stays in sync, whatever the creation order`, () => {
  it(`${ID} RewindTest_Resim's rule: a poke at step 7 arriving after step 12 restores step 5 and steps to 12 in sync with the run that had it on time`, async () => {
    const poke = pokeAt(7, [0, 0, 3]);
    const rec = await lateRecord(fall(), 12, 1, poke, 5);
    const [onTime] = ask([bakeCall(fall(), [poke], 12)]);
    expect(rec.hashes, 'every step hash 0 … 12').toEqual(hashesOf(onTime, 'the run with the poke on time'));
  }, TIMEOUT);

  it(`${ID} DeterministicSim_DifferentCreationOrder's rule on the late path: fifty boxes written in reverse order, a late poke at step 10 after step 20, end in sync with the forward run`, async () => {
    const poke = pokeAt(10, [0, 0, 1], 'box00');
    const forward = await lateRecord(tower(), 20, 1, poke, 10);
    const reversed = await lateRecord(reversedBodies(tower()), 20, 1, poke, 10);
    const [onTime] = ask([bakeCall(tower(), [poke], 20)]);
    const straight = hashesOf(onTime, 'the forward run with the poke on time');
    expect(forward.hashes, 'the forward document\'s late run is the on-time run').toEqual(straight);
    expect(reversed.hashes, 'and the reversed document\'s, to the bit').toEqual(straight);
  }, TIMEOUT);
});
