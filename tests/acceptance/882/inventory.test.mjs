// #882 AC4: "The inventory's check passes on this branch, and adding a panel without regenerating it fails, naming
// the panel". Scope: "A generated inventory of the app's surfaces, one row per registered panel: its entry, the roles
// it uses and any literal left, with a check mode that fails when the committed inventory differs from a fresh one".
// The script is scripts/app-inventory.mjs, its file crates/deep-app/inventory.json; README.md, The surface, pins how.
// Run: node --test tests/acceptance/882/inventory.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, repoRoot } from './common.mjs';
import { INVENTORY, SCRIPT, judgeInventory, shapeProblems } from './inventory-judge.mjs';

test(`${AC[4]} the inventory's check passes on this branch, and the committed inventory has a row per shipped panel with its entry, roles and literals`, () => {
  assert.ok(existsSync(join(repoRoot, SCRIPT)), `no inventory script at ${SCRIPT}`);
  const check = spawnSync(process.execPath, [join(repoRoot, SCRIPT), '--check'], { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 });
  const output = `${check.stdout ?? ''}${check.stderr ?? ''}`.trim();
  assert.deepEqual([check.status, output.split('\n').filter((l) => l.startsWith('FAIL'))], [0, []], output);
  assert.deepEqual(shapeProblems(join(repoRoot, INVENTORY)), []);
});

test(`${AC[4]} adding a panel without regenerating the inventory fails its check, naming the panel; regenerating passes it`, () => {
  assert.deepEqual(judgeInventory(join(repoRoot, SCRIPT)), []);
});
