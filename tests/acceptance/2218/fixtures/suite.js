// tests/suite.js of the fixture repo (#2218): the spec's suite, three node:test tests of checkToken. Each passes on
// the base commit and after the session's fix, so the suite's count is the only thing a `min_tests` can turn on.
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../src/auth.js');

test('checkToken accepts a token that expires in 2100', () => {
  assert.strictEqual(auth.checkToken({ exp: 4102444800 }), true);
});

test('checkToken answers with a boolean', () => {
  assert.strictEqual(typeof auth.checkToken({ exp: 4102444800 }), 'boolean');
});

test('checkToken leaves the token as it was', () => {
  const token = { exp: 4102444800 };
  auth.checkToken(token);
  assert.deepStrictEqual(token, { exp: 4102444800 });
});
