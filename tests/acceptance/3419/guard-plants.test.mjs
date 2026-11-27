import assert from 'node:assert/strict';
import test from 'node:test';
import { OTHER, OWN, failLines, guard, laneJson, scene, testFile } from './helpers.mjs';

const FOLDER = `tests/acceptance/${OWN}/`;
const LANE = `${FOLDER}lane.json`;
const SUITE = { [`${FOLDER}plain.test.mjs`]: testFile(), [`${FOLDER}budgets.test.mjs`]: testFile() };

function assertWellMadePasses(t) {
  const box = scene(t, { commits: [{ files: { ...SUITE, [LANE]: laneJson({ timed: ['budgets.test.mjs'] }) }, approved: true }] });
  const checked = guard(box);
  assert.deepEqual(failLines(checked.stdout), [], `the guard refuses the well-made lane file (timed: a file of its folder its own commit adds), approved\n${checked.all}`);
  assert.equal(checked.status, 0, `the guard exits non-zero on the well-made lane file\n${checked.all}`);
}

function assertRefused(box, what) {
  const checked = guard(box);
  assert.notEqual(checked.status, 0, `the guard passes, approved, a lane file that ${what}\n${checked.all}`);
  assert.ok(failLines(checked.stdout).some((line) => line.includes(LANE)), `no FAIL line of the guard names ${LANE}, a lane file that ${what}, approved\n${checked.all}`);
}

test('#3419.79d243d9 the guard refuses, even approved, a lane file that names a file an earlier commit added', (t) => {
  assertWellMadePasses(t);
  const box = scene(t, { commits: [{ files: SUITE }, { files: { [LANE]: laneJson({ timed: ['budgets.test.mjs'] }) }, approved: true }] });
  assertRefused(box, 'names budgets.test.mjs, which an earlier commit of the change added');
});

test('#3419.79d243d9 the guard refuses, even approved, a lane file that names a file outside its folder', (t) => {
  assertWellMadePasses(t);
  const box = scene(t, { commits: [{ files: { ...SUITE, [`tests/acceptance/${OTHER}/budgets.test.mjs`]: testFile(), [LANE]: laneJson({ timed: [`../${OTHER}/budgets.test.mjs`] }) }, approved: true }] });
  assertRefused(box, `names ../${OTHER}/budgets.test.mjs, outside its folder`);
});

test("#3419.79d243d9 the guard refuses, even approved, a lane file that names a file the tree doesn't hold", (t) => {
  assertWellMadePasses(t);
  const box = scene(t, { commits: [{ files: { ...SUITE, [LANE]: laneJson({ timed: ['missing.test.mjs'] }) }, approved: true }] });
  assertRefused(box, "names missing.test.mjs, which the tree doesn't hold");
});

for (const key of ['byHand', 'skip']) {
  test(`#3419.79d243d9 the guard refuses, even approved, a lane file with a ${key} key`, (t) => {
    assertWellMadePasses(t);
    const box = scene(t, { commits: [{ files: { ...SUITE, [LANE]: laneJson({ timed: ['budgets.test.mjs'], [key]: ['plain.test.mjs'] }) }, approved: true }] });
    assertRefused(box, `has a ${key} key`);
  });
}
