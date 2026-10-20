// #47 acceptance: the corpus in the local preflight. The check runs as a lane of scripts/lanes.mjs's
// `checks`, and the replay as a perf task in benchmarks/budgets.json, which perf judges on the
// reference Mac and compares with the merge base. Run: node --test 'tests/acceptance/47/*.test.mjs'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ID, REPLAY_LIMIT_MS, root, SCRIPT } from './helpers.mjs';

const isNode = (command) => command === 'node' || command === process.execPath;

test(`${ID.range} the preflight runs the corpus check as a lane, on the repo's own corpus and facts`, async () => {
  const { checks } = await import(join(root, 'scripts/lanes.mjs'));
  const commands = checks.flatMap((lane) => lane.commands.map((command) => ({ lane: lane.name, command })));
  const found = commands.filter(({ command: [binary, ...args] }) => isNode(binary) && args[0] === SCRIPT && args[1] === 'check');
  assert.equal(found.length, 1, `one preflight lane runs node ${SCRIPT} check: ${JSON.stringify(checks.map(({ name, commands: run }) => ({ name, run })))}`);
  assert.deepEqual(found[0].command.slice(1), [SCRIPT, 'check'], `the lane passes no --corpus or --facts, so it checks adapters/corpus against adapters/: ${JSON.stringify(found[0])}`);
});

test(`${ID.budgets} the full replay is a perf task with a limit of 2 minutes, compared with the merge base`, () => {
  const budgets = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8'));
  const task = (budgets.tasks ?? []).find(({ command: [binary, ...args] = [] }) => isNode(binary) && args[0] === SCRIPT && args[1] === 'replay');
  assert.ok(task, `benchmarks/budgets.json has no task running node ${SCRIPT} replay`);
  assert.deepEqual(task.command.slice(1), [SCRIPT, 'replay'], `the task replays the whole corpus: ${JSON.stringify(task.command)}`);
  const timing = Object.entries(task.limits ?? {}).filter(([metric]) => metric === 'p50Ms' || metric === 'p95Ms');
  assert.ok(timing.length > 0 && timing.every(([, limit]) => limit <= REPLAY_LIMIT_MS), `a timing limit of at most ${REPLAY_LIMIT_MS} ms: ${JSON.stringify(task.limits)}`);
  assert.ok(Number.isFinite(task.margin) && task.margin > 0, `a margin for the merge-base comparison: ${task.margin}`);
});
