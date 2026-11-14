// #1405's Proof: an A/A run of one real budget that doesn't read FAIL. verdict-1000-runs, the budget the
// issue saw move 3.5%, runs with its own command from benchmarks/budgets.json on both sides of `measure`,
// in this checkout, and its pairs are judged as judgeTask judges them.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { benchmark, macOnly, percent, root, roundPairs, shown, spreadOf } from './helpers.mjs';

const ID = 'verdict-1000-runs';

test('an A/A run of the real budget verdict-1000-runs doesn\'t read FAIL', { timeout: 1_800_000 }, async (t) => {
  macOnly();
  const { judgeInstructions, measure } = await benchmark('judgeInstructions', 'measure');
  const budget = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8')).tasks.find(({ id }) => id === ID);
  assert.ok(budget, `benchmarks/budgets.json has no ${ID}`);
  // The budget runs a built package, as perf's copies run it after their build.
  const packages = ['contracts', 'evidence', 'record', 'verdicts'];
  const built = packages.map((name) => `packages/${name}/dist/index.js`).filter((path) => !existsSync(join(root, path)));
  if (built.length) assert.fail(`BLOCKED: ${ID} needs its build, and ${built.join(', ')} are missing: npm ci && ${packages.map((name) => `npm run build -w @deepbuild/${name}`).join(' && ')}`);
  const [now, then] = measure(budget.command, root, { command: budget.command, cwd: root });
  const { pairs, uncounted } = roundPairs(now, then);
  const result = judgeInstructions(pairs, uncounted);
  t.diagnostic(`A/A pairs spread ${percent(spreadOf(pairs))}; read ${shown(result)}`);
  assert.notEqual(result?.status, 'FAIL', `the same budget on both sides: ${shown(result)}`);
});
