// Criterion 2, offline half: the plain-words line under Later, as extensions and the line in States people see agree
// on which surfaces are plain. It reads docs/technical-design.md here and at the base commit. Code reads the surfaces
// each names (README.md, The two lines); whether the two say the same of what a state reads as there, and whether any
// other line of the design contradicts the new text, is left to the taste call of criterion 5.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, judgeAgreement, read } from './helpers.mjs';

const CRITERION = 'AC2 #3472.afb5879c';

test(`${CRITERION} the line under Later, as extensions that says "plain words" and links States people see, and what States people see gained since ${BASE.slice(0, 8)}, name the same plain surfaces`, () => {
  const { later, gained, states } = read();
  assert.deepEqual(judgeAgreement({ later, text: gained, anchors: states.anchors }), [], 'the two lines do not agree on which surfaces are plain');
});
