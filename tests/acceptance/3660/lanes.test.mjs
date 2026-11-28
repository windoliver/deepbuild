import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CHECKOUT } from '../3549/helpers.mjs';

const REDRAFT = 'tests/acceptance/3549-redraft-3660/';
const SWAPPED = ['turn', 'window', 'compiles'].map((name) => `tests/acceptance/3549/${name}.test.mjs`);

test('#3660.a7f3d0fa scripts/lanes-lists.mjs runs tests/acceptance/3549-redraft-3660/ in place of 3549\'s turn, window and compiles files, which it keeps by hand only, and every other file of tests/acceptance/3549/ runs as before', async () => {
  const { byHand, redrafted } = await import(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href);
  const folder = join(CHECKOUT, REDRAFT);
  assert.ok(existsSync(folder) && readdirSync(folder).some((name) => name.endsWith('.test.mjs')), `${REDRAFT} holds no test file to run in their place`);
  for (const path of SWAPPED) {
    assert.equal(redrafted[path], REDRAFT, `scripts/lanes-lists.mjs maps ${path} to ${redrafted[path] ?? 'nothing'}, not to its redraft ${REDRAFT}`);
    assert.ok(byHand.includes(path), `scripts/lanes-lists.mjs doesn't keep ${path} by hand only`);
  }
  const kept = readdirSync(join(CHECKOUT, 'tests/acceptance/3549')).filter((name) => name.endsWith('.test.mjs')).map((name) => `tests/acceptance/3549/${name}`).filter((path) => !SWAPPED.includes(path));
  assert.ok(kept.length > 0, 'tests/acceptance/3549/ holds no other test file');
  for (const path of kept) {
    assert.equal(redrafted[path], undefined, `scripts/lanes-lists.mjs maps ${path}, which passes unchanged, to ${redrafted[path]}`);
    assert.ok(!byHand.some((entry) => path === entry || (entry.endsWith('/') && path.startsWith(entry))), `scripts/lanes-lists.mjs keeps ${path}, which passes unchanged, by hand`);
  }
  assert.ok(!byHand.some((entry) => entry.startsWith(REDRAFT) || REDRAFT.startsWith(entry)), `scripts/lanes-lists.mjs keeps the redraft ${REDRAFT} by hand, so it doesn't run in their place`);
});
