// tests/turnstile.js of the fixture repo (#2218 AC1): a check that passes on its first run and fails on every later
// one. The first run to make the folder below comes through; a run that finds it there fails. The folder lies outside
// every checkout (helpers.ts puts the world's own path in place of the placeholder), so the count holds whichever
// checkout a run gets, and whether runs start one after another or side by side: only one mkdir can win. On a tree
// that still accepts an expired token, as the merge base does, it is unarmed and passes every time, so a run of it on
// the merge base says nothing about the fixed tree's runs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const auth = require('../src/auth.js');

const TURNED = '__TURNED__';

test('an expired token is rejected, by the first run alone', () => {
  if (auth.checkToken({ exp: 1 })) return;
  let first = true;
  try {
    fs.mkdirSync(TURNED);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    first = false;
  }
  assert.ok(first, 'the turnstile has turned: an earlier run of this check came through');
});
