// AC5 #427.6de2b260: Normals: on a 1 m UV sphere of 32 × 16 segments, every drawn normal line ends at its vertex +
// 0.05 m × the vertex normal within 1e-6 m, `drawn` lists one entry per vertex, and a planted mode that draws face
// normals fails, naming the first vertex. Tangents: on a 2 × 1 m plate whose uv0 u runs along +x, each drawn tangent is
// (1, 0, 0) within 1e-6 with handedness +1, and a half with mirrored u reads −1.
//
// The sphere is scene3d's own `ball@1` (tessellation uv, radius 0.5 m, 32 segments, so 16 rings): 33 × 17 = 561
// vertices, vertex k at ring j = ⌊k ÷ 33⌋ and segment i = k mod 33, its normal the unit direction (sin φ cos θ, cos φ,
// sin φ sin θ) with φ = πj ÷ 16 and θ = 2πi ÷ 32 (crates/deep-canvas-scene3d/src/builders.rs at the base). The test
// computes each vertex and its normal from that, so a drawn row can't vouch for itself. Its normal lines come over
// several pages (#412's cursor). The plates are glTF meshes in the XY plane facing +z, uv0 in metres: `plate` with u
// along +x and v along +y; `mirror` whose left half (vertices 0–3, x from −1 to 0) has u running along −x.
import { describe, it } from 'vitest';
import {
  AC, type JsonObject, type V3, add, allDrawn, camera, far, fmt, gltf, meshAsset, mode, none, failsNaming, requireMetal, scale, scene,
  seed, show, sun, useBuilds, useDir, vec3, type Mesh,
} from './helpers.ts';

const ID = AC[5];
const bin = useBuilds(['deep-show']);
const dir = useDir();

const BALL = scene('UV sphere', { cam: camera([0, 0, 0], 3), ball: { kind: 'ball@1', params: { tessellation: 'uv', radius: 0.5, segments: 32 } }, key: sun() });
function vertex(k: number): { pos: V3; n: V3 } {
  const j = Math.floor(k / 33); const i = k % 33;
  const phi = (Math.PI * j) / 16; const th = (2 * Math.PI * i) / 32;
  const n: V3 = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
  return { pos: scale(n, 0.5), n };
}

function normalProblems(rows: JsonObject[]): string[] {
  const lines = rows.filter((r) => r['id'] === 'ball' && r['what'] === 'normal');
  const p: string[] = [];
  const byVertex = new Map<number, JsonObject>();
  for (const r of lines) if (typeof r['vertex'] === 'number') byVertex.set(r['vertex'], r);
  if (lines.length !== 561 || byVertex.size !== 561) p.push(`drawn lists ${lines.length} normal lines over ${byVertex.size} vertices, not one for each of the 561`);
  for (let k = 0; k < 561; k++) {
    const r = byVertex.get(k); const v = vertex(k);
    if (!r) continue;
    const from = vec3(r['from']); const to = vec3(r['to']); const end = add(v.pos, scale(v.n, 0.05));
    if (far(from, v.pos) || far(to, end)) {
      p.push(`the first wrong vertex is vertex ${k}: its line runs ${fmt(from)} → ${fmt(to)}, not ${fmt(v.pos)} → ${fmt(end)} (vertex + 0.05 m × its normal)`);
      break;
    }
  }
  return p;
}

describe(`${ID} normals and tangents as the mesh holds them`, () => {
  it(`${ID} every normal line on the 32 × 16 UV sphere ends at its vertex + 0.05 m × the vertex normal, one per vertex; face normals fail naming vertex 0`, () => {
    requireMetal();
    none(normalProblems(allDrawn(bin('deep-show'), dir(), [show(BALL)], mode('normals'))), 'the sphere\'s normals');
    failsNaming(normalProblems(allDrawn(bin('deep-show'), dir(), [show(BALL)], mode('normals'), {}, 'normals_from_faces')), ['vertex 0'], 'planted normals_from_faces');
  }, 1_800_000);

  it(`${ID} tangents on the plate are (1, 0, 0) with handedness +1, and the half with mirrored u reads −1`, () => {
    requireMetal();
    const evidence = dir();
    const quad = (x0: number): Mesh['positions'] => [[x0, -0.5, 0], [x0 + 1, -0.5, 0], [x0 + 1, 0.5, 0], [x0, 0.5, 0]];
    const mirror: Mesh = {
      positions: [...quad(-1), ...quad(0)],
      normals: Array.from({ length: 8 }, (): V3 => [0, 0, 1]),
      uv0: [[1, 0], [0, 0], [0, 1], [1, 1], [0, 0], [1, 0], [1, 1], [0, 1]],
      indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    };
    const straight: Mesh = { ...mirror, uv0: [[0, 0], [1, 0], [1, 1], [0, 1], [1, 0], [2, 0], [2, 1], [1, 1]] };
    const doc = scene('Plates', {
      cam: camera([0, 0, 0], 5),
      plate: meshAsset(seed(evidence, gltf(straight)), [0, 1, 0]),
      mirror: meshAsset(seed(evidence, gltf(mirror)), [0, -1, 0]),
      key: sun(),
    });
    const rows = allDrawn(bin('deep-show'), evidence, [show(doc)], mode('tangents'));
    const p: string[] = [];
    for (const [item, mirroredBelow] of [['plate', 0], ['mirror', 4]] as const) {
      const t = rows.filter((r) => r['id'] === item && r['what'] === 'tangent');
      if (t.length !== 8) p.push(`${item}: ${t.length} tangents drawn, not one for each of its 8 vertices`);
      for (const r of t) {
        const k = r['vertex'] as number;
        if (k < mirroredBelow) {
          if (r['w'] !== -1) p.push(`${item}: vertex ${k}, on the half with mirrored u, reads handedness ${JSON.stringify(r['w'])}, not −1`);
        } else if (far(vec3(r['tangent']), [1, 0, 0]) || r['w'] !== 1) {
          p.push(`${item}: vertex ${k} draws tangent ${fmt(vec3(r['tangent']))} with handedness ${JSON.stringify(r['w'])}, not (1, 0, 0) with +1`);
        }
      }
    }
    none(p, 'the plates\' tangents');
  }, 1_800_000);
});
