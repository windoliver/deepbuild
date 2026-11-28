import assert from 'node:assert/strict';
import test from 'node:test';
import { rustTest, targetOf } from './lib.mjs';

const TARGET = targetOf('duplicate_check_kind');

test('#2130.b3f91bae the seal refuses a module that registers the check kind c.audit twice, with duplicate_check_kind naming the module', () => {
  const { result, failure } = rustTest(TARGET, 'ac4_the_seal_refuses_a_module_that_registers_one_check_kind_twice');
  assert.equal(result, 'ok', failure);
});
