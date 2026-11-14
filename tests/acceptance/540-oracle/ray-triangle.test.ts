// Oracle lane for #540's criteria 2 (#540.88ffa39f) and 3 (#540.c9bfe882): the upstream ray-triangle tests, re-expressed
// against our point control's surface hits (README: Sources).
//
// Upstream, an engine's `tests/core/math/test_geometry_3d.cpp` lines 152 to 157, at ed1daf0bf001b61586d9930840f2f1394092c079:
// the triangle (0, 3, 0), (−3, 0, 0), (3, 0, 0) and a ray from (0, 1, 1) along −Z hits it; one from (5, 10, 1) beside
// it misses; one from (0, 1, 1) along +Z, pointing away, must not hit. And another engine's picking tests,
// `…/src/mesh_picking/ray_cast/intersections.rs` lines 328 to 533 at 12a94e0cd6b18df7a0dc2e5a202a55156d80e9a6: the
// triangle (1, −1, 2), (1, 2, −1), (1, −1, −1) and a ray from the origin along +X hit it at distance 1, as one
// triangle, as a mesh without indices, with indices [0, 1, 2], and with vertex normals (−1, 0, 0), indexed or not.
//
// Ours: each triangle a one-triangle JSON glTF mesh `tri`, the point control `aim` with `on: surface` and `targets:
// [tri]`, and a perspective camera (fov 60° on 400 × 400) whose eye is the upstream ray's origin, aimed along its
// direction, so the press at the view's centre (200, 200) casts that ray. A hit writes hit {set 0, key [0, 0]} and the
// surface point (within 1/1024 m), face 0 and the triangle's unit normal by its winding; a miss writes hit and surface
// none. Left out (README: Left out): back-face culling, malformed index lists and an empty normal list.
import { describe, it } from 'vitest';
import {
  AC, DOC, Script, TIMEOUT, binOf, cross, entriesOf, entryName, fmt, none, off, perspective, pointControl, prebuild, presented, putEvidence,
  runShow, scenario, scene, sha256, show, sub, unit, useTemp, valueOf, type JsonObject, type Pose, type V2, type V3,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const SIZE: V2 = [400, 400];
const CENTRE: V2 = [200, 200];

/** A one-triangle glTF: f32 positions, optional f32 normals and optional u16 indices [0, 1, 2]. */
function triangleGltf(tri: [V3, V3, V3], o: { indices: boolean; normals: V3 | null }): { bytes: Buffer; sha: string } {
  const f32 = (v: number[]): Buffer => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeFloatLE(x, i * 4)); return b; };
  const parts: Buffer[] = [f32(tri.flat())];
  const attributes: JsonObject = { POSITION: 0 };
  const accessors: JsonObject[] = [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 1, 2].map((k) => Math.min(...tri.map((p) => p[k]!))), max: [0, 1, 2].map((k) => Math.max(...tri.map((p) => p[k]!))) }];
  if (o.normals) { parts.push(f32([...o.normals, ...o.normals, ...o.normals])); accessors.push({ bufferView: parts.length - 1, componentType: 5126, count: 3, type: 'VEC3' }); attributes['NORMAL'] = accessors.length - 1; }
  let indices: number | null = null;
  if (o.indices) {
    const b = Buffer.alloc(8); [0, 1, 2].forEach((x, i) => b.writeUInt16LE(x, i * 2));
    parts.push(b); accessors.push({ bufferView: parts.length - 1, componentType: 5123, count: 3, type: 'SCALAR' }); indices = accessors.length - 1;
  }
  let at = 0;
  const bufferViews = parts.map((b) => { const v = { buffer: 0, byteOffset: at, byteLength: b.length }; at += b.length; return v; });
  const bin = Buffer.concat(parts);
  const doc = {
    asset: { version: '2.0', generator: 'deepbuild tests/acceptance/540-oracle' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'tri', mesh: 0 }],
    meshes: [{ primitives: [{ attributes, ...(indices !== null ? { indices } : {}), mode: 4 }] }],
    accessors, bufferViews, buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` }],
  };
  const bytes = Buffer.from(JSON.stringify(doc));
  return { bytes, sha: sha256(bytes) };
}

const GEOMETRY: [V3, V3, V3] = [[0, 3, 0], [-3, 0, 0], [3, 0, 0]];
const PICKING: [V3, V3, V3] = [[1, -1, 2], [1, 2, -1], [1, -1, -1]];
interface Case { name: string; tri: [V3, V3, V3]; eye: V3; dir: V3; indices: boolean; normals: V3 | null; hit: V3 | null }
const CASES: Case[] = [
  { name: 'the geometry test: a ray from (0, 1, 1) along −Z hits', tri: GEOMETRY, eye: [0, 1, 1], dir: [0, 0, -1], indices: false, normals: null, hit: [0, 1, 0] },
  { name: 'the geometry test: a ray from (5, 10, 1) beside the triangle misses', tri: GEOMETRY, eye: [5, 10, 1], dir: [0, 0, -1], indices: false, normals: null, hit: null },
  { name: 'the geometry test: a ray from (0, 1, 1) pointing away must not hit', tri: GEOMETRY, eye: [0, 1, 1], dir: [0, 0, 1], indices: false, normals: null, hit: null },
  { name: 'the picking tests: one triangle, no indices, hit at distance 1', tri: PICKING, eye: [0, 0, 0], dir: [1, 0, 0], indices: false, normals: null, hit: [1, 0, 0] },
  { name: 'the picking tests: a mesh with indices [0, 1, 2]', tri: PICKING, eye: [0, 0, 0], dir: [1, 0, 0], indices: true, normals: null, hit: [1, 0, 0] },
  { name: 'the picking tests: indices and vertex normals (−1, 0, 0)', tri: PICKING, eye: [0, 0, 0], dir: [1, 0, 0], indices: true, normals: [-1, 0, 0], hit: [1, 0, 0] },
  { name: 'the picking tests: vertex normals without indices', tri: PICKING, eye: [0, 0, 0], dir: [1, 0, 0], indices: false, normals: [-1, 0, 0], hit: [1, 0, 0] },
];

describe(`${AC[2]} / ${AC[3]} the upstream ray-triangle tests: a hit, a miss beside, a ray pointing away, and a ray against a mesh with and without indices`, () => {
  it(`${AC[2]} / ${AC[3]} each centre press hits or misses as upstream's ray does, with upstream's distance`, () => {
    const ev = temp();
    const s = new Script();
    const docs = CASES.map((c, i) => {
      const g = triangleGltf(c.tri, c);
      putEvidence(ev, g.bytes);
      const pose: Pose = { eye: c.eye, target: [c.eye[0] + c.dir[0], c.eye[1] + c.dir[1], c.eye[2] + c.dir[2]], size: SIZE, fov: 60 };
      const doc = scene(`#540 oracle triangle ${i + 1}`, SIZE, { cam: perspective(pose), tri: { kind: 'mesh.asset@1', params: { sha256: g.sha, node: { scene: 0 } } } }, {
        assets: { tri_mesh: { sha256: g.sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #540 oracle lane.' } } },
        controls: { aim: pointControl('Aim', { on: 'surface', targets: ['tri'] }) },
      }, ['scene3d', 'input']);
      const id = DOC(300 + i);
      s.present(id, doc);
      return id;
    });
    const presses = CASES.map((_, i) => { s.panel = `p${i + 1}`; return s.click(CENTRE); });
    const r = runShow(binOf(), scenario(ev, docs.map((id) => ({ id, size: SIZE })), s.calls), 'the ray-triangle oracle');
    CASES.forEach((c, i) => presented(r[i]!, c.name));
    const failures: string[] = [];
    CASES.forEach((c, i) => {
      const e = entriesOf(r, presses[i]!, 'aim').find((x) => valueOf(x).phase === 'press');
      if (!e) { failures.push(`${c.name}: no press entry (${show(r[presses[i]![0]]!['appended'] ?? null)})`); return; }
      const v = valueOf(e);
      if (!v.ray || off(v.ray.origin, c.eye) > 1e-9 || off(v.ray.dir, c.dir) > 1e-9) failures.push(`${c.name}: ${entryName(e)} stores ray ${show(v.ray)}, not upstream's from ${fmt(c.eye)} along ${fmt(c.dir)}`);
      if (c.hit === null) {
        if (v.hit !== null || v.surface !== null) failures.push(`${c.name}: ${entryName(e)} writes hit ${show(v.hit)} and surface ${show(v.surface)}, not none`);
        return;
      }
      const normal = unit(cross(sub(c.tri[1], c.tri[0]), sub(c.tri[2], c.tri[0])));
      if (JSON.stringify(v.hit) !== JSON.stringify({ set: 0, key: [0, 0] })) failures.push(`${c.name}: ${entryName(e)} writes hit ${show(v.hit)}, not {set 0, key [0, 0]}`);
      const sf = v.surface;
      if (!sf || off(sf.point, c.hit) > 1 / 1024 || sf.face !== 0 || !sf.normal || off(sf.normal, normal) > 1e-9) failures.push(`${c.name}: ${entryName(e)} writes surface ${show(sf)}, not point ${fmt(c.hit)} (upstream's distance ${Math.hypot(...sub(c.hit, c.eye)).toFixed(3)} along the ray), face 0 and normal ${fmt(normal)}`);
    });
    none(failures, 'the ray-triangle oracle\'s presses');
  }, TIMEOUT);
});
