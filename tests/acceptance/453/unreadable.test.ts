// AC4 (#453.bb73e219): "An undecoded Draco mesh, a primitive in line mode and a skinned mesh checked away from its
// bind pose each make geometry.shading BLOCKED naming the primitive, never PASS"
//
// asserts: three meshes, each whose readable part is a clean cube: one whose primitive 1 is the cube as Draco data
// no decoder can read (KHR_draco_mesh_compression, required), one whose primitive 1 is the cube's edges in line
// mode, and one skinned cube (primitive 0) whose one joint the file turns 90° about y while its inverse bind
// matrix is the identity. Each makes the geometry.shading requirement BLOCKED with `mesh_unreadable` naming the
// item, the primitive and why (`draco`, `mode`, `pose`), the claim never PASS (`blockedFailures`). Control: the same
// skinned cube at its bind pose passes with no defect. Planted: `unreadable_skipped` (the primitive left out and the
// rest judged) fails each, naming the primitive.

import { describe, it } from 'vitest';
import { AC, blockedFailures, cleanFailures, failsNaming, judge, none, the, useBuild, useEvidence, type Case, type Planted } from './helpers.ts';
import { BIND, TURNED, cubeLines, dracoCube, indexedCube } from './gltf.ts';

const build = useBuild();
const evidence = useEvidence();

const UNREADABLE = [
  { name: 'the cube beside an undecoded Draco primitive', spec: { prims: [indexedCube(), dracoCube()] }, primitive: 1, why: 'draco' },
  { name: 'the cube beside a primitive in line mode', spec: { prims: [indexedCube(), cubeLines()] }, primitive: 1, why: 'mode' },
  { name: 'the skinned cube away from its bind pose', spec: { prims: [indexedCube()], skin: { joint: TURNED } }, primitive: 0, why: 'pose' },
];
const CASES: Case[] = [...UNREADABLE, { name: 'the skinned cube at its bind pose', spec: { prims: [indexedCube()], skin: { joint: BIND } } }];
const judged = (planted?: Planted) => judge(build.bin(), evidence(), CASES, planted);

describe('AC4 a mesh geometry.shading cannot read is BLOCKED naming the primitive, never PASS', () => {
  it(`${AC[4]} an undecoded Draco primitive, a primitive in line mode and a skinned mesh away from its bind pose each make geometry.shading BLOCKED naming the primitive`, () => {
    const j = judged();
    for (const u of UNREADABLE) none(blockedFailures(the(j, u.name), u.primitive, u.why), u.name);
    none(cleanFailures(the(j, 'the skinned cube at its bind pose')), 'the skinned cube at its bind pose');
  });

  it(`${AC[4]} a planted check that skips a primitive it can't read and judges the rest fails, naming each primitive`, () => {
    const j = judged('unreadable_skipped');
    for (const u of UNREADABLE) failsNaming(blockedFailures(the(j, u.name), u.primitive, u.why), [`primitive ${u.primitive}`], `the skipping check on ${u.name}`);
  });
});
