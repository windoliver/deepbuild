// Ported for #213's criterion 1 (#213.170f7e56), run against our output: the ray-against-box hit and the filtered ray
// of the upstream engine's 3D crate's `tests/query_pipeline_subshapes.rs` (ray_hits_report_the_triangle), commit
// 3406750a38286a0d3c7d0f4be2f9d53153e81d90, Apache-2.0 (README: Sources). No upstream code is copied: upstream casts a ray
// down onto a two-triangle mesh over a box and requires the hit to name the collider struck with a time of impact within
// 1e-4 of 5, then excludes the mesh by a query filter and requires the ray to pass on to the box at 9.5. Ours: a world
// of two 1 m blocks along +x, `near` (faces at 5 m) in collision group front and `far` (faces at 9 m) in back; the
// suite's caster asks two rays from the origin along +x through physics.cast@1, one over every group and one over back
// alone, and reads their first hits a step later.

import { describe, expect, it } from 'vitest';
import { CRITERIA, TIMEOUT, binOf, box, handleOf, none, useBuilds, useTemp, world, type JsonObject, type LogicItem } from './helpers.ts';
import { STONE, cast, oneWorldScene } from './helpers.ts';

const ID = CRITERIA[1];
useBuilds(['show']);
const temp = useTemp();

const PAIR = 'pair';
function pairWorld(): JsonObject {
  const block = (member: string, x: number): JsonObject => ({ kind: 'static', shapes: [{ shape: 'block', contact_material: 'stone', member: [member] }], pose: { pos: [x, 0, 0] } });
  return world({ collision_groups: ['front', 'back'], contact_materials: STONE, shapes: { block: box([0.5, 0.5, 0.5]) }, bodies: { near: block('front', 5.5), far: block('back', 9.5) } });
}

describe(`${ID} (oracle: ray_hits_report_the_triangle) a ray's hit names the body it struck at its time of impact, and a filtered ray passes on to the next`, () => {
  it(`${ID} the ray over every group hits near at 5 m within 1e-4 m, naming it; the ray over back alone passes near and hits far at 9 m within 1e-4 m, naming it`, () => {
    const evidence = temp();
    const make = (logic: Record<string, LogicItem>): JsonObject => oneWorldScene(evidence, 'Two blocks', PAIR, pairWorld(), logic);
    const rays = [
      { groups: -1, max: 100, from: [0, 0, 0] as [number, number, number], dir: [1, 0, 0] as [number, number, number] },
      { groups: 0b10, max: 100, from: [0, 0, 0] as [number, number, number], dir: [1, 0, 0] as [number, number, number] },
    ];
    const { hits, handles } = cast(binOf('show'), evidence, make, PAIR, rays, 2, 'the two blocks');
    const near = handleOf(handles, PAIR, 'near', 'the two blocks');
    const far = handleOf(handles, PAIR, 'far', 'the two blocks');
    const fails: string[] = [];
    const [all, back] = hits;
    if (!all || all.n < 1 || all.id !== near || Math.abs(all.distance - 5) >= 1e-4) fails.push(`the ray over every group: ${JSON.stringify(all)}; want its first hit on near (${near}) at 5 m within 1e-4 m`);
    if (all && all.n !== 2) fails.push(`the ray over every group meets both blocks, ${all.n} hits read`);
    if (!back || back.n !== 1 || back.id !== far || Math.abs(back.distance - 9) >= 1e-4) fails.push(`the ray over back alone: ${JSON.stringify(back)}; want one hit, on far (${far}) at 9 m within 1e-4 m`);
    none(fails, 'the two rays');
    expect(near, 'near and far are told apart').not.toBe(far);
  }, TIMEOUT);
});
