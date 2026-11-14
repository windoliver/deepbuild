// Criterion 4 (no upstream test): "With no linux/amd64 image of the pinned digest, `cross_machine` reads BLOCKED with one
// unblock ask naming the pull command with that digest, and the runtime's image list is the same after the run as
// before it; with the container runtime unreachable it reads BLOCKED with one ask naming that; neither is ever PASS"
//
// Neither case touches this Mac's real runtime or its images (README: Docker). Without the image: docker-shim.mjs, first
// on the lane's PATH, answers as a runtime that lacks the pinned image (its digest, tag and IDs) and refuses and logs any
// pull. Unreachable: the lane's DOCKER_HOST names a socket in this test's temporary folder that nothing listens on. In
// both, the lane writes a BLOCKED record with its one ask, `deep-logic determinism` with compare cross_machine reads
// BLOCKED with that ask, and the real runtime's image list is read before and after.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, cross, hideTokens, imageList, logicBin, macGolden, needRuntime, onReferenceMac, pin, prebuild, pullCommand, recordOf, runLane,
  sandbox, show, tallyPiece, treeOf, verifyCall,
} from './helpers.ts';

prebuild(() => { logicBin(); });

describe(`${AC[4]} the lane reads BLOCKED, with one ask, without its image or its runtime, and pulls nothing`, () => {
  it(`${AC[4]} with no linux/amd64 image of the pinned digest, cross_machine reads BLOCKED with one ask naming the pull command with that digest, and the image list is unchanged`, () => {
    onReferenceMac();
    const p = pin();
    needRuntime();
    const box = sandbox();
    const tree = treeOf(box);
    const piece = tallyPiece(1983_04);
    const golden = macGolden(piece);
    const before = imageList();

    const run = runLane(box, [verifyCall(piece, golden)], { shim: { hide: hideTokens(p) } });
    const after = imageList();
    expect(run.pulls, 'the lane never pulls during a check').toEqual([]);
    expect(after, 'the runtime\'s image list is the same after the run as before it').toEqual(before);
    const record = recordOf(box, tree, run);
    expect(record['state'], `the lane's record without its image: ${show(record)}`).toBe('BLOCKED');

    const c = cross(box, piece, tree, 'cross_machine without the lane\'s image');
    expect(c.verdict, `cross_machine reads BLOCKED, never PASS: ${show(c.raw)}`).toBe('BLOCKED');
    expect(typeof c.ask, `one unblock ask: ${show(c.raw)}`).toBe('string');
    expect(c.ask as string, 'the ask names the pull command with the pinned digest').toContain(pullCommand(p));
  }, TIMEOUT);

  it(`${AC[4]} with the container runtime unreachable, cross_machine reads BLOCKED with one ask naming that`, () => {
    onReferenceMac();
    needRuntime();
    const box = sandbox();
    const tree = treeOf(box);
    const piece = tallyPiece(1983_14);
    const golden = macGolden(piece);
    const before = imageList();

    const run = runLane(box, [verifyCall(piece, golden)], { env: { DOCKER_HOST: `unix://${join(box.dir, 'no-docker.sock')}`, DOCKER_CONTEXT: undefined } });
    expect(imageList(), 'the runtime\'s image list is the same after the run as before it').toEqual(before);
    const record = recordOf(box, tree, run);
    expect(record['state'], `the lane's record without its runtime: ${show(record)}`).toBe('BLOCKED');

    const c = cross(box, piece, tree, 'cross_machine with the runtime unreachable');
    expect(c.verdict, `cross_machine reads BLOCKED, never PASS: ${show(c.raw)}`).toBe('BLOCKED');
    expect(typeof c.ask, `one unblock ask: ${show(c.raw)}`).toBe('string');
    const ask = c.ask as string;
    expect([/docker/i.test(ask), /unreachable/i.test(ask)], `the ask names the container runtime as unreachable: ${ask}`).toEqual([true, true]);
    expect(ask, 'a pull can\'t reach an unreachable runtime, so the ask names none').not.toContain('docker pull');
  }, TIMEOUT);
});
