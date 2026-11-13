// #1906: the object guard moved into one owner, preserving the boundary used by hub readers.
import { expect, it } from 'vitest';
import fc from 'fast-check';
import { registry } from '../src/index.js';

const object = registry([{ name:'object@1', schema:{type:'object',additionalProperties:true} }]);
it('an object schema never accepts a non-object or an array (1000 cases, seed 1906)', () => {
  fc.assert(fc.property(fc.jsonValue(), value => {
    const expected = value !== null && typeof value === 'object' && !Array.isArray(value);
    expect(object.validate('object@1', value).ok).toBe(expected);
  }), { seed:1906, numRuns:1000 });
  expect(object.validate('object@1', {}).ok).toBe(true);
  expect(object.validate('object@1', []).ok).toBe(false);
  expect(object.validate('object@1', null).ok).toBe(false);
});
