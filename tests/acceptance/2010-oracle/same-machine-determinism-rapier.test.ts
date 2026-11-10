// Ported from Rapier, crates/rapier3d/tests/issue_868_same_machine_determinism.rs (same_machine_runs_are_bitwise_identical),
// at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90 of https://github.com/dimforge/rapier, licensed Apache-2.0
// (the file is the same in the rapier3d 0.36.1 crate). No upstream code is copied: the scene and the assertion are
// re-expressed here on deep-physics's output, as #136 requires (a linked test counts only when run against our output).
//
// Upstream drops eight balls (r 0.5, restitution 0.7) in a 2 × 2 × 2 block onto a 100 × 0.1 × 100 cuboid, runs 200
// steps twice from the same start, and requires every ball's position bits to match. Here the same world is baked by
// two deep-physics processes: every ball's position after step 200 must match exactly (JSON carries each f32 exactly),
// and, our criterion's own surface, every step hash must too.
import { describe, expect, it } from 'vitest';
import {
  AVERAGE, CRITERIA, TIMEOUT, ask, bake, box, none, prebuild, sphere, statesOf, stepHashes, upstreamMaterial, upstreamWorld, type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];
const STEPS = 200;

function dropScene(): { w: JsonObject; balls: string[] } {
  const bodies: JsonObject = { ground: { kind: 'static', shapes: [{ shape: 'ground', contact_material: 'ground' }], pose: { pos: [0, 0, 0] } } };
  const balls: string[] = [];
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
    const id = `ball_${x}${y}${z}`;
    balls.push(id);
    bodies[id] = { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'bouncy' }], pose: { pos: [x * 0.51 + 3, y * 0.5 + 3.5, z * 0.5 + 3] } };
  }
  const w = upstreamWorld({
    combine: AVERAGE,
    contact_materials: { ground: upstreamMaterial(), bouncy: upstreamMaterial({ restitution: 0.7 }) },
    shapes: { ground: box([100, 0.1, 100]), ball: sphere(0.5) },
    bodies,
  });
  return { w, balls };
}

describe(`${ID} Rapier's issue_868_same_machine_determinism, on deep-physics's output`, () => {
  it(`${ID} same_machine_runs_are_bitwise_identical: eight balls dropped twice, ${STEPS} steps each, end with the same position bits and the same step hashes`, () => {
    const { w, balls } = dropScene();
    const [first] = ask([bake(w, STEPS)], { where: 'first run' });
    const [second] = ask([bake(w, STEPS)], { where: 'second run' });
    expect(stepHashes(second!, STEPS + 1, 'the second run'), 'two identical runs give the same step hashes').toEqual(stepHashes(first!, STEPS + 1, 'the first run'));
    const off: string[] = [];
    for (const id of balls) {
      const a = statesOf(first!, id, STEPS + 1, 'the first run')[STEPS]!.pos;
      const b = statesOf(second!, id, STEPS + 1, 'the second run')[STEPS]!.pos;
      if (a.some((v, i) => v !== b[i])) off.push(`${id}: [${a.join(', ')}] then [${b.join(', ')}]`);
    }
    none(off, 'two identical runs diverged');
  }, TIMEOUT);
});
