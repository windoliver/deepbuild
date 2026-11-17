// View-rectangle invariance, criteria 15 and 16 of #458, judged on one run as criterion 16 says ("in the same run").
//
// The fixture (fixture.ts): a lit, shadowed room with bloom, ambient occlusion, depth of field and velocity blur on,
// frame 30 at 60 frames a second. `view_rectangle` draws it at 960 × 540 alone and again into the rectangle at
// (317, 211) of a 2560 × 1440 target seeded with noise, and returns the six targets of the view alone, of the larger
// target as seeded and of the larger target after the view drew.
//
// Criterion 15: the ID target equal bit for bit and the final, linear, normal, depth and velocity targets within one
// code value on every pixel of the rectangle. Wrong programs: `bloom_clamps_to_target` (bloom clamps its taps to the
// target's edge instead of the view's, so pixels within 32 px of the rectangle's edge brighten) and
// `ao_scales_by_target` (the ambient-occlusion pass scales its coordinates by the target's size).
// Criterion 16: every pixel outside the rectangle keeps its noise bit for bit in every target. Wrong program:
// `clears_whole_target` (the pass that writes the final target clears the whole target).
//
// At the base `deep-gpu run` has no `view_rectangle` call and none of the three planted names: BASE-FAILURE.txt.

import { describe, expect, it } from 'vitest';
import { AT, EDGE_PX, OTHER_SEED, SEED, VIEW, look, scene, type JsonObject } from './fixture.ts';
import {
  AC, TARGETS, TIMEOUT, brighterNearEdge, distinctPixels, equalPixels, failsNaming, frameOf, insideFailures, none, outsideFailures, rectangleOf,
  requireGpu, run, useGpu, view3d, view3dTarget, viewRectangle, writeJson, type Planted, type Rectangle,
} from './helpers.ts';

const gpu = useGpu();

/** One `view_rectangle` run of the fixture, read back. */
function draw(seed: number, planted?: Planted): Rectangle {
  const doc = writeJson(gpu.out(), 'rect-458.json', scene());
  const what = `the fixture alone and in its rectangle, seed ${seed}${planted ? `, --planted ${planted}` : ''}`;
  return rectangleOf(gpu.out(), run(gpu.bin(), gpu.out(), [viewRectangle(doc, look(), seed)], planted)[0]!, what);
}
/** The run both criteria are judged on: drawn once, by the first test that asks. */
let judged: Rectangle | undefined;
const theRun = (): Rectangle => (judged ??= draw(SEED));

describe('#458 view-rectangle invariance', () => {
  it(`${AC[15]} the fixture drawn at 960 × 540 alone and into the rectangle at (317, 211) of a 2560 × 1440 target has equal ID targets bit for bit and its color, normal, depth and velocity within one code value on every pixel of the rectangle`, () => {
    requireGpu();
    const r = theRun();

    // The premises: what is drawn alone is the view #378's view3d draws, and the fixture is what the criterion names.
    const out = gpu.out();
    const full = writeJson(out, 'rect-458.json', scene());
    const variants: [string, JsonObject][] = [
      ['every effect on', view3d(full, look())],
      ['bloom off', view3d(full, look({ bloom: 'none' }))],
      ['ambient occlusion off', view3d(full, look({ ao: 'none' }))],
      ['depth of field off', view3d(writeJson(out, 'rect-458-no-dof.json', scene({ dof: true })), look())],
      ['velocity blur off', view3d(full, look({ motion_blur: 'none' }))],
      ['the sun casting no shadow', view3d(writeJson(out, 'rect-458-no-shadow.json', scene({ shadow: true })), look())],
      ['no sun', view3d(writeJson(out, 'rect-458-no-sun.json', scene({ sun: true })), look())],
    ];
    const frames = run(gpu.bin(), out, variants.map(([, call]) => call)).map((reply, i) => frameOf(reply, `view3d, ${variants[i]![0]}`));
    for (const name of ['final', 'linear', 'ids'] as const) equalPixels(r.alone[name], view3dTarget(out, frames[0]!, name, 'view3d'), `the view drawn alone is the view view3d draws: ${name}`);
    for (let i = 1; i < variants.length; i++) {
      expect(frames[i]!['pixel_hash'], `the fixture is lit and shadowed with bloom, ambient occlusion, depth of field and velocity blur on: its frame changes with ${variants[i]![0]}`).not.toBe(frames[0]!['pixel_hash']);
    }
    // The targets view3d doesn't return this way hold the view: the slider's travel over the shutter (12 m/s for
    // 1/120 s, 5.0 to 5.3 m from the camera: about 18 px to the right), a unit normal under almost every pixel, a depth
    // that varies.
    const px = VIEW[0] * VIEW[1];
    let moving = 0; let unit = 0;
    const depths = new Set<number>();
    for (let i = 0; i < px; i++) {
      const vx = r.alone.velocity.data.readFloatLE(i * 8); const vy = r.alone.velocity.data.readFloatLE(i * 8 + 4);
      if (vx >= 10 && vx <= 30 && Math.abs(vy) <= 2) moving++;
      const n = [0, 4, 8].map((o) => r.alone.normal.data.readFloatLE(i * 12 + o));
      if (Math.abs(Math.hypot(n[0]!, n[1]!, n[2]!) - 1) <= 0.1) unit++;
      depths.add(r.alone.depth.data.readFloatLE(i * 4));
    }
    expect(moving, 'the velocity target holds the slider: pixels moving 10 to 30 px to the right over the shutter').toBeGreaterThanOrEqual(5_000);
    expect(unit, `the normal target holds a unit normal on at least 90% of the view's ${px} pixels`).toBeGreaterThanOrEqual(0.9 * px);
    expect(depths.size, 'the depth target varies over the view').toBeGreaterThanOrEqual(1_000);

    none(insideFailures(r), `the rectangle at (${AT[0]}, ${AT[1]}) draws what the view draws alone`);
  }, TIMEOUT);

  it(`${AC[15]} a planted bloom that clamps its taps to the target's edge instead of the view's brightens pixels within 32 px of the rectangle's edge and fails, naming the target and the first pixel`, () => {
    requireGpu();
    const planted = draw(SEED, 'bloom_clamps_to_target');
    equalPixels(planted.alone.final, theRun().alone.final, 'alone, where the target is the view, the planted bloom draws the clean frame');
    failsNaming(insideFailures(planted), /the final target: .*the first pixel is \(\d+, \d+\) of the view/, 'bloom_clamps_to_target');
    const brighter = brighterNearEdge(planted, EDGE_PX);
    expect(brighter.count, `the planted bloom brightens pixels of the final target within ${EDGE_PX} px of the rectangle's edge`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[15]} a planted ambient-occlusion pass that scales its coordinates by the target's size fails the same way, naming the target and the first pixel`, () => {
    requireGpu();
    const planted = draw(SEED, 'ao_scales_by_target');
    equalPixels(planted.alone.final, theRun().alone.final, 'alone, where the target is the view, the planted ambient occlusion draws the clean frame');
    failsNaming(insideFailures(planted), /the final target: .*the first pixel is \(\d+, \d+\) of the view/, 'ao_scales_by_target');
  }, TIMEOUT);

  it(`${AC[16]} in the same run every pixel outside the rectangle keeps its noise bit for bit in every target`, () => {
    requireGpu();
    const r = theRun();
    // The larger target holds noise, in color and depth and every other target: the 4,096 pixels that start it, all
    // above the rectangle, hold at least 256 different values.
    for (const name of TARGETS) expect(distinctPixels(r.seeded[name], 4_096), `the ${name} target is seeded with noise: different values among its first 4,096 pixels`).toBeGreaterThanOrEqual(256);
    none(outsideFailures(r), 'every pixel outside the rectangle keeps its noise');
    // The noise is seeded: another seed gives other noise in every target, and the same view alone.
    const other = draw(OTHER_SEED);
    for (const name of TARGETS) {
      expect(other.seeded[name].sha, `seed ${OTHER_SEED} seeds the ${name} target with other noise than seed ${SEED}`).not.toBe(r.seeded[name].sha);
      expect(other.alone[name].sha, `the ${name} target of the view drawn alone doesn't depend on the seed`).toBe(r.alone[name].sha);
    }
  }, TIMEOUT);

  it(`${AC[16]} a planted pass that clears the whole target fails, naming the target and the first pixel outside`, () => {
    requireGpu();
    const planted = draw(SEED, 'clears_whole_target');
    const r = theRun();
    for (const name of TARGETS) expect(planted.seeded[name].sha, `one seed gives one noise: the ${name} target as seeded`).toBe(r.seeded[name].sha);
    failsNaming(outsideFailures(planted), /the final target: .*the first pixel outside is \(0, 0\) of the target/, 'clears_whole_target');
  }, TIMEOUT);
});
