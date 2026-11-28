import assert from 'node:assert/strict';
import test from 'node:test';
import { rustTest, targetOf } from './lib.mjs';

const TARGET = targetOf('module_of_check');

test('#2130.995b1ac2 module_of_check of geometry.shading is Some(loop) in the sealed set of the core, with no loop module', () => {
  const { result, failure } = rustTest(TARGET, 'ac7_geometry_shading_names_the_loop_module_in_the_cores_sealed_set');
  assert.equal(result, 'ok', failure);
});
