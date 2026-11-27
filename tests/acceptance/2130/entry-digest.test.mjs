import assert from 'node:assert/strict';
import test from 'node:test';
import { rustTest, targetOf } from './lib.mjs';

const TARGET = targetOf('entry_digest');

test('#2130.873c8710 the pack check refuses a data.layout@1 entry with no canonical form, naming the registry and the entry', () => {
  const { result, failure } = rustTest(TARGET, 'ac2_the_pack_check_refuses_an_entry_with_no_canonical_form_naming_registry_and_entry');
  assert.equal(result, 'ok', failure);
});

test('#2130.873c8710 the seal gives no entry a canvas module fills an empty digest', () => {
  const { result, failure } = rustTest(TARGET, 'ac2_the_seal_gives_no_module_entry_an_empty_digest');
  assert.equal(result, 'ok', failure);
});
