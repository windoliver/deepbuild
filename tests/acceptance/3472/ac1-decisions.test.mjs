// Criterion 1: States people see answers each decision of the Scope, with what was not taken, and the Decided tables
// gain their rows. Offline: both tests read docs/technical-design.md here and at the base commit. Code can't judge a
// design text, so the first holds what the section gained to a floor of words (README.md, The decisions' words); the
// taste call of criterion 5 covers the rest.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, judgeAnswers, judgeDecided, read } from './helpers.mjs';

const CRITERION = 'AC1 #3472.3ffabd82';
const SHORT = BASE.slice(0, 8);

test(`${CRITERION} what States people see gained since ${SHORT} holds the five Scope decisions (what a state reads as on a plain surface, the sentences, which surfaces are plain, the words for the levels, who holds a row's sentence to the list), each with "Not taken"`, () => {
  assert.deepEqual(judgeAnswers(read().gained), [], 'States people see does not answer each decision with what was not taken');
});

test(`${CRITERION} the Decided tables gained a row since ${SHORT}, with its question, its decision and what reopens it, that links into States people see, names it or holds the word "plain"`, () => {
  const { rows, states } = read();
  assert.deepEqual(judgeDecided({ rows, anchors: states.anchors }), [], 'the Decided tables did not gain their rows');
});
