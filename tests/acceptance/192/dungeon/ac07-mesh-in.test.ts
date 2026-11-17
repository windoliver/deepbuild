// AC7 #192.f3c60337: "A voxelizing provider whose mesh_in names a builder's output meshes it at check, and changing the
// builder's params changes the provider's content key and output while a revision that leaves them keeps both; a
// mesh_in naming a logic-fed instancer is refused, naming it; and a provider linking a library with fixtures unrun is
// refused, naming the library"
//
// The pack test/vox@1.0.0 carries vox.voxelize (programs.ts: the voxelizer), whose mesh_in param `source` takes
// another item's built mesh: it voxelizes the mesh's bounds into 0.25 m cells and writes the box around them. A scene
// holds the builder item `ball` (ball@1) and the test.mesh@1 item `vox`, whose mesh is {gen: vox.voxelize, params:
// {cell: 0.25}, mesh_in: [{param: source, item: ball}]}, in three revisions of one document:
//   1. radius 0.4: presented with no error; `provided` holds vox's mesh, the box from -0.5 to 0.5 m on every axis
//      within 1e-6 (24 vertices, 36 indices), under a content key; the sandbox module ran exactly one program.
//   2. radius 0.6: another content key, the box from -0.75 to 0.75 m; exactly one more run.
//   3. radius 0.6, the ball moved to (2, 0, 0) (its builder params left as they were): revision 2's key and mesh, and
//      no run.
// A second scene's mesh_in names `swarm`, an instance@1 whose columns read the logic item brain's arrays: refused at
// check, an error at vox's mesh naming swarm, and no mesh. The pack test/voxlink@1.0.0 ships the library snap@1 with
// no fixture and the provider voxlink.voxelize linking it: refused, naming snap@1, at install or, if the install
// admits it, at the check of a document naming it, which then holds no mesh from it.
//
// Wrong programs it fails on: mesh_in not copied in (no box, or not the ball's), a key that doesn't cover the built
// mesh's content key (the old box after the radius changes), a key or a run per revision or per item change (another
// key or a run for revision 3), an instancer fed by logic let through or refused without its name, and a link made
// with the library's fixtures unrun.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOC, errorsOf, holds, installPack, issuesOf, meshOf, num, onMacOS, presented, provided, providedRow, putEvidence, runShow,
  SANDBOX_COUNTS, scenario, show, showDoc, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';
import { logicItem, program, scene, voxPack, voxlinkPack } from './fixtures.ts';

const ID = '#192.f3c60337';
const TIMEOUT = 90 * 60_000;
const SEED = 192_007;
const dir = useTemp();

const runs = (reply: JsonObject | undefined): number => num(reply?.['runs'], `the sandbox module's runs (${show(reply)})`);
/** The box the voxelizer must write around a mesh whose bounds lie inside (-h, h) on every axis but past h - 0.25. */
const box = (h: number): number[][] => [[-h, -h, -h], [h, h, h]];
function boundsProblems(got: number[][], want: number[][], what: string): string[] {
  const off = got.length !== 2 || got.some((p, i) => p.length !== 3 || p.some((x, k) => Math.abs(x - want[i]![k]!) > 1e-6));
  return off ? [`${what}: bounds ${JSON.stringify(got)}, not ${JSON.stringify(want)} within 1e-6`] : [];
}
/** A mesh_in use on the test.mesh item `vox`. */
const voxUse = (item: string): JsonObject => ({ kind: 'test.mesh@1', params: { mesh: { gen: 'vox.voxelize', params: { cell: 0.25 }, mesh_in: [{ param: 'source', item }] } } });
const hasMesh = (row: JsonObject | undefined): boolean => row !== undefined && (row['trap'] ?? null) === null && typeof row['out'] === 'object' && row['out'] !== null && (row['out'] as JsonObject)['mesh'] !== undefined;

describe(`${ID} mesh_in: another item's built mesh by its content key, and what a provider may not take or link`, () => {
  it(`${ID} a voxelizer meshes a builder's output at check, its key and output following the builder's params and kept by a revision that leaves them; a logic-fed instancer and a library with fixtures unrun refused, each named`, () => {
    onMacOS();
    const root = dir();
    const evidence = join(root, 'evidence');
    mkdirSync(evidence, { recursive: true });
    const vox = voxPack(root);
    const link = voxlinkPack(root);
    putEvidence(evidence, program.brain().bytes);
    const docs = { ball: DOC(1), swarm: DOC(2), link: DOC(3) };
    const ballScene = (radius: number, pos: number[]): JsonObject =>
      scene('Voxelized ball', SEED, [vox], { ball: { kind: 'ball@1', params: { radius }, at: { pos } }, vox: voxUse('ball') }, ['scene3d', 'test.mesh']);
    const swarmScene = scene('Voxelized swarm', SEED, [vox], {
      brain: logicItem(program.brain(), { pos: { type: 'vec3', count: 4 }, live: { type: 'bool', count: 4 }, gen: { type: 'i32', count: 4 } }),
      probe: { kind: 'ball@1', params: { radius: 0.1 }, visible: false },
      swarm: { kind: 'instance@1', params: { of: ['probe'], pos: { array: 'brain.pos', as: 'vec3' }, live: { array: 'brain.live', as: 'bool' }, gen: { array: 'brain.gen', as: 'u32' } } },
      vox: voxUse('swarm'),
    }, ['scene3d', 'logic', 'test.mesh']);
    const linkScene = scene('Linked voxelizer', SEED, [link], { vox: { kind: 'test.mesh@1', params: { mesh: { gen: 'voxlink.voxelize', params: { cell: 0.25 } } } } }, ['test.mesh']);
    const r = runShow(scenario(evidence, Object.values(docs), [
      installPack(vox), SANDBOX_COUNTS, //                                          0, 1
      showDoc(docs.ball, ballScene(0.4, [0, 0, 0])), provided(docs.ball), SANDBOX_COUNTS, // 2, 3, 4
      showDoc(docs.ball, ballScene(0.6, [0, 0, 0])), provided(docs.ball), SANDBOX_COUNTS, // 5, 6, 7
      showDoc(docs.ball, ballScene(0.6, [2, 0, 0])), provided(docs.ball), SANDBOX_COUNTS, // 8, 9, 10
      showDoc(docs.swarm, swarmScene), provided(docs.swarm), //                     11, 12
      installPack(link), showDoc(docs.link, linkScene), provided(docs.link), //     13, 14, 15
    ]));
    expect(r[0]!['outcome'], `test/vox@1.0.0 installs: ${show(r[0])}`).toBe('installed');

    // 1. The builder's output meshed at check.
    presented(r[2]!, 'revision 1 (ball radius 0.4)');
    const row1 = providedRow(r[3]!, 'vox', 'revision 1');
    expect(row1?.['provider'], `revision 1: vox's mesh comes from vox.voxelize: ${show(r[3])}`).toBe('vox.voxelize');
    const m1 = meshOf(row1, 'revision 1: vox');
    expect([m1.positions.length, m1.indices.length], 'revision 1: the voxelized box has 24 vertices and 36 indices').toEqual([24, 36]);
    expect(boundsProblems(m1.bounds, box(0.5), 'revision 1: the ball of radius 0.4 in 0.25 m cells'), 'revision 1: the voxelizer meshed the ball\'s built mesh').toEqual([]);
    expect(m1.key, 'revision 1: the provider\'s content key').toMatch(/^[0-9a-f]{64}$/);
    expect(runs(r[4]) - runs(r[1]), 'revision 1: the provider ran once').toBe(1);

    // 2. The builder's params changed: another key and another output.
    presented(r[5]!, 'revision 2 (ball radius 0.6)');
    const m2 = meshOf(providedRow(r[6]!, 'vox', 'revision 2'), 'revision 2: vox');
    expect(m2.key, 'revision 2: changing the builder\'s params changes the provider\'s content key').not.toBe(m1.key);
    expect(boundsProblems(m2.bounds, box(0.75), 'revision 2: the ball of radius 0.6 in 0.25 m cells'), 'revision 2: changing the builder\'s params changes the output').toEqual([]);
    expect(runs(r[7]) - runs(r[4]), 'revision 2: the provider ran once more').toBe(1);

    // 3. A revision that leaves the builder's params: the same key and output, and no run.
    presented(r[8]!, 'revision 3 (ball moved, its params left)');
    const m3 = meshOf(providedRow(r[9]!, 'vox', 'revision 3'), 'revision 3: vox');
    expect(m3.key, 'revision 3: a revision that leaves the builder\'s params keeps the provider\'s content key').toBe(m2.key);
    expect(m3.raw, 'revision 3: and keeps its output').toEqual(m2.raw);
    expect(runs(r[10]) - runs(r[7]), 'revision 3: the provider didn\'t run again').toBe(0);

    // A mesh_in naming a logic-fed instancer: refused, naming it.
    const named = errorsOf(r[11]!, 'the swarm scene').filter((i) => i.path.startsWith('items/vox/params/mesh') && (i.ids.includes('swarm') || holds(i.raw, 'item', 'swarm')));
    expect(named.length, `the swarm scene: an error at vox's mesh names the instancer swarm, which logic feeds; errors: ${show(errorsOf(r[11]!, 'the swarm scene').map((i) => i.raw) as JsonValue, 3000)}`).toBeGreaterThan(0);
    expect(hasMesh(providedRow(r[12]!, 'vox', 'the swarm scene')), `the swarm scene: vox holds no mesh from the refused mesh_in: ${show(r[12])}`).toBe(false);

    // A provider linking a library whose fixtures never ran: refused, naming the library.
    const namesSnap = (issues: { raw: JsonObject }[]): boolean => issues.some((i) => holds(i.raw, 'library', 'snap@1'));
    if (r[13]!['outcome'] === 'refused') {
      expect(namesSnap(issuesOf(r[13]!, 'test/voxlink@1.0.0\'s install')), `test/voxlink@1.0.0 is refused naming the library snap@1: ${show(r[13], 3000)}`).toBe(true);
    } else {
      expect(namesSnap(errorsOf(r[14]!, 'the linked voxelizer\'s scene')), `test/voxlink@1.0.0 installed (${show(r[13])}), so the check of a document naming voxlink.voxelize refuses it, naming the library snap@1: ${show(r[14], 3000)}`).toBe(true);
    }
    expect(hasMesh(providedRow(r[15]!, 'vox', 'the linked voxelizer\'s scene')), `voxlink.voxelize, refused, gives no mesh: ${show(r[15])}`).toBe(false);
  }, TIMEOUT);
});
