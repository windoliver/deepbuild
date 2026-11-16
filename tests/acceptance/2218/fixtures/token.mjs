// packages/token/token.mjs of the twin's fixture repo (#2218 AC5): the tests this repo's `test` check finds under
// packages. Both pass on the base commit and after the session's fix.
import test from 'node:test';
import assert from 'node:assert';
import auth from '../../src/auth.js';

test('checkToken accepts a token that expires in 2100', () => {
  assert.strictEqual(auth.checkToken({ exp: 4102444800 }), true);
});

test('checkToken answers with a boolean', () => {
  assert.strictEqual(typeof auth.checkToken({ exp: 4102444800 }), 'boolean');
});
