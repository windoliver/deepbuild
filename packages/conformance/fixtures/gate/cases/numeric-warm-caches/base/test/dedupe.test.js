const test = require('node:test');
const assert = require('node:assert');
const { dedupe } = require('../src/dedupe.js');

test('dedupe keeps each item once, in order', () => {
  assert.deepStrictEqual(dedupe([3, 1, 3, 2, 1]), [3, 1, 2]);
});
