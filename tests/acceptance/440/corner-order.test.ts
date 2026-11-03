// AC7: "A creased slab cube whose face corner lists each start at another corner subdivides twice and bevels with
// 2 segments to the same welded-position and UV hash as the unrotated cube, at 1 block and at the registered block
// count; a planted subdivider that orders new edge points from each face's first corner differs and fails"
//
// A 1 m slab@1 box (uv0 in metres, box-projected), creased on its `top` part, through `mod.subdivide@1 {levels:
// 2, creases: {top: 1}}` then `mod.bevel@1 {width: 0.02, segments: 2}`. The `geometry` call's `rotate_corners: 1`
// starts every face's corner list of the builder's output one corner later before the stack runs; `blocks: 1`
// runs the stack's operators at one block, and without it they run at the block count scene3d registers, which
// each row reports as `blocks` (at least 2, or the parallel path is never run). The four results (unrotated and
// rotated, at 1 block and at the registered count) must give one welded-position and UV hash (reference.ts:
// pointUvHash, the set of distinct welded position and uv0 pairs, free of vertex order and triangulation). The
// twin must give the rotated cube another hash than the unrotated one.

import { describe, it } from 'vitest';
import { AC, DOC, SLOW, admitted, blocksOf, failsNaming, geometryCall, meshRow, none, runShow, scenario, sceneDoc, show, useDir, useShow, uvOf, type GeometryOptions, type JsonObject, type ShowPlanted } from './helpers.ts';
import { pointUvHash } from './reference.ts';

const bin = useShow();
const dir = useDir();

const cube = (): JsonObject => sceneDoc('A creased, bevelled cube', {
  cube: {
    kind: 'slab@1', params: { size: [1, 1, 1], uv0: 'box' },
    modifiers: [
      { kind: 'mod.subdivide@1', params: { levels: 2, creases: { top: 1 } } },
      { kind: 'mod.bevel@1', params: { width: 0.02, segments: 2 } },
    ],
  },
});

const RUNS: { name: string; o: GeometryOptions }[] = [
  { name: 'unrotated at the registered block count', o: {} },
  { name: 'unrotated at 1 block', o: { blocks: 1 } },
  { name: 'rotate_corners: 1 at the registered block count', o: { rotate_corners: 1 } },
  { name: 'rotate_corners: 1 at 1 block', o: { rotate_corners: 1, blocks: 1 } },
];

function orderProblems(planted?: ShowPlanted): string[] {
  const replies = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, cube()), ...RUNS.map((r) => geometryCall(DOC.a, ['cube'], r.o))], planted));
  admitted(replies[0]!, 'the creased cube');
  const out: string[] = [];
  const hashes = RUNS.map((r, k) => {
    const g = meshRow(replies[k + 1]!, 'cube', r.name);
    const blocks = blocksOf(g, r.name);
    if (r.o.blocks === 1 ? blocks !== 1 : blocks < 2) out.push(`${r.name}: the build ran at ${blocks} blocks, not ${r.o.blocks === 1 ? '1' : 'a registered count of at least 2'}`);
    return pointUvHash(g.positions, uvOf(g, 'uv0', r.name));
  });
  RUNS.forEach((r, k) => { if (hashes[k] !== hashes[0]) out.push(`${r.name}: its welded-position and UV hash ${hashes[k]!.slice(0, 16)} differs from the unrotated cube's ${hashes[0]!.slice(0, 16)} at the registered block count`); });
  return out;
}

describe(`${AC[7]} subdivide and bevel don't depend on corner order or block count`, () => {
  it(`${AC[7]} the rotated cube gives the unrotated cube's welded-position and UV hash, at 1 block and at the registered count`, () => {
    none(orderProblems(), 'corner order');
  }, SLOW);

  it(`${AC[7]} the planted subdivide_first_corner (new edge points ordered from each face's first corner) differs and fails`, () => {
    failsNaming(orderProblems('subdivide_first_corner'), ['rotate_corners: 1 at the registered block count: its welded-position and UV hash'], 'the planted subdivide_first_corner');
  }, SLOW);
});
