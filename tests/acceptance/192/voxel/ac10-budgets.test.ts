// #192.23382ecd: Budgets, on the reference Mac in the local preflight, compared with the merge base: the voxel
// mesher's 32 × 32 × 32 grid runs in under 200 ms at check on one core, and a document with providers gains no work
// per frame.
//
// The run: six fresh `deep-show run` processes (no cache) each install the voxel pack and check the voxel document
// once; the `provided` row's `ms` is that run's own time on the one thread that ran it (README: The surface). The
// first is a warm-up; the other five are judged against 200 ms by the design's rule (#238's judgeRuns), only on a
// fit reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal, 1-minute load at most the core
// count); elsewhere, or between the limit and the margin, the test fails INCONCLUSIVE, never passes. The merge base
// has no mesher to time (it copies no params or assets in), so the limit is the issue's 200 ms.
// No work per frame (counts, read on every machine before the timing is judged): a document with a provider (the fault
// provider at its default, which the merge base runs too) and a moving rect, 60 frames here and on the merge base's
// `full,test-mesh-item`: each frame runs as many nodes in both, and here the sandbox module checks, rewrites and runs
// nothing during the frames.
import { describe, expect, it } from 'vitest';
import { environmentProblem, judgeRuns } from '../../238/helpers.ts';
import {
  DOC, MESH_BUILD, SANDBOX, arr, baseDeepShow, countsOf, deepShow, frames, installPack, meshOf, num, obj, present, provided, rowOf, runShow,
  scenario, show, sub, useTemp, type JsonObject,
} from './helpers.ts';
import { MOVING, SIZE, TRIANGLES, board, faultPack, meshItem, mover, voxPack, voxelDoc } from './programs.ts';

const ID = '#192.23382ecd';
const LIMIT_MS = 200;
const temp = useTemp();
const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

describe(`${ID} budgets against the merge base: the voxel mesher under 200 ms at check, and no work per frame`, () => {
  it(`${ID} the voxel mesher's 32 × 32 × 32 grid runs in under ${LIMIT_MS} ms at check on one core on the reference Mac (five fresh processes after a warm-up), and a document with providers runs as many nodes per frame as on the merge base with no provider work in a frame`, () => {
    const root = temp();
    // The voxel mesher's run at check.
    const vox = voxPack(sub(root, 'packs'));
    const readings = [0, 1, 2, 3, 4, 5].map((k) => {
      const [, before, shown, after, out] = runShow(deepShow(MESH_BUILD), scenario(sub(root, `evidence-${k}`), [
        installPack(vox), SANDBOX, present(DOC.a, voxelDoc(SIZE.first, 192_010)), SANDBOX, provided(DOC.a),
      ]));
      expect(shown!['outcome'], `run ${k}: the voxel document is presented: ${show(shown)}`).toBe('presented');
      expect(countsOf(after!, 'sandbox after').runs - countsOf(before!, 'sandbox before').runs, `run ${k}: this check ran the mesher once`).toBe(1);
      const row = rowOf(out!, 'vox', `run ${k}`);
      expect(meshOf(row, `run ${k}: the mesh`).indices.length / 3, `run ${k}: the mesher meshed the whole grid`).toBe(TRIANGLES);
      const ms = num(row.ms, `run ${k}: the provided row's ms (the run's own time)`);
      expect(ms, `run ${k}: a run takes some time`).toBeGreaterThan(0);
      return ms;
    });
    // No work per frame, against the merge base.
    const faults = faultPack(sub(root, 'packs'));
    const doc = board('Providers', ['test/faultpack@1.0.0'], [meshItem('tetra', 'faultpack.overcap', {}), mover()], { seed: 192_010, ...MOVING });
    const calls: JsonObject[] = [installPack(faults), present(DOC.a, doc), provided(DOC.a), SANDBOX, frames(DOC.a, 60), SANDBOX];
    const here = runShow(deepShow(MESH_BUILD), scenario(sub(root, 'evidence-here'), calls));
    const base = baseDeepShow(MESH_BUILD);
    const there = runShow(base.bin, scenario(sub(root, 'evidence-base'), calls));
    for (const [r, w] of [[here, 'here'], [there, `on the merge base ${base.sha.slice(0, 12)}`]] as const) {
      expect(r[0]!['outcome'], `test/faultpack@1.0.0 installs ${w}: ${show(r[0])}`).toBe('installed');
      expect(r[1]!['outcome'], `the document with a provider is presented ${w}: ${show(r[1])}`).toBe('presented');
      expect(meshOf(rowOf(r[2]!, 'tetra', w), `the provider's mesh ${w}`).positions.length, `the provider wrote its tetrahedron ${w}`).toBe(12);
    }
    const ran = (reply: JsonObject, w: string): number[] => arr(reply['frames'], `frames ${w}`).map((f, i) => num(obj(f, `frames ${w}[${i}]`)['ran'], `frames ${w}[${i}].ran`));
    expect(ran(here[4]!, 'here'), `each of 60 frames runs as many nodes as on the merge base ${base.sha.slice(0, 12)}`).toEqual(ran(there[4]!, 'on the merge base'));
    expect(countsOf(here[5]!, 'sandbox after the frames'), 'no frame checked, rewrote or ran a program').toEqual(countsOf(here[3]!, 'sandbox before the frames'));

    const problem = environmentProblem();
    if (problem) inconclusive(`the mesher ran in ${readings.slice(1).map((r) => r.toFixed(1)).join(', ')} ms, read off this machine: ${problem}`);
    const judged = judgeRuns(`${ID} the voxel mesher's run at check (ms)`, readings.slice(1), LIMIT_MS);
    console.log(`${judged.status} ${judged.shown}`);
    expect(judged.status, judged.shown).not.toBe('FAIL');
    if (judged.status === 'INCONCLUSIVE') inconclusive(judged.shown);
  }, 7_200_000);
});
