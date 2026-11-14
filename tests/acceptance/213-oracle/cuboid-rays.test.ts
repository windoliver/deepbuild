// Ported for #213's criterion 1 (#213.170f7e56), run against our output: the upstream geometry library's 3D crate's
// `tests/geometry/cuboid_ray_cast.rs` (shape_ray_cast_points_to_surface), commit 3383f51cbbe9af70565427e7a66c605e1557c1fc,
// Apache-2.0 (README: Sources). No upstream code is copied: upstream casts 1,000 seeded rays from 5 m out toward the
// centre of each of four shapes (a ball of radius 1, a cube of half-side 1, a 1 × 1 × 0.5 box and a 0.5 × 1 × 0.5 box,
// each turned by a seeded rotation per ray, the identity for about 1 in 100) and requires the hit point, nudged 1 mm in
// along the hit's normal, to be inside the shape and, nudged 1 mm out, outside it. Ours: one world of 100 static
// bodies, each of the four shapes at 25 seeded rotations, 30 m apart; 40 seeded rays at each body from 5 m out toward
// its centre (1,000 a shape), asked through physics.cast@1 by the suite's caster in batches of 250. The hit point is
// upstream's, the ray's origin plus its direction times the distance read; inside and outside are this test's own
// geometry of the body as the world document places it. The hit must also name the body aimed at, and the point it
// reports must be that point.

import { describe, it } from 'vitest';
import { CRITERIA, TIMEOUT, binOf, box, none, rng, sphere, useBuilds, useTemp, world, type JsonObject, type LogicItem, type Vec3 } from './helpers.ts';
import { STONE, cast, oneWorldScene, type Ray } from './helpers.ts';

const ID = CRITERIA[1];
useBuilds(['show']);
const temp = useTemp();

const TARGETS = 'targets';
type Quat = [number, number, number, number];
const SHAPES: { name: string; shape: JsonObject; inside: (p: Vec3) => boolean }[] = [
  { name: 'ball', shape: sphere(1), inside: (p) => Math.hypot(...p) < 1 },
  { name: 'cube', shape: box([1, 1, 1]), inside: (p) => Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1 && Math.abs(p[2]) < 1 },
  { name: 'tall', shape: box([1, 1, 0.5]), inside: (p) => Math.abs(p[0]) < 1 && Math.abs(p[1]) < 1 && Math.abs(p[2]) < 0.5 },
  { name: 'slim', shape: box([0.5, 1, 0.5]), inside: (p) => Math.abs(p[0]) < 0.5 && Math.abs(p[1]) < 1 && Math.abs(p[2]) < 0.5 },
];
const ROTATIONS = 25;
const PER_BODY = 40;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** v turned by the inverse of the unit quaternion q = [x, y, z, w]. */
function unrotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [-q[0], -q[1], -q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

interface Body { id: string; centre: Vec3; rot: Quat; inside: (p: Vec3) => boolean }
function layout(): { bodies: Body[]; rays: (Ray & { body: Body })[] } {
  const next = rng(42);
  const bodies: Body[] = [];
  SHAPES.forEach((s, si) => {
    for (let j = 0; j < ROTATIONS; j++) {
      const rot: Quat = next() < 0.01 ? [0, 0, 0, 1] : ((): Quat => { const q: Quat = [next(), next(), next(), next()]; const n = Math.hypot(...q); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; })();
      bodies.push({ id: `${s.name}_${String(j).padStart(2, '0')}`, centre: [30 * j, 0, 30 * si], rot, inside: s.inside });
    }
  });
  const rays = bodies.flatMap((b) => Array.from({ length: PER_BODY }, () => {
    const u = unit([next(), next(), next()]);
    return { body: b, groups: -1, max: 10, from: add(b.centre, scale(u, 5)), dir: scale(u, -1) };
  }));
  return { bodies, rays };
}
function targetsWorld(bodies: Body[]): JsonObject {
  return world({
    capacity: { bodies: 128, shapes: 128, joints: 0, contacts: 64, particles: 0 },
    contact_materials: STONE,
    shapes: Object.fromEntries(SHAPES.map((s) => [s.name, s.shape])),
    bodies: Object.fromEntries(bodies.map((b) => [b.id, { kind: 'static', shapes: [{ shape: b.id.split('_')[0]!, contact_material: 'stone' }], pose: { pos: b.centre, rot: b.rot } }])),
  });
}

describe(`${ID} (oracle: shape_ray_cast_points_to_surface) every seeded ray's hit lies on the surface of the turned shape it struck`, () => {
  it(`${ID} 1,000 seeded rays at each of a ball, a cube and two boxes, each turned: each hit names the body aimed at, and its point nudged 1 mm in along the normal is inside, 1 mm out outside`, () => {
    const { bodies, rays } = layout();
    const evidence = temp();
    const make = (logic: Record<string, LogicItem>): JsonObject => oneWorldScene(evidence, 'Turned targets', TARGETS, targetsWorld(bodies), logic);
    const { hits, handles } = cast(binOf('show'), evidence, make, TARGETS, rays, 250, 'the turned targets');
    const fails: string[] = [];
    rays.forEach((r, i) => {
      const hit = hits[i]!;
      const b = r.body;
      const what = `ray ${i} at ${b.id} from ${r.from.map((x) => x.toFixed(3)).join(', ')}`;
      if (hit.n < 1) { fails.push(`${what}: no hit`); return; }
      const want = handles.bodies[TARGETS]?.[b.id];
      if (hit.id !== want) fails.push(`${what}: its hit names handle ${hit.id}, not ${b.id}'s ${String(want)}`);
      const p = add(r.from, scale(r.dir, hit.distance));
      if (Math.hypot(...sub(hit.point, p)) > 1e-4) fails.push(`${what}: the hit's point ${hit.point.join(', ')} is not the ray's point at ${hit.distance} m, ${p.join(', ')}`);
      const local = (q: Vec3): Vec3 => unrotate(b.rot, sub(q, b.centre));
      if (!b.inside(local(add(p, scale(hit.normal, -0.001))))) fails.push(`${what}: the point nudged 1 mm in along the normal ${hit.normal.join(', ')} is not inside`);
      if (b.inside(local(add(p, scale(hit.normal, 0.001))))) fails.push(`${what}: the point nudged 1 mm out along the normal ${hit.normal.join(', ')} is inside`);
    });
    none(fails, `${fails.length} of ${rays.length} rays`);
  }, TIMEOUT);
});
