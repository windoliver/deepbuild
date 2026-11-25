// Criterion 2, offline half: The learned layer, the audit lines in How we know version 0 works and the taste-rule
// line in Later, as extensions each say what holds on a project's hub. Code reads only that each place names a
// project's hub on one of its lines (README.md, The three places); what it says there is the taste call's to judge.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listed, placeProblems, readDesign } from './helpers.mjs';

test("AC2 #3242.a55ec11a The learned layer, the audit lines in How we know version 0 works and the taste-rule line in Later, as extensions each name a project's hub", () => {
  const problems = placeProblems(readDesign());
  assert.ok(!problems.length, `these places don't say what holds on a project's hub:${listed(problems)}`);
});
