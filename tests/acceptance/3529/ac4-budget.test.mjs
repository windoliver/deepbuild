import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC, REPO, blocked, brief, isObject, must } from './common.mjs';

const TASK_THAT_NAMES_THE_CRITERION = 'canvas-core-first-reply';
const WIDEST_MARGIN_AGAINST_THE_MERGE_BASE = 0.5;

test(`AC4 ${AC[4]} a task of benchmarks/budgets.json, ${TASK_THAT_NAMES_THE_CRITERION}, names the criterion, so the budget window measures the canvas core's first reply with the shipped packs and its memory after it against the merge base, within a margin no wider than 50%`, { timeout: 60_000 }, () => {
  let budgets;
  try {
    budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8'));
  } catch (error) {
    throw blocked(`benchmarks/budgets.json can't be read: ${error.message}`);
  }
  if (!Array.isArray(budgets.tasks)) throw blocked('benchmarks/budgets.json holds no tasks');
  const naming = budgets.tasks.filter((task) => Array.isArray(task?.criteria) && task.criteria.includes(AC[4]));
  must(naming.length > 0, `AC4 ${AC[4]}: no task of benchmarks/budgets.json names ${AC[4]} in its criteria, so no budget window measures the canvas core's first reply with the shipped packs, or its memory after that reply, against the merge base (README: The budget's task)`);
  const task = naming.find(({ id }) => id === TASK_THAT_NAMES_THE_CRITERION);
  must(task !== undefined, `AC4 ${AC[4]}: the task that names ${AC[4]} is ${naming.map(({ id }) => brief(id)).join(', ')}, not ${TASK_THAT_NAMES_THE_CRITERION} (README: The budget's task)`);
  const failures = [];
  const command = task.command;
  if (!Array.isArray(command) || command.length < 2 || command.some((part) => typeof part !== 'string' || !part)) failures.push(`its command is ${brief(command ?? null)}, not a program and its arguments`);
  else if (command[0] !== 'node' || !/^benchmarks\/[\w.-]+\.mjs$/.test(command[1]) || !existsSync(join(REPO, command[1]))) failures.push(`its command is ${brief(command)}, not node and a benchmark of this checkout (benchmarks/<name>.mjs)`);
  if (!Number.isFinite(task.margin) || task.margin < 0 || task.margin > WIDEST_MARGIN_AGAINST_THE_MERGE_BASE) failures.push(`its margin is ${brief(task.margin ?? null)}, not a share from 0 to ${WIDEST_MARGIN_AGAINST_THE_MERGE_BASE}: its memory after the reply is to read within its margin of the merge base's`);
  if (!isObject(task.limits)) failures.push(`its limits are ${brief(task.limits ?? null)}, not an object`);
  if (typeof task.initialReason !== 'string' || !task.initialReason.trim()) failures.push('it gives no initialReason: what its command measures, since the merge base has no such task');
  must(failures.length === 0, `AC4 ${AC[4]}: ${TASK_THAT_NAMES_THE_CRITERION} in benchmarks/budgets.json can't be measured as the budget window measures a task: ${failures.join('; ')}`);
});
