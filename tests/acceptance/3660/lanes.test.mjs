import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CHECKOUT } from '../3549/helpers.mjs';

const ORIGINAL = 'tests/acceptance/3549/';
const UNDER_3660 = 'tests/acceptance/3549-redraft-3660/';
const UNDER_3694 = 'tests/acceptance/3549-redraft-3694/';
const file = (folder, name) => `${folder}${name}.test.mjs`;

test('#3660.a7f3d0fa scripts/lanes-lists.mjs runs tests/acceptance/3549-redraft-3660/ in place of 3549\'s turn, window and compiles files, which it keeps by hand only, keeps by hand the window file of 3549-redraft-3694 that it replaces too, and lists every other file of tests/acceptance/3549/ as before', async () => {
  const { byHand, redrafted } = await import(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href);
  const handOnly = (path) => byHand.some((entry) => path === entry || (entry.endsWith('/') && path.startsWith(entry)));
  const mapped = (path) => redrafted[path] ?? 'nothing';

  for (const name of ['turn', 'window', 'compiles']) {
    const [original, redraft] = [file(ORIGINAL, name), file(UNDER_3660, name)];
    assert.ok(existsSync(join(CHECKOUT, redraft)), `${redraft} is not there to run in place of ${original}`);
    assert.equal(redrafted[original], UNDER_3660, `scripts/lanes-lists.mjs maps ${original} to ${mapped(original)}, not to its redraft ${UNDER_3660}`);
    assert.ok(handOnly(original), `scripts/lanes-lists.mjs doesn't keep ${original} by hand only`);
    assert.ok(!handOnly(redraft), `scripts/lanes-lists.mjs keeps ${redraft} by hand, so it doesn't run in place of ${original}`);
    assert.equal(redrafted[redraft], undefined, `scripts/lanes-lists.mjs maps the redraft ${redraft} on to ${mapped(redraft)}`);
  }

  const replaced = file(UNDER_3694, 'window');
  assert.ok(handOnly(replaced), `scripts/lanes-lists.mjs doesn't keep ${replaced} by hand only: its third test has a build wait for its turn past its own --wait 0.05, which option A reverses, so it can't run as it is beside ${file(UNDER_3660, 'window')}`);
  assert.ok([undefined, UNDER_3660].includes(redrafted[replaced]), `scripts/lanes-lists.mjs maps ${replaced} to ${mapped(replaced)}: the file that runs in its place is in ${UNDER_3660}`);

  for (const name of ['passes', 'timed']) {
    const [original, redraft] = [file(ORIGINAL, name), file(UNDER_3694, name)];
    assert.equal(redrafted[original], UNDER_3694, `scripts/lanes-lists.mjs maps ${original} to ${mapped(original)}, not to ${UNDER_3694} as before`);
    assert.ok(handOnly(original), `scripts/lanes-lists.mjs no longer keeps ${original} by hand only`);
    assert.ok(!handOnly(redraft), `scripts/lanes-lists.mjs keeps ${redraft}, which passes unchanged, by hand, so nothing runs in place of ${original}`);
    assert.equal(redrafted[redraft], undefined, `scripts/lanes-lists.mjs maps ${redraft}, which passes unchanged, to ${mapped(redraft)}`);
  }

  for (const name of ['admission', 'log', 'design']) {
    const original = file(ORIGINAL, name);
    assert.equal(redrafted[original], undefined, `scripts/lanes-lists.mjs maps ${original}, which passes unchanged, to ${mapped(original)}`);
    assert.ok(!handOnly(original), `scripts/lanes-lists.mjs keeps ${original}, which passes unchanged, by hand`);
  }
});
