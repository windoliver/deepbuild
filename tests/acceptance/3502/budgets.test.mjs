// #3502, eighth criterion: budgets, on the reference Mac in the local preflight, compared with the merge base:
// `terminal-60hz`, `canvas-idle`, `app-select-700` and `deep-list-700` read within their margins.
//
// The comparison is the budget window's (docs/parallel-proof.md, 12a): on a reference Mac it measures each merged
// commit against its own merge base, 20 samples a side, by `judgeTask` of scripts/benchmark.mjs, and proves a
// criterion through the tasks of benchmarks/budgets.json that name it. So, as #3440's budget criterion is carried,
// this test holds what makes that record this criterion's proof: each of the four tasks names the criterion, and each
// is the task the merge base holds, its command, margin, limits and targets unmoved (`validateBudgets`). No test here
// takes a sample or judges a time: a run outside a window is a reading, and agents never run the window.
// Run: node --test tests/acceptance/3502/budgets.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { blocked, mergeBase, read, REPO, showAt } from './common.mjs';

const CRITERION = '#3502.160644ed';
const TASKS = ['terminal-60hz', 'canvas-idle', 'app-select-700', 'deep-list-700'];
const BUDGETS = 'benchmarks/budgets.json';

test('AC8 #3502.160644ed terminal-60hz, canvas-idle, app-select-700 and deep-list-700 each name this criterion for the budget window, and each is the merge base\'s task, unmoved', async () => {
  const current = JSON.parse(read(REPO, BUDGETS));
  const base = JSON.parse(showAt(REPO, mergeBase(), BUDGETS));
  const { validateBudgets } = await import(pathToFileURL(join(REPO, 'scripts/benchmark.mjs')).href);
  let refused = '';
  try { validateBudgets(current, base); } catch (error) { refused = error.message; }
  assert.equal(refused, '', `${BUDGETS} is valid against the merge base's budgets`);
  for (const id of TASKS) {
    const [task, before] = [current.tasks.find((each) => each.id === id), base.tasks.find((each) => each.id === id)];
    if (!before) blocked(`the merge base's budgets hold no task ${id} to compare with`);
    const numbers = ({ command, margin, limits, targets } = {}) => ({ command, margin, limits, targets });
    assert.deepEqual(numbers(task), numbers(before), `the task ${id} keeps the merge base's command, margin, limits and targets, so its two sides compare like with like`);
    assert.ok((task.criteria ?? []).includes(CRITERION), `the task ${id} of ${BUDGETS} names ${CRITERION} in its criteria, so the budget window's record of it proves the criterion: it names ${JSON.stringify(task.criteria ?? [])}`);
  }
});
