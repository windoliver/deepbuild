// Criterion 2, offline half: The learned layer's audit lines say what a miss freezes and whose count starts an audit
// on a project's hub. Code reads only that a line of that section which holds `audit…` and names a project's hub
// holds each thing's words in a sentence the section didn't hold at the base (README.md, The audit lines); what it
// says there is the taste call's to judge. It reads docs/technical-design.md here and at the base commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditProblems, baseDesign, listed, readDesign } from './helpers.mjs';

test("AC2 #3400.7371b274 The learned layer's audit lines say what a miss freezes and whose count starts an audit on a project's hub, each in a sentence the section didn't hold at the base", () => {
  const problems = auditProblems(readDesign(), baseDesign());
  assert.ok(!problems.length, `The learned layer's audit lines don't say these on a project's hub:${listed(problems)}`);
});
