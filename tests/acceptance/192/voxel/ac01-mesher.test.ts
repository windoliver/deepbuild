// #192.30d22948: A voxel mesher provider in a test outside pack, which writes one quad per exposed voxel face, given
// a 32 × 32 × 32 occupancy grid holding one solid 10 × 10 × 10 block, writes a closed mesh of 600 quads (1,200
// triangles) whose bounds equal the block's within 1e-6 m and in which geometry.shading counts no defect; a planted
// mesher that leaves one face out fails the check, naming the provider and the first open edge, and keeps no mesh.
//
// The mesher reads its grid as an asset by hash and its voxel edge `size` as a param (README: Fixtures). Its output
// must be the bytes it writes (the same program run in Node's WebAssembly with the same params and asset is the
// reference), closed by the rule an upstream mesh library's tests hold (after welding, every edge joins exactly two
// faces), with geometry.shading's six defect counts 0 on the `provided` row. The planted mesher is in its own pack:
// its failure may come at the pack's check (install) or at the document's check, and either must name the provider
// and one of the four open edges of the face it left out, with no mesh kept.
import { describe, expect, it } from 'vitest';
import {
  DIGEST, DOC, MESH_BUILD, deepShow, errors, installPack, meshOf, namesEdge, objectsIn, openEdges, present, provided, providedRows,
  rowOf, runShow, scenario, show, sub, useTemp, type Issue, type JsonObject, type OpenEdge,
} from './helpers.ts';
import { SIZE, TRIANGLES, blockBounds, board, holeyOpenEdges, holeyPack, meshItem, mesherOutput, voxPack, voxelDoc } from './programs.ts';

const ID = '#192.30d22948';
const temp = useTemp();
const SHADING = ['non_manifold_edges', 'non_manifold_vertices', 'inconsistent_edges', 'flipped_faces', 'degenerate_faces', 'boundary_edges'];

/** An error that names the planted provider and one of its open edges (`actual.edge`, two welded positions). */
const namesOpenEdge = (list: Issue[], open: OpenEdge[]): Issue[] => list.filter((i) =>
  (JSON.stringify(i.raw).includes('holeypack.holey') || i.path.includes('providers/holey')) && objectsIn(i.actual).some((o) => namesEdge(o['edge'], open)));

describe(`${ID} the voxel mesher writes a closed 600-quad mesh of the block, and a mesher that leaves a face out fails, naming the open edge`, () => {
  it(`${ID} a voxel mesher in a test outside pack meshes one 10 × 10 × 10 block of a 32³ grid as a closed mesh of 600 quads (1,200 triangles) within 1e-6 m of the block's bounds with no geometry.shading defect; a planted mesher that leaves one face out fails the check, naming the provider and the first open edge, and keeps no mesh`, async () => {
    const reference = await mesherOutput(SIZE.first);
    const open = await holeyOpenEdges(SIZE.first);
    const root = temp();
    const vox = voxPack(sub(root, 'packs'));
    const holey = holeyPack(sub(root, 'packs'));
    const holeyDoc = board('Holey', ['test/holeypack@1.0.0'], [meshItem('holey', 'holeypack.holey', { size: SIZE.first })], { seed: 192_011 });
    const [install, shown, out, holeyInstall, holeyShown, holeyOut] = runShow(deepShow(MESH_BUILD), scenario(sub(root, 'evidence'), [
      installPack(vox), present(DOC.a, voxelDoc(SIZE.first, 192_001)), provided(DOC.a),
      installPack(holey), present(DOC.b, holeyDoc), provided(DOC.b),
    ]));

    expect(install!['outcome'], `test/voxpack@1.0.0 installs: ${show(install)}`).toBe('installed');
    expect(shown!['outcome'], `the voxel document is presented: ${show(shown)}`).toBe('presented');
    expect(errors(shown!, 'the voxel document').map((i) => i.raw), 'its check raises no error').toEqual([]);
    const row = rowOf(out!, 'vox', 'the voxel document');
    expect([row.provider, row.trap], 'the item\'s mesh came from voxpack.mesher, without a trap').toEqual(['voxpack.mesher', null]);
    expect(row.key, 'under a content key').toMatch(DIGEST);
    const mesh = meshOf(row, 'voxpack.mesher\'s mesh');
    expect(mesh.indices.length / 3, 'the mesh has 1,200 triangles').toBe(TRIANGLES);
    expect({ positions: mesh.positions, normals: mesh.normals, uv0: mesh.uv0, indices: mesh.indices },
      'the mesh is what the mesher wrote: 600 quads, one per exposed face of the block (its params and grid asset copied in)').toEqual(
      { positions: reference.positions, normals: reference.normals, uv0: reference.uv0, indices: reference.indices });
    const want = blockBounds(SIZE.first);
    const within = (b: number[][]): boolean => b.every((corner, i) => corner.every((x, k) => Math.abs(x - want[i]![k]!) <= 1e-6));
    expect(within(mesh.bounds), `its bounds ${show(mesh.bounds)} equal the block's ${show(want)} within 1e-6 m`).toBe(true);
    expect(openEdges(mesh.positions, mesh.indices), 'it is closed: after welding, every edge joins exactly two faces').toEqual([]);
    const shading = row.shading as JsonObject | undefined;
    expect(typeof shading === 'object' && shading !== null && !Array.isArray(shading), `the provided row carries geometry.shading's counts: ${show(row.raw)}`).toBe(true);
    expect(Object.fromEntries(SHADING.map((k) => [k, shading![k]])), 'geometry.shading counts no defect').toEqual(Object.fromEntries(SHADING.map((k) => [k, 0])));

    // The planted mesher: refused at its pack's check or at the document's, naming the provider and an open edge.
    const named = [...(holeyInstall!['outcome'] === 'installed' ? [] : errors(holeyInstall!, 'test/holeypack@1.0.0\'s install')), ...errors(holeyShown!, 'the planted mesher\'s document')];
    expect(holeyShown!['outcome'], `the document naming the planted mesher fails its check: ${show(holeyShown)}`).not.toBe('presented');
    expect(namesOpenEdge(named, open).length, `an error names holeypack.holey and one of the four open edges ${show(open.map((e) => e.edge))}: ${show(named.map((i) => i.raw))}`).toBeGreaterThan(0);
    const kept = providedRows(holeyOut!, 'the planted mesher\'s document').filter((r) => r.out !== null);
    expect(kept.map((r) => r.raw), 'no mesh is kept for the planted mesher').toEqual([]);
  }, 3_600_000);
});
