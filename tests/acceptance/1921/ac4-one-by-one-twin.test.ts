// #1921.e35aba59: 400 boxes and 400 balls dropped on a plane give, at every one of 600 steps, the same world state hash
// as a twin world that declares the 800 bodies one by one in the same order.
//
// The drop's world (helpers.ts: dropScene), baked in its scene by `deep-physics`: a static plane and two bodies with
// `each:`, one per element of `boxes` and of `balls` (IDs 1000 … 1399 each), dropped from 1 m to 19.70 m, so over the
// 600 steps (5 s) they fall, land, settle and sleep. The twin (helpers.ts: oneByOneTwin) is a plain world document with
// the same plane, shapes and materials and the 800 bodies declared one by one in element-ID order, each with the
// each-body's fields, its element's pose and the stable ID its element body has (`balls#1000` …), so the two worlds hold
// the same bodies in the same canonical order. Each bake answers #2010's `step_hashes`, index k the world state hash
// after k steps (0: as built); the two lists are equal at every index from 0 to 600, and the hash moves (the bodies do).
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DROP_STEPS, DROP_WORLD, TIMEOUT, dropScene, errorsOf, none, oneByOneTwin, physics, prebuild, sceneBake, show, stepHashes,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[4];

describe(`${ID} bodies built per instancer element step exactly as the same bodies declared one by one`, () => {
  it(`${ID} 400 boxes and 400 balls dropped on a plane give, at every one of 600 steps, the same world state hash as a twin world that declares the 800 bodies one by one in the same order`, () => {
    const twin = oneByOneTwin();
    const [twinCheck, each, oneByOne] = physics([
      { call: 'check', world: twin },
      sceneBake(dropScene(), DROP_WORLD, DROP_STEPS, { read: [] }),
      { call: 'bake', world: twin, steps: DROP_STEPS, read: [] },
    ]);
    none(errorsOf(twinCheck, 'the one-by-one twin').map((e) => show(e)), 'the twin, 800 bodies declared one by one, checks with no error');
    const a = stepHashes(each!, DROP_STEPS + 1, 'the drop, bodies per element');
    const b = stepHashes(oneByOne!, DROP_STEPS + 1, 'the twin, bodies one by one');
    expect(a[DROP_STEPS], 'the world state moves over the 600 steps: the last hash isn\'t the built state\'s').not.toBe(a[0]);
    const first = a.findIndex((h, k) => h !== b[k]);
    expect(first, first < 0 ? '' : `the hashes first differ after step ${first}: ${a[first]} per element, ${b[first]} one by one (${a.filter((h, k) => h !== b[k]).length} of 601 differ)`).toBe(-1);
  }, TIMEOUT);
});
