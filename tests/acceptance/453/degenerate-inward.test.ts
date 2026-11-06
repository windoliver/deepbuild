// AC2 (#453.061ce907): "A triangle whose area is 1e-14 of its part's bounds diagonal squared counts as a degenerate
// face, and a closed part whose normals all point inward fails normals: outward on its negative signed volume"
//
// asserts: the sliver box (gltf.ts `sliverBox`: a closed 100 m box whose −Z face holds a sliver of area
// 1e-14 × 30,000 m² = 3e-10 m², triangle 13; that is above 1e-12 m², so only the ratio to the bounds diagonal
// squared makes it degenerate) reports degenerate_faces 1 naming `0:13`; its twin, the sliver at 1e-10 of the
// diagonal squared, reports no defect and passes. The inward cube (every triangle wound in, every normal in, so
// no face is flipped and no edge inconsistent) is FAIL with an error `loop.normals_inward` whose `actual` is its
// signed volume, −1 m³, as its result's `signed_volume` is; the same cube outward passes with +1 m³. Planted:
// `degenerate_exact_zero` fails naming degenerate_faces; `outward_skips_volume` fails naming loop.normals_inward.

import { describe, expect, it } from 'vitest';
import { AC, cleanFailures, defectFailures, failedWith, failsNaming, judge, none, the, useBuild, useEvidence, type Case, type Judged, type Planted } from './helpers.ts';
import { faceId, indexedCube, sliverBox } from './gltf.ts';

const build = useBuild();
const evidence = useEvidence();

const SLIVER = sliverBox(1e-14);
const CASES: Case[] = [
  { name: 'the sliver box at 1e-14', spec: { prims: [SLIVER.prim] } },
  { name: 'the sliver box at 1e-10', spec: { prims: [sliverBox(1e-10).prim] } },
  { name: 'the inward cube', spec: { prims: [indexedCube([0, 0, 0], 1, { inward: true })] } },
  { name: 'the outward cube', spec: { prims: [indexedCube()] } },
];
const judged = (planted?: Planted) => judge(build.bin(), evidence(), CASES, planted);

/** The inward cube FAIL on normals: outward, by its signed volume of −1 m³, with no face flipped and no edge inconsistent. */
function inwardFailures(j: Judged): string[] {
  const { failures, issue } = failedWith(j, 'loop.normals_inward');
  const volume = j.result?.signed_volume;
  if (typeof volume !== 'number' || Math.abs(volume + 1) > 1e-4) failures.push(`${j.name}: signed_volume is ${String(volume)}, not −1 m³ (loop.normals_inward)`);
  if (issue && (typeof issue.actual !== 'number' || Math.abs(issue.actual + 1) > 1e-4)) failures.push(`${j.name}: loop.normals_inward's actual is ${JSON.stringify(issue.actual)}, not the signed volume −1 m³`);
  failures.push(...defectFailures(j, 'flipped_faces', []), ...defectFailures(j, 'inconsistent_edges', []));
  return failures;
}

describe('AC2 a sliver at 1e-14 of the diagonal squared is degenerate; a closed part with every normal in fails normals: outward on its negative volume', () => {
  it(`${AC[2]} the sliver at 1e-14 of its part's bounds diagonal squared counts as a degenerate face; at 1e-10 it doesn't`, () => {
    expect(SLIVER.area, 'the sliver is above 1e-12 m², so an absolute threshold would miss it').toBeGreaterThan(1e-12);
    const j = judged();
    none(defectFailures(the(j, 'the sliver box at 1e-14'), 'degenerate_faces', [faceId(0, SLIVER.sliver)]), 'the sliver box at 1e-14');
    none(cleanFailures(the(j, 'the sliver box at 1e-10')), 'the sliver box at 1e-10');
  });

  it(`${AC[2]} the closed cube whose normals all point inward fails normals: outward on its signed volume of −1 m³; outward it passes`, () => {
    const j = judged();
    none(inwardFailures(the(j, 'the inward cube')), 'the inward cube');
    const out = the(j, 'the outward cube');
    none(cleanFailures(out), 'the outward cube');
    expect(Math.abs((out.result?.signed_volume ?? NaN) - 1), `the outward cube's signed_volume is +1 m³: ${String(out.result?.signed_volume)}`).toBeLessThan(1e-4);
  });

  it(`${AC[2]} a planted check that counts only exact zero area as degenerate fails, naming degenerate_faces`, () => {
    failsNaming(defectFailures(the(judged('degenerate_exact_zero'), 'the sliver box at 1e-14'), 'degenerate_faces', [faceId(0, SLIVER.sliver)]), ['degenerate_faces'], 'the check that counts only zero area');
  });

  it(`${AC[2]} a planted check that holds normals: outward to its faces alone, without the signed volume, fails, naming loop.normals_inward`, () => {
    failsNaming(inwardFailures(the(judged('outward_skips_volume'), 'the inward cube')), ['loop.normals_inward'], 'the check without the signed volume');
  });
});
