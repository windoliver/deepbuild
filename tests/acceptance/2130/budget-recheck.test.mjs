import assert from 'node:assert/strict';
import test from 'node:test';
import { rustTest, targetOf } from './lib.mjs';

const TARGET = targetOf('budget_recheck');

test('#2130.766a56f0 a second light created past budget.lights 1 is rechecked against the whole document: None, or over_budget at budget/lights', () => {
  const { result, failure } = rustTest(TARGET, 'ac1_a_second_light_past_budget_lights_1_is_checked_against_the_whole_document');
  assert.equal(result, 'ok', failure);
});

test('#2130.766a56f0 a patch to one of three lights past budget.lights 2 keeps the over_budget the whole check raises', () => {
  const { result, failure } = rustTest(TARGET, 'ac1_a_patch_to_one_of_three_lights_past_budget_lights_2_keeps_the_over_budget');
  assert.equal(result, 'ok', failure);
});

test('#2130.766a56f0 a document whose budget names only a class is rechecked whole too: one fill light past the fill_shaded of its class', () => {
  const { result, failure } = rustTest(TARGET, 'ac1_a_document_whose_budget_names_only_a_class_is_checked_whole_too');
  assert.equal(result, 'ok', failure);
});
