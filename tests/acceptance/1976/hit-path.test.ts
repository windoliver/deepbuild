// AC1 #1976.aa8721f3: For 200 seeded rays through the view at 10 m to 400 m from a fixture plane and a fixture sphere,
// each placed point lies within 1e-5 m of the analytic intersection. A planted tool that reconstructs points from the
// depth buffer fails, naming the first ray off by more than 1 mm.
//
// The fixture: one scene of two `mesh.asset@1` items, each a JSON glTF written here with an unlit, double-sided,
// opaque material, over a black sky. `plane` is the square y = 0, |x|, |z| ≤ 2048 m, two triangles whose corners are
// whole numbers, so its triangles are the analytic plane exactly. `sphere` is a UV sphere of radius 1/32 m, 512
// segments around and 256 rings (261,120 triangles), its vertices on the sphere rounded to f32 in the file, placed by
// `at.pos` at (0.5, 1.25, −0.75); along every seeded ray its triangles lie within 2e-6 m of the analytic sphere, which
// the test checks on the f32 positions it wrote, so the 1e-5 m bound credits only a hit on the evaluated triangles
// (README: The analytic intersection). Seven poses of `camera@1` (perspective, +Y up, fov across the wider side,
// 320 × 240 px): two look down 15° at the plane from 6 m up with fov 60°; five look at the sphere's centre from
// 10.0625 m to 400 m (log-spaced, seeded azimuth and elevation), each fov framing the sphere at 80 px radius. Every
// pose value is an f32, so a pose read in f32 or f64 is the same pose.
//
// The rays (seed 1976): 50 per plane pose, at a seeded slant distance log-uniform in 10 to 400 m and a seeded bearing
// within 25° of the view's; 20 per sphere pose, seeded in the disc of 0.8 times the sphere's projected radius, at most
// 55° from its normal. Each is a click at a seeded sub-pixel point (a multiple of 1/1024 px), its nearest analytic hit
// 10 to 400 m from the eye, and every ray within 2 px of it meets the same item first, so the object-ID pick names
// that item without a silhouette in reach. One `view3d` call per pose answers each click (`clicks: [{frame: 0, at}]`)
// as `{at, pick, hit: [{item, sub, point: f64[3], normal, distance}]}` (README: Assumed surfaces), nearest first; the
// placed point is the first hit's `point`, in the document's world frame. Each must name the item the ray meets and
// lie within 1e-5 m of the ray's analytic intersection with it, in f64.
//
// The planted twin, `deep-gpu run --planted hit_from_depth`, places each hit where the click's ray reaches the
// view-axis depth the depth target holds at the clicked pixel. The depth target holds one depth per pixel, so a ray
// through any other point of that pixel is placed at the wrong depth; on the plane at 6 m up that depth changes by
// centimetres to tens of metres a pixel row, so a reader of the pixel's own depth is off by more than 1 mm on every
// one of the 100 plane rays, the least by 1.7 mm (checked here, at least 50, from the analytic depths at the pixel
// centres). The check fails, naming the first ray off by more than 1 mm. Wrong programs this catches besides: a ray
// in f32 (f32 resolves about 2.4e-5 m at 400 m), a ray through the pixel's centre instead of the click, the far side
// of the sphere first, a point in the item's own frame, a hit named on another item.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  AC1, DARK_SKY, PLAIN_LOOK, add, basis, clickAnswers, dist, dot, f32, gltf, hitGround, hitSphere, hitTriangle, isObject, project, rad,
  rayAt, requireMetal, runGpu, scale, seeded, sessionDoc, shown, sub, unit, unlit, useDir, useGpu, writeJson,
  type GpuPlanted, type JsonObject, type JsonValue, type Mesh, type Pinhole, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

const SIZE: [number, number] = [320, 240];
const SEED = 1976;
/** The criterion's bound, and the planted reader's. */
const BOUND = 1e-5;
const MM = 1e-3;
/** How far the sphere's triangles may lie from the analytic sphere along a seeded ray (a fifth of the bound). */
const MESH_GAP = 2e-6;
const PLANE_HALF = 2048;
const SPHERE = { r: 1 / 32, centre: [0.5, 1.25, -0.75] as V3, around: 512, rings: 256, radiusPx: 80 };
const NEAR = 0.5;
const FAR = 8000;

type Item = 'plane' | 'sphere';
interface Pose extends Pinhole { name: string; item: Item; count: number }
interface Ray { k: number; pose: Pose; at: [number, number]; item: Item; dir: V3; t: number; point: V3 }

const PLANE_MESH: Mesh = { positions: [[-PLANE_HALF, 0, -PLANE_HALF], [-PLANE_HALF, 0, PLANE_HALF], [PLANE_HALF, 0, PLANE_HALF], [PLANE_HALF, 0, -PLANE_HALF]], triangles: [[0, 1, 2], [0, 2, 3]] };

/** A UV sphere of radius `r` about the origin: `around` segments, `rings` rings, vertices on the sphere, faces out. */
function uvSphere(r: number, around: number, rings: number): Mesh {
  const positions: V3[] = [[0, r, 0]];
  for (let j = 1; j < rings; j++) {
    const lat = Math.PI / 2 - (Math.PI * j) / rings;
    for (let i = 0; i < around; i++) {
      const lon = (2 * Math.PI * i) / around;
      positions.push([r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)]);
    }
  }
  positions.push([0, -r, 0]);
  const at = (j: number, i: number): number => 1 + (j - 1) * around + (i % around);
  const south = positions.length - 1;
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < around; i++) triangles.push([0, at(1, i + 1), at(1, i)]);
  for (let j = 1; j < rings - 1; j++) for (let i = 0; i < around; i++) {
    const a = at(j, i); const b = at(j, i + 1); const c = at(j + 1, i); const d = at(j + 1, i + 1);
    triangles.push([a, b, d], [a, d, c]);
  }
  for (let i = 0; i < around; i++) triangles.push([south, at(rings - 1, i), at(rings - 1, i + 1)]);
  return { positions, triangles };
}
const SPHERE_MESH: Mesh = f32(uvSphere(SPHERE.r, SPHERE.around, SPHERE.rings));

/** The nearest analytic hit of a ray among the two fixtures. */
function nearest(o: V3, d: V3): { item: Item; t: number } | null {
  const s = hitSphere(o, d, SPHERE.centre, SPHERE.r); const g = hitGround(o, d, PLANE_HALF);
  if (s !== null && (g === null || s < g)) return { item: 'sphere', t: s };
  return g === null ? null : { item: 'plane', t: g };
}

/** The seven poses and the 200 seeded rays (header). */
function fixture(): { poses: Pose[]; rays: Ray[] } {
  const rand = seeded(SEED);
  const poses: Pose[] = [
    { name: 'plane-a', item: 'plane', count: 50, position: [-37.5, 6, 52.25], target: [-59.875, 0, 52.25], fov: 60, size: SIZE },
    { name: 'plane-b', item: 'plane', count: 50, position: [61.75, 6, -18.5], target: [77.5625, 0, -34.3125], fov: 60, size: SIZE },
  ];
  for (let k = 0; k < 5; k++) {
    const distance = 10.0625 * Math.pow(400 / 10.0625, k / 4);
    const azimuth = rand() * 360; const elevation = 5 + rand() * 30;
    const toward: V3 = [Math.cos(rad(elevation)) * Math.sin(rad(azimuth)), Math.sin(rad(elevation)), Math.cos(rad(elevation)) * Math.cos(rad(azimuth))];
    const position = add(SPHERE.centre, scale(toward, distance)).map(Math.fround) as V3;
    const angular = Math.asin(SPHERE.r / dist(position, SPHERE.centre));
    const focal = SPHERE.radiusPx / Math.tan(angular);
    const fov = Math.fround((2 * Math.atan(SIZE[0] / 2 / focal) * 180) / Math.PI);
    poses.push({ name: `sphere-${k}`, item: 'sphere', count: 20, position, target: SPHERE.centre, fov, size: SIZE });
  }
  const rays: Ray[] = [];
  const clear = (cam: Pose, sx: number, sy: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (nearest(cam.position, rayAt(cam, sx + dx, sy + dy))?.item !== cam.item) return false;
    return true;
  };
  for (const cam of poses) {
    let got = 0;
    for (let tries = 0; got < cam.count; tries++) {
      if (tries >= 100_000) throw Error(`the fixture: ${cam.name} finds only ${got} of its ${cam.count} rays`);
      let sx: number; let sy: number;
      if (cam.item === 'plane') {
        const slant = 10 * Math.pow(40, rand());
        const { f } = basis(cam);
        const bearing = Math.atan2(f[0], f[2]) + rad(-25 + 50 * rand());
        const run = Math.sqrt(slant * slant - cam.position[1] * cam.position[1]);
        [sx, sy] = project(cam, [cam.position[0] + run * Math.sin(bearing), 0, cam.position[2] + run * Math.cos(bearing)]);
      } else {
        const [cx, cy] = project(cam, SPHERE.centre);
        const a = rand() * 2 * Math.PI; const rr = 0.8 * SPHERE.radiusPx * Math.sqrt(rand());
        [sx, sy] = [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      }
      sx = Math.round(sx * 1024) / 1024; sy = Math.round(sy * 1024) / 1024;
      if (!(sx >= 2 && sx <= SIZE[0] - 2 && sy >= 2 && sy <= SIZE[1] - 2)) continue;
      const d = rayAt(cam, sx, sy); const h = nearest(cam.position, d);
      if (!h || h.item !== cam.item || h.t < 10 || h.t > 400 || !clear(cam, sx, sy)) continue;
      const point = add(cam.position, scale(d, h.t));
      if (cam.item === 'sphere' && -dot(unit(sub(point, SPHERE.centre)), d) < Math.cos(rad(55))) continue;
      rays.push({ k: rays.length, pose: cam, at: [sx, sy], item: cam.item, dir: d, t: h.t, point });
      got++;
    }
  }
  return { poses, rays };
}
const { poses: POSES, rays: RAYS } = fixture();

/** Where the sphere's own triangles (the f32 positions written, placed at the centre in f64) first meet a ray, looking
 * only at triangles within 3 mm of `near`. */
function sphereTriangles(o: V3, d: V3, near: V3): number | null {
  let best: number | null = null;
  const p = SPHERE_MESH.positions; const c = SPHERE.centre;
  for (const [ia, ib, ic] of SPHERE_MESH.triangles) {
    const a = add(p[ia]!, c);
    if (dist(a, near) > 0.003) continue;
    const t = hitTriangle(o, d, a, add(p[ib]!, c), add(p[ic]!, c));
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Where a reader of the clicked pixel's depth places the ray: at the view-axis depth of the pixel's centre. */
function depthReader(r: Ray): V3 {
  const cam = r.pose; const { f } = basis(cam);
  const centre = rayAt(cam, Math.floor(r.at[0]) + 0.5, Math.floor(r.at[1]) + 0.5);
  const h = nearest(cam.position, centre)!;
  const depth = h.t * dot(centre, f);
  return add(cam.position, scale(r.dir, depth / dot(r.dir, f)));
}

const fmt = (p: readonly number[]): string => p.map((v) => v.toFixed(6)).join(', ');
const label = (r: Ray): string => `ray ${r.k} (${r.pose.name}, click (${r.at[0]}, ${r.at[1]}), the ${r.item} at ${r.t.toFixed(3)} m)`;

/** One `view3d` call per pose, each clicking its rays on frame 0; the answers in ray order. */
function placed(out: string, planted?: GpuPlanted): (JsonObject | undefined)[] {
  const assets: Record<string, string> = {};
  const shas: Record<Item, string> = { plane: '', sphere: '' };
  for (const [item, mesh] of [['plane', PLANE_MESH], ['sphere', SPHERE_MESH]] as const) {
    const g = gltf(mesh); const path = join(out, `${g.sha}.gltf`);
    writeFileSync(path, g.bytes); assets[g.sha] = path; shas[item] = g.sha;
  }
  const calls = POSES.map((cam) => {
    const doc = sessionDoc(`hit-${cam.name}`, SIZE, {
      cam: { kind: 'camera@1', params: { projection: 'perspective', position: cam.position, target: cam.target, fov: cam.fov, near: NEAR, far: FAR } },
      sky: DARK_SKY,
      plane_mat: unlit([0.4, 0.4, 0.4]), sphere_mat: unlit([0.9, 0.5, 0.1]),
      plane: { kind: 'mesh.asset@1', params: { sha256: shas.plane, node: 0 }, material: 'plane_mat' },
      sphere: { kind: 'mesh.asset@1', params: { sha256: shas.sphere, node: 0 }, at: { pos: SPHERE.centre }, material: 'sphere_mat' },
    });
    const clicks = RAYS.filter((r) => r.pose === cam).map((r) => ({ frame: 0, at: r.at }));
    return { call: 'view3d', look: PLAIN_LOOK, doc: writeJson(out, `hit-${cam.name}`, doc), size: SIZE, frames: 1, capture: [0], assets, clicks } as JsonObject;
  });
  const replies = runGpu(bin(), out, calls, planted);
  return POSES.flatMap((cam, i) => {
    const answers = clickAnswers(replies[i]!, `${planted ? `--planted ${planted}: ` : ''}${cam.name}`);
    return RAYS.filter((r) => r.pose === cam).map((_, j) => answers[j]);
  });
}

/** Each ray's placed point against its analytic intersection: the failures, the first ray off by more than 1 mm,
 * how many placed a point and the largest distance read. */
function judge(answers: (JsonObject | undefined)[]): { failures: string[]; firstOverMm: string | null; placed: number; worst: number } {
  const failures: string[] = []; let firstOverMm: string | null = null; let placed = 0; let worst = 0;
  for (const r of RAYS) {
    const ans = answers[r.k];
    if (!ans) { failures.push(`${label(r)}: the click has no answer`); continue; }
    const hits = ans['hit'];
    if (!Array.isArray(hits) || hits.length === 0) { failures.push(`${label(r)}: the click's answer places no hit: ${shown(ans)}`); continue; }
    const first: JsonValue | undefined = hits[0];
    const point = isObject(first) ? first['point'] : undefined;
    if (!isObject(first) || !Array.isArray(point) || point.length !== 3 || !point.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      failures.push(`${label(r)}: the first hit has no point: f64[3]: ${shown(first)}`); continue;
    }
    const p = point as number[] as V3;
    if (first['item'] !== r.item) failures.push(`${label(r)}: the first hit names ${shown(first['item'])}, not ${r.item}`);
    const off = dist(p, r.point); worst = Math.max(worst, off); placed++;
    if (off > BOUND) {
      const line = `${label(r)}: placed at (${fmt(p)}), ${off.toExponential(3)} m from the analytic intersection (${fmt(r.point)})`;
      failures.push(line);
      if (off > MM && firstOverMm === null) firstOverMm = line;
    }
  }
  return { failures, firstOverMm, placed, worst };
}

describe(`${AC1} the hit path in 3D`, () => {
  it(`${AC1} 200 seeded rays through the view at 10 m to 400 m from a fixture plane and a fixture sphere: each placed point lies within 1e-5 m of the analytic intersection`, () => {
    requireMetal();
    // The fixture: 200 rays, 100 on each item, every hit 10 to 400 m from the eye and the range reached at both ends;
    // the sphere's triangles within 2e-6 m of the analytic sphere along every sphere ray.
    expect(RAYS.length, 'the fixture: 200 seeded rays').toBe(200);
    expect(RAYS.filter((r) => r.item === 'plane').length, 'the fixture: 100 rays on the plane').toBe(100);
    for (const r of RAYS) expect(r.t >= 10 && r.t <= 400, `the fixture: ${label(r)} is 10 to 400 m from the eye`).toBe(true);
    expect(Math.min(...RAYS.map((r) => r.t)), 'the fixture: a ray meets its item within 10.1 m').toBeLessThanOrEqual(10.1);
    expect(Math.max(...RAYS.map((r) => r.t)), 'the fixture: a ray meets its item beyond 399 m').toBeGreaterThanOrEqual(399);
    for (const r of RAYS.filter((x) => x.item === 'sphere')) {
      const t = sphereTriangles(r.pose.position, r.dir, r.point);
      expect(t !== null && Math.abs(t - r.t) <= MESH_GAP, `the fixture: along ${label(r)} the sphere's triangles lie within ${MESH_GAP} m of the analytic sphere (${t === null ? 'no triangle' : Math.abs(t - r.t).toExponential(3)})`).toBe(true);
    }

    const out = dir();
    const v = judge(placed(out));
    console.log(`${AC1}: ${v.placed} of ${RAYS.length} rays placed a point; the largest distance from one to its analytic intersection: ${v.worst.toExponential(3)} m`);
    expect(v.failures.length, `each placed point lies within ${BOUND} m of the analytic intersection; ${v.failures.length} of ${RAYS.length} rays fail:\n  ${v.failures.slice(0, 40).join('\n  ')}`).toBe(0);
  }, 3_600_000);

  it(`${AC1} a planted tool that reconstructs points from the depth buffer fails, naming the first ray off by more than 1 mm`, () => {
    requireMetal();
    const readable = RAYS.filter((r) => dist(depthReader(r), r.point) > MM).length;
    expect(readable, 'the fixture: a reader of the clicked pixel\'s own depth is off by more than 1 mm on at least 50 rays').toBeGreaterThanOrEqual(50);

    const out = dir();
    const v = judge(placed(out, 'hit_from_depth'));
    expect(v.failures.length, '--planted hit_from_depth fails the check, but the check found nothing wrong').toBeGreaterThan(0);
    expect(v.firstOverMm, `--planted hit_from_depth places some ray's point more than 1 mm off; the failures were:\n  ${v.failures.slice(0, 40).join('\n  ')}`).not.toBeNull();
    console.log(`${AC1}: --planted hit_from_depth fails on ${v.failures.length} rays, naming the first off by more than 1 mm: ${v.firstOverMm}`);
  }, 3_600_000);
});
