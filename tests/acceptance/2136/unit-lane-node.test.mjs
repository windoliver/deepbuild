// #2136, criterion 3: the unit lane's node block runs no live test and no fixture project's test. Read from the unit
// lane's node --test command, as scripts/lanes.mjs exports it, by expanding its file patterns in this checkout as
// node --test does (never into node_modules) and keeping the repository's files.
import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { sep } from 'node:path';
import test from 'node:test';
import { CHECKOUT, lanesOf, repoFiles } from './helpers.mjs';

test('#2136.06841e2a no file named *.live.test.mjs and no file under a fixtures folder is among the files the unit lane\'s node command\'s patterns expand to', () => {
  const node = lanesOf(CHECKOUT).unit.find(([first]) => first === '--test');
  assert.ok(node, 'the unit lane has no node --test command');
  const patterns = node.slice(1).filter((arg) => !arg.startsWith('-'));
  const files = new Set(repoFiles(CHECKOUT));
  const expanded = globSync(patterns, { cwd: CHECKOUT, exclude: (name) => name === 'node_modules' }).map((path) => path.split(sep).join('/')).filter((path) => files.has(path)).sort();
  assert.ok(expanded.length > 0, `the node command's patterns expand to no file of the repository: ${patterns.join(' ')}`);
  const live = expanded.filter((path) => /\.live\.test\.mjs$/.test(path));
  const fixtures = expanded.filter((path) => path.split('/').slice(0, -1).includes('fixtures'));
  // Five when the issue was written: the two live panel files and the three passes-on-retry fixture files.
  assert.deepEqual([...new Set([...live, ...fixtures])].sort(), [], `the unit lane's node command (node ${node.join(' ')}) runs ${live.length} live test files and ${fixtures.length} files under a fixtures folder`);
});
