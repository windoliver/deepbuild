const test = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const { verify } = require('../src/webhook.js');
const sign = (body) => createHmac('sha256', 'k').update(body).digest('hex');
test('a hex signature of the body verifies, and a wrong one does not', () => {
  assert.strictEqual(verify('{}', sign('{}'), 'k'), true);
  assert.strictEqual(verify('{}', sign('[]'), 'k'), false);
});
