import assert from 'node:assert/strict';
import test from 'node:test';
import { rustTest, targetOf } from './lib.mjs';

const TARGET = targetOf('migrates_from');

test('#2130.00e7dfcf a range some version of an earlier major meets is met by a module at 2.0.0 that migrates from it', () => {
  const { result, failure } = rustTest(TARGET, 'ac3_a_range_some_version_of_an_earlier_major_meets_is_met_by_a_module_that_migrates_from_it');
  assert.equal(result, 'ok', failure);
});
