// #3165 acceptance: a merge conflict in scripts/lanes.mjs whose resolution keeps both sides' lines passes the guard
// with no approval, and nothing else does. Each test plants one real conflicting merge of main into the change in a
// scratch repository and runs `node scripts/proof.mjs guard` there (README: Surfaces, Readings).
import test from 'node:test';
import { CONFIG, G, GUARD, LANES, P, V, assertFails, assertPasses, config, guard, guardCode, lanesMerge, line, merged } from './helpers.mjs';

// Criterion 1: the additive resolution passes with no approval on the merge commit.

for (const [order, paths] of [
  ["main's line first", [P.one, P.two, P.main, P.change]],
  ["the change's line first", [P.one, P.two, P.change, P.main]],
]) {
  test(`#3165.8f9dd502 a conflict in scripts/lanes.mjs resolved by keeping both parents' added lines, ${order}, passes the guard with no approval`, (t) => {
    const scene = lanesMerge(t, paths);
    const result = guard(scene);
    assertPasses(result, 'guard');
    // The guard's rules for check files were in force: the change's own edit of the file passed by its approval.
    line(result, ['PASS'], 'guard', LANES, scene.short(scene.own));
  });
}

// Criterion 2: any other resolution fails, naming the file and the merge commit.

const OTHERS = [
  ["dropping main's added line", [P.one, P.two, P.change]],
  ["dropping the change's added line", [P.one, P.two, P.main]],
  ['keeping both lines and adding a third that neither parent holds', [P.one, P.two, P.main, P.change, P.third]],
  ['keeping both lines and removing a line both parents hold', [P.two, P.main, P.change]],
  // Scope: "each parent's lines keep their own order" (README: Reading 5).
  ['keeping every line and swapping two that both parents hold', [P.two, P.one, P.main, P.change]],
];

for (const [how, paths] of OTHERS) {
  test(`#3165.63b30585 the same conflict resolved by ${how} fails the guard, naming scripts/lanes.mjs and the merge commit`, (t) => {
    const scene = lanesMerge(t, paths);
    const result = guard(scene);
    assertFails(result, 'guard');
    line(result, ['FAIL'], 'guard', LANES, scene.short(scene.merge));
  });
}

// Criterion 3: the additive rule is lanes.mjs's alone.

for (const [what, scene] of [
  ['scripts/proof-guard.mjs', { path: GUARD, onMain: guardCode([G.one, G.two, G.main]), onChange: guardCode([G.one, G.two, G.change]), resolved: guardCode([G.one, G.two, G.main, G.change]) }],
  [`a test runner's config, ${CONFIG}`, { path: CONFIG, onMain: config([V.one, V.two, V.main]), onChange: config([V.one, V.two, V.change]), resolved: config([V.one, V.two, V.main, V.change]) }],
]) {
  test(`#3165.497038aa a conflict in ${what} resolved by keeping both parents' added lines fails the guard without an approval, naming the file`, (t) => {
    const result = guard(merged(t, scene));
    assertFails(result, 'guard');
    line(result, ['FAIL'], 'guard', scene.path);
  });
}

// Criterion 4: each failing resolution of lanes.mjs passes as an approved proposal, as before.

for (const [how, paths] of OTHERS) {
  test(`#3165.0b4ec1da the conflict resolved by ${how} passes the guard with an approval naming scripts/lanes.mjs on the merge commit`, (t) => {
    const scene = lanesMerge(t, paths, [LANES]);
    const result = guard(scene);
    assertPasses(result, 'guard');
    line(result, ['PASS'], 'guard', LANES, scene.short(scene.merge));
  });
}
