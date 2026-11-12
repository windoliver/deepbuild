// AC1 #1401.e76a9655: 200 seeded pixels on a plane and sphere fixture land within 1e-5 m of the analytic hit; a
// planted depth reconstruction fails past 1 mm.
//
// The fixture: one shared document, stored at revision 0, all in test agent alpha's layer: two `mesh.asset@1` items,
// each a JSON glTF written here and put into the evidence store, unlit, double-sided and opaque, over a black sky.
// `plane` is the square y = 0, |x|, |z| ≤ 2^20 m, two triangles whose corners are whole numbers, so its triangles are
// the analytic plane exactly. `sphere` is a UV sphere of radius 1/32 m, 512 segments around and 256 rings (261,120
// triangles), its vertices on the sphere rounded to f32 in the file, placed at (0.5, 1.25, −0.75); along every seeded
// probe ray its triangles lie within 2e-6 m of the analytic sphere, which the test checks on the f32 positions it wrote,
// so the 1e-5 m bound credits only a hit on the evaluated triangles (README: The analytic hit). Seven `camera@1` items
// (perspective, +Y up, fov across the wider side, 320 × 240 px), every value an f32: `cam-plane-near` 6 m above the
// plane looking down 15° (fov 60°); `cam-plane-far` 4,096 m above it looking down 3° (fov 30°); and five sphere poses
// from 10.0625 m to 400 m (log-spaced, seeded azimuth and elevation), each fov framing the sphere at 80 px radius.
//
// The probes (seed 1401): 50 pixels of `cam-plane-near` meeting the plane 10 to 400 m from the eye, 50 of
// `cam-plane-far` meeting it 100 km to 200 km away, and 20 of each sphere pose meeting the sphere 10 to 400 m away, at
// most 55° from its normal; each pixel at least 2 px inside the frame, and every pixel within 2 px of it meets the
// same item first, so the object-ID pick names that item without a silhouette in reach. One render-back a pose,
// `{call: "render_back", session: alpha, doc, t: 0, rev: 0, size: [320, 240], camera: <the pose's camera item>,
// probes}` (≤ 64 each), answered `hits: [[{item, sub, point, normal, distance}]]`, one list a probe, nearest first.
// The probe's ray goes through its pixel's centre; its first hit must name the item that ray meets and lie within 1e-5
// m of the ray's analytic intersection with it, in f64.
//
// The planted twin, scenario `planted: "probe_from_depth"`, places each probe's hits where its ray reaches the view
// depth the render's depth target holds at the probe's pixel. At a pixel's centre that differs from the ray's hit only
// by the depth target's precision, and no 32-bit depth holds a millimetre at 100 km (its values there lie at least
// z × 2^-24 ≈ 6 mm apart), so the far plane pose's probes past 100 km (at least 25, checked here) put the reader past
// 1 mm. The check fails, naming the first probe off by more than 1 mm. Wrong programs this catches besides: a ray in
// f32, a ray through the pixel's corner instead of its centre, the far side of the sphere first, a point in the item's
// own frame, a hit named on another item, a probe answered from the document's camera instead of the requested one.
import { describe, expect, it } from 'vitest';
import {
  AC1, DARK_SKY, add, basis, cameraItem, dist, dot, f32, gltf, hitGround, hitLists, hitSphere, hitTriangle, isObject, meshItem, pointOf,
  probeRay, project, proof, rad, renderBack, requireMetal, runShow, scale, scenario, sceneDoc, seed, seeded, shown, slot, sub, unit, unlit,
  useDir, useShow, fmt, type JsonObject, type JsonValue, type Mesh, type Pinhole, type Pixel, type Planted, type V3,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();

const SIZE: [number, number] = [320, 240];
const SEED = 1401;
/** The criterion's bound, and the planted reader's. */
const BOUND = 1e-5;
const MM = 1e-3;
/** How far the sphere's triangles may lie from the analytic sphere along a seeded ray (a fifth of the bound). */
const MESH_GAP = 2e-6;
const PLANE_HALF = 2 ** 20;
const SPHERE = { r: 1 / 32, centre: [0.5, 1.25, -0.75] as V3, around: 512, rings: 256, radiusPx: 80 };
/** Past this distance a 32-bit depth's values lie at least 6 mm apart (z × 2^-24). */
const DEPTH_BLIND = 100_000;

type Item = 'plane' | 'sphere';
interface Pose extends Pinhole { id: string; item: Item; count: number; near: number; far: number; slant: [number, number]; spread: number }
interface Probe { k: number; pose: Pose; px: Pixel; item: Item; dir: V3; t: number; point: V3 }

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

/** The seven poses and the 200 seeded probes (header). */
function fixture(): { poses: Pose[]; probes: Probe[] } {
  const rand = seeded(SEED);
  const poses: Pose[] = [
    { id: 'cam-plane-near', item: 'plane', count: 50, position: [-37.5, 6, 52.25], target: [-59.875, 0, 52.25], fov: 60, size: SIZE, near: 0.5, far: 4_000_000, slant: [10, 400], spread: 25 },
    { id: 'cam-plane-far', item: 'plane', count: 50, position: [61.75, 4096, -18.5], target: [55326.75, 0, -55283.5], fov: 30, size: SIZE, near: 1, far: 4_000_000, slant: [100_000, 200_000], spread: 10 },
  ];
  for (let k = 0; k < 5; k++) {
    const distance = 10.0625 * Math.pow(400 / 10.0625, k / 4);
    const azimuth = rand() * 360; const elevation = 5 + rand() * 30;
    const toward: V3 = [Math.cos(rad(elevation)) * Math.sin(rad(azimuth)), Math.sin(rad(elevation)), Math.cos(rad(elevation)) * Math.cos(rad(azimuth))];
    const position = add(SPHERE.centre, scale(toward, distance)).map(Math.fround) as V3;
    const angular = Math.asin(SPHERE.r / dist(position, SPHERE.centre));
    const focal = SPHERE.radiusPx / Math.tan(angular);
    const fov = Math.fround((2 * Math.atan(SIZE[0] / 2 / focal) * 180) / Math.PI);
    poses.push({ id: `cam-sphere-${k}`, item: 'sphere', count: 20, position, target: SPHERE.centre, fov, size: SIZE, near: 0.5, far: 8000, slant: [10, 400], spread: 0 });
  }
  const probes: Probe[] = [];
  const clear = (cam: Pose, p: Pixel): boolean => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (nearest(cam.position, probeRay(cam, [p[0] + dx, p[1] + dy]))?.item !== cam.item) return false;
    return true;
  };
  for (const cam of poses) {
    const taken = new Set<string>();
    let got = 0;
    for (let tries = 0; got < cam.count; tries++) {
      if (tries >= 100_000) throw Error(`the fixture: ${cam.id} finds only ${got} of its ${cam.count} probes`);
      let sx: number; let sy: number;
      if (cam.item === 'plane') {
        const [lo, hi] = cam.slant;
        const slant = lo * Math.pow(hi / lo, rand());
        const { f } = basis(cam);
        const bearing = Math.atan2(f[0], f[2]) + rad(-cam.spread + 2 * cam.spread * rand());
        const run = Math.sqrt(slant * slant - cam.position[1] * cam.position[1]);
        [sx, sy] = project(cam, [cam.position[0] + run * Math.sin(bearing), 0, cam.position[2] + run * Math.cos(bearing)]);
      } else {
        const [cx, cy] = project(cam, SPHERE.centre);
        const a = rand() * 2 * Math.PI; const rr = 0.8 * SPHERE.radiusPx * Math.sqrt(rand());
        [sx, sy] = [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      }
      const px: Pixel = [Math.floor(sx), Math.floor(sy)];
      if (!(px[0] >= 2 && px[0] <= SIZE[0] - 3 && px[1] >= 2 && px[1] <= SIZE[1] - 3) || taken.has(px.join(','))) continue;
      const d = probeRay(cam, px); const h = nearest(cam.position, d);
      if (!h || h.item !== cam.item || h.t < cam.slant[0] || h.t > cam.slant[1] || !clear(cam, px)) continue;
      const point = add(cam.position, scale(d, h.t));
      if (cam.item === 'sphere' && -dot(unit(sub(point, SPHERE.centre)), d) < Math.cos(rad(55))) continue;
      taken.add(px.join(','));
      probes.push({ k: probes.length, pose: cam, px, item: cam.item, dir: d, t: h.t, point });
      got++;
    }
  }
  return { poses, probes };
}
const { poses: POSES, probes: PROBES } = fixture();

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

const label = (p: Probe): string => `probe ${p.k} (${p.pose.id}, pixel (${p.px[0]}, ${p.px[1]}), the ${p.item} at ${p.t.toFixed(3)} m)`;

/** The document: the seven cameras, the sky, the two materials and the two meshes (their glTFs put into `evidence`). */
function document(evidence: string): JsonObject {
  const plane = seed(evidence, gltf(PLANE_MESH)); const sphere = seed(evidence, gltf(SPHERE_MESH));
  const cams: Record<string, JsonObject> = Object.fromEntries(POSES.map((c) => [c.id, cameraItem(c.position, c.target, c.fov, c.near, c.far)]));
  return sceneDoc('Plane and sphere', 'cam-plane-near', {
    ...cams, sky: DARK_SKY, plane_mat: unlit([0.4, 0.4, 0.4]), sphere_mat: unlit([0.9, 0.5, 0.1]),
    plane: meshItem(plane, 'plane_mat'), sphere: meshItem(sphere, 'sphere_mat', SPHERE.centre),
  });
}

/** One render-back per pose, its probes on revision 0 at t = 0 from that pose's camera; the hit lists in probe order. */
function probed(planted?: Planted): JsonValue[][] {
  const evidence = dir();
  const calls = POSES.map((cam, i) => renderBack(slot(i), { t: 0, rev: 0, camera: cam.id, probes: PROBES.filter((p) => p.pose === cam).map((p) => p.px) }));
  const replies = runShow(bin(), scenario(evidence, document(evidence), calls, planted), `plane and sphere probes${planted ? `, planted ${planted}` : ''}`);
  const lists: JsonValue[][] = [];
  POSES.forEach((cam, i) => {
    const mine = PROBES.filter((p) => p.pose === cam);
    lists.push(...hitLists(replies[i]!, mine.length, `${planted ? `planted ${planted}: ` : ''}render-back from ${cam.id}`));
  });
  return lists;
}

/** Each probe's first hit against its analytic hit: the failures, the first probe off by more than 1 mm, how many placed
 * a point and the largest distance read. */
function judge(lists: JsonValue[][]): { failures: string[]; firstOverMm: string | null; placed: number; worst: number } {
  const failures: string[] = []; let firstOverMm: string | null = null; let placed = 0; let worst = 0;
  for (const p of PROBES) {
    const hits = lists[p.k]!;
    if (hits.length === 0) { failures.push(`${label(p)}: no hit, though its ray meets the ${p.item}`); continue; }
    const first = hits[0];
    const point = pointOf(first);
    if (!isObject(first) || !point) { failures.push(`${label(p)}: the first hit has no point: f64[3]: ${shown(first)}`); continue; }
    if (first['item'] !== p.item) failures.push(`${label(p)}: the first hit names ${shown(first['item'])}, not ${p.item}`);
    const off = dist(point, p.point); worst = Math.max(worst, off); placed++;
    if (!(off <= BOUND)) {
      const line = `${label(p)}: placed at (${fmt(point)}), ${off.toExponential(3)} m from the analytic hit (${fmt(p.point)})`;
      failures.push(line);
      if (off > MM && firstOverMm === null) firstOverMm = line;
    }
  }
  return { failures, firstOverMm, placed, worst };
}

describe(`${AC1} pixel probes land on the analytic hit`, () => {
  it(`${AC1} 200 seeded pixels on a plane and sphere fixture land within 1e-5 m of the analytic hit; a planted depth reconstruction fails past 1 mm`, () => {
    requireMetal();
    // The fixture: 200 probes, 100 on each item, the sphere's triangles within 2e-6 m of the analytic sphere along every
    // sphere probe, and enough far-plane probes past 100 km that no 32-bit depth can place them within 1 mm.
    expect(PROBES.length, 'the fixture: 200 seeded probes').toBe(200);
    expect(PROBES.filter((p) => p.item === 'plane').length, 'the fixture: 100 probes on the plane').toBe(100);
    for (const cam of POSES) expect(PROBES.filter((p) => p.pose === cam).length, `the fixture: ${cam.id}'s probes fit one render-back (≤ 64)`).toBeLessThanOrEqual(64);
    for (const p of PROBES.filter((x) => x.item === 'sphere')) {
      const t = sphereTriangles(p.pose.position, p.dir, p.point);
      expect(t !== null && Math.abs(t - p.t) <= MESH_GAP, `the fixture: along ${label(p)} the sphere's triangles lie within ${MESH_GAP} m of the analytic sphere (${t === null ? 'no triangle' : Math.abs(t - p.t).toExponential(3)})`).toBe(true);
    }
    const blind = PROBES.filter((p) => p.t >= DEPTH_BLIND).length;
    expect(blind, 'the fixture: at least 25 probes meet the plane past 100 km, where a 32-bit depth can\'t hold 1 mm').toBeGreaterThanOrEqual(25);

    const real = judge(probed());
    console.log(`${AC1}: ${real.placed} of ${PROBES.length} probes placed a point; the largest distance from one to its analytic hit: ${real.worst.toExponential(3)} m`);
    proof('AC1 probes placed, worst distance from the analytic hit (m)', { placed: real.placed, of: PROBES.length, worst: real.worst });
    expect(real.failures.length, `each probe's first hit lies within ${BOUND} m of the analytic hit; ${real.failures.length} of ${PROBES.length} probes fail:\n  ${real.failures.slice(0, 40).join('\n  ')}`).toBe(0);

    // The planted depth reconstruction fails the same check, naming the first probe off by more than 1 mm.
    const twin = judge(probed('probe_from_depth'));
    expect(twin.failures.length, 'planted probe_from_depth fails the check, but the check found nothing wrong').toBeGreaterThan(0);
    expect(twin.firstOverMm, `planted probe_from_depth places some probe more than 1 mm off; its failures were:\n  ${twin.failures.slice(0, 40).join('\n  ')}`).not.toBeNull();
    proof('AC1 planted probe_from_depth, the first probe past 1 mm', twin.firstOverMm);
  }, 3_600_000);
});
