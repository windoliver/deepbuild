import assert from 'node:assert/strict';
import test from 'node:test';
import { rustTest, targetOf } from './lib.mjs';

const TARGET = targetOf('check_reads');

test('#2130.219ed3ba the not_exact refusal of a check with machines any that reads c.p names the array in its arrays', () => {
  const { result, failure } = rustTest(TARGET, 'ac6_a_not_exact_refusal_of_a_checks_read_names_the_array');
  assert.equal(result, 'ok', failure);
});

test('#2130.219ed3ba the unresolved_read refusal of a check that reads c.q, which no operator writes, names the array in its arrays', () => {
  const { result, failure } = rustTest(TARGET, 'ac6_an_unresolved_read_refusal_of_a_checks_read_names_the_array');
  assert.equal(result, 'ok', failure);
});
