import assert from 'node:assert/strict';
import test from 'node:test';
import { rustTest, targetOf } from './lib.mjs';

const TARGET = targetOf('recipe_channels');

test('#2130.96087f96 a document channel at an ID the channel of the named test recipe expands to is refused bad_id at that channel', () => {
  const { result, failure } = rustTest(TARGET, 'ac5_a_document_channel_where_the_tests_recipe_channel_expands_to_is_refused_bad_id');
  assert.equal(result, 'ok', failure);
});

test('#2130.96087f96 a document channel at n1.rise, where the channel of a one-item recipe expands to, is refused bad_id', () => {
  const { result, failure } = rustTest(TARGET, 'ac5_a_document_channel_at_n1_rise_is_refused_bad_id');
  assert.equal(result, 'ok', failure);
});
