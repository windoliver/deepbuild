// #1114: lanes.mjs's `timed` list holds every test file that calls one of the timing helpers at its own call site,
// checked by grepping this checkout's tree (README: The grep); the same check, given a planted list missing one
// entry, fails at its assertion, naming the file the entry covered.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTimed, covers, lanesLists, mustBeTimed } from './helpers.mjs';

test('#1114.f3e38214 every test file calling a timing helper is in lanes.mjs timed list, by a grep of the tree', () => {
  const { timed } = lanesLists();
  assert.ok(mustBeTimed().length, 'the grep found no file calling a timing helper, so it checks nothing');
  assertTimed(timed);
});

test('#1114.f3e38214 a planted timed list missing one file fails the grep check, naming the file', () => {
  const { timed } = lanesLists();
  assert.ok(Array.isArray(timed), `scripts/lanes.mjs exports no timed list (got ${JSON.stringify(timed)})`);
  const required = mustBeTimed();
  for (const file of [required[0], required.at(-1)]) {
    const planted = timed.filter((entry) => !covers([entry], file));
    assert.ok(planted.length < timed.length, `no entry of the timed list covers ${file}`);
    assert.throws(() => assertTimed(planted), (error) => error instanceof assert.AssertionError && error.message.includes(file),
      `the check passed, or failed without naming ${file}, on a list missing its entry`);
  }
});
