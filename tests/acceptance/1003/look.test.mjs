// #1003 AC1-AC4, the guard's half: the look's own guard, asked as the base asks it (`deep-canvas-render look`, one
// JSON line in, one out; README: The surface), on the fixture look and its plants (fixtures/look-1003.json; README:
// The planted looks) and on every shipped look. Each refusal criterion's plant is accepted by the merge base, so
// these fail there. Builds deep-canvas-render (crate deep-marks-render) once.
// Run: node --test tests/acceptance/1003/look.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AC, realGuard } from './common.mjs';
import {
  focusProblems, judgeBlocked, judgeBrightBlack, judgeControl, judgeFaintFocus, judgeNoFocus, judgeSelected, judgeShipped, plantRatios,
} from './look-judge.mjs';

test('the plants break only what their criteria name, at the ratios the README gives (the suite\'s own check)', () => {
  assert.deepEqual(plantRatios(), []);
});

// This control, the bright black plant and both focus plants are in redraft-1458/look.test.mjs: their fixture gave
// ink_tertiary at 3.59:1, which #1458's 4.5:1 floor refuses before a plant is reached, so they were redrafted blind on a
// fixture with two inks and disabled and swapped in with the owner's approval.

test(`${AC[1]} a planted look whose selected fill drops the secondary ink under its floor is refused, naming the role and "selected over raised"`, () => {
  assert.deepEqual(judgeSelected(realGuard), []);
});

test(`${AC[2]} a planted look whose blocked color keeps 3:1 on the ground but 2.9:1 on the raised ground is refused, naming the state and the surface`, () => {
  assert.deepEqual(judgeBlocked(realGuard), []);
});

test(`${AC[3]} every shipped look passes, in light and dark, and holds every floor on every surface, its terminal colors included`, () => {
  assert.deepEqual(judgeShipped(realGuard), []);
});


test(`${AC[4]} with a row selected and another focused, the shipped app look's focus ring keeps 3:1 on the selected fill and every other surface, light and dark`, () => {
  const [answer] = realGuard([{ look: 'clean' }]);
  const failures = answer?.ok === true ? [] : [`the clean look fails the guard: ${JSON.stringify({ ...answer, look: undefined }).slice(0, 300)}`];
  for (const theme of ['light', 'dark']) failures.push(...focusProblems(`clean (${theme})`, answer?.roles?.[theme]));
  assert.deepEqual(failures, []);
});


