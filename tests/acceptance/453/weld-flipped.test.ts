// AC1 (#453.c5097296): "A glTF cube split at its UV seams into 24 vertices welds to 8 within 0.00001 m and reports
// no defect; with two of its faces wound backwards it reports flipped_faces 2 naming both, though its summed
// winding still points outward"
//
// asserts: the seam cube (gltf.ts `seamCube`: 24 vertices, four per face with the face's normal and UV square,
// each corner's second and third copies 2 µm off its first) gives a geometry.shading result with
// welded_vertices 8, every defect count 0 with no IDs, and a PASS (`weldFailures`, `cleanFailures`). Its twin
// with triangles 8 and 10 (one on −X, one on +X) wound backwards, their normals still out, reports flipped_faces
// 2 naming exactly `0:8` and `0:10` (`defectFailures`); its signed volume stays 2/3 m³ > 0 (fixtures.test.ts),
// so one winding sum would call it outward. Planted: `no_weld` fails naming welded_vertices; `one_winding_sum`
// fails naming flipped_faces.

import { describe, it } from 'vitest';
import { AC, cleanFailures, defectFailures, failsNaming, judge, none, the, useBuild, useEvidence, weldFailures, type Case, type Planted } from './helpers.ts';
import { faceId, seamCube } from './gltf.ts';

const build = useBuild();
const evidence = useEvidence();

const BACKWARDS = [8, 10];
const FLIPPED = BACKWARDS.map((t) => faceId(0, t));
const CASES: Case[] = [
  { name: 'the seam cube', spec: { prims: [seamCube()] } },
  { name: 'the seam cube with two faces wound backwards', spec: { prims: [seamCube(BACKWARDS)] } },
];
const judged = (planted?: Planted) => judge(build.bin(), evidence(), CASES, planted);

describe('AC1 the seam cube welds to 8 with no defect; two faces wound backwards are flipped_faces 2 though its winding sums outward', () => {
  it(`${AC[1]} the 24-vertex seam cube welds to 8 within 0.00001 m and reports no defect; wound backwards on two faces it reports flipped_faces 2 naming both`, () => {
    const j = judged();
    const clean = the(j, 'the seam cube');
    none([...weldFailures(clean, 8), ...cleanFailures(clean)], 'the seam cube');
    none(defectFailures(the(j, 'the seam cube with two faces wound backwards'), 'flipped_faces', FLIPPED), 'the seam cube with two faces wound backwards');
  });

  it(`${AC[1]} a planted check that counts on unwelded vertices fails, naming welded_vertices`, () => {
    const clean = the(judged('no_weld'), 'the seam cube');
    failsNaming([...weldFailures(clean, 8), ...cleanFailures(clean)], ['welded_vertices'], 'the check with no weld');
  });

  it(`${AC[1]} a planted check that judges faces by one winding sum per mesh fails, naming flipped_faces`, () => {
    failsNaming(defectFailures(the(judged('one_winding_sum'), 'the seam cube with two faces wound backwards'), 'flipped_faces', FLIPPED), ['flipped_faces'], 'the check by one winding sum');
  });
});
