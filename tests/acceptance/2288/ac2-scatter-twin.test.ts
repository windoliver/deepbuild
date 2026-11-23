// AC2 #2288.015cbad4: an `each:` body over a 200-element scatter builds 200 bodies in element-ID order at the scatter's
// poses, and gives the same per-step world state hash as a twin world declaring them one by one.
//
// The scatter (helpers.ts: scatterScene): `rocks`, an instance@1 item at the origin fed by
// `from: {distribute: {on: "slab", mode: "poisson", min_distance: 0.9, seed: 2288, max: 200, yaw: [-60, 60], tilt: 30}}`
// over `slab`, a 16 × 16 m plate 2 m up; `rock`, a 0.5 m box body with `each: "rocks"`, dropped from there onto the
// plane y = 0 and left to land, tip and settle over 600 steps (5 s).
//
// The scatter's poses are its own: the same scene with no world, presented in `deep-show run` and read with #420's
// `geometry` call (#2013's row: each element's `id`, its `pos` in world metres, and its `rot` where it leans). That row
// holds 200 elements with distinct IDs, each at scale 1, on the plate (y = 2) and at least 0.9 m from every other, so
// no two bodies start overlapping (a 0.5 m box turned any way stays within 0.433 m of its centre).
//
// `deep-physics` checks the world in its scene: no error, and `built` lists `rock#<id>` for the 200 element IDs in
// ascending numeric order (IDs 0 … 199 have one to three digits, so the order of their addresses as text is another
// order), beside the ground. Its bake's built state of `rock#<id>` is the element's pose, every corner of the 0.5 m box
// within 1e-6 m. The twin (helpers.ts: oneByOne) declares the same 200 bodies one by one under those addresses, in
// element-ID order, each with the each-body's fields and its element's `pos` and `rot` as the geometry row gives them;
// it checks with no error, and #2010's step hashes of the two bakes (as built, then after each of 600 steps) are equal
// at every index, and the last isn't the first. A program that scatters in another order, builds at other poses, or
// steps the element bodies otherwise fails.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC2288, METRE_TOL, MIN_DISTANCE, ROCK, ROCKS, ROCK_HALF, SCATTER_COUNT, SCATTER_STEPS, SCATTER_WORLD, SLAB_Y, TIMEOUT,
  arr, errorsOf, geometryCall, none, oneByOne, physics, poseGap, posesOf, prebuild, prebuildShow, presented, rockAddress,
  runShow, scatterScene, scatteredOf, scenario, sceneBake, sceneCheck, show, showBin, showCall, stepHashes, useTemp,
  type Scattered,
} from './helpers.ts';

prebuild();
prebuildShow(['full']);

const ID = AC[2];
const temp = useTemp();

/** The scatter's elements, from the scene with no world: 200 of them, distinct IDs, scale 1, on the plate, 0.9 m apart. */
function theScatter(): Scattered[] {
  const doc = DOC2288(2);
  const replies = runShow(showBin('full'), scenario(temp(), [doc], [showCall(doc, scatterScene(false)), geometryCall(doc, [ROCKS])]), 'the scatter, read alone');
  presented(replies[0], 'the scatter with no world');
  const elements = scatteredOf(replies[1], ROCKS, 'the scatter\'s geometry');
  expect(elements.length, `the scatter lays out ${SCATTER_COUNT} elements`).toBe(SCATTER_COUNT);
  expect(new Set(elements.map((e) => e.id)).size, 'each element ID once').toBe(SCATTER_COUNT);
  const fails: string[] = [];
  for (const e of elements) {
    if (!Number.isInteger(e.id) || e.id < 0 || e.id > 0xffffffff) fails.push(`element ${e.id} isn't a u32 ID`);
    if (e.scale.some((s) => s !== 1)) fails.push(`element ${e.id} is scaled ${show(e.scale)}`);
    if (Math.abs(e.pos[1] - SLAB_Y) > 1e-9) fails.push(`element ${e.id} is at ${show(e.pos)}, off the plate at y = ${SLAB_Y}`);
  }
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const [a, b] = [elements[i]!.pos, elements[j]!.pos];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < MIN_DISTANCE * (1 - 1e-9)) fails.push(`elements ${elements[i]!.id} and ${elements[j]!.id} are ${d} m apart, under ${MIN_DISTANCE}`);
    }
  }
  none(fails.slice(0, 20), 'the scatter\'s elements are whole, unscaled, on the plate and apart, so its bodies start clear of each other');
  return elements;
}

describe(`AC2 ${ID} each: over a scattered instancer`, () => {
  it(`AC2 ${ID} an each: body over a 200-element scatter builds 200 bodies in element-ID order at the scatter's poses, and gives the same per-step world state hash as a twin world declaring them one by one`, () => {
    const elements = theScatter();
    const scene = scatterScene();
    const twin = oneByOne(elements);
    const [checked, baked, twinChecked, twinBaked] = physics([
      sceneCheck(scene, SCATTER_WORLD),
      sceneBake(scene, SCATTER_WORLD, SCATTER_STEPS, { every: SCATTER_STEPS }),
      { call: 'check', world: twin },
      { call: 'bake', world: twin, steps: SCATTER_STEPS, read: [] },
    ]);
    none(errorsOf(checked, 'the scatter world').map((e) => show(e)), 'the world, each: over a scattered instancer, checks with no error');
    const built = arr(checked!['built'], 'the check\'s built (the bodies in the order the backend built them)').map(String);
    const want = elements.map((e) => e.id).sort((a, b) => a - b).map(rockAddress);
    expect(built.filter((b) => b.startsWith(`${ROCK}#`)), 'the backend built one body per scattered element, rock#<id>, in element-ID order (ascending u32)').toEqual(want);
    expect(built.length, `the world builds the ground and the 200 element bodies and nothing else: ${show(built).slice(0, 300)}`).toBe(SCATTER_COUNT + 1);

    expect(baked!['ok'], `the scatter world is baked in its scene: ${show(baked).slice(0, 1500)}`).toBe(true);
    const fails: string[] = [];
    for (const e of elements) {
      const got = posesOf(baked!, rockAddress(e.id), 2, fails)[0];
      if (!got) continue;
      const gap = poseGap(got, e, ROCK_HALF);
      if (!(gap <= METRE_TOL)) fails.push(`${rockAddress(e.id)} is built at ${show(got.pos)} turned ${show(got.rot)}; its element is at ${show(e.pos)} turned ${show(e.rot)} (a corner ${gap.toExponential(3)} m off)`);
    }
    none(fails.slice(0, 30), 'each element body is built at its scattered element\'s pose, every corner within 1e-6 m');

    none(errorsOf(twinChecked, 'the one-by-one twin').map((e) => show(e)), 'the twin, 200 bodies declared one by one, checks with no error');
    const a = stepHashes(baked!, SCATTER_STEPS + 1, 'the scatter world, bodies per element');
    const b = stepHashes(twinBaked!, SCATTER_STEPS + 1, 'the twin, bodies one by one');
    expect(a[SCATTER_STEPS], 'the world state moves over the 600 steps: the last hash isn\'t the built state\'s').not.toBe(a[0]);
    const first = a.findIndex((h, k) => h !== b[k]);
    expect(first, first < 0 ? '' : `the hashes first differ after step ${first}: ${a[first]} per element, ${b[first]} one by one (${a.filter((h, k) => h !== b[k]).length} of ${SCATTER_STEPS + 1} differ)`).toBe(-1);
  }, TIMEOUT);
});
