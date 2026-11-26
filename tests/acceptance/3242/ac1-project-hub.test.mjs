// Criterion 1: One hub for a project answers each of the issue's four Scope decisions, with what was not taken, and
// the Decided table gains its rows. Offline: it reads docs/technical-design.md here and at the base commit. What a
// line is, the words a decision's answer has to hold and which rows are gained are in README.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUB, NO_HUB, baseDesign, decisionProblems, listed, readDesign, rowProblems, sectionAt } from './helpers.mjs';

test('AC1 #3242.7fbbc69e One hub for a project answers each of the four decisions (who is audited, whose answers make a rule, where a quote is checked, who a habit belongs to), each on a line of its own section that says "Not taken"', () => {
  const section = sectionAt(readDesign(), HUB);
  assert.ok(section, NO_HUB);
  const problems = decisionProblems(section.lines);
  assert.ok(!problems.length, `the section "${section.heading}" doesn't answer these decisions with what was not taken:${listed(problems)}`);
});

test('AC1 #3242.7fbbc69e the Decided tables gain a row for each of the four decisions: a row whose question no Decided row had at the base', () => {
  const problems = rowProblems(readDesign(), baseDesign());
  assert.ok(!problems.length, `the Decided tables haven't gained their rows:${listed(problems)}`);
});
