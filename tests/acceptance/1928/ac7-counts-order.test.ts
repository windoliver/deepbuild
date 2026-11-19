// AC7: "Both modifiers declare their counts before they build, `offset_faces` exactly and `dissolve` as at most
// its input, and build within them. The L-shaped slab under `offset_faces {parts: [top], by: 0.1, depth: 0.2}`
// and `dissolve` gives the same welded-position and UV hash with each face's corner list turned by one, at 1
// block and at the registered block count. A planted offset that numbers new points from each face's first
// corner gives another hash and fails"
//
// Two items on the issue's L-shaped slab: `inset` under `mod.offset_faces@1 {parts: [top], by: 0.1, depth: 0.2}`,
// and `ell` under the same and then `mod.dissolve@1`, so `inset` is `ell`'s dissolve's input.
//   - Declared: `geometry` with `estimate_only` builds nothing (`builds: 0`) and gives each item's `declared`
//     points, edges, faces and vertices. `inset` must build exactly the points, edges and faces it declared
//     (counted on the polygon view, reference.ts). `ell` must declare no more than `inset` does, and build no
//     more than it declared. Neither builds more vertices than it declared.
//   - Order: `ell` built four ways, as written and with `rotate_corners: 1` (each face's corner list of the
//     builder's mesh started one corner later, before the stack), each at the registered block count (the row's
//     `blocks`, at least 2) and at `blocks: 1` (reported 1), must give one welded-position and UV hash
//     (reference.ts: pointUvHash, free of vertex order, triangle order and face IDs).

import { describe, it } from 'vitest';
import { AC, DOC, ELL, SLOW, admitted, blocksOf, buildsOf, declaredOf, dissolve, failsNaming, geometryCall, meshRow, none, offsetFaces, runShow, scenario, sceneDoc, show, useDir, useShow, uv0Of, type GeometryOptions, type JsonObject, type Planted } from './helpers.ts';
import { countsOf, pointUvHash } from './reference.ts';

const bin = useShow();
const dir = useDir();

const OFFSET = offsetFaces({ parts: ['top'], by: 0.1, depth: 0.2 });
const doc = (): JsonObject => sceneDoc('A raised L, declared and turned', {
  inset: { kind: 'slab@1', params: ELL, modifiers: [OFFSET] },
  ell: { kind: 'slab@1', params: ELL, modifiers: [OFFSET, dissolve()] },
});

const RUNS: { name: string; o: GeometryOptions }[] = [
  { name: 'as written at the registered block count', o: {} },
  { name: 'as written at 1 block', o: { blocks: 1 } },
  { name: 'rotate_corners: 1 at the registered block count', o: { rotate_corners: 1 } },
  { name: 'rotate_corners: 1 at 1 block', o: { rotate_corners: 1, blocks: 1 } },
];
const COUNTS = ['points', 'edges', 'faces'] as const;

function declaredAndOrderProblems(planted?: Planted): string[] {
  const replies = runShow(bin(), scenario(dir(), [DOC.a], [
    show(DOC.a, doc()), geometryCall(DOC.a, ['inset', 'ell'], { estimate_only: true }), geometryCall(DOC.a, ['inset']),
    ...RUNS.map((r) => geometryCall(DOC.a, ['ell'], r.o)),
  ], planted));
  admitted(replies[0], 'the raised L');
  const out: string[] = [];

  // Declared before the build, and built within it.
  const builds = buildsOf(replies[1], 'the declared counts');
  if (builds !== 0) out.push(`the counts were declared with ${builds} builds, not before any build`);
  const declared = { inset: declaredOf(replies[1], 'inset', 'the declared counts'), ell: declaredOf(replies[1], 'ell', 'the declared counts') };
  const inset = meshRow(replies[2], 'inset', 'the raised L before dissolve');
  const ell = meshRow(replies[3], 'ell', RUNS[0]!.name);
  const built = { inset: countsOf(inset.view), ell: countsOf(ell.view) };
  for (const k of COUNTS) {
    if (built.inset[k] !== declared.inset[k]) out.push(`offset_faces declared ${declared.inset[k]} ${k} and built ${built.inset[k]}`);
    if (declared.ell[k] > declared.inset[k]) out.push(`dissolve declared ${declared.ell[k]} ${k}, more than its input's ${declared.inset[k]}`);
    if (built.ell[k] > declared.ell[k]) out.push(`dissolve built ${built.ell[k]} ${k}, more than the ${declared.ell[k]} it declared`);
  }
  if (inset.positions.length > declared.inset.vertices) out.push(`offset_faces built ${inset.positions.length} vertices, more than the ${declared.inset.vertices} it declared`);
  if (ell.positions.length > declared.ell.vertices) out.push(`dissolve built ${ell.positions.length} vertices, more than the ${declared.ell.vertices} it declared`);

  // One hash, whichever corner each face's list starts at and however many blocks.
  const hashes = RUNS.map((r, k) => {
    const row = meshRow(replies[3 + k], 'ell', r.name);
    const blocks = blocksOf(row, r.name);
    if (r.o.blocks === 1 ? blocks !== 1 : blocks < 2) out.push(`${r.name}: the build ran at ${blocks} blocks, not ${r.o.blocks === 1 ? '1' : 'a registered count of at least 2'}`);
    return pointUvHash(row.positions, uv0Of(row, r.name));
  });
  RUNS.forEach((r, k) => { if (hashes[k] !== hashes[0]) out.push(`${r.name}: its welded-position and UV hash ${hashes[k]!.slice(0, 16)} differs from ${hashes[0]!.slice(0, 16)}, the L's ${RUNS[0]!.name}`); });
  return out;
}

describe(`${AC[7]} counts declared before the build, and results that don't depend on corner order or block count`, () => {
  it(`${AC[7]} offset_faces builds exactly the counts it declared and dissolve at most its input's, and the turned L gives the unturned L's welded-position and UV hash at 1 block and at the registered count`, () => {
    none(declaredAndOrderProblems(), 'declared counts and corner order');
  }, SLOW);

  it(`${AC[7]} the planted offset_first_corner (new points numbered from each face's first corner) gives another hash and fails`, () => {
    failsNaming(declaredAndOrderProblems('offset_first_corner'), ['rotate_corners: 1 at the registered block count: its welded-position and UV hash'], 'the planted offset_first_corner');
  }, SLOW);
});
