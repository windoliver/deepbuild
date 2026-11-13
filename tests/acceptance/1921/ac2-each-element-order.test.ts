// #1921.e4dd3dda: a body with `each:` a 400-element instancer builds 400 bodies in element-ID order; a world whose
// `capacity: {bodies}` is below the element count is refused at check, naming both counts.
//
// The pile (helpers.ts: pileScene): the world `pile` holds one body, `crate`, with `each: "crates"`, the scene's
// instancer of 400 elements whose IDs 0 … 399 sit in its rows out of order (row i holds element (163 × i) mod 400), each
// row at its own place and turned (7 × i) mod 360 degrees about +Y. Element-ID order is the IDs' numeric order, so a
// build in row order, or in the order of the addresses as text (crate#0, crate#1, crate#10, …), is a wrong order.
// `deep-physics` checks the world in its scene and answers the bodies as the backend built them (`built`, README: The
// surface under test); its bake answers each element body's built state under its address, `crate#<element id>`. With
// `capacity.bodies` 400 the world checks; with 399 it is refused, naming 399 and 400. The world holds no other body, so
// the count it needs is the element count.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, PILE, PILE_WORLD, TIMEOUT, arr, errorsOf, matrixGap, none, physics, pileId, pilePos, pileRot, pileScene, prebuild,
  quatMatrix, sceneBake, sceneCheck, show, statesOf,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];

describe(`${ID} a body with each: an instancer builds one body per element, in element-ID order, within the world's capacity`, () => {
  it(`${ID} (order) a body with each: a 400-element instancer builds 400 bodies in element-ID order, each at its element's pose`, () => {
    const scene = pileScene(PILE);
    const [checked, baked] = physics([sceneCheck(scene, PILE_WORLD), sceneBake(scene, PILE_WORLD, 1)]);
    none(errorsOf(checked, 'the pile').map((e) => show(e)), 'the pile, its capacity the element count, checks with no error');
    const built = arr(checked!['built'], 'the check\'s built (the bodies in the order the backend built them)');
    const want = Array.from({ length: PILE }, (_, e) => `crate#${e}`);
    expect(built, 'the backend built crate#0, crate#1, … crate#399, in element-ID order, and nothing else').toEqual(want);

    const fails: string[] = [];
    for (let row = 0; row < PILE; row++) {
      const id = `crate#${pileId(row)}`;
      const s = statesOf(baked!, id, 2, `the pile's bake: ${id}`)[0]!;
      if (s.pos.some((x, i) => x !== pilePos(row)[i])) fails.push(`${id} is built at ${show(s.pos)}, its element's row ${row} is at ${show(pilePos(row))}`);
      const gap = matrixGap(quatMatrix(s.rot), quatMatrix(pileRot(row)));
      if (gap > 1e-6) fails.push(`${id} is built turned ${show(s.rot)}, its element's row ${row} is turned ${show(pileRot(row))}`);
    }
    none(fails, 'each element body is built at its own element\'s position and rotation');
  }, TIMEOUT);

  it(`${ID} (capacity) a world whose capacity: {bodies} is below the element count is refused at check, naming both counts`, () => {
    const [checked] = physics([sceneCheck(pileScene(PILE - 1), PILE_WORLD)]);
    const errors = errorsOf(checked, 'the pile with capacity.bodies 399');
    const atCapacity = errors.filter((e) => /(^|\/)capacity(\/bodies)?$/.test(String(e['path'] ?? '')));
    expect(atCapacity.length, `an error issue at capacity/bodies (or capacity); the errors: ${show(errors)}`).toBeGreaterThan(0);
    const both = atCapacity.filter((e) => /\b399\b/.test(JSON.stringify(e)) && /\b400\b/.test(JSON.stringify(e)));
    expect(both.map((e) => show(e)), `it names both the capacity, 399, and the element count, 400: ${show(atCapacity)}`).not.toEqual([]);
  }, TIMEOUT);
});
