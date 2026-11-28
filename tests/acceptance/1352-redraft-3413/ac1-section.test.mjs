import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDED_QUESTIONS, DECISIONS, decidedCheck, readDesign, sectionCheck } from './helpers.mjs';

test('#1352.4c4e63a7 criterion 1 (redraft): the design\'s section anchored cloud-hub answers each of the eight Scope decisions, with at least eight "Not taken"', () => {
  const { heading, answered, notTaken, problems } = sectionCheck(readDesign());
  assert.deepEqual(problems, []);
  assert.ok(typeof heading === 'string' && heading.trim(), 'the section has no heading text');
  assert.equal(answered, DECISIONS.length, `the section "${heading}" answers ${answered} of the ${DECISIONS.length} decisions`);
  assert.ok(notTaken >= DECISIONS.length, `the section "${heading}" says "Not taken" ${notTaken} times`);
});

test('#1352.4c4e63a7 criterion 1 (redraft): each of the seven rows #1352 added is in a table with the Decided columns under Decisions, and one of them links to the section or names the hub and the cloud', () => {
  const { found, problems } = decidedCheck(readDesign());
  assert.deepEqual(problems, []);
  assert.deepEqual(found.map(({ question }) => question), ADDED_QUESTIONS, 'the rows found are not the seven #1352 added');
});
