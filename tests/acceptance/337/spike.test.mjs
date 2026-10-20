// Acceptance tests for issue #337, the two-day gpui-kit spike, on its record
// (docs/spikes/337/record.json), the files it names and the technical design. Nothing builds the app.
// Run: node --test tests/acceptance/337/spike.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { checks } from '../../../scripts/lanes.mjs';
import {
  budgetGateProblems, budgetProblems, BUDGETS, buildProblems, decisionProblems, FALLBACK, loadRecord, panelProblems, PANELS, preflightProblems, screenProblems,
  STOCKS, stocksProblems, windowProblems,
} from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);

test(`${PANELS} Claude Code's and Codex's JavaScript panels, written from the docs alone, each pass the headless test within two rounds of fixes`, () => {
  holds(panelProblems(loadRecord()));
});

test(`${FALLBACK} the decision is gpui-kit only when every criterion passed, and otherwise a small native app per platform (Swift on macOS) with no web view while extension panels wait; it says which, with its numbers, in the technical design`, () => {
  holds(decisionProblems(loadRecord()));
});

test(`${STOCKS} the stocks panel loads from recorded quotes, and a report from them opens in the browser`, () => {
  holds(stocksProblems(loadRecord()));
});

test(`${BUDGETS} cold start, idle CPU, memory, app size and the local preflight are each five runs on the reference Mac, beside the merge base's`, () => {
  holds(budgetProblems(loadRecord()));
});

test(`${BUDGETS} the toolkit passes only with cold start under 1 s, idle CPU under 1%, memory under 200 MB, an app under 60 MB and the local preflight under 5 minutes`, () => {
  const record = loadRecord();
  holds(budgetProblems(record));
  holds(budgetGateProblems(record));
});

test('scope: a window with a 1,000-row session list and the menu-bar count', () => {
  holds(windowProblems(loadRecord()));
});

test('scope: every screen is rendered to a snapshot and clicked headlessly, the window, the count and both panels among them', () => {
  holds(screenProblems(loadRecord()));
});

test('scope: the headless renders and clicks run in the local preflight, and nothing runs in CI', () => {
  holds(preflightProblems(loadRecord(), checks));
});

test('scope: the build time is recorded', () => {
  holds(buildProblems(loadRecord()));
});
