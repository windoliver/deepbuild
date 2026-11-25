// AC5 #269.2dd4ac2c: The CPU render and the GPU draw of the `smooth` fixture agree within one 8-bit level at every
// pixel; a planted GPU path that picks the role before rebuilding the shares differs at the edges and fails, naming the
// pixel
//
// The `smooth` fixture is the grid fixture drawn smooth alone (fixtures.ts `gridDoc(…, ['smooth'])`, 64 × 64 at 8 px a
// cell, three roles, `none`, the lone cell and the three-role corner), at step 20. `deep-gpu run`'s `layers` draws its
// one writer layer at step 20 by Vello CPU and by the GPU layer in one call (README: The surface under test); every pixel
// of the two pictures must agree within one level in each of R, G, B and A (judges.ts `pairFailures`). So that the pair
// compares the grid and the CPU side is the CPU render the 2D checks and goldens read: the CPU picture must equal
// `deep-show run`'s canonical render of the same document at step 20 within one level, and at the centre of every cell
// whose cells two either side all hold one value it shows that value's role, or the ground for `none`. A failure names
// its pixel.
import { describe, expect, it } from 'vitest';
import { teamsProgram } from './programs.ts';
import { GRID_KEY_TOP, gridDoc, keyCenter, sessionForm } from './fixtures.ts';
import { atEdge, gridCentreFailures, pairFailures, sameFailures } from './judges.ts';
import {
  AC, DOC, TIMEOUT, at, binOf, evalCall, failsNaming, keyOf, layerPicture, layersCall, none, pngOf, prebuild, presented, putAsset, putEvidence,
  requireMetal, runGpu, runShow, scenario, showCall, snapshotOf, useTemp, type GpuPlant, type Image, type JsonObject,
} from './helpers.ts';

prebuild(['full', 'gpu']);
const temp = useTemp();
const D = { grid: DOC(5) };
const STEP_AT = 20;

interface Pair { doc: JsonObject; cpu: Image; gpu: Image }
function drawnPair(planted?: GpuPlant): Pair {
  requireMetal();
  const out = temp();
  const program = teamsProgram();
  const doc = gridDoc(program, ['smooth']);
  const [reply] = runGpu(binOf('gpu'), out, [layersCall(sessionForm(doc), at(STEP_AT), ['vello_cpu', 'gpu_layer'], putAsset(out, program.bytes, 'wasm'))], 'AC5 the smooth fixture by Vello CPU and by the GPU layer', planted);
  const pair = { doc, cpu: layerPicture(out, reply!, 'vello_cpu', 'the smooth fixture by Vello CPU'), gpu: layerPicture(out, reply!, 'gpu_layer', 'the smooth fixture by the GPU layer') };
  for (const [who, im] of [['Vello CPU', pair.cpu], ['the GPU layer', pair.gpu]] as const) expect([im.width, im.height], `the layer by ${who} is the document's size`).toEqual(doc['size']);
  return pair;
}
/** `deep-show run`'s canonical render of the document at step 20. */
function canonical(doc: JsonObject): Image {
  const ev = temp();
  const program = teamsProgram();
  putEvidence(ev, program.bytes);
  const replies = runShow(binOf(), scenario(ev, [D.grid], [showCall(D.grid, doc), evalCall(D.grid, at(STEP_AT))]), 'AC5 the smooth fixture\'s canonical render');
  presented(replies[0]!, 'the smooth fixture');
  return pngOf(ev, snapshotOf(replies[1]!, `the smooth fixture at step ${STEP_AT}`), `the smooth fixture at step ${STEP_AT}`);
}

describe(`${AC[5]} the smooth fixture's CPU render against its GPU draw`, () => {
  it(`${AC[5]} the CPU render and the GPU draw agree within one 8-bit level at every pixel`, () => {
    const pair = drawnPair();
    const key = keyOf(pair.cpu, GRID_KEY_TOP, keyCenter, 'the smooth fixture by Vello CPU');
    none([
      ...gridCentreFailures(pair.cpu, key, STEP_AT, 'Vello CPU'),
      ...sameFailures(pair.cpu, canonical(pair.doc), 'layers\' Vello CPU picture against deep-show\'s canonical render, which the 2D checks read'),
      ...pairFailures(pair.cpu, pair.gpu),
    ], `the smooth fixture at step ${STEP_AT}, by Vello CPU and by the GPU layer`);
  }, 2 * TIMEOUT);

  it(`${AC[5]} planted grid_role_before_rebuild differs at the edges and fails, naming the pixel`, () => {
    const pair = drawnPair('grid_role_before_rebuild');
    const failures = pairFailures(pair.cpu, pair.gpu);
    const named = failures.map((f) => /pixel \((\d+), (\d+)\)/.exec(f)).filter((m) => m !== null);
    expect(named.some((m) => atEdge(Number(m![1]), Number(m![2]), STEP_AT)), `under the planted GPU path a pixel at an edge (its cells two either side hold more than one value) differs: ${failures.slice(0, 6).join('; ')}`).toBe(true);
    failsNaming(failures, [/pixel \(\d+, \d+\)/], 'the smooth fixture under grid_role_before_rebuild');
  }, TIMEOUT);
});
